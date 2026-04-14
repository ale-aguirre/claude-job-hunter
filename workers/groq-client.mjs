/**
 * groq-client.mjs — Groq-direct LLM backend
 * Same interface as openfang-client.mjs — drop-in fallback
 * No OpenFang required — works with just GROQ_API_KEY (free tier)
 */

const GROQ_KEY  = process.env.GROQ_API_KEY || '';
const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_FAST  = 'llama-3.1-8b-instant';
const MODEL_SMART = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPTS = {
  researcher:
    'You are a remote job research specialist. Find specific job platforms and real opportunities. ' +
    'When asked for JSON, return ONLY a valid JSON array — no markdown fences, no prose, no explanation.',
  orchestrator:
    'You are a job hunt orchestrator. Analyze the current state and produce a concrete, actionable plan. ' +
    'Be specific: platform names, company names, immediate next actions.',
  analyst:
    'You are a data analyst for a job hunting system. Analyze statistics honestly and give clear, blunt recommendations.',
  writer:
    'You are an expert cover letter writer. Write concise professional cover letters under 180 words. Direct, no fluff.',
  recruiter:
    'You are a recruiter who evaluates job-candidate fit. Score clearly and explain your reasoning.',
  'social-media':
    'You are a social media specialist who creates engaging posts for job hunters and developers.',
  assistant:
    'You are a helpful assistant focused on job hunting strategy.',
  'sales-assistant':
    'You are a sales outreach specialist. Write concise, effective cold email copy.',
};

async function callGroq(agentName, message, modelOverride) {
  if (!GROQ_KEY) throw new Error('GROQ_API_KEY not set — cannot use Groq fallback');
  const model  = modelOverride || MODEL_SMART;
  const system = SYSTEM_PROMPTS[agentName] || 'You are a helpful assistant.';

  const r = await fetch(GROQ_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system',  content: system  },
        { role: 'user',    content: message },
      ],
      max_tokens:  2048,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Groq ${r.status}: ${err.slice(0, 200)}`);
  }
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim() || '';
}

// ─── Public interface (mirrors openfang-client.mjs) ──────────────────────────

/** Always returns true if GROQ_API_KEY is set */
export async function isRunning() {
  return !!GROQ_KEY;
}

/** Mock agent list so callers don't break */
export async function getAgents() {
  return Object.keys(SYSTEM_PROMPTS).map(name => ({ id: name, name }));
}

/** Send a message to a named "agent" (Groq system prompt) */
export async function sendMessage(agentName, message, _opts = {}) {
  return callGroq(agentName, message);
}

/** Research queries — fast model ok for simple JSON extraction */
export async function research(query) {
  return callGroq('researcher', query, MODEL_SMART);
}

/** High-level orchestration tasks — needs the smart model */
export async function orchestrate(task) {
  return callGroq('orchestrator', task, MODEL_SMART);
}

/** Write a cover letter */
export async function writeCoverLetter(jobInfo, profileInfo) {
  const prompt =
    `Write a concise, professional cover letter (max 180 words) for this job:\n` +
    `Job: ${jobInfo.title} at ${jobInfo.company}\n` +
    `Description: ${jobInfo.notes || ''}\n` +
    `URL: ${jobInfo.url}\n\n` +
    `Candidate profile: ${profileInfo}\n\n` +
    `Requirements:\n- Direct, no fluff\n- Mention 2-3 specific matching skills\n` +
    `- Express genuine interest\n- End with clear CTA\n- Sign as ${process.env.FIRST_NAME || 'Your'} ${process.env.LAST_NAME || 'Name'}`;
  return callGroq('writer', prompt);
}

/** Score a job-candidate match */
export async function evaluateJobMatch(jobText, profileText) {
  return callGroq('recruiter',
    `Score this job match 1-10 and explain why:\nJob: ${jobText}\nProfile: ${profileText}`
  );
}
