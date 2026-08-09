/**
 * migrate-dates.mjs — separate "when we found it" from "when we applied".
 *
 * applied_at has always held the scout timestamp, so every application looked
 * like it went out the day the lead was discovered. Eight emails sit in the
 * database dated 2026-04-15; Gmail shows they were actually sent on July 2nd
 * and 3rd. With that column you cannot tell how long a company has been silent,
 * which is the only question that matters when following up.
 *
 * Adds:
 *   found_at   - renamed meaning of the old column, left in place
 *   sent_at    - when the application actually left
 *   replied_at - when they answered, set by hand or by the inbox reader
 *
 * Run: node migrate-dates.mjs [--dry]
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DRY = process.argv.includes('--dry');
const db = new Database('applications.db');

const cols = db.prepare('PRAGMA table_info(applications)').all().map(c => c.name);
const add = (name, type) => {
  if (cols.includes(name)) return `${name}: ya existe`;
  if (!DRY) db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${type}`);
  return `${name}: agregada`;
};

console.log(add('sent_at', 'TEXT'));
console.log(add('replied_at', 'TEXT'));
console.log(add('outcome', "TEXT DEFAULT ''"));

if (DRY) { console.log('\n(dry run, nada se escribió)'); db.close(); process.exit(0); }

// Backfill: the applier wrote its own timestamp into the proof screenshot path
// as epoch millis (proof_<Company>_<epoch>.png). That is the only record of the
// real send time we have, so it is worth recovering.
const rows = db.prepare(
  "SELECT id, notes, applied_at FROM applications WHERE status='applied' AND sent_at IS NULL"
).all();

let fromProof = 0, fromApplied = 0;
const setSent = db.prepare('UPDATE applications SET sent_at=? WHERE id=?');

for (const r of rows) {
  const m = (r.notes || '').match(/proof_[^\s]*?_(\d{13})\.png/);
  if (m) {
    setSent.run(new Date(Number(m[1])).toISOString().replace('T', ' ').slice(0, 19), r.id);
    fromProof++;
  } else {
    // No better evidence: fall back to the scout date and flag it as approximate
    // rather than inventing precision we do not have.
    setSent.run(r.applied_at, r.id);
    fromApplied++;
  }
}

console.log(`\nsent_at recuperado del screenshot: ${fromProof}`);
console.log(`sent_at estimado con la fecha de scouting: ${fromApplied}`);

const check = db.prepare(`
  SELECT COUNT(*) n, MIN(sent_at) primero, MAX(sent_at) ultimo
  FROM applications WHERE sent_at IS NOT NULL
`).get();
console.log(`\ncon fecha de envío: ${check.n} | rango: ${check.primero} → ${check.ultimo}`);

db.close();
