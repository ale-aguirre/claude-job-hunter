/**
 * backfill-descriptions.mjs — rellena `description` en avisos viejos.
 *
 * La columna description se agrego despues de que ya hubiera 1800+ filas en
 * la base. El scout la llena para avisos nuevos, pero cuando encuentra un
 * duplicado su UPDATE solo toca `notes`, asi que todo lo que ya estaba antes
 * quedo con description vacio para siempre si nadie lo va a buscar a mano.
 * Este worker hace eso: por cada fuente pega contra la API del board y
 * completa lo que falta, sin tocar nada mas de la fila.
 *
 * Run: node backfill-descriptions.mjs [--dry] [--limit=N]
 */
import { openDB, logDB, limpiarDescripcion } from './db-utils.mjs';

const DRY = process.argv.includes('--dry');
const limitArg = process.argv.find(a => a.startsWith('--limit='))?.split('=')[1];
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

const db = openDB();
// check-alive.mjs esta escribiendo `applications.db` en paralelo. Sin esto,
// cualquier UPDATE nuestro que pise un write suyo tira SQLITE_BUSY al toque.
db.pragma('busy_timeout = 10000');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 Safari/537.36' };
const FETCH_TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Pausa aleatoria entre 400 y 900ms. Por-board, no por-fila en ashby/jobicy,
// que ahi el volumen de requests es bajo igual.
const pausa = () => sleep(400 + Math.random() * 500);

