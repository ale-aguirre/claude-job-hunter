/**
 * unified-client.mjs — Multi-backend LLM client with auto-fallback chain
 *
 * Priority (first available wins):
 *   1. OpenFang  :4200   — richest (web_search tools, multi-agent)
 *   2. Groq              — fast, free tier (GROQ_API_KEY)
 *   3. OpenRouter        — broad model access (OPENROUTER_API_KEY)
 *   4. Ollama   :11434   — local, always available, no API key
 *
 * Model routing:
 *   orchestrator / analyst → Claude Haiku 4.5 via OpenRouter (smarter decisions)
 *   writer / researcher    → Groq llama-3.3-70b (fast, free)
 *   everything else        → Groq → OpenRouter free → Ollama
 *
 * Same interface as openfang-client.mjs — drop-in replacement.
 */

import { isRunning as ofIsRunning } from './openfang-client.mjs';
import * as OF from './openfang-client.mjs';

// ─── Config ──────────────────────────────────────────────────────────────────

const GROQ_KEY  = process.env.GROQ_API_KEY      || '';
const OR_KEY    = process.env.OPENROUTER_API_KEY || '';
const OLLAMA    = 'http://localhost:11434';

// Model routing — smarter model for orchestration, faster for content tasks
const GROQ_MODEL       = 'llama-3.3-70b-versatile';
const OR_MODEL_SMART   = 'anthropic/claude-haiku-4.5';        // Senku / analyst — best decisions
const OR_MODEL_FREE    = 'meta-llama/llama-3.3-70b-instruct:free'; // fallback free
const OLLAMA_MODEL     = 'deepseek-r1:8b';   // best local for reasoning

// Agents that need smart orchestration → use Haiku on OpenRouter
const SMART_AGENTS = new Set(['orchestrator', 'analyst']);

const SYSTEM_PROMPTS = {
  researcher:
    'You are a remote job research specialist. Find specific job platforms and real opportunities. ' +
    'When asked for JSON, return ONLY a valid JSON array — no markdown fences, no prose, no explanation.',
  orchestrator:
    'You are Senku, a job hunt orchestrator. Analyze the current state and produce a concrete, actionable plan. ' +
    'Be specific: platform names, company names, immediate next actions. Prioritize speed of income.',
  analyst:
    'You are Erwin, a data analyst for a job hunting system. Analyze statistics honestly and give clear, blunt recommendations.',
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

// ─── Individual backends ─────────────────────────────────────────────────────

async function callOpenAICompat(url, apiKey, model, system, message, extraHeaders = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: message },
      ],
      max_tokens:  2048,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`HTTP ${r.status}: ${err.slice(0, 200)}`);
  }
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim() || '';
}

const OR_HEADERS = { 'HTTP-Referer': 'http://localhost:4242', 'X-Title': 'HuntDesk' };

const BACKENDS = {
  groq: {
    name: 'Groq',
    available: () => !!GROQ_KEY,
    call: (agentName, msg) => callOpenAICompat(
      'https://api.groq.com/openai/v1/chat/completions',
      GROQ_KEY, GROQ_MODEL,
      SYSTEM_PROMPTS[agentName] || 'You are a helpful assistant.',
      msg
    ),
  },
  // Haiku via OpenRouter — only for smart agents (orchestrator, analyst)
  openrouter_smart: {
    name: 'OpenRouter/Haiku',
    available: () => !!OR_KEY,
    agentsOnly: SMART_AGENTS,  // only used when agentName is in this set
    call: (agentName, msg) => callOpenAICompat(
      'https://openrouter.ai/api/v1/chat/completions',
      OR_KEY, OR_MODEL_SMART,
      SYSTEM_PROMPTS[agentName] || 'You are a helpful assistant.',
      msg, OR_HEADERS
    ),
  },
  // Free llama on OpenRouter — general fallback
  openrouter_free: {
    name: 'OpenRouter/llama',
    available: () => !!OR_KEY,
    call: (agentName, msg) => callOpenAICompat(
      'https://openrouter.ai/api/v1/chat/completions',
      OR_KEY, OR_MODEL_FREE,
      SYSTEM_PROMPTS[agentName] || 'You are a helpful assistant.',
      msg, OR_HEADERS
    ),
  },
  ollama: {
    name: 'Ollama',
    available: async () => {
      try {
        const r = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(2000) });
        return r.ok;
      } catch { return false; }
    },
    call: (agentName, msg) => callOpenAICompat(
      `${OLLAMA}/v1/chat/completions`,
      '', OLLAMA_MODEL,
      SYSTEM_PROMPTS[agentName] || 'You are a helpful assistant.',
      msg
    ),
  },
};

