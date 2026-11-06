// Runs autofill.js against real application forms and reports what it filled.
// SAFETY: never submits. Auto-submit is off, form submission is blocked, and
// every POST/PUT request from the page is aborted.
// Usage: node tests/live-sites.js <url> [url...]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const AUTOFILL = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/www/autofill.js'), 'utf8');

const PROFILE = {
  firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', email: 'alex.rivera@example.com', phone: '(555) 201-3344',
  city: 'Austin', state: 'Texas', country: 'United States', zip: '78701', address: '100 Congress Ave', location: 'Austin, TX',
  linkedin: 'https://linkedin.com/in/alexrivera-sample', github: 'https://github.com/alexrivera-sample', website: 'https://alexrivera.design',
  currentTitle: 'Product Designer', currentCompany: 'Northwind Logistics', yearsExperience: '6', school: 'University of Texas at Austin',
  degree: "Bachelor's", gradYear: '2018', salary: '$145,000', startDate: 'Two weeks notice', workAuthorized: 'Yes', needsSponsorship: 'No',
  willingToRelocate: 'Yes', remotePreference: 'Remote or hybrid', gender: 'Decline to self-identify', race: 'Decline to self-identify',
  veteran: 'I am not a protected veteran', disability: 'I do not want to answer', pronouns: 'they/them',
  summary: 'Product designer with 6 years designing operational tools.', resumeText: ''
};
const PAYLOAD = {
  profile: PROFILE, coverLetter: 'Sample cover letter text.', autoSubmit: false,
  answers: [{ q: 'How did you hear about us', a: 'Company careers page' }],
  resume: { name: 'Alex_Rivera_Resume.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 sample').toString('base64') }
};

(async () => {
  const browser = await chromium.launch();
  for (const url of process.argv.slice(2)) {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    await page.route('**/*', r => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /submit|apply|application|candidate/i.test(r.request().url()) ? r.abort() : r.continue());
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);
      await page.evaluate(() => document.addEventListener('submit', e => e.preventDefault(), true));
      let rep = await page.evaluate(([src, p]) => { eval(src); return window.__jobpilot.run(p); }, [AUTOFILL, PAYLOAD]);
      if (rep.applyButton || rep.redirect) {
        if (rep.redirect) await page.goto(rep.redirect, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        rep = await page.evaluate(([src, p]) => { if (!window.__jobpilot) eval(src); return window.__jobpilot.run(p); }, [AUTOFILL, PAYLOAD]);
      }
      // What did each field end up with? (label -> value) for spotting wrong matches.
      const fields = await page.evaluate(() => {
        const seen = new Set();
        return Array.from(document.querySelectorAll('[data-jobpilot="filled"]')).map(el => {
          const ctl = el.matches('input,select,textarea') ? el : el.querySelector('input:checked') || el.querySelector('input,select,textarea') || el;
          if (seen.has(ctl)) return null; seen.add(ctl);
          let v;
          if (el.matches('[class*="select__control"]')) v = el.innerText;
          else if (ctl.tagName === 'SELECT') v = (ctl.selectedOptions[0] || {}).text;
          else if (ctl.type === 'file') v = (ctl.files[0] || {}).name;
          else if (ctl.type === 'radio' || ctl.type === 'checkbox') v = ctl.checked ? '[x] ' + ((ctl.closest('label') || {}).innerText || window.__jobpilot.strongLabel(ctl)) : '[ ]';
          else v = ctl.value;
          const q = ctl.type === 'radio' ? el.innerText.split('\n')[0] : window.__jobpilot.strongLabel(ctl);
          return [String(q).slice(0, 70), String(v || '').replace(/\s+/g, ' ').slice(0, 50)];
        }).filter(Boolean);
      });
      console.log(`\n=== ${url}\n${rep.filled}/${rep.total} filled · resume ${rep.resumeAttached ? 'attached' : 'NOT attached'} · submit button ${rep.submitFound ? 'found' : 'not found'}`);
      fields.forEach(([l, v]) => console.log(`  ✓ ${l}  →  ${v}`));
      rep.missing.forEach(m => console.log(`  ✗ ${m.slice(0, 100)}`));
      await page.screenshot({ path: path.join(process.env.SHOTS || '.', url.replace(/\W+/g, '_').slice(-60) + '.png'), fullPage: false });
    } catch (e) { console.log(`\n=== ${url}\nERROR ${e.message.split('\n')[0]}`); }
    await page.close();
  }
  await browser.close();
})();
