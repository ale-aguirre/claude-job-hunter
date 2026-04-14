/**
 * cleanup-db.mjs — Archive jobs in DB that don't match dev profile
 * Run: node cleanup-db.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('applications.db');

const EXCL = [
  'security engineer', 'customer support', 'sales rep', 'marketing manager',
  'animator', 'vfx', 'account executive', 'recruiter', 'staff engineer',
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
  const excluded = EXCL.some(k => t.includes(k));
  const relevant = DEV.some(k => t.includes(k));
  if (excluded || !relevant) {
    db.prepare("UPDATE applications SET status='archived', notes='AUTO: role not matching dev profile' WHERE id=?").run(j.id);
    archived++;
    if (archived <= 20) console.log(`  ARCHIVED: ${j.company} — ${j.title}`);
  }
}

const remaining = db.prepare("SELECT COUNT(*) as n FROM applications WHERE status='found'").get().n;
console.log(`\nDone. Archived: ${archived} | Remaining found: ${remaining}`);
db.close();
