/**
 * draft.mjs — Generate email drafts for jobs status='found' with valid email_contact
 *
 * Writes to DB: status='draft', cover_letter=body, cv_used=cvPath
 * Does NOT send anything.
 *
 * Run: node draft.mjs [--dry-run] [--limit=N]
 */
import 'dotenv/config';
import { openDB, logDB } from './db-utils.mjs';
import { buildEmail, cvFor } from './templates.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '50');

const db = openDB();

const jobs = db.prepare(`
  SELECT * FROM applications
  WHERE status='found'
    AND email_contact IS NOT NULL
    AND trim(email_contact) != ''
  ORDER BY score DESC, applied_at DESC
  LIMIT ?
`).all(LIMIT);

if (jobs.length === 0) {
  console.log('[draft] No jobs with email_contact — run filter.mjs first');
  db.close();
  process.exit(0);
}

console.log(`[draft] ${jobs.length} jobs to draft${DRY_RUN ? ' | DRY RUN' : ''}\n`);

let drafted = 0;

for (const job of jobs) {
  const { subject, body, role, lang } = buildEmail(job);
  const cvPath = cvFor(role, lang);

  console.log(`-> [${job.score || 0}pts ${role}/${lang}] ${job.title} @ ${job.company} | ${job.email_contact}`);

  if (DRY_RUN) {
    console.log(`   Subject: ${subject}`);
    console.log(`   ${body.split('\n').filter(l => l.trim()).slice(0, 3).join('\n   ')}\n`);
    continue;
  }

  db.prepare(`
    UPDATE applications
    SET status='draft', cover_letter=?, cv_used=?, updated_at=datetime('now')
    WHERE id=?
  `).run(body, cvPath, job.id);

  logDB(db, 'draft', 'drafted', `${job.title} @ ${job.company}`);
  drafted++;
}

if (!DRY_RUN) {
  logDB(db, 'draft', 'done', `${drafted}/${jobs.length} drafted`);
}
console.log(`\n[draft] ${DRY_RUN ? '(dry) ' : ''}${drafted}/${jobs.length} drafted`);
db.close();
