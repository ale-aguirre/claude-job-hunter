/**
 * email-apply.mjs — Send approved job application emails
 *
 * Reads status='approved' jobs and uses their pre-built cover_letter + cv_used from DB.
 * Template generation happens in draft.mjs — this script ONLY sends.
 *
 * Requires: GMAIL_APP_PASSWORD in .env
 * Dry run:  node email-apply.mjs --dry-run [--limit=N]
 * Real:     node email-apply.mjs [--limit=N]
 * Test:     TEST_TO=test@example.com node email-apply.mjs --limit=1
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');
import { existsSync } from 'fs';
import { basename } from 'path';
import 'dotenv/config';
import { openDB, logDB } from './db-utils.mjs';
import { PROFILE } from './config.mjs';
import { buildEmail } from './templates.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '5');
const TEST_TO = process.env.TEST_TO || '';

const EMAIL      = PROFILE.email;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';

if (!GMAIL_PASS && !DRY_RUN) {
  console.error('[email-apply] GMAIL_APP_PASSWORD not set in .env — aborting');
  process.exit(1);
}

const db = openDB();

const jobs = db.prepare(`
  SELECT * FROM applications
  WHERE status='approved'
  ORDER BY score DESC, updated_at DESC
  LIMIT ?
`).all(LIMIT);

if (jobs.length === 0) {
  console.log('[email-apply] No approved jobs. Run: node approve.mjs list');
  db.close();
  process.exit(0);
}

console.log(`[email-apply] ${jobs.length} approved${TEST_TO ? ` | TEST -> ${TEST_TO}` : ''}${DRY_RUN ? ' | DRY RUN' : ''}\n`);

const transporter = DRY_RUN ? null : nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: EMAIL, pass: GMAIL_PASS },
});

let sent = 0;

for (const job of jobs) {
  // cover_letter and cv_used were stored by draft.mjs; fall back to buildEmail only if missing
  const body    = job.cover_letter || buildEmail(job).body;
  const cvPath  = job.cv_used      || '';
  const subject = buildEmail(job).subject;  // cheap: just picks template subject
  const to      = TEST_TO || job.email_contact;

  const cvOk        = cvPath && existsSync(cvPath);
  // Always use a clean public filename — the internal job-id slug stays private
  const attachments = cvOk ? [{ filename: 'Alexis_Aguirre_CV.pdf', path: cvPath }] : [];

  console.log(`-> [${job.score || 0}pts] ${job.title} @ ${job.company} | ${to} | CV: ${cvOk ? basename(cvPath) : 'MISSING'}`);

  if (DRY_RUN) {
    console.log(`   Subject: ${subject}`);
    console.log(`   ${body.split('\n').filter(l => l.trim()).slice(0, 3).join('\n   ')}\n`);
    continue;
  }

  try {
    await transporter.sendMail({
      from: `Alexis Aguirre <${EMAIL}>`,
      to,
      subject,
      text: body,
      attachments,
    });

    if (!TEST_TO) {
      db.prepare(`
        UPDATE applications SET status='applied', updated_at=datetime('now') WHERE id=?
      `).run(job.id);
      logDB(db, 'email-apply', 'sent', `${job.title} @ ${job.company} -> ${job.email_contact}`);
    }
    console.log(`   OK Sent${TEST_TO ? ' (test)' : ''}`);
    sent++;
    await new Promise(r => setTimeout(r, 3000));
  } catch (e) {
    logDB(db, 'email-apply', 'send_error', `${job.title}: ${e.message.slice(0, 80)}`, 'error');
    console.error(`   FAIL: ${e.message.slice(0, 80)}`);
  }
}

console.log(`\n[email-apply] ${sent}/${jobs.length} sent`);
if (!TEST_TO && !DRY_RUN) logDB(db, 'email-apply', 'done', `${sent}/${jobs.length} sent`);
db.close();
