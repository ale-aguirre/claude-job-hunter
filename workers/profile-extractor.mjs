/**
 * profile-extractor.mjs — Dynamic job search keywords from CV + profile
 *
 * Calls Groq to analyze the user's real CV and extract:
 *   - searchTerms: what to search on job boards
 *   - roles: job titles they can apply to
 *   - skills: their actual skills
 *   - city/country: for local job search
 *   - excludeTerms: seniority/role exclusions based on experience level
 *
 * Cache: .profile-keywords.json (refreshed every 24h)
 * Fallback chain: Groq → APPLY_KEYWORDS in .env → generic terms
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { getCVText } from './cv-reader.mjs';
import 'dotenv/config';

const CACHE_PATH = new URL('.profile-keywords.json', import.meta.url).pathname;
const CACHE_TTL  = 24 * 60 * 60 * 1000; // 24 hours
const GROQ_KEY   = process.env.GROQ_API_KEY       || '';
const OR_KEY     = process.env.OPENROUTER_API_KEY  || '';

/**
 * Returns structured keywords extracted from the user's real CV/profile.
 * Result shape:
 * {
 *   searchTerms: string[],   // search queries for job boards
 *   roles:       string[],   // job titles to apply to
 *   skills:      string[],   // top technical/professional skills
 *   seniority:   string,     // 'junior'|'mid'|'senior'
 *   city:        string,     // city name (no country)
 *   country:     string,     // 2-letter code (ar, mx, co, br...)
 *   excludeTerms: string[],  // role/level terms to exclude from search
 *   localSearch: boolean,    // true → also search local job portals
 *   ts:          number,     // cache timestamp
 * }
 */
export async function getProfileKeywords() {
  // 1. Return cache if still valid
  try {
    if (existsSync(CACHE_PATH)) {
      const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
      if (cache.ts && Date.now() - cache.ts < CACHE_TTL) return cache;
    }
  } catch {}

  const cvText    = await getCVText();
  const city      = process.env.CITY        || '';
  const configKw  = process.env.APPLY_KEYWORDS;
  const profileTx = process.env.PROFILE_TEXT || '';

  // 2. No LLM at all → fallback
  if (!GROQ_KEY && !OR_KEY) return _buildFallback(configKw, city);

  // 3. Nothing to analyze → fallback
  const context = cvText
    ? `CV:\n${cvText.slice(0, 3000)}`
    : profileTx
      ? `Profile: ${profileTx}`
      : null;
  if (!context) return _buildFallback(configKw, city);

  // 4. LLM analysis — Groq first, OpenRouter free as fallback
  const llmProviders = [
    GROQ_KEY && { url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_KEY, model: 'llama-3.3-70b-versatile' },
    OR_KEY   && { url: 'https://openrouter.ai/api/v1/chat/completions',   key: OR_KEY,   model: 'google/gemma-3-4b-it:free' },
    OR_KEY   && { url: 'https://openrouter.ai/api/v1/chat/completions',   key: OR_KEY,   model: 'meta-llama/llama-3.2-3b-instruct:free' },
  ].filter(Boolean);

  for (const provider of llmProviders) {
  try {
    const r = await fetch(provider.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json', ...(provider.url.includes('openrouter') ? { 'HTTP-Referer': 'https://huntdesk.local', 'X-Title': 'HuntDesk' } : {}) },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 900,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'You are a career analyst. Extract job search data from CVs. Return ONLY valid JSON, no explanation.',
          },
          {
            role: 'user',
            content:
`Analyze this CV and return job search keywords.

${context}

City from profile: ${city || 'not specified'}

Return JSON with exactly these fields:
{
  "searchTerms": [15-20 keywords that will appear in JOB TITLES — focus on specific technologies and roles, e.g. 'react', 'frontend', 'next.js', 'typescript', 'full stack', 'node.js', 'desarrollador', 'frontend engineer' — extract from actual skills in the CV, not generic terms like 'developer'],
  "roles": [5-8 realistic job titles in order from most to least qualified, English + Spanish],
  "skills": [8-12 top skills listed in the CV],
  "seniority": "junior or mid or senior",
  "city": "only the city name, no country (e.g. 'Córdoba'), or empty string",
  "country": "2-letter country code (ar/mx/co/br/cl/us/etc.)",
  "excludeTerms": ["only EXCLUDE truly out-of-reach roles: ['staff ', 'principal ', 'lead ', 'director', 'vp ', 'head of'] — do NOT exclude 'senior'/'sr' since many remote/LATAM companies use those titles for mid-level roles"],
  "localSearch": true if they have a specific city and may want local/on-site jobs
}

Rules:
- searchTerms must match what this person CAN DO TODAY based on the CV
- A sales professional should get sales/admin terms, not programming terms
- A developer should get dev terms, not sales terms
- Include Spanish versions if city is in LATAM (Argentina, Mexico, Colombia, etc.)`,
          },
        ],
      }),
    });

    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${r.status}`);
    }
    const data   = await r.json();
    const raw    = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (!parsed.searchTerms?.length) throw new Error('Empty result from LLM');

    // Merge LLM searchTerms with skills so job title matching is tech-specific
    // LLMs tend to generate generic role phrases; skills are more accurate for matching
    const skills = parsed.skills || [];
    const mergedTerms = [...new Set([
      ...skills.map(s => s.toLowerCase()),
      ...(parsed.searchTerms || []).map(s => s.toLowerCase()),
    ])].filter(t => t.length > 1);

    const result = {
      searchTerms:  mergedTerms,
      roles:        parsed.roles        || [],
      skills,
      seniority:    parsed.seniority    || 'mid',
      city:         parsed.city         || city || '',
      country:      parsed.country      || 'ar',
      excludeTerms: parsed.excludeTerms || [],
      localSearch:  parsed.localSearch  ?? !!city,
      ts: Date.now(),
    };

    writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2));
    const src = provider.url.includes('openrouter') ? 'OpenRouter' : 'Groq';
    console.log(`[profile] ✅ ${result.searchTerms.length} terms | ${result.seniority} | ${result.city || 'remote only'} (${src})`);
    return result;

  } catch (e) {
    const src = provider.url.includes('openrouter') ? 'OpenRouter' : 'Groq';
    console.warn(`[profile] ${src} failed (${e.message.slice(0, 60)}), trying next...`);
  }
  } // end for loop

  console.warn('[profile] All LLM providers failed — using config fallback');
  return _buildFallback(configKw, city);
}

function _buildFallback(configKw, city) {
  const terms = configKw
    ? configKw.split(',').map(k => k.trim()).filter(Boolean)
    : ['software developer', 'web developer', 'developer', 'programmer'];
  return {
    searchTerms:  terms,
    roles:        terms,
    skills:       terms,
    seniority:    'mid',
    city:         city || '',
    country:      'ar',
    excludeTerms: ['staff ', 'principal ', 'lead ', 'director', 'vp ', 'head of'],
    localSearch:  !!city,
    ts:           0, // don't treat fallback as valid cache
  };
}

/** Force re-analysis next time (call after user updates CV/profile) */
export function invalidateProfileCache() {
  try { unlinkSync(CACHE_PATH); } catch {}
  console.log('[profile] Cache invalidated — will re-analyze on next scout run');
}
