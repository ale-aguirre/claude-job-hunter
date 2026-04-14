/**
 * openfang-client.mjs — Real OpenFang API client
 * Discovered: real endpoint is POST /api/agents/{id}/message
 * NOT /v1/chat/completions (that gives "Agent processing failed" for tool-using agents)
 *
 * OpenFang agents available:
 *   writer      - cover letters, content
 *   researcher  - web search + synthesis
 *   orchestrator - meta-agent, delegates to others
 *   analyst     - data analysis
 *   recruiter   - job matching
 *   social-media - social content
 *   assistant   - general tasks
 *   sales-assistant - outreach
 */

const OF_BASE = 'http://localhost:4200';
let _agentCache = null;

// Get all agents and cache
export async function getAgents() {
  if (_agentCache) return _agentCache;
  const r = await fetch(`${OF_BASE}/api/agents`);
  if (!r.ok) throw new Error(`OpenFang agents list failed: ${r.status}`);
  _agentCache = await r.json();
  return _agentCache;
}

// Get agent ID by name
export async function getAgentId(name) {
  const agents = await getAgents();
  const agent = agents.find(a => a.name === name);
  if (!agent) throw new Error(`Agent '${name}' not found`);
  return agent.id;
}

// Send message to agent by name, with retry on rate limit
export async function sendMessage(agentName, message, opts = {}) {
  const { retries = 3, retryDelay = 5000 } = opts;
  const id = await getAgentId(agentName);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${OF_BASE}/api/agents/${id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(300000), // 5min — researcher uses web_search/web_fetch (multiple LLM calls)
      });
      const d = await r.json();

      if (d.error) {
        if (d.error.includes('Rate limited') && attempt < retries) {
          const wait = retryDelay * (attempt + 1);
          console.log(`  [OpenFang] Rate limited, waiting ${wait/1000}s... (attempt ${attempt+1}/${retries})`);
          await new Promise(res => setTimeout(res, wait));
          continue;
        }
        throw new Error(d.error);
      }

      // Response can be in different fields
      return d.response || d.content || d.message || d.text || JSON.stringify(d);
    } catch (e) {
      if (attempt < retries && (e.message.includes('Rate') || e.name === 'TimeoutError')) {
        await new Promise(res => setTimeout(res, retryDelay));
        continue;
      }
      throw e;
    }
  }
}

// Check if OpenFang is running
export async function isRunning() {
  try {
    const r = await fetch(`${OF_BASE}/api/agents`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

// ─── Specialized helpers ──────────────────────────────────────────────────

// Research: ask researcher agent to find job platforms/opportunities
export async function research(query) {
  return sendMessage('researcher', query, { retries: 3, retryDelay: 8000 });
}

// Write: ask writer agent to create cover letter
export async function writeCoverLetter(jobInfo, profileInfo) {
  const prompt = `Write a concise, professional cover letter (max 180 words) for this job:
Job: ${jobInfo.title} at ${jobInfo.company}
Description: ${jobInfo.notes || ''}
URL: ${jobInfo.url}

Candidate profile: ${profileInfo}

Requirements:
- Direct, no fluff
- Mention 2-3 specific skills that match
- Express genuine interest
- End with clear CTA
- Sign as Alexis Aguirre`;
  return sendMessage('writer', prompt, { retries: 2, retryDelay: 5000 });
}

// Orchestrate: send a complex multi-step task to the orchestrator
export async function orchestrate(task) {
  return sendMessage('orchestrator', task, { retries: 2, retryDelay: 10000 });
}

// Recruit: ask recruiter to evaluate job match
export async function evaluateJobMatch(jobText, profileText) {
  return sendMessage('recruiter',
    `Score this job match 1-10 and explain why:\nJob: ${jobText}\nProfile: ${profileText}`,
    { retries: 2, retryDelay: 5000 }
  );
}
