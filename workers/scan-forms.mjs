/**
 * scan-forms.mjs — Abre los formularios de la cola y reporta que campos el
 * sistema NO sabe responder, ANTES de que bloqueen una postulacion.
 *
 * Existe porque el metodo anterior era reactivo: correr el applier, ver cual
 * campo lo trabo, arreglarlo, repetir. Ocho campos distintos, ocho corridas, y
 * cada corrida son ocho horas. Barrer todos los formularios de una devuelve la
 * lista completa en una sola pasada.
 *
 * No llena, no envia, no toca la base. Solo mira y cuenta.
 *
 * Uso: node scan-forms.mjs [--limit=N]
 */
import { getBrowser } from './browser-utils.mjs';
import { openDB } from './db-utils.mjs';
import { clickApplyLink } from './form-utils.mjs';
import { enumerateFields, classifyField } from './form-answerer.mjs';

const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '40');
const db = openDB();

const jobs = db.prepare(`
  SELECT id, company, title, url, score FROM applications
  WHERE status='found' AND COALESCE(alive,'') != 'muerta' AND score >= 5
    AND (veredicto IS NULL OR veredicto = '')
    AND (url LIKE '%ashbyhq.com%' OR url LIKE '%lever.co%' OR url LIKE '%greenhouse.io%'
      OR url LIKE '%workable.com%' OR url LIKE '%personio.com%')
  ORDER BY score DESC
`).all().slice(0, LIMIT);

console.log(`escaneando ${jobs.length} formularios (sin llenar ni enviar)\n`);

const { page, close } = await getBrowser();
// label normalizado -> { veces, empresas, clasificacion }
const sinCobertura = new Map();
let ok = 0, sinForm = 0, errores = 0;

for (const [i, job] of jobs.entries()) {
  process.stdout.write(`\r  ${i + 1}/${jobs.length}  ${job.company.slice(0, 24).padEnd(24)}`);
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1800);
    if (/[?&]error=true/.test(page.url())) { sinForm++; continue; }
    if (!(await page.$('input[type="email"], input[name="email"], input[id="email"], form'))) {
      await Promise.race([clickApplyLink(page), new Promise(r => setTimeout(() => r(null), 8000))]);
      await page.waitForTimeout(1800);
    }
    const campos = await enumerateFields(page);
    if (!campos.length) { sinForm++; continue; }
    ok++;
    for (const f of campos) {
      if (!f.required) continue;
      const cls = classifyField(f, job);
      // Lo determinístico y lo que se saltea por politica ya estan resueltos.
      if (['text', 'option', 'skip'].includes(cls.kind)) continue;
      const clave = (f.label || '(sin label)').replace(/\s+/g, ' ').trim().slice(0, 70);
      const e = sinCobertura.get(clave) || { veces: 0, empresas: new Set(), kind: cls.kind, tipo: f.type };
      e.veces++; e.empresas.add(job.company);
      sinCobertura.set(clave, e);
    }
  } catch { errores++; }
}
await close();

console.log(`\n\nformularios leidos: ${ok} | sin formulario o cerrados: ${sinForm} | errores: ${errores}\n`);
const filas = [...sinCobertura.entries()].sort((a, b) => b[1].veces - a[1].veces);
if (!filas.length) {
  console.log('no quedo ningun campo requerido sin cobertura deterministica.');
} else {
  console.log('CAMPOS REQUERIDOS QUE EL SISTEMA NO RESUELVE SOLO:\n');
  console.log('  veces  como se resuelve   campo');
  for (const [label, e] of filas) {
    const via = e.kind === 'abort' ? 'PARA, pide humano' : e.kind.startsWith('llm') ? 'se lo pide al LLM' : e.kind;
    console.log(`  ${String(e.veces).padStart(5)}  ${via.padEnd(18)} ${label}`);
  }
  console.log('\nlos que aparecen muchas veces conviene resolverlos de forma deterministica:');
  console.log('una respuesta fija cuesta una linea y no depende de que el modelo acierte.');
}
db.close();
