/**
 * check-alive.mjs — find out which of the open leads still exist.
 *
 * 126 of the 219 pending leads are older than 45 days. A job posting that old
 * is usually filled or withdrawn, and the dashboard was presenting all of them
 * as equally actionable. Applying to a closed posting costs nothing visible,
 * which is exactly why it goes unnoticed.
 *
 * Also backfills `source` with the real board name. Every API-sourced row says
 * "API", so there was no way to tell Greenhouse from Remotive.
 *
 * Run: node check-alive.mjs [--limit=N] [--dry]
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DRY = process.argv.includes('--dry');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '250');
const db = new Database('applications.db');

for (const [col, type] of [['alive', 'TEXT'], ['checked_at', 'TEXT']]) {
  const cols = db.prepare('PRAGMA table_info(applications)').all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE applications ADD COLUMN ${col} ${type}`);
}

// The board name is already sitting in notes, written by whichever scraper
// found the row. Recovering it is a string match, not another network call.
const BOARDS = [
  ['greenhouse', /greenhouse/i], ['lever', /lever/i], ['ashby', /ashby/i],
  ['remotive', /remotive/i], ['remoteok', /remote ?ok/i], ['himalayas', /himalayas/i],
  ['weworkremotely', /we ?work ?remotely/i], ['jobicy', /jobicy/i],
  ['hn-hiring', /HN Who is Hiring/i], ['torre', /torre/i], ['contra', /contra/i],
  ['getonbrd', /getonbrd|get on brd/i], ['themuse', /muse/i], ['workana', /workana/i],
  ['arbeitnow', /arbeitnow/i], ['jobgether', /jobgether/i], ['bumeran', /bumeran/i],
  ['computrabajo', /computrabajo/i], ['europeremotely', /europe ?remotely/i],
  ['groq-search', /groq:/i],
];

if (!DRY) {
  const upd = db.prepare('UPDATE applications SET source=? WHERE id=?');
  let n = 0;
  for (const r of db.prepare("SELECT id, notes, url FROM applications WHERE source='API'").all()) {
    const hay = `${r.notes || ''} ${r.url || ''}`;
    const hit = BOARDS.find(([, re]) => re.test(hay));
    if (hit) { upd.run(hit[0], r.id); n++; }
  }
  console.log(`source recuperado en ${n} filas\n`);
}

const rows = db.prepare(`
  SELECT id, company, title, url,
         CAST(julianday('now') - julianday(applied_at) AS INTEGER) AS dias
  FROM applications
  WHERE status='found' AND url LIKE 'http%'
  ORDER BY dias ASC
  LIMIT ?
`).all(LIMIT);

console.log(`chequeando ${rows.length} avisos...\n`);

const setAlive = db.prepare("UPDATE applications SET alive=?, checked_at=datetime('now') WHERE id=?");
const stats = { viva: 0, muerta: 0, incierta: 0 };

/**
 * A 404 or 410 is a dead posting. Anything else is treated as alive: a 403
 * usually means the board is blocking us, not that the job is gone, and
 * marking those dead would quietly delete real leads.
 */
async function check(r) {
  try {
    const res = await fetch(r.url, {
      method: 'GET', redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404 || res.status === 410) return 'muerta';
    if (!res.ok) return 'incierta';

    // Some boards answer 200 with a "this job is closed" page.
    const body = (await res.text()).toLowerCase().slice(0, 60000);
    const closed = ['no longer accepting', 'position has been filled', 'job not found',
      'this job is closed', 'no longer available', 'posting is closed',
      'ya no está disponible', 'búsqueda cerrada'];
    return closed.some(s => body.includes(s)) ? 'muerta' : 'viva';
  } catch {
    return 'incierta';
  }
}

// Four at a time: enough to finish in minutes, gentle enough not to look like
// an attack to any single board.
const BATCH = 4;
for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH);
  const results = await Promise.all(slice.map(check));
  slice.forEach((r, k) => {
    const v = results[k];
    stats[v]++;
    if (!DRY) setAlive.run(v, r.id);
  });
  process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length}  vivas ${stats.viva} · muertas ${stats.muerta} · inciertas ${stats.incierta}`);
}

console.log('\n');
const porEdad = db.prepare(`
  SELECT CASE WHEN julianday('now')-julianday(applied_at) < 15 THEN 'menos de 15 dias'
              WHEN julianday('now')-julianday(applied_at) < 45 THEN '15 a 45 dias'
              ELSE 'mas de 45 dias' END AS edad,
         SUM(alive='viva') AS vivas, SUM(alive='muerta') AS muertas, COUNT(*) AS total
  FROM applications WHERE status='found' AND alive IS NOT NULL
  GROUP BY edad ORDER BY MIN(julianday('now')-julianday(applied_at))
`).all();

console.log('edad del aviso      vivas  muertas  total');
for (const r of porEdad) {
  console.log(`  ${r.edad.padEnd(18)} ${String(r.vivas).padStart(4)} ${String(r.muertas).padStart(8)} ${String(r.total).padStart(7)}`);
}

db.close();
