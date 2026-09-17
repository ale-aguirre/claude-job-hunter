/**
 * cleanup-db.mjs — Archive jobs in DB that don't match dev profile
 * Run: node cleanup-db.mjs
 */
import { openDB } from './db-utils.mjs';

const db = openDB();

/**
 * Escapa caracteres especiales de regex para meter un string literal adentro
 * de un patron.
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matchea `phrase` como palabra o frase completa dentro de `text`, no como
 * substring. Antes `t.includes('insurance')` archivaba "Software Engineer,
 * Insurance Platform" por 'insurance' (correcto, ahi es palabra completa),
 * pero tambien cosas como 'legal' adentro de "Legalzoom Engineer" o 'nurse'
 * adentro de "Nursery App Developer", que son falsos positivos de substring.
 * \b de JS no reconoce letras con tilde/unicode como parte de palabra, por
 * eso los bordes se arman a mano con \p{L}\p{N} (requiere flag 'u').
 */
function matchesPhrase(text, phrase) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, 'iu');
  return re.test(text);
}

const EXCL = [
  'security engineer', 'customer support', 'sales rep', 'marketing manager',
  'animator', 'vfx', 'account executive', 'recruiter',
  'solutions engineer', 'enterprise support', 'legal', 'lawyer', 'paralegal',
  'accountant', 'physician', 'nurse', 'gameplay', '3d artist', 'concept artist',
  'social media manager', 'copywriter', 'seo specialist', 'sales development',
  'insurance', 'loan officer', 'truck driver', 'warehouse',
];
const DEV = [
  'react', 'next.js', 'nextjs', 'typescript', 'javascript', 'frontend', 'front-end',
  'full stack', 'fullstack', 'full-stack', 'node.js', 'nodejs',
  'software engineer', 'software developer', 'web developer', 'web engineer',
  'ui developer', 'ui engineer', 'backend engineer', 'backend developer',
  'frontend engineer', 'frontend developer', 'devrel', 'developer relations',
  'prompt engineer', 'technical writer', 'product manager', 'qa engineer',
  'ux researcher', 'product designer', 'data analyst', 'engineer',
];

const found = db.prepare("SELECT id, title, company FROM applications WHERE status='found'").all();
let archived = 0;

for (const j of found) {
  const t = j.title.toLowerCase();
  const excluded = EXCL.some(k => matchesPhrase(t, k));
  const relevant = DEV.some(k => matchesPhrase(t, k));
  if (excluded || !relevant) {
    // notes es metadata del scout (se refresca cada vez que reencuentra el
    // aviso); el veredicto del cleanup va en su propia columna, igual que
    // markResult en db-utils.
    db.prepare("UPDATE applications SET status='archived', veredicto='AUTO: role not matching dev profile' WHERE id=?").run(j.id);
    archived++;
    if (archived <= 20) console.log(`  ARCHIVED: ${j.company} — ${j.title}`);
  }
}

const remaining = db.prepare("SELECT COUNT(*) as n FROM applications WHERE status='found'").get().n;
console.log(`\nDone. Archived: ${archived} | Remaining found: ${remaining}`);
db.close();
