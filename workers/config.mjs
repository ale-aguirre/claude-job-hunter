/**
 * config.mjs — Shared profile, paths, and copy used by all apply/agent scripts
 *
 * Copy .env.example → .env and fill in your values before running.
 */
import 'dotenv/config';

export const CV_PATH = process.env.CV_PATH || '';

export const PROFILE = {
  firstName:  process.env.FIRST_NAME  || 'Your',
  lastName:   process.env.LAST_NAME   || 'Name',
  email:      process.env.EMAIL       || 'you@example.com',
  phone:      process.env.PHONE       || '',
  linkedin:   process.env.LINKEDIN    || '',
  github:     process.env.GITHUB      || '',
  portfolio:  process.env.PORTFOLIO   || '',
  city:       process.env.CITY        || '',
};

export const PROFILE_TEXT = process.env.PROFILE_TEXT ||
  `${PROFILE.firstName} ${PROFILE.lastName} — developer available for remote work.`;

export const BASE_COVER = process.env.BASE_COVER ||
`Hi,

I'm ${PROFILE.firstName} ${PROFILE.lastName}, a developer available for remote work.

${PROFILE_TEXT}

${PROFILE.firstName} ${PROFILE.lastName}${PROFILE.email ? ' | ' + PROFILE.email : ''}${PROFILE.linkedin ? ' | ' + PROFILE.linkedin : ''}`;

// ── Job search settings ────────────────────────────────────────────────────────
// JOB_TYPE: 'contract', 'full-time', 'freelance', or 'any'
export const JOB_TYPE = process.env.JOB_TYPE || 'any';
export const PREFER_EASY_JOBS = process.env.PREFER_EASY_JOBS === 'true';

// APPLY_KEYWORDS: override via .env as comma-separated list
const _kwEnv = process.env.APPLY_KEYWORDS;
export const APPLY_KEYWORDS = _kwEnv
  ? _kwEnv.split(',').map(k => k.trim()).filter(Boolean)
  : [
      'react', 'next.js', 'nextjs', 'typescript', 'javascript',
      'frontend', 'front-end', 'frontend engineer', 'frontend developer',
      'full stack', 'fullstack', 'full-stack',
      'ui engineer', 'ui developer', 'web developer', 'web engineer',
      'devrel', 'developer relations', 'developer experience',
    ];