async function fetchJSON(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const updateStmt = db.prepare('UPDATE applications SET description=? WHERE id=?');

function nuevoBalance() {
  return {
    intentadas: 0, rellenadas: 0, no_encontradas: 0, error_red: 0,
    ejemplo_no_encontrado: null, ejemplo_error: null,
  };
}

/**
 * Registra el resultado de una fila contra su balance de fuente. Nunca se
 * traga un caso: todo lo que no se pudo rellenar queda contado con su razon
 * y, la primera vez que aparece esa razon, con un ejemplo concreto.
 */
function registrar(bal, row, resultado) {
  bal.intentadas++;
  if (resultado.ok) {
    const limpio = limpiarDescripcion(resultado.texto);
    if (!limpio) {
      bal.no_encontradas++;
      if (!bal.ejemplo_no_encontrado) bal.ejemplo_no_encontrado = `#${row.id} ${row.url} (texto vacio tras limpiar)`;
      return;
    }
    if (!DRY) updateStmt.run(limpio, row.id);
    bal.rellenadas++;
    return;
  }
  if (resultado.razon === 'no_encontrado') {
    bal.no_encontradas++;
    if (!bal.ejemplo_no_encontrado) bal.ejemplo_no_encontrado = `#${row.id} ${row.url}`;
  } else {
    bal.error_red++;
    if (!bal.ejemplo_error) bal.ejemplo_error = `#${row.id} ${row.url} -> ${resultado.err?.message || resultado.razon}`;
  }
}

// ─── Seleccion ───────────────────────────────────────────────────────────
// found + description vacio/nulo + no confirmada muerta (null incluido:
// son las que check-alive todavia no toco).
let rows = db.prepare(`
  SELECT id, url, source FROM applications
  WHERE status='found'
    AND (description IS NULL OR trim(description) = '')
    AND (alive IS NULL OR alive != 'muerta')
`).all();

if (Number.isFinite(LIMIT)) rows = rows.slice(0, LIMIT);

const bySource = {};
for (const r of rows) (bySource[r.source] ??= []).push(r);

const CON_ESTRATEGIA = new Set(['ashby', 'greenhouse', 'jobicy', 'himalayas']);
const balance = {};

console.log(`${DRY ? '[DRY] ' : ''}backfill-descriptions: ${rows.length} filas a procesar\n`);

// ─── ASHBY: un request por board ────────────────────────────────────────
async function procesarAshby(filas) {
  const bal = balance.ashby = nuevoBalance();
  const porBoard = {};
  for (const r of filas) {
    const m = /^https?:\/\/jobs\.ashbyhq\.com\/([^/]+)\//i.exec(r.url);
    if (!m) { registrar(bal, r, { ok: false, razon: 'no_encontrado' }); continue; }
    (porBoard[m[1]] ??= []).push(r);
  }

  const boards = Object.keys(porBoard);
  for (let i = 0; i < boards.length; i++) {
    const board = boards[i];
    const filasBoard = porBoard[board];
    try {
      const data = await fetchJSON(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
      const jobs = data.jobs || [];
      for (const r of filasBoard) {
        const idFila = r.url.split('/').filter(Boolean).pop();
        let job = jobs.find((j) => j.jobUrl === r.url);
        if (!job) {
          job = jobs.find((j) => {
            const idJob = (j.jobUrl || '').split('/').filter(Boolean).pop();
            return idJob === idFila || j.id === idFila;
          });
        }
        if (!job) { registrar(bal, r, { ok: false, razon: 'no_encontrado' }); continue; }
        registrar(bal, r, { ok: true, texto: job.descriptionPlain });
      }
    } catch (err) {
      console.error(`[ashby] fallo el board "${board}": ${err.message}`);
      const razon = err.status === 404 ? 'no_encontrado' : 'error_red';
      for (const r of filasBoard) registrar(bal, r, { ok: false, razon, err });
    }
    if (i < boards.length - 1) await pausa();
  }
}

// ─── GREENHOUSE: un request por aviso ───────────────────────────────────
async function procesarGreenhouse(filas) {
  const bal = balance.greenhouse = nuevoBalance();
  for (let i = 0; i < filas.length; i++) {
    const r = filas[i];
    const m = /^https?:\/\/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i.exec(r.url);
    if (!m) { registrar(bal, r, { ok: false, razon: 'no_encontrado' }); continue; }
    const [, board, id] = m;
    try {
      const job = await fetchJSON(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`);
      registrar(bal, r, { ok: true, texto: job.content });
    } catch (err) {
      console.error(`[greenhouse] fallo #${r.id} (${board}/${id}): ${err.message}`);
      registrar(bal, r, { ok: false, razon: err.status === 404 ? 'no_encontrado' : 'error_red', err });
    }
    if (i < filas.length - 1) await pausa();
  }
}

// ─── JOBICY: un request para todo el listado ────────────────────────────
async function procesarJobicy(filas) {
  const bal = balance.jobicy = nuevoBalance();
  let porId = new Map();
  try {
    // count=200 fue verificado a mano (curl, 31/8): la API lo acepta y
    // devuelve exactamente 200 avisos. Si algun dia lo topea mas abajo, el
    // log de abajo lo deja ver.
    const data = await fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=200');
    const jobs = data.jobs || [];
    console.log(`[jobicy] listado trajo ${jobs.length} avisos (pedimos count=200)`);
    for (const j of jobs) porId.set(String(j.id), j);
  } catch (err) {
    console.error(`[jobicy] fallo el listado completo: ${err.message}`);
    for (const r of filas) registrar(bal, r, { ok: false, razon: 'error_red', err });
    return;
  }

  for (const r of filas) {
    const m = /\/jobs\/(\d+)-/.exec(r.url);
    if (!m) { registrar(bal, r, { ok: false, razon: 'no_encontrado' }); continue; }
    const job = porId.get(m[1]);
    // Avisos viejos que ya salieron del listado no aparecen: es esperable,
    // no es un error de la fuente.
    if (!job) { registrar(bal, r, { ok: false, razon: 'no_encontrado' }); continue; }
    registrar(bal, r, { ok: true, texto: job.jobDescription });
  }
}

// ─── HIMALAYAS: paginado por cursor ──────────────────────────────────────
async function procesarHimalayas(filas) {
  const bal = balance.himalayas = nuevoBalance();
  const porLink = new Map();
  let cursor = '';
  try {
    for (let page = 0; page < 5; page++) {
      const url = `https://himalayas.app/jobs/api?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const data = await fetchJSON(url);
      // Ojo: la API ignora el limit=100 pedido y siempre devuelve paginas de
      // 20 (verificado a mano, 31/8). Igual pagina por nextCursor como pide
      // la spec, solo que con paginas mas chicas de lo esperado.
      for (const j of (data.jobs || [])) {
        if (j.applicationLink) porLink.set(j.applicationLink, j);
      }
      cursor = data.nextCursor || '';
      if (!cursor) break;
      if (page < 4) await pausa();
    }
  } catch (err) {
    console.error(`[himalayas] fallo el paginado: ${err.message}`);
    for (const r of filas) registrar(bal, r, { ok: false, razon: 'error_red', err });
    return;
  }

  for (const r of filas) {
    const job = porLink.get(r.url);
    if (!job) { registrar(bal, r, { ok: false, razon: 'no_encontrado' }); continue; }
    registrar(bal, r, { ok: true, texto: job.description });
  }
}

// ─── Ejecucion ───────────────────────────────────────────────────────────
if (bySource.ashby) await procesarAshby(bySource.ashby);
if (bySource.greenhouse) await procesarGreenhouse(bySource.greenhouse);
if (bySource.jobicy) await procesarJobicy(bySource.jobicy);
if (bySource.himalayas) await procesarHimalayas(bySource.himalayas);

const sinEstrategia = Object.entries(bySource).filter(([src]) => !CON_ESTRATEGIA.has(src));

// ─── Reporte ─────────────────────────────────────────────────────────────
console.log('\n--- balance por fuente ---');
const lineasResumen = [];
for (const src of ['ashby', 'greenhouse', 'jobicy', 'himalayas']) {
  const bal = balance[src];
  if (!bal) continue;
  console.log(`${src}: intentadas=${bal.intentadas} rellenadas=${bal.rellenadas} no_encontradas=${bal.no_encontradas} error_red=${bal.error_red}`);
  if (bal.ejemplo_no_encontrado) console.log(`  ejemplo no_encontrada: ${bal.ejemplo_no_encontrado}`);
  if (bal.ejemplo_error) console.log(`  ejemplo error_red: ${bal.ejemplo_error}`);
  lineasResumen.push(`${src} ${bal.rellenadas}/${bal.intentadas} (no_enc=${bal.no_encontradas} err=${bal.error_red})`);
}

if (sinEstrategia.length) {
  console.log('\n--- sin estrategia (no procesadas) ---');
  for (const [src, filas] of sinEstrategia) {
    console.log(`${src}: ${filas.length} filas`);
  }
  lineasResumen.push(`sin_estrategia: ${sinEstrategia.map(([s, f]) => `${s}=${f.length}`).join(', ')}`);
}

const huboErrores = Object.values(balance).some((b) => b.error_red > 0);
const resumen = lineasResumen.join(' | ');
console.log(`\n${resumen}`);

logDB(db, 'backfill-desc', 'done', resumen, huboErrores ? 'warn' : 'ok');
db.close();
