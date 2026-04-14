/**
 * anthropic-client.mjs — LLM routing: Claude Sonnet para orquestación, Groq para tareas simples
 *
 * Routing:
 *   callSmart()     → Claude Sonnet 4.6 (orchestration, reasoning, research) → Groq fallback
 *   callFast()      → Groq llama-3.3-70b (cover letters, parsing, scoring) → Sonnet fallback
 *   callHaiku()     → alias de callSmart() — backward compat con senku.mjs
 *   callHaikuJSON() → callSmart() + extracción JSON
 */
// override:true fuerza los valores del .env sobre vars del shell (ej: .zshrc setea ANTHROPIC_API_KEY="" para OpenClaw)
import dotenv from 'dotenv';
dotenv.config({ override: true });

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
const GROQ_KEY       = process.env.GROQ_API_KEY       || '';
const SONNET_MODEL   = 'claude-sonnet-4-6';
const GROQ_MODEL     = 'llama-3.3-70b-versatile';
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'deepseek-r1:8b';
const OLLAMA_BASE    = process.env.OLLAMA_BASE  || 'http://localhost:11434';

// ── Anthropic Sonnet (orchestration primary) ─────────────────────────────────
async function callAnthropicRaw(system, user, maxTokens = 2000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 100)}`);
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

// ── Groq llama-3.3-70b (simple tasks primary / smart fallback) ───────────────
async function callGroqRaw(system, user, maxTokens = 1500) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 100)}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

// ── Ollama local (last resort) ───────────────────────────────────────────────
async function callOllamaRaw(system, user) {
  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}`);
  const d = await r.json();
  return d.message?.content || '';
}

// ── callSmart — Sonnet para razonamiento y orquestación ──────────────────────
// Usado por: Senku, openfang-scout, Erwin analyst
export async function callSmart(system, user, maxTokens = 2000) {
  if (ANTHROPIC_KEY) {
    try { return await callAnthropicRaw(system, user, maxTokens); } catch (e) {
      console.warn(`[llm] Sonnet failed: ${e.message.slice(0, 60)} — trying Groq`);
    }
  }
  if (GROQ_KEY) {
    try { return await callGroqRaw(system, user, maxTokens); } catch (e) {
      console.warn(`[llm] Groq failed: ${e.message.slice(0, 60)} — trying Ollama`);
    }
  }
  return callOllamaRaw(system, user);
}

// ── callFast — Groq para tareas simples (cover letters, parsing, scoring) ────
// Usado por: profile-extractor, writeCoverLetter, evaluateJobMatch
export async function callFast(system, user, maxTokens = 1500) {
  if (GROQ_KEY) {
    try { return await callGroqRaw(system, user, maxTokens); } catch (e) {
      console.warn(`[llm] Groq failed: ${e.message.slice(0, 60)} — trying Sonnet`);
    }
  }
  if (ANTHROPIC_KEY) {
    try { return await callAnthropicRaw(system, user, maxTokens); } catch (e) {
      console.warn(`[llm] Sonnet failed: ${e.message.slice(0, 60)} — trying Ollama`);
    }
  }
  return callOllamaRaw(system, user);
}

// ── callHaiku — backward compat con senku.mjs (ahora usa Sonnet) ─────────────
export async function callHaiku(system, user, maxTokens = 1024) {
  return callSmart(system, user, maxTokens);
}

// ── callHaikuJSON — Senku orchestration: Sonnet + extracción JSON ─────────────
export async function callHaikuJSON(system, user, maxTokens = 2000) {
  const jsonSystem = system + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no ```json blocks — just raw JSON.';
  const raw = await callSmart(jsonSystem, user, maxTokens);
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON in response: ${raw.slice(0, 100)}`);
  return JSON.parse(match[0]);
}

export const usingAnthropicKey = () => !!ANTHROPIC_KEY;
export const backend = () => {
  if (ANTHROPIC_KEY) return `${SONNET_MODEL} (Anthropic) + Groq fallback`;
  if (GROQ_KEY)      return 'llama-3.3-70b (Groq free)';
  return `${OLLAMA_MODEL} (Ollama local)`;
};
