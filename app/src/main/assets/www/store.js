// Local-first data store. Everything lives on the device (WebView localStorage).
// The Android host exposes `window.Android` (see MainActivity.kt); in a desktop
// browser we fall back to an in-page simulator so the UI can be previewed.
(function () {
  const KEY = 'jobpilot.v1';
  const defaults = () => ({
    profile: {
      firstName: '', lastName: '', email: '', phone: '', city: '', state: '', country: 'United States',
      zip: '', address: '', linkedin: '', github: '', website: '', currentTitle: '', currentCompany: '',
      yearsExperience: '', school: '', degree: '', gradYear: '', salary: '', startDate: 'Two weeks notice',
      workAuthorized: 'Yes', needsSponsorship: 'No', willingToRelocate: 'Yes', remotePreference: 'Remote or hybrid',
      gender: 'Decline to self-identify', race: 'Decline to self-identify', veteran: 'I am not a protected veteran',
      disability: 'I do not want to answer', pronouns: '', summary: '', resumeText: ''
    },
    resume: null, // { name, mime, data (base64) }
    answers: [
      { q: 'How did you hear about us', a: 'Company careers page' },
      { q: 'Are you 18 years or older', a: 'Yes' },
      { q: 'Have you previously worked for', a: 'No' }
    ],
    jobs: [],
    settings: { apiKey: '', model: 'claude-opus-5-5', autoSubmit: false, tone: 'warm and concise' }
  });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const d = JSON.parse(raw), base = defaults();
      return { ...base, ...d, profile: { ...base.profile, ...d.profile }, settings: { ...base.settings, ...d.settings } };
    } catch (e) { return defaults(); }
  }

  const state = load();
  const listeners = new Set();

  const Store = {
    state,
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { console.warn('save failed', e); window.App && App.toast('Storage full — try a smaller resume file'); }
      if (window.Android && Android.syncState) Android.syncState(JSON.stringify(Store.applyPayload()));
      listeners.forEach(fn => fn());
    },
    onChange(fn) { listeners.add(fn); },
    uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },

    addJob(url, extra = {}) {
      url = (url || '').trim();
      const m = url.match(/https?:\/\/\S+/); if (m) url = m[0];
      if (!/^https?:\/\//.test(url)) return null;
      if (state.jobs.some(j => j.url === url)) return state.jobs.find(j => j.url === url);
      let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
      const job = { id: Store.uid(), url, host, title: extra.title || '', company: extra.company || guessCompany(url, host),
        status: 'queued', description: extra.description || '', coverLetter: '', aiAnswers: [], notes: '',
        added: Date.now(), applied: null, filled: null };
      state.jobs.unshift(job); Store.save(); return job;
    },
    job(id) { return state.jobs.find(j => j.id === id); },
    updateJob(id, patch) { const j = Store.job(id); if (j) { Object.assign(j, patch); Store.save(); } return j; },
    removeJob(id) { state.jobs = state.jobs.filter(j => j.id !== id); Store.save(); },

    // Everything the autofill script needs, flattened.
    applyPayload(job) {
      const p = state.profile;
      return {
        profile: { ...p, fullName: [p.firstName, p.lastName].filter(Boolean).join(' '),
          location: [p.city, p.state].filter(Boolean).join(', ') },
        answers: [...state.answers, ...((job && job.aiAnswers) || [])],
        coverLetter: (job && job.coverLetter) || '',
        resume: state.resume, autoSubmit: !!state.settings.autoSubmit
      };
    }
  };

  // Greenhouse / Lever / Ashby / Workday URLs carry the company slug.
  function guessCompany(url, host) {
    const pats = [/greenhouse\.io\/([^/?#]+)/, /lever\.co\/([^/?#]+)/, /ashbyhq\.com\/([^/?#]+)/,
      /^([^.]+)\.wd\d+\.myworkdayjobs/, /smartrecruiters\.com\/([^/?#]+)/, /workable\.com\/([^/?#]+)/];
    for (const re of pats) { const m = (re.source.startsWith('^') ? host : url).match(re); if (m) return pretty(m[1]); }
    const parts = host.split('.'); return pretty(parts.length > 2 ? parts[parts.length - 2] : parts[0]);
  }
  function pretty(s) { return decodeURIComponent(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

  window.Store = Store;
})();
