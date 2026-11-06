# JobPilot: job application autopilot for Android

JobPilot keeps your profile, resume and saved answers on your phone. It opens each job
posting, finds the application form and fills it in for you. You review and submit.

## What it does
- **Queue jobs**: paste a link, or tap **Share → JobPilot** in Chrome, LinkedIn or Indeed.
- **Autofill**: detects fields by label, name, placeholder and ARIA attributes. Fills text,
  dropdowns, yes/no radio groups and required consent boxes. Never ticks marketing opt-ins.
  Works with React/Angular forms (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable,
  iCIMS and generic forms).
  Attaches your resume automatically, or offers it as the first choice in the file picker.
  Opens ATS forms embedded in iframes on company career pages. Outlines filled fields in green
  and fields that still need you in red.
- **Batch mode**: "Apply to N queued jobs" steps through the queue one job at a time.
- **AI drafting (optional)**: with your Anthropic API key, drafts a cover letter and answers to
  the form's open-ended questions, grounded only in your resume. Review them before applying.
- **Tracker**: queued → applied → interview → offer / rejected, with notes and JSON backup.
- **Auto-submit (opt-in, off by default)**: clicks Submit only when every required field is filled.

## Get the APK
**Option A: GitHub (no tools needed).** Push this folder to a GitHub repo. The included
workflow (`.github/workflows/build-apk.yml`) builds the APK. Download it from the run's
**Artifacts**, copy it to your phone and open it. Allow "install unknown apps" when asked.

**Option B: Android Studio.** File → Open → this folder → Run ▶ on your phone or emulator.

## Preview the UI on a computer
    node studio/server.js     # then open http://localhost:5173
The studio shows the code next to the running app and reloads on every save. In the browser,
"Apply" opens a sample form (`demo-form.html`) so you can watch autofill work.

## Layout
    app/src/main/assets/www/   UI (HTML/CSS/JS): app.js, store.js, ai.js, autofill.js
    app/src/main/java/...      MainActivity (hosts the UI, share intent), ApplyActivity (job site + autofill)
    studio/                    live side-by-side preview server

## Notes
- Your data lives only on the device. The API key is excluded from exports.
- Some sites need an account login or a CAPTCHA first. Sign in once inside the Apply screen
  (cookies are kept), then tap **Autofill**.
- Respect each site's terms. LinkedIn "Easy Apply" and similar in-app flows prohibit automated
  submission, so keep auto-submit off there.
