/**
 * rules.mjs — Shared scoring rules and constants used by filter.mjs and draft.mjs
 *
 * Export: SKIP_TITLES, SKIP_LOCATION, SKIP_TECH, MIN_SALARY_MO,
 *         BOOST_HIGH, BOOST_MED, scoreJob
 */
import { APPLY_KEYWORDS } from './config.mjs';

export const SKIP_TITLES   = ['senior staff', 'principal engineer', 'principal', 'director of', 'vp of', 'vice president', 'head of', 'cto', 'cpo'];
export const SKIP_LOCATION = ['on-site only', 'onsite only', 'on-site in', 'onsite in', 'in-office', 'no remote', 'not remote', 'hybrid in', 'must relocate', 'relocation required'];
export const SKIP_TECH     = ['python only', 'ruby on rails only', '.net only', 'java only', 'php only', 'golang only'];
export const MIN_SALARY_MO = 2000;

export const BOOST_HIGH = ['ai agent', 'llm', 'mcp', 'anthropic', 'claude', 'openai', 'agentic', 'autonomous'];
export const BOOST_MED  = ['typescript', 'next.js', 'nextjs', 'react', 'node.js', 'automation', 'ai', 'remote latam', 'latam'];

export function scoreJob(job) {
  const text = `${job.title} ${job.notes} ${job.platform} ${job.location}`.toLowerCase();

  if (SKIP_TITLES.some(s => text.includes(s))) return -1;
  if (SKIP_LOCATION.some(s => text.includes(s))) return -1;
  if (SKIP_TECH.some(s => text.includes(s))) return -1;
  if (job.pay_mo > 0 && job.pay_mo < MIN_SALARY_MO) return -1;

  let score = 0;
  for (const kw of BOOST_HIGH) if (text.includes(kw)) score += 3;
  for (const kw of BOOST_MED)  if (text.includes(kw)) score += 1;
  for (const kw of APPLY_KEYWORDS) if (text.includes(kw.toLowerCase())) score += 1;

  if (job.pay_mo >= 3000) score += 5;
  if (job.pay_mo >= 4000) score += 3;

  return score;
}
