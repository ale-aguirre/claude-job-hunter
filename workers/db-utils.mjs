/**
 * db-utils.mjs — Shared DB helpers: logging, upsert, status updates
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

export function openDB() {
  const dbPath = process.env.HUNTDESK_DB_PATH
    || new URL('applications.db', import.meta.url).pathname;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  return db;
}

/**
 * Log an action to agent_log table and console.
 * @param {import('better-sqlite3').Database} db
 * @param {string} agent  - agent name
 * @param {string} action
 * @param {string} detail
 * @param {'ok'|'warn'|'error'} status
 */
export function logDB(db, agent, action, detail = '', status = 'ok') {
  db.prepare('INSERT INTO agent_log (agent,action,detail,status) VALUES (?,?,?,?)')
    .run(agent, action, String(detail).slice(0, 200), status);
  console.log(`[${status}] ${action}: ${String(detail).slice(0, 120)}`);
}

/**
 * Upsert an application record (insert if not exists, skip if exists).
 * Returns true if inserted.
 */
export function upsertJob(db, { company, title, url, source, status = 'found', notes = '', platform = '' }) {
  if (!url?.startsWith('http')) return false;
  // Dedup by URL first
  const byUrl = db.prepare('SELECT id FROM applications WHERE url=?').get(url);
  if (byUrl) return false;
  // Dedup by company+title (case-insensitive) — skip generic titles that are always duplicates
  const genericTitles = ['from x bookmark', 'developer (hn who is hiring)', 'virtual assistant'];
  const lowerTitle = (title || '').toLowerCase();
  if (!genericTitles.some(g => lowerTitle.includes(g))) {
    const byNameCompany = db.prepare(
      'SELECT id FROM applications WHERE lower(company)=lower(?) AND lower(title)=lower(?)'
    ).get(company, title);
    if (byNameCompany) return false;
  }
  db.prepare(
    'INSERT INTO applications (company,title,url,source,status,notes,platform) VALUES (?,?,?,?,?,?,?)'
  ).run(company, title, url, source, status, notes, platform);
  return true;
}

/**
 * Update (or insert) an application's status + notes.
 * Matches by url when id not provided.
 */
export function markResult(db, { id, url, company, title, source = 'direct', platform = 'direct' }, status, note) {
  const n = String(note).slice(0, 500);
  if (id) {
    db.prepare("UPDATE applications SET status=?, notes=?, updated_at=datetime('now') WHERE id=?")
      .run(status, n, id);
    return;
  }
  const ex = db.prepare('SELECT id FROM applications WHERE url=?').get(url);
  if (ex) {
    db.prepare("UPDATE applications SET status=?, notes=?, updated_at=datetime('now') WHERE url=?")
      .run(status, n, url);
  } else {
    db.prepare(
      'INSERT INTO applications (company,title,url,source,status,notes,platform) VALUES (?,?,?,?,?,?,?)'
    ).run(company ?? '', title ?? '', url, source, status, n, platform);
  }
}
