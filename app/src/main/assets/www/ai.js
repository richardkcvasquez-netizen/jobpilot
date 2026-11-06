// Optional AI drafting via the official Anthropic SDK (bundled in vendor/anthropic.js).
// The key is entered by the user in Settings and stays on the device.
(function () {
  const SCHEMA = {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Job title from the posting, or empty if unknown' },
      company: { type: 'string', description: 'Company name, or empty if unknown' },
      fitSummary: { type: 'string', description: 'Two sentences on how well the candidate fits, and the biggest gap' },
      coverLetter: { type: 'string', description: 'Cover letter body, 180-260 words, no placeholders' },
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: { q: { type: 'string' }, a: { type: 'string' } },
          required: ['q', 'a'], additionalProperties: false
        }
      }
    },
    required: ['title', 'company', 'fitSummary', 'coverLetter', 'answers'],
    additionalProperties: false
  };

  function client() {
    const key = Store.state.settings.apiKey;
    if (!key) throw new Error('Add your Anthropic API key in Settings to use AI drafting.');
    // The app talks to the API directly from the device, so the browser guard is lifted.
    return new AnthropicSDK.Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  }

  async function draft(job) {
    const s = Store.state, p = s.profile;
    const questions = (job.pendingQuestions || []).map(q => '- ' + q).join('\n') || '(none)';
    const resume = p.resumeText || p.summary;
    if (!resume) throw new Error('Paste your resume text in Profile first so the drafts are grounded in your real experience.');

    const system =
      'You help a job seeker complete applications. Write only from facts in the candidate\'s resume and profile; ' +
      'never invent employers, titles, degrees, numbers or skills. If a question cannot be answered from those facts, ' +
      'give a short honest answer the candidate can edit, rather than a made-up one. Tone: ' + s.settings.tone + '. ' +
      'Plain text only, no markdown, no "[placeholder]" brackets.';

    const user =
      `<candidate>\nName: ${p.firstName} ${p.lastName}\nCurrent: ${p.currentTitle} at ${p.currentCompany}\n` +
      `Location: ${p.city}, ${p.state}\nYears of experience: ${p.yearsExperience}\nSummary: ${p.summary}\n</candidate>\n` +
      `<resume>\n${resume}\n</resume>\n` +
      `<job url="${job.url}">\n${job.description || '(No description captured. Infer only from the URL and say so in fitSummary.)'}\n</job>\n` +
      `<open_questions>\n${questions}\n</open_questions>\n\n` +
      'Write the cover letter, then answer each open question (keep each answer under 150 words, and use the exact ' +
      'question text as "q").';

    const res = await client().beta.messages.create({
      model: s.settings.model || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system,
      messages: [{ role: 'user', content: user }]
    });

    if (res.stop_reason === 'refusal') throw new Error('The model declined this request. Try editing the job description.');
    if (res.stop_reason === 'max_tokens') throw new Error('The draft was cut off. Try again.');
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return JSON.parse(text);
  }

  function friendly(e) {
    const A = AnthropicSDK.Anthropic;
    if (e instanceof A.AuthenticationError) return 'Your API key was rejected. Check it in Settings.';
    if (e instanceof A.RateLimitError) return 'Rate limited. Wait a minute and try again.';
    if (e instanceof A.APIConnectionError) return 'Could not reach the API. Check your connection.';
    if (e instanceof A.APIError) return 'API error: ' + e.message;
    return e.message || String(e);
  }

  window.AI = { draft, friendly };
})();
