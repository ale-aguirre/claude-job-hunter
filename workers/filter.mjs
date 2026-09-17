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
import { cleanTitle } from './templates.mjs';
import { SKIP_TITLES, SKIP_LOCATION, SKIP_TECH, MIN_SALARY_MO, BOOST_HIGH, BOOST_MED, scoreJob } from './rules.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const EMAIL_SKIP = ['noreply', 'no-reply', 'donotreply', 'notifications', 'bounce', 'mailer', 'system@', 'alerts@',
  'your@', 'you@', 'example@', '@example.', 'email@', 'name@', 'user@', 'test@', 'sentry.', '@sentry', '.png', '.jpg', '.svg', 'wixpress'];

// Allowlist regex for valid title characters.
// Incluye ':' y acentos a propósito: sin ellos se descartaban títulos legítimos
// como "Senior Software Engineer (Typescript), AI Clients: Duo CLI" o cualquier
// aviso en español con tildes o eñes.
const TITLE_CHARS_RE = /^[\p{L}\p{N}_\s/+#.,:&()[\]'‐-―-]+$/u;

// Emojis y pictogramas decorativos. Varios boards abren el título con uno
// (⚙️ Senior/Staff Platform Engineer). Eso no ensucia el título, es adorno.
const DECOR_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu;

/**
 * Saca el adorno y normaliza espacios. El título limpio es el que se valida y
 * el que se guarda.
 */
export function stripDecor(raw = '') {
  return raw.replace(DECOR_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * Returns true if a raw title string looks like garbage / truncated text.
 * Checks: >70 chars, illegal chars, starts with lowercase letter.
 *
 * El adorno se saca ANTES de validar. Antes se rechazaba de plano y así se
 * perdían avisos buenos por un emoji al principio, que es la misma familia de
 * fallo que el filtro que tiraba 98 de cada 100 avisos sin decirlo.
 */
function isBadTitle(raw) {
  const t = stripDecor(raw);
  if (!t) return true;
  if (t.length > 70) return true;
  if (!TITLE_CHARS_RE.test(t)) return true;
  if (/^[a-z]/.test(t)) return true;  // starts with lowercase = likely a sentence fragment
  return false;
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
  // Si el título traía adorno, se guarda ya limpio. Si no se persiste acá, el
  // emoji vuelve a aparecer en el dashboard y en el CV adaptado.
  const sinDecor = stripDecor(job.title);
  if (sinDecor && sinDecor !== job.title) {
    if (!DRY_RUN) db.prepare('UPDATE applications SET title=? WHERE id=?').run(sinDecor, job.id);
    job.title = sinDecor;
  }

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

// El log de 'done' es lo único que el dashboard y las próximas corridas ven.
// Antes se escribía igual en --dry-run que en una corrida real: mismos números,
// mismo aspecto de "544 ready", pero SIN UPDATE de por medio — cero filas
// tocadas en la base. Eso fue justo lo que pasó el 31/8 con agentic-jobs: una
// corrida en dry-run quedó logueada como si hubiera scoreado, y los 85 avisos
// se quedaron en score=0 porque la corrida real nunca se hizo. Prefijar
// [DRY RUN] es la única diferencia entre "esto pasó" y "esto se simuló".
const doneDetail = `${DRY_RUN ? '[DRY RUN] ' : ''}${scored} ready (${emailFound} with email), ${skipped} skipped, ${deduped} deduped`;
logDB(db, 'filter', 'done', doneDetail);
console.log(`\nfilter: ${DRY_RUN ? '[DRY RUN] ' : ''}${scored} ready | ${emailFound} with email | ${skipped} skipped | ${deduped} deduped`);
db.close();
