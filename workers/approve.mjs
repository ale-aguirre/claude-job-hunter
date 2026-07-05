/**
 * approve.mjs — Approval queue for email drafts
 *
 * node approve.mjs list              — list pending drafts
 * node approve.mjs 12,15,18          — mark ids as 'approved'
 * node approve.mjs reject 13         — mark id as 'rejected'
 */
import 'dotenv/config';
import { basename } from 'path';
import { openDB, logDB } from './db-utils.mjs';

const db   = openDB();
const args = process.argv.slice(2);
const cmd  = args[0] || 'list';

if (cmd === 'list') {
  const drafts = db.prepare(`
    SELECT id, score, title, company, email_contact, cover_letter, cv_used
    FROM applications
    WHERE status='draft'
    ORDER BY score DESC, applied_at DESC
  `).all();

  if (drafts.length === 0) {
    console.log('[approve] No pending drafts.');
    db.close();
    process.exit(0);
  }

  console.log(`\n[approve] ${drafts.length} pending draft(s):\n`);
  for (const d of drafts) {
    const preview = (d.cover_letter || '')
      .split('\n')
      .filter(l => l.trim())
      .slice(0, 3)
      .join('\n         ');
    const cvLabel = d.cv_used ? basename(d.cv_used) : 'static';
    console.log(`  #${d.id} [${d.score || 0}pts] ${d.title} @ ${d.company}`);
    console.log(`         -> ${d.email_contact} | CV: ${cvLabel}`);
    console.log(`         ${preview}\n`);
  }
  console.log(`Approve: node approve.mjs 1,2,3    Reject: node approve.mjs reject 4`);

} else if (cmd === 'reject') {
  const id = parseInt(args[1]);
  if (!id) {
    console.error('Usage: node approve.mjs reject <id>');
    db.close();
    process.exit(1);
  }
  const job = db.prepare(
    `SELECT id, title, company FROM applications WHERE id=? AND status='draft'`
  ).get(id);
  if (!job) {
    console.error(`[approve] Draft #${id} not found or not in draft status.`);
    db.close();
    process.exit(1);
  }
  db.prepare(`UPDATE applications SET status='rejected', updated_at=datetime('now') WHERE id=?`).run(id);
  logDB(db, 'approve', 'rejected', `#${id} ${job.title} @ ${job.company}`);
  console.log(`[approve] #${id} rejected.`);

} else {
  // Comma-separated ids to approve
  const ids = cmd.split(',').map(s => parseInt(s.trim())).filter(Boolean);
  if (ids.length === 0) {
    console.error('Usage: node approve.mjs <id1,id2,...>');
    db.close();
    process.exit(1);
  }
  let approved = 0;
  for (const id of ids) {
    const job = db.prepare(
      `SELECT id, title, company FROM applications WHERE id=? AND status='draft'`
    ).get(id);
    if (!job) {
      console.warn(`[approve] Draft #${id} not found or not in draft status — skipped`);
      continue;
    }
    db.prepare(`UPDATE applications SET status='approved', updated_at=datetime('now') WHERE id=?`).run(id);
    logDB(db, 'approve', 'approved', `#${id} ${job.title} @ ${job.company}`);
    console.log(`[approve] #${id} approved — ${job.title} @ ${job.company}`);
    approved++;
  }
  console.log(`\n[approve] ${approved}/${ids.length} approved.`);
}

db.close();
