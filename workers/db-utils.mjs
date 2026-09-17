/**
 * db-utils.mjs — Shared DB helpers: logging, upsert, status updates
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

export function openDB() {
  const dbPath = process.env.HUNTDESK_DB_PATH
    || fileURLToPath(new URL('applications.db', import.meta.url));
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  // Sin esto, cualquier escritura mientras otro worker tiene la base tomada
  // falla al toque con SQLITE_BUSY en vez de esperar. El 9/9 eso mato a
  // check-alive en TODAS sus corridas automaticas: esta agendado a las :25 y el
  // filter a las :20, y bastaba que se rozaran. A mano nunca se reproducia.
  //
  // Va aca y no en cada worker porque hay ocho tareas programadas corriendo en
  // horarios cercanos (scout :00, filter :20, check-alive :25, applier :40, mas
  // los watchers) y catorce de dieciseis archivos escriben en la misma base.
  db.pragma('busy_timeout = 15000');
  // Migracion de la base existente (1800+ filas). Guardada asi para que corra
  // una sola vez y desde cualquier worker que abra la DB por este helper.
  try { db.exec(`ALTER TABLE applications ADD COLUMN description TEXT DEFAULT ''`); } catch {}
  // notes venia cumpliendo dos roles: la metadata que escribe el scout y el
  // veredicto que escribe el applier. Como el scout refresca notes cada vez que
  // reencuentra un aviso, le borraba el "BLOCKED: Job closed/expired" y el
  // applier volvia a intentar el mismo aviso muerto tres veces por dia. Separar
  // las columnas es el arreglo de fondo: cada proceso escribe la suya y no hay
  // forma de que uno pise al otro.
  try { db.exec(`ALTER TABLE applications ADD COLUMN veredicto TEXT DEFAULT ''`); } catch {}
  return db;
}

/**
 * Limpia una descripcion de aviso antes de guardarla: saca tags HTML, decodifica
 * las entidades mas comunes y colapsa espacios/saltos de linea repetidos. Se usa
 * en upsertJob para que la columna description no arrastre markup crudo de las
 * APIs (Greenhouse y Ashby, sobre todo, devuelven HTML).
 */
export function limpiarDescripcion(txt) {
  if (!txt) return '';
  const ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&#x27;': "'", '&#x2F;': '/', '&nbsp;': ' ',
  };
  // El orden importa y estaba al reves. Greenhouse devuelve `content` con doble
  // escape (`&amp;lt;div&amp;gt;`), asi que sacar tags primero no encontraba
  // ninguno, y el decode posterior resucitaba el HTML dentro del texto ya
  // "limpio". Se decodifica primero, repitiendo hasta que el texto deje de
  // cambiar, y recien despues se sacan los tags.
  const decodificar = t => t.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#x27;|&#x2F;|&nbsp;/g, m => ENTITIES[m]);
  let out = String(txt);
  for (let i = 0; i < 3; i++) {
    const antes = out;
    out = decodificar(out);
    if (out === antes) break;
  }
  out = out.replace(/<[^>]+>/g, ' ');
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/ *\n */g, '\n').trim();
  return out.slice(0, 6000);
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
export function upsertJob(db, { company, title, url, source, status = 'found', notes = '', platform = '', description = '' }) {
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
    'INSERT INTO applications (company,title,url,source,status,notes,platform,description) VALUES (?,?,?,?,?,?,?,?)'
  ).run(company, title, url, source, status, notes, platform, limpiarDescripcion(description));
  return true;
}

/**
 * Update (or insert) an application's status + veredicto.
 * Matches by url when id not provided.
 *
 * El veredicto va en su propia columna y NO en notes: notes es de la metadata
 * del board, que el scout refresca en cada corrida. Escribir el veredicto ahi
 * hacia que el scout lo borrara cada ocho horas.
 */
export function markResult(db, { id, url, company, title, source = 'direct', platform = 'direct' }, status, note) {
  const n = String(note).slice(0, 500);
  // applied_at es la fecha en que el scout encontro el aviso, no cuando se
  // postulo de verdad. Cuando el applier confirma un envio hay que dejar
  // sent_at, sino las postulaciones reales del bot quedaban sin fecha propia
  // de envio. COALESCE para no pisarlo si ya se habia guardado antes.
  const sentAtSet = status === 'applied' ? ", sent_at=COALESCE(sent_at, datetime('now'))" : '';
  if (id) {
    db.prepare(`UPDATE applications SET status=?, veredicto=?, updated_at=datetime('now')${sentAtSet} WHERE id=?`)
      .run(status, n, id);
    return;
  }
  const ex = db.prepare('SELECT id FROM applications WHERE url=?').get(url);
  if (ex) {
    db.prepare(`UPDATE applications SET status=?, veredicto=?, updated_at=datetime('now')${sentAtSet} WHERE url=?`)
      .run(status, n, url);
  } else if (status === 'applied') {
    db.prepare(
      "INSERT INTO applications (company,title,url,source,status,veredicto,platform,sent_at) VALUES (?,?,?,?,?,?,?,datetime('now'))"
    ).run(company ?? '', title ?? '', url, source, status, n, platform);
  } else {
    db.prepare(
      'INSERT INTO applications (company,title,url,source,status,veredicto,platform) VALUES (?,?,?,?,?,?,?)'
    ).run(company ?? '', title ?? '', url, source, status, n, platform);
  }
}
