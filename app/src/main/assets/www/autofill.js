// JobPilot autofill engine. Injected into job application pages (Greenhouse, Lever,
// Ashby, Workday, SmartRecruiters, Workable, iCIMS, generic forms).
//   await window.__jobpilot.run(payload)  -> report
//   window.__jobpilot.start(payload); window.__jobpilot.status()  (for hosts that can't await)
(function () {
  if (window.__jobpilot) return;

  // Rules for ordinary fields: label regex -> profile key. First match wins, so order matters.
  const FIELD_RULES = [
    [/first.?name|given.?name|fname|forename/i, 'firstName'],
    [/last.?name|family.?name|surname|lname/i, 'lastName'],
    [/preferred.?(first.?)?name/i, 'firstName'],
    [/^(full.?|legal.?|your.?|candidate.?)?name$/i, 'fullName'],
    [/e-?mail/i, 'email'],
    [/phone|mobile|telephone|cell/i, 'phone'],
    [/linkedin/i, 'linkedin'],
    [/github/i, 'github'],
    [/portfolio|personal.?(web)?site|website|blog|^url$|other.?(web)?site/i, 'website'],
    [/street|address.?(line)?.?1?$|^address/i, 'address'],
    [/zip|postal/i, 'zip'],
    [/^city\b|\bcity$|^town/i, 'city'],
    [/^(state|province|region)\b/i, 'state'],
    [/^country/i, 'country'],
    [/location|where (are you|do you) (located|based|live)/i, 'location'],
    [/current.?(company|employer)|^employer|^organi[sz]ation/i, 'currentCompany'],
    [/current.?(job.?)?(title|role|position)|^job title|^title$/i, 'currentTitle'],
    [/years.?(of)?.?(professional |relevant )?experience/i, 'yearsExperience'],
    [/school|university|college|institution/i, 'school'],
    [/^degree|education level|highest.*education/i, 'degree'],
    [/graduat/i, 'gradYear'],
    [/salary|compensation|pay expectation|desired pay/i, 'salary'],
    [/start date|available to start|notice period|earliest/i, 'startDate'],
    [/pronouns?\b/i, 'pronouns'],
    [/gender|^sex$/i, 'gender'],
    [/race|ethnic|hispanic|latino/i, 'race'],
    [/veteran/i, 'veteran'],
    [/disabilit/i, 'disability'],
    [/cover.?letter|additional information/i, p => p.coverLetter],
    [/^(professional )?summary|about (yourself|you)$/i, 'summary']
  ];

  // Rules for yes/no style questions ("Are you…?", "Will you…?"). Only these may answer them,
  // so a question that merely mentions "state" or "city" never gets an address back.
  const QUESTION_RULES = [
    [/sponsor/i, 'needsSponsorship'],
    [/authori[sz]ed|legally (able|eligible|permitted)|right to work|work permit|eligible to work/i, 'workAuthorized'],
    [/relocat/i, 'willingToRelocate'],
    [/18 (years|or older)|of legal age|at least 18/i, () => 'Yes'],
    [/(consent|agree|acknowledge|certify|privacy (notice|policy))(?!.*(market|newsletter|sms|text message|promot))/i, () => 'Yes'],
    [/veteran/i, 'veteran'],
    [/disabilit/i, 'disability'],
    [/gender|identify as/i, 'gender'],
    [/race|ethnic|hispanic|latino/i, 'race'],
    [/pronouns?\b/i, 'pronouns'],
    [/(located|based|live|reside) in the (us|u\.s\.|united states)/i, p => /united states|^us$|usa/i.test(p.country) ? 'Yes' : 'No']
  ];

  const SKIP_TYPES = /^(hidden|submit|button|reset|image|password|search)$/i;
  const OPEN_QUESTION = /why|describe|tell us|explain|what (makes|excites|interests|has been)|how would|share|motivat|proudest|favorite/i;
  const OPTION_SEL = '[role="option"], .dropdown-results > *, .pac-item, [class*="option"][id*="option"]';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function clean(s) { return (s || '').replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim(); }

  // Text of a node without the text of any form controls or option lists inside it.
  function textOf(node) {
    if (!node) return '';
    const c = node.cloneNode(true);
    c.querySelectorAll('input, select, textarea, ul, ol, [role="listbox"], [class*="dropdown"], style, script, [class*="error"], [class*="hint"]').forEach(n => n.remove());
    return clean(c.textContent);
  }

  function strongLabel(el) {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && textOf(l)) return textOf(l);
    }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = clean(lb.split(/\s+/).map(id => textOf(document.getElementById(id))).join(' ')); if (t) return t; }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const wrap = el.closest('label'); if (wrap && textOf(wrap)) return textOf(wrap);
    // Walk up to the field's container and use its leading text (Lever / Workday / Ashby style).
    let c = el.parentElement;
    for (let i = 0; i < 5 && c && c !== document.body; i++, c = c.parentElement) {
      const n = Array.from(c.querySelectorAll('label, legend, [class*="label"], [class*="question"], [class*="title"], h3, h4, p'))
        .find(n => !n.contains(el) && textOf(n) && textOf(n).length < 300);
      if (n) return textOf(n);
    }
    return '';
  }

  function labelFor(el) {
    return [strongLabel(el), el.getAttribute('placeholder'), el.getAttribute('autocomplete'), el.name, el.id]
      .map(clean).filter(Boolean).join(' | ');
  }

  // "Are you…?" / "Do you…?" questions may only be answered by QUESTION_RULES.
  function isYesNo(t) { return /^(do|are|have|will|would|can|is|did|were|has|please confirm)\b/i.test(t); }

  function apply(rules, text, p) {
    for (const [re, key] of rules) if (re.test(text)) { const v = typeof key === 'function' ? key(p) : p[key]; if (v) return v; }
    return null;
  }

  function valueFor(el, payload, labelOverride) {
    const p = { ...payload.profile, coverLetter: payload.coverLetter };
    const primary = labelOverride || strongLabel(el) || clean(el.getAttribute('placeholder'));
    const low = primary.toLowerCase();
    // Saved / AI answers match on question text first: they are the most specific.
    const ans = payload.answers.find(x => x.q && x.q.trim() && low.includes(x.q.toLowerCase().trim().slice(0, 60)));
    if (ans) return ans.a;
    if (isYesNo(primary)) return apply(QUESTION_RULES, primary, p);
    if (/\?\s*$/.test(primary)) { const v = apply(QUESTION_RULES, primary, p); if (v) return v; }
    if (primary) { const v = apply(FIELD_RULES, primary, p); if (v) return v; }
    // Fall back to the placeholder and machine hints (autocomplete / name / id), one at a time.
    for (const hint of [el.getAttribute('placeholder'), el.getAttribute('autocomplete'), el.name, el.id]) {
      if (!hint || /^(on|off)$/.test(hint) || clean(hint) === primary || /^[0-9a-f-]{20,}$|^cards\[/i.test(hint)) continue;
      const h = clean(hint.replace(/[_\-\[\]]+/g, ' '));
      if (isYesNo(h)) continue;
      const v = apply(FIELD_RULES, h, p); if (v) return v;
    }
    return null;
  }

  // React/Vue/Angular track values through the native setter; assigning .value alone is ignored.
  function setNative(el, value, blur = true) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (blur) el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function norm(s) { return clean(s).toLowerCase(); }
  function bestOption(options, value) {
    const v = norm(value); if (!v) return null;
    const yes = /^(yes|y|true)\b/.test(v), no = /^(no|n|false)\b/.test(v);
    const decline = /decline|prefer not|do not want|don't wish|not to (say|answer)/.test(v);
    let best = null, score = 0;
    for (const o of options) {
      const t = norm(o.text); if (!t || /^(select|choose|--|please select)/.test(t)) continue;
      let s = 0;
      if (t === v) s = 100;
      else if (yes && /^yes\b/.test(t)) s = 90;
      else if (no && /^no\b/.test(t)) s = 90;
      else if (decline && /decline|prefer not|do not want|don't wish|not to (say|answer|disclose)|wish to answer/.test(t)) s = 85;
      else if (t.includes(v) || v.includes(t)) s = 60 + Math.min(t.length, v.length) / 10;
      else { const words = v.split(/\W+/).filter(w => w.length > 2); s = words.filter(w => t.includes(w)).length * 12; }
      if (s > score) { score = s; best = o; }
    }
    return score >= 24 ? best : null;
  }

  function mark(el, ok) {
    if (!el) return;
    el.style.outline = ok ? '2px solid #12a150' : '2px solid #dc2626';
    el.style.outlineOffset = '1px';
    el.dataset.jobpilot = ok ? 'filled' : 'missing';
  }

  function visible(el) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  // Hidden inputs that widgets keep for form validation (react-select's "requiredInput" etc.).
  function isProxy(el) {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const cs = getComputedStyle(el);
    return el.tabIndex < 0 && (cs.opacity === '0' || el.getBoundingClientRect().width <= 2);
  }

  function isRequired(el, label) {
    return el.required || el.getAttribute('aria-required') === 'true' || /required/i.test(label) ||
      !!(el.closest('[class*="required"]'));
  }

  function b64ToFile(r) {
    const bin = atob(r.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], r.name, { type: r.mime || 'application/pdf' });
  }

  function attachResume(input, payload) {
    if (!payload.resume || !payload.resume.data) return false;
    try {
      const dt = new DataTransfer(); dt.items.add(b64ToFile(payload.resume));
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.files.length > 0;
    } catch (e) { return false; }
  }

  function press(el, key) {
    const code = { ArrowDown: 40, Enter: 13 }[key];
    el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode: code, which: code, bubbles: true }));
  }
  function clickLike(n) {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
  }
  function visibleOptions(el) {
    const own = el.getAttribute('aria-controls') && document.getElementById(el.getAttribute('aria-controls'));
    const scope = own || el.closest('li, .field, [class*="field"], [class*="question"], form') || document;
    let opts = Array.from(scope.querySelectorAll(OPTION_SEL)).filter(visible);
    if (!opts.length) opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).filter(visible);
    return opts.map(n => ({ el: n, text: n.innerText }));
  }
  async function waitOptions(el, ms = 2500) {
    for (let t = 0; t < ms; t += 150) { const o = visibleOptions(el); if (o.length) return o; await sleep(150); }
    return [];
  }

  // Search-as-you-type dropdowns (react-select on Greenhouse, Ashby, location pickers on Lever).
  async function fillCombo(el, value, opts = {}) {
    el.focus(); clickLike(el);
    const search = opts.search != null ? opts.search : String(value).split(/[,(]/)[0].slice(0, 40);
    setNative(el, search, false);
    // Some pickers (Lever's location) search on key events rather than input events.
    const k = search.slice(-1) || 'a';
    for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: k, bubbles: true }));
    let options = await waitOptions(el, opts.search != null ? 4000 : 2500);
    let pick = opts.first ? options.find(o => norm(o.text).includes(norm(search))) || options[0] : bestOption(options, value);
    if (!pick && search) { // the list may filter differently than we searched: open it unfiltered
      setNative(el, '', false); press(el, 'ArrowDown');
      options = await waitOptions(el, 1500);
      pick = bestOption(options, value);
    }
    if (!pick) { setNative(el, '', false); press(el, 'Escape'); el.blur(); return null; }
    clickLike(pick.el);
    await sleep(250);
    el.blur();
    return clean(pick.text);
  }

  function isCombo(el) {
    return el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' ||
      /location-input|autocomplete/i.test(el.className || '');
  }

  // The question for a group of radio buttons: the nearest ancestor holding the whole group
  // that has text beyond the option labels.
  function groupQuestion(inputs) {
    let c = inputs[0].parentElement;
    while (c && !inputs.every(i => c.contains(i))) c = c.parentElement;
    for (let i = 0; i < 6 && c && c !== document.body; i++, c = c.parentElement) {
      const n = Array.from(c.querySelectorAll('legend, [class*="label"], [class*="question"], [class*="title"], h3, h4, p, label'))
        .find(n => !inputs.some(i => n.contains(i)) && textOf(n));
      if (n) return { q: textOf(n), box: c };
    }
    return { q: inputs[0].name || '', box: inputs[0].parentElement };
  }

  function optionLabel(i) { return clean((i.closest('label') || {}).innerText) || strongLabel(i) || i.value; }

  async function run(payload) {
    const report = { filled: 0, total: 0, missing: [], unanswered: [], resumeAttached: false, redirect: null,
      submitFound: false, title: document.title, description: '' };
    const p = payload.profile;

    // Many company career pages embed the real form in an ATS iframe we can't script; open it directly.
    const ats = Array.from(document.querySelectorAll('iframe')).find(f => /greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|icims|jobvite/.test(f.src || ''));
    if (ats && !document.querySelector('form input:not([type=hidden])')) { report.redirect = ats.src; return report; }

    let fields = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter(el => !SKIP_TYPES.test(el.type || '') && (el.type === 'file' || el.type === 'radio' || el.type === 'checkbox' || (visible(el) && !isProxy(el))));
    if (fields.filter(f => f.type !== 'file').length < 2) {
      // Posting page: jump to the form via an obvious "Apply" link or tab.
      const apply = Array.from(document.querySelectorAll('a, button, [role="tab"]')).find(a => /^\s*apply( for this job| now)?\s*$/i.test(a.innerText || '') || /^\s*application\s*$/i.test(a.innerText || ''));
      if (apply) { report.applyButton = true; apply.click(); }
    }

    report.description = clean((document.querySelector('[class*="description"], [class*="posting"], #content, main, article') || document.body).innerText).slice(0, 12000);

    const radios = {};
    let resumeDone = false;
    for (const el of fields) {
      if (el.dataset.jobpilot === 'filled') { report.total++; report.filled++; continue; }
      const type = (el.type || '').toLowerCase();
      if (type === 'radio') { (radios[el.name || strongLabel(el)] = radios[el.name || strongLabel(el)] || []).push(el); continue; }
      const label = strongLabel(el), all = labelFor(el);
      if (type === 'file') {
        if (/cover/i.test(all) || resumeDone) continue;
        if (!/resume|cv\b|curriculum/i.test(all) && fields.some(f => f.type === 'file' && /resume|cv\b/i.test(labelFor(f)))) continue;
        report.total++;
        if (attachResume(el, payload)) { resumeDone = report.resumeAttached = true; report.filled++; mark(el.closest('div') || el, true); el.dataset.jobpilot = 'filled'; }
        else report.missing.push('Resume upload');
        continue;
      }
      if (type === 'checkbox') {
        // Only tick required consent/acknowledgement boxes, never marketing opt-ins.
        const t = label || optionLabel(el);
        if (/agree|acknowledge|certify|consent|accurate|privacy/i.test(t) && !/market|newsletter|sms|text me|promot/i.test(t) && isRequired(el, t)) {
          if (!el.checked) el.click(); report.total++; report.filled++; mark(el, true);
        }
        continue;
      }
      if (el.value && el.value.trim()) continue; // never overwrite what's already there
      const req = isRequired(el, label);
      const v = valueFor(el, payload);
      report.total++;

      if (el.tagName === 'SELECT') {
        const options = Array.from(el.options);
        let opt = v && bestOption(options, v);
        if (!opt && /location|country/i.test(label)) opt = bestOption(options, p.country);
        if (opt) { setNative(el, opt.value); report.filled++; mark(el, true); }
        else { report.missing.push(label || all); if (req) mark(el, false); }
        continue;
      }
      if (isCombo(el)) {
        let got = null;
        if (v) {
          const isPlace = /location|city/i.test(label);
          got = await fillCombo(el, v, isPlace ? { search: p.city, first: true } : {});
          if (!got && /country/i.test(label)) got = await fillCombo(el, p.country);
        }
        if (got) { report.filled++; mark(el.closest('[class*="select__control"]') || el, true); el.dataset.jobpilot = 'filled'; }
        else { report.missing.push(label || all); if (req) mark(el.closest('[class*="select__control"]') || el, false); }
        continue;
      }
      if (v) { el.focus(); setNative(el, String(v)); report.filled++; mark(el, true); }
      else {
        report.missing.push(label || all);
        if (el.tagName === 'TEXTAREA' || OPEN_QUESTION.test(label)) report.unanswered.push(label);
        if (req) mark(el, false);
      }
    }

    for (const inputs of Object.values(radios)) {
      const { q, box } = groupQuestion(inputs);
      report.total++;
      const v = valueFor(inputs[0], payload, q);
      const pick = v && bestOption(inputs.map(i => ({ el: i, text: optionLabel(i) })), v);
      if (pick) { if (!pick.el.checked) pick.el.click(); report.filled++; mark(box, true); }
      else { report.missing.push(q); if (inputs.some(i => i.required)) mark(box, false); }
    }

    const submit = Array.from(document.querySelectorAll('button, input[type=submit]'))
      .find(b => /submit( application)?|send application|^apply$/i.test(clean(b.innerText || b.value || '')));
    report.submitFound = !!submit;
    const requiredLeft = document.querySelectorAll('[data-jobpilot="missing"]').length;
    if (payload.autoSubmit && submit && requiredLeft === 0 && report.filled > 0) { report.autoSubmitted = true; submit.click(); }

    const first = document.querySelector('[data-jobpilot="missing"]');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return report;
  }

  let last = null, running = false;
  window.__jobpilot = {
    run, labelFor, strongLabel,
    start(payload) {
      if (running) return;
      running = true; last = null;
      run(payload).then(r => { last = r; }, e => { last = { error: String(e), filled: 0, total: 0, missing: [], unanswered: [] }; })
        .finally(() => { running = false; });
    },
    status() { return running ? null : last; }
  };
})();
