// JobPilot UI. Plain JS, no build step: runs in the Android WebView and in any browser.
(function () {
  const S = Store.state;
  const isAndroid = !!window.Android;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUSES = ['queued', 'applied', 'interview', 'offer', 'rejected', 'skipped'];
  let tab = 'jobs', filter = 'all', queueRun = false;

  const App = {
    toast(msg, ms = 2600) {
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
      document.body.appendChild(t); setTimeout(() => t.remove(), ms);
    },
    render() {
      document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
      const v = $('#view'); v.innerHTML = '';
      ({ jobs: renderJobs, profile: renderProfile, answers: renderAnswers, settings: renderSettings })[tab](v);
    },
    // Called by Android when a URL is shared to the app from a browser / LinkedIn / Indeed.
    addJobFromShare(text) {
      const j = Store.addJob(text);
      if (j) { tab = 'jobs'; App.render(); App.toast('Added to queue: ' + (j.company || j.host)); }
      else App.toast('No link found in what was shared');
    },
    // Called by Android (or the browser simulator) when an apply session ends.
    onApplyResult(id, report, outcome) {
      const j = Store.job(id); if (!j) return;
      const patch = { filled: report ? { n: report.filled, of: report.total, at: Date.now() } : j.filled };
      if (report) {
        if (report.description && report.description.length > (j.description || '').length) patch.description = report.description;
        if (report.title && !j.title) patch.title = report.title.replace(/\s*[|–-].*$/, '').slice(0, 120);
        if (report.unanswered && report.unanswered.length) patch.pendingQuestions = report.unanswered;
      }
      if (outcome === 'applied') { patch.status = 'applied'; patch.applied = Date.now(); }
      if (outcome === 'skipped') patch.status = 'skipped';
      Store.updateJob(id, patch);
      App.render();
      if (outcome === 'applied') App.toast('Marked applied ✓');
      if (queueRun && outcome && outcome !== 'closed') { const next = S.jobs.find(x => x.status === 'queued'); if (next) setTimeout(() => apply(next), 400); else { queueRun = false; App.toast('Queue finished 🎉'); } }
      else queueRun = false;
    }
  };
  window.App = App;

  // ---------- Jobs ----------
  function renderJobs(v) {
    setTitle('Jobs', 'Your application queue');
    const c = s => S.jobs.filter(j => j.status === s).length;
    const list = S.jobs.filter(j => filter === 'all' || j.status === filter);
    const ready = profileReady();
    v.innerHTML = `
      ${ready ? '' : `<div class="card" style="border-color:var(--warn)"><b>Finish your profile first</b><div class="muted">Autofill uses your profile and resume. Add at least your name, email and resume.</div><button class="btn block" data-go="profile">Open profile</button></div>`}
      <div class="stats"><div class="stat"><b>${c('queued')}</b><span>Queued</span></div><div class="stat"><b>${c('applied')}</b><span>Applied</span></div><div class="stat"><b>${c('interview') + c('offer')}</b><span>Interviews</span></div></div>
      <div class="card"><div class="row"><input id="newUrl" class="grow" placeholder="Paste a job posting link…" inputmode="url" style="margin:0"><button class="btn primary" id="addBtn">Add</button></div>
        <div class="muted" style="margin-top:6px">${isAndroid ? 'Tip: in Chrome, LinkedIn or Indeed tap Share → JobPilot to add a job.' : 'Preview mode: Apply opens a sample form so you can watch autofill work.'}</div></div>
      ${c('queued') ? `<button class="btn primary block" id="runQueue">▶ Apply to ${c('queued')} queued job${c('queued') > 1 ? 's' : ''}</button>` : ''}
      <h2>Applications</h2>
      <div class="seg">${['all', ...STATUSES].map(s => `<button data-f="${s}" class="${filter === s ? 'on' : ''}">${cap(s)}${s === 'all' ? '' : ' ' + c(s)}</button>`).join('')}</div>
      ${list.length ? list.map(jobRow).join('') : `<div class="empty">No jobs here yet.<br>Paste a link above to start your queue.</div>`}`;
    $('#addBtn').onclick = () => { const j = Store.addJob($('#newUrl').value); if (!j) return App.toast('That doesn\'t look like a link'); App.render(); openJob(j.id); };
    $('#newUrl').onkeydown = e => { if (e.key === 'Enter') $('#addBtn').click(); };
    const rq = $('#runQueue'); if (rq) rq.onclick = () => { if (!ready) return App.toast('Add your name, email and resume first'); queueRun = true; apply(S.jobs.find(j => j.status === 'queued')); };
    v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; App.render(); });
    v.querySelectorAll('[data-job]').forEach(b => b.onclick = () => openJob(b.dataset.job));
    v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { tab = b.dataset.go; App.render(); });
  }

  function jobRow(j) {
    const pct = j.filled && j.filled.of ? Math.round(100 * j.filled.n / j.filled.of) : null;
    return `<div class="card job" data-job="${j.id}"><div class="ic">${esc((j.company || j.host || '?')[0].toUpperCase())}</div>
      <div class="grow"><div class="t">${esc(j.title || j.company || j.host)}</div>
      <div class="m">${esc(j.title ? j.company : j.host)} · ${ago(j.applied || j.added)}${pct != null ? ` · ${pct}% autofilled` : ''}</div></div>
      <span class="pill ${j.status}">${cap(j.status)}</span></div>`;
  }

  function openJob(id) {
    const j = Store.job(id); if (!j) return;
    const qs = (j.pendingQuestions || []);
    sheet(`
      <h3>${esc(j.title || j.company || j.host)}</h3>
      <div class="muted" style="word-break:break-all">${esc(j.url)}</div>
      <div class="row" style="margin-top:12px"><button class="btn primary grow" id="go">${j.status === 'queued' ? 'Autofill & apply' : 'Open application'}</button><button class="btn" id="st">Status</button></div>
      <label class="f">Title<input id="jt" value="${esc(j.title)}"></label>
      <label class="f">Company<input id="jc" value="${esc(j.company)}"></label>
      <label class="f">Status<select id="js">${STATUSES.map(s => `<option ${s === j.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f">Job description <span class="muted">(captured automatically when you open the job, or paste it)</span><textarea id="jd" style="min-height:110px">${esc(j.description)}</textarea></label>
      <h2>AI drafting</h2>
      <div class="card" style="margin:6px 0">
        ${j.fit ? `<div class="muted" style="margin-bottom:8px">${esc(j.fit)}</div>` : ''}
        <div class="muted">${qs.length ? `${qs.length} open question${qs.length > 1 ? 's' : ''} found on the form.` : 'Open questions on the form will appear here after the first autofill.'}</div>
        <button class="btn block" id="draft">✨ Draft cover letter${qs.length ? ' & answers' : ''}</button>
      </div>
      <label class="f">Cover letter<textarea id="jl" style="min-height:140px">${esc(j.coverLetter)}</textarea></label>
      ${(j.aiAnswers || []).map((a, i) => `<label class="f">${esc(a.q)}<textarea data-ai="${i}">${esc(a.a)}</textarea></label>`).join('')}
      <label class="f">Notes<textarea id="jn">${esc(j.notes)}</textarea></label>
      <div class="row" style="margin-top:14px"><button class="btn ghost" id="del" style="color:var(--bad)">Delete</button><span class="grow"></span><button class="btn primary" id="save">Save</button></div>`,
      root => {
        const collect = () => Store.updateJob(id, { title: $('#jt', root).value, company: $('#jc', root).value, status: $('#js', root).value,
          description: $('#jd', root).value, coverLetter: $('#jl', root).value, notes: $('#jn', root).value,
          aiAnswers: (j.aiAnswers || []).map((a, i) => ({ q: a.q, a: $(`[data-ai="${i}"]`, root).value })) });
        $('#save', root).onclick = () => { collect(); close(); App.render(); };
        $('#go', root).onclick = () => { collect(); close(); apply(Store.job(id)); };
        $('#st', root).onclick = () => $('#js', root).focus();
        $('#del', root).onclick = () => { if (confirm('Delete this job?')) { Store.removeJob(id); close(); App.render(); } };
        $('#draft', root).onclick = async e => {
          collect(); const b = e.target; b.disabled = true; b.textContent = 'Drafting…';
          try {
            const r = await AI.draft(Store.job(id));
            Store.updateJob(id, { coverLetter: r.coverLetter, aiAnswers: r.answers, fit: r.fitSummary,
              title: Store.job(id).title || r.title, company: Store.job(id).company || r.company });
            close(); openJob(id); App.toast('Draft ready. Review it before applying.');
          } catch (err) { b.disabled = false; b.textContent = '✨ Try again'; App.toast(AI.friendly(err), 4500); }
        };
      });
  }

  // ---------- Apply ----------
  function apply(job) {
    if (!job) return;
    const payload = Store.applyPayload(job);
    if (isAndroid) { Android.apply(job.id, job.url, JSON.stringify(payload)); return; }
    // Browser preview: real job sites can't be scripted from inside an iframe, so use the sample form.
    const ov = document.createElement('div'); ov.className = 'applyframe';
    ov.innerHTML = `<div class="bar"><button class="btn ghost" data-a="closed">✕</button><div class="grow muted" style="font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Sample form · ${esc(job.company || job.host)}</div>
      <button class="btn" data-a="fill">Autofill</button><button class="btn primary" data-a="applied">Applied ✓</button></div>
      <iframe src="demo-form.html"></iframe><div id="rep" class="muted" style="padding:6px 10px;background:var(--card);border-top:1px solid var(--line)">Loading…</div>`;
    document.body.appendChild(ov);
    const fr = $('iframe', ov); let report = null;
    const fill = () => {
      const w = fr.contentWindow, d = fr.contentDocument;
      if (!w.__jobpilot) { const s = d.createElement('script'); s.textContent = AUTOFILL_SRC; d.head.appendChild(s); }
      report = w.__jobpilot.run(payload);
      $('#rep', ov).innerHTML = `Filled <b>${report.filled}</b> of ${report.total} fields${report.resumeAttached ? ' · resume attached' : ''}${report.unanswered.length ? ` · <b>${report.unanswered.length}</b> question(s) need you or AI` : ''}`;
    };
    fr.onload = () => setTimeout(fill, 250);
    ov.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      if (b.dataset.a === 'fill') return fill();
      ov.remove(); App.onApplyResult(job.id, report, b.dataset.a);
    });
  }
  let AUTOFILL_SRC = '';
  if (!isAndroid) fetch('autofill.js').then(r => r.text()).then(t => AUTOFILL_SRC = t);

  // ---------- Profile ----------
  const GROUPS = [
    ['Basics', [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['pronouns', 'Pronouns']]],
    ['Location', [['address', 'Street address'], ['city', 'City'], ['state', 'State / province'], ['zip', 'ZIP / postal code'], ['country', 'Country']]],
    ['Links', [['linkedin', 'LinkedIn URL', 'url'], ['github', 'GitHub URL', 'url'], ['website', 'Portfolio / website', 'url']]],
    ['Work', [['currentTitle', 'Current title'], ['currentCompany', 'Current company'], ['yearsExperience', 'Years of experience'], ['salary', 'Salary expectation'], ['startDate', 'Availability / start date']]],
    ['Education', [['school', 'School'], ['degree', 'Degree'], ['gradYear', 'Graduation year']]],
    ['Eligibility', [['workAuthorized', 'Authorized to work?', ['Yes', 'No']], ['needsSponsorship', 'Need visa sponsorship?', ['No', 'Yes']], ['willingToRelocate', 'Willing to relocate?', ['Yes', 'No']], ['remotePreference', 'Work arrangement']]],
    ['Voluntary self-ID (optional)', [['gender', 'Gender'], ['race', 'Race / ethnicity'], ['veteran', 'Veteran status'], ['disability', 'Disability status']]]
  ];
  function renderProfile(v) {
    setTitle('Profile', 'Used to fill every application');
    const p = S.profile, r = S.resume;
    v.innerHTML = `
      <div class="card"><b>Resume</b><div class="muted">${r ? `📄 ${esc(r.name)} · ${Math.round(r.data.length * .75 / 1024)} KB` : 'PDF or DOCX, attached automatically to applications.'}</div>
        <label class="btn block" style="display:block;text-align:center">${r ? 'Replace resume' : 'Upload resume'}<input type="file" id="rf" accept=".pdf,.doc,.docx,application/pdf" hidden></label>
        <label class="f">Resume text <span class="muted">(paste it: grounds the AI drafts)</span><textarea data-k="resumeText" style="min-height:120px">${esc(p.resumeText)}</textarea></label>
        <label class="f">Professional summary<textarea data-k="summary">${esc(p.summary)}</textarea></label></div>
      ${GROUPS.map(([g, fs]) => `<h2>${g}</h2><div class="card">${fs.map(([k, l, t]) => Array.isArray(t)
        ? `<label class="f">${l}<select data-k="${k}">${t.map(o => `<option ${p[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`
        : `<label class="f">${l}<input data-k="${k}" type="${t || 'text'}" value="${esc(p[k])}"></label>`).join('')}</div>`).join('')}
      ${!isAndroid && !p.firstName ? '<button class="btn block" id="sample">Fill with sample profile (preview)</button>' : ''}`;
    v.querySelectorAll('[data-k]').forEach(el => el.oninput = el.onchange = () => { p[el.dataset.k] = el.value; Store.save(); });
    $('#rf').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) return App.toast('Please use a resume under 4 MB');
      const rd = new FileReader(); rd.onload = () => { S.resume = { name: f.name, mime: f.type || 'application/pdf', data: rd.result.split(',')[1] }; Store.save(); App.render(); App.toast('Resume saved'); };
      rd.readAsDataURL(f);
    };
    const sm = $('#sample'); if (sm) sm.onclick = () => { seedSample(); App.render(); };
  }

  // ---------- Saved answers ----------
  function renderAnswers(v) {
    setTitle('Answers', 'Reused for recurring questions');
    v.innerHTML = `<div class="muted" style="margin:4px 2px">When a form question contains the phrase on the left, JobPilot fills in your answer.</div>
      ${S.answers.map((a, i) => `<div class="card"><label class="f" style="margin:0">Question contains<input data-q="${i}" value="${esc(a.q)}"></label>
        <label class="f">Answer<textarea data-a="${i}" style="min-height:60px">${esc(a.a)}</textarea></label>
        <button class="btn ghost" data-x="${i}" style="color:var(--bad)">Remove</button></div>`).join('')}
      <button class="btn block" id="addA">+ Add answer</button>`;
    v.querySelectorAll('[data-q]').forEach(el => el.oninput = () => { S.answers[el.dataset.q].q = el.value; Store.save(); });
    v.querySelectorAll('[data-a]').forEach(el => el.oninput = () => { S.answers[el.dataset.a].a = el.value; Store.save(); });
    v.querySelectorAll('[data-x]').forEach(el => el.onclick = () => { S.answers.splice(+el.dataset.x, 1); Store.save(); App.render(); });
    $('#addA').onclick = () => { S.answers.push({ q: '', a: '' }); Store.save(); App.render(); };
  }

  // ---------- Settings ----------
  function renderSettings(v) {
    setTitle('Settings', 'AI drafting, automation, backup');
    const st = S.settings;
    v.innerHTML = `
      <h2>AI drafting (optional)</h2><div class="card">
        <label class="f">Anthropic API key<input id="key" type="password" value="${esc(st.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
        <div class="muted" style="margin-top:6px">Stored only on this device. Used to draft cover letters and answers from your resume.</div>
        <label class="f">Model<select id="model">${['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map(m => `<option ${st.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="f">Writing tone<input id="tone" value="${esc(st.tone)}"></label></div>
      <h2>Automation</h2><div class="card"><label class="row" style="gap:12px"><input type="checkbox" id="auto" ${st.autoSubmit ? 'checked' : ''} style="width:auto;margin:0"><span class="grow"><b>Auto-submit</b><div class="muted">Click Submit automatically when every required field is filled. Off by default, so you review each application first.</div></span></label></div>
      <h2>Backup</h2><div class="card"><div class="row"><button class="btn grow" id="exp">Export data</button><label class="btn grow" style="text-align:center">Import<input type="file" id="imp" accept=".json" hidden></label></div>
        <button class="btn ghost block" id="wipe" style="color:var(--bad)">Erase all data</button></div>
      <div class="muted" style="text-align:center;margin:18px 0">JobPilot 1.0 · data stays on your device</div>`;
    $('#key').oninput = e => { st.apiKey = e.target.value.trim(); Store.save(); };
    $('#model').onchange = e => { st.model = e.target.value; Store.save(); };
    $('#tone').oninput = e => { st.tone = e.target.value; Store.save(); };
    $('#auto').onchange = e => { st.autoSubmit = e.target.checked; Store.save(); };
    $('#exp').onclick = () => {
      const data = JSON.stringify({ ...S, settings: { ...st, apiKey: '' } }, null, 2);
      if (isAndroid && Android.saveFile) return Android.saveFile('jobpilot-backup.json', data);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = 'jobpilot-backup.json'; a.click();
    };
    $('#imp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const d = JSON.parse(t); Object.assign(S, d, { settings: { ...d.settings, apiKey: st.apiKey } }); Store.save(); App.toast('Imported'); App.render(); }).catch(() => App.toast('Not a JobPilot backup')); };
    $('#wipe').onclick = () => { if (confirm('Erase your profile, resume and all jobs?')) { localStorage.clear(); location.reload(); } };
  }

  // ---------- helpers ----------
  function sheet(html, bind) {
    const bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet">${html}</div>`; document.body.appendChild(bg);
    bg.onclick = e => { if (e.target === bg) close(); };
    window.__closeSheet = () => bg.remove(); bind($('.sheet', bg));
  }
  function close() { window.__closeSheet && window.__closeSheet(); }
  function setTitle(t, s) { $('#title').textContent = t; $('#subtitle').textContent = s; }
  function cap(s) { return s[0].toUpperCase() + s.slice(1); }
  function ago(t) { const d = (Date.now() - t) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : Math.floor(d) + 'd ago'; }
  function profileReady() { const p = S.profile; return p.firstName && p.email && S.resume; }

  function seedSample() {
    Object.assign(S.profile, { firstName: 'Alex', lastName: 'Rivera', email: 'alex.rivera@example.com', phone: '(555) 201-3344',
      city: 'Austin', state: 'TX', zip: '78701', linkedin: 'https://linkedin.com/in/alexrivera-sample', website: 'https://alexrivera.design',
      currentTitle: 'Product Designer', currentCompany: 'Northwind Logistics', yearsExperience: '6', salary: '$145,000',
      school: 'University of Texas at Austin', degree: "Bachelor's", gradYear: '2018',
      summary: 'Product designer with 6 years designing operational tools for logistics teams.',
      resumeText: 'Alex Rivera — Product Designer\nNorthwind Logistics, Product Designer (2021–present): led redesign of the driver dispatch app used by 1,200 drivers; built the company\'s first design system; ran field research at 9 depots.\nBrightPath, UX Designer (2018–2021): designed B2B inventory dashboards.\nSkills: interaction design, prototyping (Figma), design systems, field research.\nEducation: BS, University of Texas at Austin, 2018.' });
    S.resume = { name: 'Alex_Rivera_Resume.pdf', mime: 'application/pdf', data: btoa('%PDF-1.4 sample resume') };
    if (!S.jobs.length) {
      Store.addJob('https://boards.greenhouse.io/acmerobotics/jobs/4821', { title: 'Senior Product Designer', company: 'Acme Robotics' });
      Store.addJob('https://jobs.lever.co/globex/7a1c-ux-lead', { title: 'UX Lead', company: 'Globex' });
    }
    Store.save();
  }

  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; close(); App.render(); });
  if (isAndroid && Android.ready) Android.ready();
  App.render();
})();