// ─── Resolution ──────────────────────────────────────────────────────────────

let _primary = null;

async function resolvePrimary() {
  if (_primary) return _primary;
  if (await ofIsRunning().catch(() => false)) {
    _primary = { name: 'OpenFang', isOF: true };
    console.log('[unified] Backend: OpenFang (:4200)');
    return _primary;
  }
  for (const [key, b] of Object.entries(BACKENDS)) {
    if (b.agentsOnly) continue; // skip agent-specific backends in primary resolution
    if (await b.available()) {
      _primary = { name: b.name, key };
      console.log(`[unified] OpenFang offline → Backend: ${b.name}`);
      return _primary;
    }
  }
  throw new Error('No LLM backend available. Set GROQ_API_KEY / OPENROUTER_API_KEY or start Ollama / OpenFang.');
}

/**
 * Build the fallback chain for a specific agent.
 * Smart agents (orchestrator, analyst) get Haiku via OpenRouter first.
 */
async function callWithFallback(agentName, message, opts = {}) {
  const primary = await resolvePrimary();
  const chain = [];

  if (primary.isOF) {
    chain.push({ name: 'OpenFang', fn: () => OF.sendMessage(agentName, message, opts) });
  }

  // Smart agents: inject Haiku at front of chain (after OpenFang)
  if (SMART_AGENTS.has(agentName) && OR_KEY) {
    chain.push({
      name: 'Haiku (OpenRouter)',
      fn: () => BACKENDS.openrouter_smart.call(agentName, message),
    });
  }

  // Rest of chain: groq → openrouter_free → ollama
  for (const [key, b] of Object.entries(BACKENDS)) {
    if (key === 'openrouter_smart') continue; // already handled above
    chain.push({ name: b.name, fn: () => b.call(agentName, message) });
  }

  let lastErr;
  for (const { name, fn } of chain) {
    try {
      const result = await fn();
      if (chain[0].name !== name) {
        // Only log when falling back (not the first successful attempt)
        console.log(`[unified] ✓ ${name}`);
      }
      return result;
    } catch (e) {
      lastErr = e;
      console.log(`[unified] ${name} failed (${e.message.slice(0, 60)}) — trying next`);
    }
  }
  throw new Error(`All LLM backends failed. Last: ${lastErr?.message}`);
}

// ─── Public interface ─────────────────────────────────────────────────────────

export async function backendName() {
  return (await resolvePrimary()).name;
}

export async function isRunning() {
  try { await resolvePrimary(); return true; } catch { return false; }
}

export async function getAgents() {
  const r = await resolvePrimary();
  if (r.isOF) return OF.getAgents();
  return Object.keys(SYSTEM_PROMPTS).map(name => ({ id: name, name }));
}

export async function sendMessage(agentName, message, opts = {}) {
  return callWithFallback(agentName, message, opts);
}

export async function research(query) {
  return callWithFallback('researcher', query);
}

export async function orchestrate(task) {
  return callWithFallback('orchestrator', task);
}

export async function writeCoverLetter(jobInfo, profileInfo) {
  const prompt =
    `Write a concise, professional cover letter (max 180 words) for this job:\n` +
    `Job: ${jobInfo.title} at ${jobInfo.company}\n` +
    `Description: ${jobInfo.notes || ''}\n` +
    `URL: ${jobInfo.url}\n\n` +
    `Candidate profile: ${profileInfo}\n\n` +
    `Requirements:\n- Direct, no fluff\n- Mention 2-3 specific matching skills\n` +
    `- Express genuine interest\n- End with clear CTA\n- Sign as ${process.env.FIRST_NAME || 'Your'} ${process.env.LAST_NAME || 'Name'}`;
  return callWithFallback('writer', prompt);
}

export async function evaluateJobMatch(jobText, profileText) {
  return callWithFallback('recruiter',
    `Score this job match 1-10 and explain why:\nJob: ${jobText}\nProfile: ${profileText}`
  );
}
