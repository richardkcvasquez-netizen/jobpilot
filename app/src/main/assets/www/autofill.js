// JobPilot autofill engine. Injected into job application pages (Greenhouse, Lever,
// Ashby, Workday, SmartRecruiters, Workable, iCIMS, generic forms).
// Usage: window.__jobpilot.run(payload) -> report
(function () {
  if (window.__jobpilot) return;

  // label regex -> profile key (or function of payload). First match wins, so order matters.
  const RULES = [
    [/first.?name|given.?name|fname|forename/i, 'firstName'],
    [/last.?name|family.?name|surname|lname/i, 'lastName'],
    [/preferred.?name/i, 'firstName'],
    [/^(full.?)?name$|your name|legal name|candidate name/i, 'fullName'],
    [/e-?mail/i, 'email'],
    [/phone|mobile|telephone|cell/i, 'phone'],
    [/linkedin/i, 'linkedin'],
    [/github/i, 'github'],
    [/portfolio|personal.?(web)?site|website|blog|url/i, 'website'],
    [/street|address.?(line)?.?1?$|^address/i, 'address'],
    [/zip|postal/i, 'zip'],
    [/^city|city$|town/i, 'city'],
    [/\bstate\b(?! of)|province|region/i, 'state'],
    [/country/i, 'country'],
    [/current.?location|^location|where are you (located|based)/i, 'location'],
    [/current.?(company|employer)|employer|organi[sz]ation/i, 'currentCompany'],
    [/current.?(title|role|position)|job title|title/i, 'currentTitle'],
    [/years.?(of)?.?(professional )?experience/i, 'yearsExperience'],
    [/school|university|college|institution/i, 'school'],
    [/degree|education level/i, 'degree'],
    [/graduat/i, 'gradYear'],
    [/salary|compensation|pay expectation|desired pay/i, 'salary'],
    [/start date|available to start|notice period|earliest/i, 'startDate'],
    [/sponsor/i, 'needsSponsorship'],
    [/authori[sz]ed|legally (able|eligible)|right to work|work permit|eligib/i, 'workAuthorized'],
    [/relocat/i, 'willingToRelocate'],
    [/remote|hybrid|on.?site|work arrangement/i, 'remotePreference'],
    [/pronoun/i, 'pronouns'],
    [/gender|sex\b/i, 'gender'],
    [/race|ethnic|hispanic|latino/i, 'race'],
    [/veteran/i, 'veteran'],
    [/disabilit/i, 'disability'],
    [/cover.?letter/i, p => p.coverLetter],
    [/summary|about (yourself|you)|introduce yourself/i, 'summary']
  ];

  const SKIP_TYPES = /^(hidden|submit|button|reset|image|password|search)$/i;
  const OPEN_QUESTION = /why|describe|tell us|explain|what (makes|excites|interests)|how would|share|motivat/i;

  function clean(s) { return (s || '').replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim(); }

  function labelFor(el) {
    const bits = [];
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) bits.push(l.innerText);
    }
    const wrap = el.closest('label'); if (wrap) bits.push(wrap.innerText);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach(id => { const n = document.getElementById(id); if (n) bits.push(n.innerText); });
    bits.push(el.getAttribute('aria-label'), el.getAttribute('placeholder'));
    if (!clean(bits.join(''))) {
      // Walk up to the field's container and use its leading text (Lever/Workday/Ashby style).
      let c = el.parentElement;
      for (let i = 0; i < 4 && c; i++, c = c.parentElement) {
        const t = clean(Array.from(c.querySelectorAll('label, legend, .label, [class*="label"], [class*="question"], h3, h4, span, p'))
          .filter(n => !n.contains(el) && n.innerText && n.innerText.length < 300).map(n => n.innerText)[0]);
        if (t) { bits.push(t); break; }
      }
    }
    bits.push(el.getAttribute('autocomplete'), el.name, el.id);
    return clean(bits.filter(Boolean).join(' | '));
  }

  function primaryLabel(el) { return clean(labelFor(el).split(' | ')[0]); }

  function valueFor(label, payload) {
    const p = { ...payload.profile, coverLetter: payload.coverLetter };
    // Saved/AI answers match on question text first: they are more specific than profile rules.
    const low = label.toLowerCase();
    const ans = payload.answers.find(x => x.q && low.includes(x.q.toLowerCase().slice(0, 60)));
    if (ans) return ans.a;
    for (const [re, key] of RULES) {
      if (re.test(label)) { const v = typeof key === 'function' ? key(p) : p[key]; if (v) return v; }
    }
    return null;
  }

  // React/Vue/Angular track values through the native setter; assigning .value alone is ignored.
  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function norm(s) { return clean(s).toLowerCase(); }
  function bestOption(options, value) {
    const v = norm(value); if (!v) return null;
    const yes = /^(yes|y|true)\b/.test(v), no = /^(no|n|false)\b/.test(v);
    let best = null, score = 0;
    for (const o of options) {
      const t = norm(o.text); if (!t || /^(select|choose|--|please)/.test(t)) continue;
      let s = 0;
      if (t === v) s = 100;
      else if (yes && /^yes\b/.test(t)) s = 90;
      else if (no && /^no\b/.test(t)) s = 90;
      else if (t.includes(v) || v.includes(t)) s = 60 + Math.min(t.length, v.length);
      else { const words = v.split(/\W+/).filter(w => w.length > 2); s = words.filter(w => t.includes(w)).length * 10; }
      if (s > score) { score = s; best = o; }
    }
    return score >= 20 ? best : null;
  }

  function mark(el, ok) {
    el.style.outline = ok ? '2px solid #12a150' : '2px solid #dc2626';
    el.style.outlineOffset = '1px';
    el.dataset.jobpilot = ok ? 'filled' : 'missing';
  }

  function visible(el) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return (r.width > 0 || r.height > 0) && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function isRequired(el, label) {
    return el.required || el.getAttribute('aria-required') === 'true' || /\*|required/i.test(label + (el.closest('[class*="required"]') ? ' required' : ''));
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

  function fillRadioGroup(name, inputs, payload, report) {
    const group = inputs[0].closest('fieldset, [role="radiogroup"], .field, li, div');
    const q = clean((group && (group.querySelector('legend, label, .label, h3, h4, p') || {}).innerText) || name);
    const v = valueFor(q, payload);
    const opts = inputs.map(i => ({ el: i, text: primaryLabel(i) || i.value }));
    const pick = v && bestOption(opts, v);
    report.total++;
    if (pick) { pick.el.click(); report.filled++; mark(group || pick.el, true); }
    else { report.missing.push(q); if (group) mark(group, false); }
  }

  function run(payload) {
    const report = { filled: 0, total: 0, missing: [], unanswered: [], resumeAttached: false, redirect: null,
      submitFound: false, title: document.title, description: '' };

    // Many company career pages embed the real form in an ATS iframe we can't script; open it directly.
    const ats = Array.from(document.querySelectorAll('iframe')).find(f => /greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|icims|jobvite/.test(f.src || ''));
    if (ats && !document.querySelector('form input:not([type=hidden])')) { report.redirect = ats.src; return report; }

    // Some ATS pages show the posting first; jump to the form if there's an obvious "Apply" link.
    const fields = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => !SKIP_TYPES.test(el.type || '') && visible(el));
    if (fields.length < 2) {
      const apply = Array.from(document.querySelectorAll('a, button')).find(a => /^\s*apply( for this job| now)?\s*$/i.test(a.innerText || ''));
      if (apply) { report.applyButton = true; apply.click(); }
    }

    report.description = clean((document.querySelector('[class*="description"], [class*="posting"], #content, main, article') || document.body).innerText).slice(0, 12000);

    const radios = {};
    for (const el of fields) {
      if (el.dataset.jobpilot === 'filled') { report.total++; report.filled++; continue; }
      const type = (el.type || '').toLowerCase();
      if (type === 'radio') { (radios[el.name] = radios[el.name] || []).push(el); continue; }
      const label = labelFor(el);
      if (type === 'file') {
        if (/resume|cv|curriculum/i.test(label) || !report.resumeAttached) {
          if (/cover/i.test(label)) continue;
          report.total++;
          if (attachResume(el, payload)) { report.resumeAttached = true; report.filled++; mark(el, true); }
          else report.missing.push('Resume upload');
        }
        continue;
      }
      if (type === 'checkbox') {
        // Only tick consent/acknowledgement boxes, never marketing opt-ins.
        if (/agree|acknowledge|certify|consent|accurate|privacy/i.test(label) && !/market|newsletter|sms|text me|promot/i.test(label) && isRequired(el, label)) {
          if (!el.checked) el.click(); report.total++; report.filled++; mark(el, true);
        }
        continue;
      }
      if (el.value && el.value.trim()) continue; // never overwrite what's already there
      const v = valueFor(label, payload);
      const req = isRequired(el, label);
      if (el.tagName === 'SELECT') {
        report.total++;
        const opt = v && bestOption(Array.from(el.options), v);
        if (opt) { setNative(el, opt.value); report.filled++; mark(el, true); }
        else { report.missing.push(primaryLabel(el)); if (req) mark(el, false); }
        continue;
      }
      report.total++;
      if (v) { setNative(el, String(v)); report.filled++; mark(el, true); }
      else {
        const q = primaryLabel(el);
        report.missing.push(q);
        if (el.tagName === 'TEXTAREA' || OPEN_QUESTION.test(q)) report.unanswered.push(q);
        if (req) mark(el, false);
      }
    }
    Object.entries(radios).forEach(([name, inputs]) => fillRadioGroup(name, inputs, payload, report));

    const submit = Array.from(document.querySelectorAll('button, input[type=submit]'))
      .find(b => /submit( application)?|send application|apply$/i.test(b.innerText || b.value || ''));
    report.submitFound = !!submit;
    const requiredLeft = document.querySelectorAll('[data-jobpilot="missing"]').length;
    if (payload.autoSubmit && submit && requiredLeft === 0 && report.filled > 0) { report.autoSubmitted = true; submit.click(); }

    const first = document.querySelector('[data-jobpilot="missing"]');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return report;
  }

  window.__jobpilot = { run, labelFor };
})();
