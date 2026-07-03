/**
 * filter.mjs — Score and triage 'found' jobs from DB
 * - Scores each job against profile keywords
 * - Extracts hiring email from job description (notes field)
 * - Marks low-score/irrelevant jobs as 'skipped'
 * - Saves score and email_contact to DB
 *
 * Run: node filter.mjs [--dry-run]
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import 'dotenv/config';
import { openDB, logDB } from './db-utils.mjs';
import { APPLY_KEYWORDS } from './config.mjs';
import { cleanTitle } from './templates.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const EMAIL_SKIP = ['noreply', 'no-reply', 'donotreply', 'notifications', 'bounce', 'mailer', 'system@', 'alerts@',
  'your@', 'you@', 'example@', '@example.', 'email@', 'name@', 'user@', 'test@', 'sentry.', '@sentry', '.png', '.jpg', '.svg', 'wixpress'];

const SKIP_TITLES   = ['senior staff', 'principal engineer', 'principal', 'director of', 'vp of', 'vice president', 'head of', 'cto', 'cpo'];
const SKIP_LOCATION = ['on-site only', 'onsite only', 'on-site in', 'onsite in', 'in-office', 'no remote', 'not remote', 'hybrid in', 'must relocate', 'relocation required'];
const SKIP_TECH     = ['python only', 'ruby on rails only', '.net only', 'java only', 'php only', 'golang only'];
const MIN_SALARY_MO = 2000;

const BOOST_HIGH = ['ai agent', 'llm', 'mcp', 'anthropic', 'claude', 'openai', 'agentic', 'autonomous'];
const BOOST_MED  = ['typescript', 'next.js', 'nextjs', 'react', 'node.js', 'automation', 'ai', 'remote latam', 'latam'];

// Allowlist regex for valid title characters
const TITLE_CHARS_RE = /^[\w\s\/\+\#\.,&\(\)-]+$/i;

/**
 * Returns true if a raw title string looks like garbage / truncated text.
 * Checks: >70 chars, illegal chars, starts with lowercase letter.
 */
function isBadTitle(raw) {
  if (!raw) return true;
  if (raw.length > 70) return true;
  if (!TITLE_CHARS_RE.test(raw)) return true;
  if (/^[a-z]/.test(raw)) return true;  // starts with lowercase = likely a sentence fragment
  return false;
}

function scoreJob(job) {
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

function extractEmail(text) {
  if (!text) return null;
  const matches = [...new Set((text.match(EMAIL_RE) || []))];
  return matches.find(e => !EMAIL_SKIP.some(s => e.toLowerCase().includes(s))) || null;
}

const db = openDB();

// Migrations (safe to run multiple times)
try { db.exec(`ALTER TABLE applications ADD COLUMN score INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE applications ADD COLUMN email_contact TEXT DEFAULT ''`); } catch {}

const jobs = db.prepare(
  `SELECT * FROM applications WHERE status='found' ORDER BY applied_at DESC LIMIT 500`
).all();

let scored = 0, skipped = 0, emailFound = 0;

for (const job of jobs) {
  // BAD_TITLE check: attempt cleanTitle first; if still bad, skip
  if (isBadTitle(job.title)) {
    const cleaned = cleanTitle(job.title);
    if (isBadTitle(cleaned)) {
      if (!DRY_RUN) {
        db.prepare(`UPDATE applications SET status='skipped', updated_at=datetime('now') WHERE id=?`)
          .run(job.id);
        logDB(db, 'filter', 'BAD_TITLE', job.title.slice(0, 120));
      }
      skipped++;
      console.log(`[BAD_TITLE] ${job.title.slice(0, 80)}`);
      continue;
    }
  }

  const score = scoreJob(job);

  if (score < 0) {
    if (!DRY_RUN) {
      db.prepare(`UPDATE applications SET status='skipped', score=0, updated_at=datetime('now') WHERE id=?`)
        .run(job.id);
    }
    skipped++;
    console.log(`[SKIP] ${job.title} @ ${job.company}`);
    continue;
  }

  const email = extractEmail(job.notes);

  if (!DRY_RUN) {
    db.prepare(`UPDATE applications SET score=?, email_contact=?, updated_at=datetime('now') WHERE id=?`)
      .run(score, email || '', job.id);
  }

  if (email) emailFound++;
  scored++;

  if (DRY_RUN || score >= 5) {
    console.log(`[${score}pts] ${job.title} @ ${job.company}${email ? ' | email:' + email : ''}`);
  }
}

// Email domain dedup: among status='found' jobs with email_contact, keep only highest-score per domain
let deduped = 0;
if (!DRY_RUN) {
  const withEmail = db.prepare(`
    SELECT id, score, email_contact
    FROM applications
    WHERE status='found' AND trim(email_contact) != ''
  `).all();

  const byDomain = {};
  for (const j of withEmail) {
    const domain = j.email_contact.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(j);
  }

  for (const [domain, dupes] of Object.entries(byDomain)) {
    if (dupes.length <= 1) continue;
    dupes.sort((a, b) => (b.score || 0) - (a.score || 0));
    for (const dup of dupes.slice(1)) {
      db.prepare(`UPDATE applications SET status='skipped', updated_at=datetime('now') WHERE id=?`)
        .run(dup.id);
      console.log(`[DEDUP] @${domain} — kept #${dupes[0].id}, skipped #${dup.id}`);
      deduped++;
    }
  }
  if (deduped > 0) logDB(db, 'filter', 'dedup', `${deduped} skipped by email domain dedup`);
}

logDB(db, 'filter', 'done', `${scored} ready (${emailFound} with email), ${skipped} skipped, ${deduped} deduped`);
console.log(`\nfilter: ${scored} ready | ${emailFound} with email | ${skipped} skipped | ${deduped} deduped`);
db.close();
