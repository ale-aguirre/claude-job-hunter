/**
 * digest.mjs — Compact pipeline summary (for cron log / future Telegram integration)
 *
 * Run: node digest.mjs
 */
import 'dotenv/config';
import { openDB } from './db-utils.mjs';

const db = openDB();

const counts = db.prepare(`
  SELECT status, COUNT(*) as n FROM applications GROUP BY status
`).all().reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});

const topDrafts = db.prepare(`
  SELECT id, score, title, company, email_contact
  FROM applications
  WHERE status='draft'
  ORDER BY score DESC
  LIMIT 5
`).all();

const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
console.log(`\n[digest] ${now}`);
console.log(
  `  found=${counts.found || 0} | draft=${counts.draft || 0} | approved=${counts.approved || 0}` +
  ` | applied=${counts.applied || 0} | skipped=${counts.skipped || 0} | rejected=${counts.rejected || 0}`
);

if (topDrafts.length > 0) {
  console.log(`  Pending approval (top ${topDrafts.length}):`);
  for (const d of topDrafts) {
    console.log(`    #${d.id} [${d.score || 0}pts] ${d.title} @ ${d.company} -> ${d.email_contact}`);
  }
}

console.log('');
db.close();
