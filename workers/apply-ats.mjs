/**
 * apply-ats.mjs — Fill ATS forms (Ashby, Lever, Greenhouse, Workable, Personio)
 * Usage: node apply-ats.mjs [--dry-run] [--visible]
 */
import { basename } from 'path';
import { getBrowser } from './browser-utils.mjs';
import { openDB, logDB, markResult } from './db-utils.mjs';
import { BASE_COVER, CV_PATH } from './config.mjs';
import { fillForm, uploadCV, clickApplyLink } from './form-utils.mjs';
import { getProfileKeywords } from './profile-extractor.mjs';
import { uploadCVRobust, fillAllRequiredFields, submitWithRetry, runFillCheck } from './form-answerer.mjs';
import { tailorCV } from './cv-tailor.mjs';

const db  = openDB();
const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const FILL_CHECK = args.includes('--fill-check'); // full fill (answers + CV), screenshot, never submits
// Tope por corrida. Antes el default era 999, o sea "postulá a todo lo que haya
// de una sentada", que es justo lo que hace que un board te marque como bot.
// Con 8 y la pausa aleatoria, una corrida se parece a una tarde de alguien
// postulando. Se puede subir a mano con --limit= cuando haga falta.
const LIMIT   = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '8');
const FILLCHECK_DIR = process.env.FILLCHECK_DIR || 'C:/tmp';

const AGENT = 'ATS-Apply';
const log = (action, detail = '', status = 'ok') => logDB(db, AGENT, action, detail, status);

const ATS_URL_PATTERNS = [
  { pattern: /ashbyhq\.com/,                          ats: 'ashby'       },
  { pattern: /lever\.co/,                             ats: 'lever'       },
  { pattern: /boards\.greenhouse\.io|greenhouse\.io/, ats: 'greenhouse'  },
  { pattern: /workable\.com/,                         ats: 'workable'    },
  { pattern: /getonbrd\.com\/jobs/,                   ats: 'getonbrd'    },
  { pattern: /jobs\.personio\.com/,                   ats: 'personio'    },
  { pattern: /careers-page\.com/,                     ats: 'careers-page'},
  { pattern: /bairesdev\.com/,                        ats: 'bairesdev'   },
];

// Dynamic keywords from user's CV/profile via profile-extractor
const profileKw       = await getProfileKeywords();
const APPLY_KEYWORDS  = profileKw.searchTerms;
// El cache de keywords lo genera un LLM y vuelve a meter "staff" cada vez que se
// regenera, asi que la decision de admitir Staff se aplica aca y no depende de lo
// que el modelo devuelva en la proxima corrida.
const EXCLUDE_KEYWORDS = (profileKw.excludeTerms || []).filter(k => !/^\s*staff\s*$/i.test(String(k)));

// Hard role exclusion, independent of the LLM-generated profile cache (which
// on 13/8 did not include "manager" and let apply-ats try to fill a form for
// "Engineering Manager, AI Engineering: Chat" — not this candidate's role).
// Decision de Alexis (7/9): Staff SI, Lead NO. Staff es contribuidor individual
// senior, escribe codigo. Lead segun la empresa maneja gente, y manager,
// director, vp y head of son directamente puestos de gestion: otro laburo y otro
// CV. Sin esto la cola quedaba en cero, porque los unicos avisos que sobrevivian
// el scoring eran justamente los Staff.
const ROLE_EXCLUDE_RE = /\b(manager|director|vp\b|head of|chief\b|lead\b|principal\b)\b/i;

/**
 * El score ya es el juicio de relevancia del sistema: lo calcula scoreJob() en
 * rules.mjs, que mira titulo, notas, plataforma y ubicacion con matching por
 * palabra. Exigir ADEMAS que el titulo contenga literalmente una keyword del
 * perfil es pedir la misma prueba dos veces, con el metodo peor de los dos.
 *
 * Lo que costaba, medido el 31/8 sobre la cola real:
 *   11pts "Full-Stack Engineer, AI Agent Platform"  descartado: la keyword es
 *         "full stack" con espacio y el titulo trae guion
 *   10pts "AI Automation Engineer & Architect"      descartado
 *    9pts "Senior Software Engineer - AI Interaction Evaluation"  descartado
 * y el applier terminaba postulando a avisos de 3 y 6 puntos teniendo esos.
 *
 * Es el mismo error que el scout tenia en isRelevant y que ya se corrigio: una
 * preferencia usada como requisito. Ahora la keyword solo decide sobre los
 * avisos que el scoring dejo abajo; arriba de 5 manda el score.
 *
 * ROLE_EXCLUDE_RE queda como veto duro en los dos caminos: es la unica regla
 * que no depende del cache de keywords generado por el LLM.
 */
// Umbral a partir del cual manda el score y no la keyword. Estaba en 5 y dejaba
// afuera avisos evidentes: "Senior / Staff Fullstack Engineer" con 4 y "Senior
// AI Platform Engineer" con 3. El scoring de rules.mjs mira titulo, notas,
// plataforma y ubicacion; la lista de keywords solo mira el titulo y exige la
// frase exacta. Confiar en la peor de las dos por dos puntos de diferencia
// costaba 24 candidatos de una cola de 278.
const SCORE_CONFIABLE = 3;

/**
 * Normaliza el titulo para comparar contra las keywords del perfil.
 *
 * "Fullstack" y "full stack" son la misma palabra escrita distinto, igual que
 * "front-end" y "frontend". Sin esto, "Senior / Staff Fullstack Engineer" no
 * matcheaba la keyword "full stack" y quedaba afuera, que es la misma familia
 * de bug que el guion de "Full-Stack": comparar texto sin normalizarlo.
 */
function normalizarTitulo(t) {
  return t.toLowerCase()
    .replace(/[-/_]+/g, ' ')
    .replace(/fullstack/g, 'full stack')
    .replace(/frontend/g, 'front end')
    .replace(/backend/g, 'back end')
    .replace(/\s+/g, ' ');
}

function isRelevantTitle(title = '', score = 0) {
  const t = title.toLowerCase();
  if (ROLE_EXCLUDE_RE.test(t)) return false;
  if (EXCLUDE_KEYWORDS.some(k => t.includes(k.toLowerCase()))) return false;
  if (score >= SCORE_CONFIABLE) return true;
  const normalizado = normalizarTitulo(t);
  return APPLY_KEYWORDS.some(k => normalizado.includes(normalizarTitulo(k)));
}

// ── Location filter ───────────────────────────────────────────────────────────
// GitLab (and most big remote-first companies) tie a role to specific regions.
// On 13/8 apply-ats tried to fill forms for "Remote, Bangalore" and "Remote, US"
// postings — roles this Argentina-based candidate cannot legally take. This
// filter reads the location line from the job posting BEFORE any form filling
// (a plain fetch() for server-rendered ATS boards, so no browser tab is even
// opened for a disqualified job; only JS-shell ATS like Ashby need the shared
// page to render first — the check still runs before any field is touched).
const LATAM_OK_RE = /argentina|latam|latin america|am[eé]rica latina|\bamericas\b|south america|m[eé]xico|mexico|colombia|\bchile\b|per[uú]|brazil|brasil|uruguay|paraguay|bolivia|ecuador|buenos aires|c[oó]rdoba|worldwide|\bglobal\b|anywhere/i;

async function prefetchText(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { texto: '', cerrado: false };
    const html = await r.text();
    const texto = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
    // Greenhouse redirige al listado de la empresa cuando el aviso cerro, con
    // HTTP 200. Detectarlo ACA importa: el filtro de ubicacion corre antes que
    // nada y, sin esto, terminaba leyendo el listado y sacando de ahi una
    // "ubicacion". Con Remote.com el parrafo que agarro decia que las
    // ubicaciones publicadas son solo publicitarias, y con eso bloqueo por pais
    // un aviso titulado "Anywhere in the World". Dos veces el motivo equivocado.
    return { texto, cerrado: /[?&]error=true/.test(r.url) };
  } catch { return { texto: '', cerrado: false }; }
}

/**
 * Una ubicacion es una lista corta de lugares, no un parrafo. Si lo que se
 * extrajo tiene largo de prosa o termina oraciones, el extractor agarro
 * cualquier cosa y bloquear con eso es peor que no filtrar: descarta avisos
 * buenos por un texto que nunca fue una ubicacion.
 */
// Palabras que aparecen en prosa y nunca en una linea de ubicacion. El corte por
// largo solo no alcanzaba: el parrafo de Remote.com entraba en 118 caracteres.
const PROSA_RE = /\b(the|you|your|are|is|was|we|our|us|please|check|only|often|means|which|that|under|about|see)\b/i;

function pareceUbicacion(txt) {
  if (!txt) return false;
  const limpio = txt.trim();
  if (limpio.length > 120) return false;
  if (limpio.split(/\s+/).length > 12) return false;   // una ubicacion son pocas palabras
  if (PROSA_RE.test(limpio)) return false;
  return true;
}

/** Pulls the location line out of a normalized (single-spaced) page text blob. */
function extractLocationText(text, title) {
  if (!text) return '';
  // Ashby-style: "<title> Location <list of places, ; separated> Employment Type|Department|Overview"
  const ashbyMatch = text.match(/\bLocation\s+(.+?)\s+(Employment Type|Department|Overview\b)/i);
  if (ashbyMatch) return ashbyMatch[1];
  // Greenhouse-style: "Job Application for <title> at <co> <title> <location> Apply
  // <co> is the intelligent...". The title appears TWICE near the top — once in
  // the "Job Application for X at Y" line, then again as the heading right before
  // the location. lastIndexOf() over the whole fetched text is wrong: on a real
  // GitLab posting it matched a THIRD occurrence buried in the "About this role"
  // paragraph ("As an AI Engineer at GitLab, you'll...") and returned that
  // paragraph's text as the "location", silently defeating the whole filter —
  // confirmed live, Bangalore/US/Canada postings all passed as eligible. Only
  // look for the title within the first ~700 chars (location is always near the
  // top) and specifically take the SECOND occurrence.
  if (title) {
    const head = text.slice(0, 700);
    const firstIdx = head.indexOf(title);
    if (firstIdx >= 0) {
      const secondIdx = head.indexOf(title, firstIdx + title.length);
      const startAt = secondIdx >= 0 ? secondIdx : firstIdx;
      const after = head.slice(startAt + title.length, startAt + title.length + 200);
      const applyIdx = after.search(/\bApply\b/);
      if (applyIdx > 0) return after.slice(0, applyIdx).trim();
    }
  }
  return '';
}

/**
 * A posting can list several regions (";"-separated for Ashby, one string per
 * Greenhouse posting). It's eligible if ANY region is Argentina/LATAM, or is a
 * bare untied "Remote" option. "Remote, Bangalore" is a Remote TIED to a place
 * — that place still has to clear the allowlist, same as a non-remote city.
 */
function isLocationEligible(locationText) {
  if (!locationText) return { ok: true, reason: 'no location text found on page — not blocking' };
  const segments = locationText.split(';').map(s => s.trim()).filter(Boolean);
  if (!segments.length) return { ok: true, reason: 'empty location — not blocking' };
  for (const seg of segments) {
    if (/^remote$/i.test(seg)) return { ok: true, reason: `open remote option: "${seg}"` };
    const tied = seg.match(/^remote,\s*(.+)$/i);
    const place = tied ? tied[1] : seg;
    if (LATAM_OK_RE.test(place)) return { ok: true, reason: `LATAM/Argentina match: "${seg}"` };
  }
  return { ok: false, reason: `location-restricted, no Argentina/LATAM/open-remote option found in "${locationText}"` };
}

// Max applications per company today — prevents ATS spam/blacklist
// Tope por empresa. El diario solo, que era lo unico que habia, no evitaba lo
// que paso con gitlab: 42 postulaciones a la misma empresa a lo largo de meses,
// de a dos por dia. Un recruiter que abre el legajo ve cuarenta y dos
// solicitudes del mismo candidato, y eso no ayuda, perjudica.
//
// gitlab, cursor y vanta ocupan un tercio de la cola viva porque publican mucho.
// Sin tope historico, el bot se dedica a esas tres y no llega al resto.
const MAX_POR_EMPRESA_HISTORICO = parseInt(process.env.MAX_POR_EMPRESA || '3');

function alreadyAppliedToday(company) {
  const hoy = db.prepare(`
    SELECT COUNT(*) as n FROM applications
    WHERE status='applied' AND company=? AND updated_at >= datetime('now','-1 day')
  `).get(company)?.n || 0;
  if (hoy >= 2) return true;                         // max 2 per company per day

  // Cuenta TODA postulacion real, no solo las que siguen activas: a los 30 dias
  // de silencio pasan a archived y desaparecerian del conteo. Las 42 de gitlab
  // estan justamente ahi. Se cuenta por la evidencia de envio (veredicto
  // CONFIRMED/UNVERIFIED o sent_at), que sobrevive al archivado.
  const total = db.prepare(`
    SELECT COUNT(*) as n FROM applications
    WHERE lower(company)=lower(?)
      AND (status='applied' OR veredicto LIKE 'CONFIRMED%' OR veredicto LIKE '%UNVERIFIED%'
           OR (sent_at IS NOT NULL AND sent_at != ''))
  `).get(company)?.n || 0;
  return total >= MAX_POR_EMPRESA_HISTORICO;
}

// Note: getonbrd.com removed — requires active session cookies (use apply-from-db.mjs with Chrome mirror instead)
//
// El ORDER BY no es cosmético. Sin él SQLite devuelve las filas en orden de
// rowid, o sea por antigüedad de descubrimiento, y como el tope por corrida es
// de 8, el applier gastaba la corrida entera en los 8 avisos más viejos que
// tuvieran URL de ATS. El 24/8 eso fueron ocho de gitlab con score 1-3, todos
// location-restricted: la corrida terminó sin postular a nada, mientras un
// aviso de score 9 seguía esperando en la misma tabla.
//
// filter.mjs venía calculando y guardando `score` desde siempre y nadie lo leía
// acá. Un puntaje que no ordena nada es un puntaje que no existe.
const allDbJobs = db.prepare(`
  SELECT id, company, title, url, description, COALESCE(score, 0) AS score FROM applications
  WHERE status='found'
    -- Todo descarte terminal se escribe con el prefijo BLOCKED:, y va en la
    -- columna veredicto, que es del applier. notes es del scout y la refresca en
    -- cada corrida: mientras el veredicto vivio ahi, el scout lo borraba cada
    -- ocho horas y estos mismos avisos volvian a la cola para siempre.
    AND (veredicto NOT LIKE 'BLOCKED:%' OR veredicto IS NULL)
    AND (url LIKE '%ashbyhq.com%' OR url LIKE '%lever.co%'
      OR url LIKE '%greenhouse.io%' OR url LIKE '%workable.com%'
      OR url LIKE '%personio.com%'
      OR url LIKE '%careers-page.com%' OR url LIKE '%bairesdev.com%')
  ORDER BY score DESC, applied_at DESC
`).all();

// Mismo criterio que el scout: un filtro que descarta en silencio es un filtro
// en el que no se puede confiar. Acá se descartaba por dos razones distintas y
// sólo se imprimía el total.
let fueraPorRol = 0, fueraPorCupoEmpresa = 0;
const dbJobs = allDbJobs.filter(j => {
  if (!isRelevantTitle(j.title, j.score)) { fueraPorRol++; return false; }
  if (alreadyAppliedToday(j.company)) { fueraPorCupoEmpresa++; return false; }
  return true;
});
console.log(`Role filter: ${allDbJobs.length} ATS jobs → ${dbJobs.length} relevant`);
console.log(`  descartados: ${fueraPorRol} por titulo/rol, ${fueraPorCupoEmpresa} por cupo diario de la empresa`);

const targets = dbJobs.map(j => ({
  ...j,
  ats: ATS_URL_PATTERNS.find(p => p.pattern.test(j.url))?.ats || 'unknown',
})).slice(0, LIMIT);

if (targets.length) {
  console.log(`Rango de score en esta corrida: ${targets[0].score} → ${targets[targets.length - 1].score}`);
}

const MODE = FILL_CHECK ? 'FILL-CHECK (no submit)' : DRY_RUN ? 'DRY RUN' : 'LIVE';
console.log(`\n🚀 ATS Direct Apply — ${MODE}`);
console.log(`Targets from DB: ${targets.length}\n`);

if (targets.length === 0) { db.close(); process.exit(0); }

const { page, close: closeBrowser } = await getBrowser();

let applied = 0, blocked = 0, skipped = 0, filteredOut = 0;

/**
 * Pausa entre postulaciones.
 *
 * Antes esto era `setTimeout(r, 2000)` fijo para todos los casos. Dos problemas.
 * Primero, 2 segundos significa 20 postulaciones en menos de un minuto de espera
 * acumulada, desde una sola IP y una sola sesión de browser: eso es la firma de
 * bot que venían marcando algunos boards. Y segundo, un intervalo CONSTANTE es
 * en sí mismo una firma, porque ninguna persona tarda exactamente lo mismo entre
 * un formulario y el siguiente.
 *
 * Ahora el intervalo es aleatorio y sólo es largo cuando de verdad se envió algo.
 * Saltear un aviso ya visto no le cuesta nada al servidor y no necesita pausa.
 */
function pausaEntrePostulaciones(huboEnvio) {
  const [min, max] = huboEnvio ? [45_000, 150_000] : [1_500, 4_000];
  const ms = Math.floor(min + Math.random() * (max - min));
  if (huboEnvio) console.log(`  ⏸  esperando ${Math.round(ms / 1000)}s antes de la próxima`);
  return new Promise(r => setTimeout(r, ms));
}

for (const target of targets) {
  // Sólo un envío real amerita la pausa larga. Se marca en los caminos que
  // efectivamente tocaron el formulario del board.
  let seAplico = false;
  const ex = db.prepare('SELECT id FROM applications WHERE url=? AND status=?').get(target.url, 'applied');
  if (ex) { console.log(`⏭  Already applied: ${target.company}`); skipped++; continue; }

  console.log(`\n→ ${target.company} | ${target.title}\n  ${target.url}`);

  // ── Location filter — server-rendered ATS: skip WITHOUT opening the browser tab.
  const { texto: preText, cerrado } = await prefetchText(target.url);
  if (cerrado) {
    log('job_closed', `${target.company} | ${target.title} — expired/closed (redirect Greenhouse)`, 'warn');
    markResult(db, target, 'found', `BLOCKED: Job closed/expired — Greenhouse redirigio al listado de la empresa`);
    blocked++; continue;
  }
  const isJsShell = !preText || /enable javascript/i.test(preText);
  if (!isJsShell) {
    const loc = extractLocationText(preText, (target.title || "").trim());
    // Si lo extraido no parece una ubicacion, no se bloquea: el aviso sigue su
    // camino y mas adelante se vuelve a mirar la ubicacion con la pagina ya
    // renderizada. Bloquear con un texto que no era una ubicacion descarta
    // avisos buenos y encima lo registra con el motivo equivocado.
    const elig = pareceUbicacion(loc)
      ? isLocationEligible(loc)
      : { ok: true, reason: 'texto extraido no parece una ubicacion — no se bloquea acá' };
    if (!elig.ok) {
      log('skipped_location', `${target.company} | ${target.title} — ${elig.reason}`, 'warn');
      markResult(db, target, 'found', `BLOCKED: ${elig.reason}`);
      filteredOut++; continue;
    }
  }

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const currentUrl = page.url();

    const pageText = await Promise.race([
      page.evaluate(() => document.body.innerText.slice(0, 1500)),
      new Promise((_, r) => setTimeout(() => r(new Error('eval timeout')), 5000)),
    ]).catch(() => '');

    // Check for expired/closed job
    const CLOSED_SIGNALS = ['job not found', 'position no longer', 'no longer available', 'job has been closed', 'this job has expired', 'posting has expired', 'page not found', '404'];
    if (CLOSED_SIGNALS.some(s => pageText.toLowerCase().includes(s))) {
      log('job_closed', `${target.company} | ${target.title} — expired/closed`, 'warn');
      markResult(db, target, 'found', `BLOCKED: Job closed/expired — "${pageText.slice(0, 80)}"`);
      blocked++; continue;
    }

    // Location filter for JS-shell ATS (Ashby etc) — the plain fetch() above only
    // returns "you need to enable JavaScript", so the check has to run against the
    // rendered page. Still happens before any field is touched or CV uploaded.
    if (isJsShell) {
      const loc = extractLocationText(pageText.replace(/\s+/g, ' '), (target.title || '').trim());
      const elig = isLocationEligible(loc);
      if (!elig.ok) {
        log('skipped_location', `${target.company} | ${target.title} — ${elig.reason}`, 'warn');
        markResult(db, target, 'found', `BLOCKED: ${elig.reason}`);
        filteredOut++; continue;
      }
    }

    // Cookie dismiss
    await Promise.race([
      page.evaluate(() => {
        const ACCEPT_TEXTS = ['accept all','accept','aceptar','entendido','acepto','continuar','got it','agree','ok','i agree','continue'];
        const clickables = [...document.querySelectorAll('button,a,[role="button"]')];
        for (const el of clickables) {
          const txt = el.textContent?.trim().toLowerCase();
          if (ACCEPT_TEXTS.some(t => txt === t || txt.startsWith(t))) { try { el.click(); } catch {} break; }
        }
        document.querySelectorAll('[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"],[id*="CookieConsent"],[class*="gdpr"],[id*="gdpr"]').forEach(el => {
          try { el.remove(); } catch {}
        });
      }),
      new Promise(r => setTimeout(r, 3000)),
    ]).catch(() => {});
    await page.waitForTimeout(500);

    const hasForm = await Promise.race([
      page.$('form, input[type="email"], input[name="email"], input[name="first_name"], input[name="firstName"]'),
      new Promise(r => setTimeout(() => r(null), 5000)),
    ]);
    if (!hasForm) {
      const href = await Promise.race([
        clickApplyLink(page),
        new Promise(r => setTimeout(() => r(null), 10000)),
      ]);
      if (!href) {
        // Greenhouse no da 404 para un aviso cerrado: redirige al listado de la
        // empresa con ?error=true y responde 200. Sin distinguirlo, tres avisos
        // vencidos quedaron registrados como "no encontro formulario", que
        // manda a buscar un bug de scraping donde no hay ninguno. El motivo
        // importa: uno se arregla con codigo y el otro con correr check-alive.
        const avisoCerrado = /[?&]error=true/.test(currentUrl);
        const motivo = avisoCerrado
          ? `BLOCKED: Job closed/expired — Greenhouse redirigio a ${currentUrl}`
          : `BLOCKED: No form or Apply button found at ${currentUrl}`;
        log(avisoCerrado ? 'job_closed' : 'blocked',
          `${target.company} | ${target.title} — ${avisoCerrado ? 'expired/closed (redirect Greenhouse)' : 'no form/button at ' + currentUrl.slice(0, 60)}`, 'warn');
        markResult(db, target, 'found', motivo);
        blocked++; continue;
      }
      await Promise.race([
        page.$('form, input[type="email"], input[name="email"], input[name="first_name"]'),
        new Promise(r => setTimeout(r, 5000)),
      ]);
    }

    if (FILL_CHECK) {
      const result = await runFillCheck(page, target, FILLCHECK_DIR);
      const unanswered = result.report.filter(r => r.method === 'unanswerable');
      const filledCount = result.report.filter(r => r.method === 'deterministic' || r.method === 'llm').length;
      console.log(`  CV: ${result.cv.ok ? '✅ ' + result.cv.filename : '❌ ' + result.cv.reason}`);
      console.log(`  Filled: ${filledCount} | Unanswerable: ${unanswered.length} | LLM calls: ${result.llmCalls} | Red fields after fill: ${result.fieldErrorsAfterFill.length}`);
      console.log(`  Screenshot: ${result.screenshotPath}`);
      if (result.aborted) {
        log('fillcheck_aborted', `${target.company} | ${target.title} — ${result.aborted}`, 'warn');
        markResult(db, target, 'found', `FILL-CHECK ABORTED: ${result.aborted} | screenshot: ${result.screenshotPath}`);
      } else {
        const note = `FILL-CHECK: cv=${result.cv.ok ? 'ok' : 'FAIL:' + result.cv.reason} filled=${filledCount} unanswerable=${unanswered.length} llmCalls=${result.llmCalls} redFields=${result.fieldErrorsAfterFill.length} | screenshot: ${result.screenshotPath}`;
        log('fillcheck', `${target.company} | ${target.title} → ${note}`);
        markResult(db, target, 'found', note);
      }
      applied++; continue;
    }

    // ── CV adaptado ──────────────────────────────────────────────────────────
    // Recién acá, con rol/ubicación ya filtrados y el form confirmado, vale la
    // pena pagar la llamada al LLM y la generación del PDF: un aviso que se
    // descarta antes de este punto nunca gastó un adaptado. tailorCV hace su
    // propia validación anti-invención y devuelve null si algo falla (LLM sin
    // responder, validación rechazada, sin descripción real para ese aviso);
    // en ese caso cae al estático — postular con el genérico es mejor que no
    // postular. El nombre subido queda registrado siempre, en cv_used.
    const tailored = await tailorCV(target);
    let cvPath = CV_PATH;
    let cvSource = 'static';
    if (tailored?.path) {
      cvPath = tailored.path;
      cvSource = 'tailored';
      console.log(`  [cv] adaptado -> ${basename(cvPath)}`);
    } else {
      console.log(`  [cv] fallback a estático -> ${basename(cvPath)} (tailorCV devolvió null, ver [cv-tailor] arriba)`);
    }

    if (DRY_RUN) {
      await Promise.race([fillForm(page, BASE_COVER), new Promise(r => setTimeout(r, 8000))]);
      await Promise.race([uploadCV(page),             new Promise(r => setTimeout(r, 5000))]);
      // Un solo log por job en dry-run
      log('dry_run', `${target.company} | ${target.title} → form found & filled (${target.ats}) [cv:${cvSource}]`);
      markResult(db, target, 'found', `DRY RUN: form found and filled | cv=${cvSource}:${basename(cvPath)}`);
      if (target.id) db.prepare(`UPDATE applications SET cv_used=? WHERE id=?`).run(cvPath, target.id);
      applied++; continue;
    }

    // LIVE: robust CV upload (real filechooser flow) + full required-field
    // answering (deterministic + validated LLM choices) before submitting.
    const cv = await uploadCVRobust(page, cvPath);
    if (!cv.ok) {
      log('blocked', `${target.company} | ${target.title} — CV upload failed: ${cv.reason}`, 'warn');
      markResult(db, target, 'found', `BLOCKED: CV upload failed — ${cv.reason}`);
      blocked++; continue;
    }
    // Se subió de verdad al form: queda registrado pase lo que pase después
    // (bloqueo en un campo, submit fallido), para poder comparar más adelante
    // si el adaptado consigue más respuestas que el estático.
    if (target.id) db.prepare(`UPDATE applications SET cv_used=? WHERE id=?`).run(cvPath, target.id);
    const fillResult = await fillAllRequiredFields(page, target);
    if (fillResult.aborted) {
      log('blocked', `${target.company} | ${target.title} — ${fillResult.aborted}`, 'warn');
      markResult(db, target, 'found', `BLOCKED: ${fillResult.aborted}`);
      blocked++; continue;
    }
    const unanswered = fillResult.report.filter(r => r.method === 'unanswerable');
    if (unanswered.length > 0) {
      const reason = `BLOCKED: ${unanswered.length} required field(s) unanswerable — ${unanswered.map(u => u.label).slice(0, 5).join(' | ')}`;
      log('blocked', `${target.company} | ${target.title} — ${reason}`, 'warn');
      markResult(db, target, 'found', reason);
      blocked++; continue;
    }

    // Desde acá hay un envío real contra el board, así que corresponde la
    // pausa larga pase lo que pase con el resultado.
    seAplico = true;
    const outcome = await submitWithRetry(page, target);
    if (outcome.status === 'applied') {
      log('applied', `${target.company} | ${target.title} → CONFIRMED at ${outcome.proof.finalUrl.slice(0, 60)}${outcome.retried ? ' (after retry)' : ''}`);
      markResult(db, target, 'applied', `CONFIRMED at ${outcome.proof.finalUrl} | screenshot: ${outcome.proof.screenshotPath}`);
      applied++;
    } else {
      // Lever contesta "File exceeds the maximum upload size of 100MB" cuando un
      // campo de archivo quedo vacio. El 31/8 eso salio con un CV de 74 KB, o
      // sea el mensaje del board es directamente falso y manda a buscar el
      // problema en el tamano del PDF, que es donde no esta. El CV principal se
      // habia subido bien; lo que faltaba era un segundo input de archivo, sin
      // etiqueta, de una tarjeta propia de la empresa. No se completa solo a
      // proposito: no se adivina que archivo pide un campo que no dice que pide.
      const errSummary = (outcome.fieldErrors || []).slice(0, 5).map(e => {
        const txt = e.label || e.error || '';
        return /exceeds the maximum upload size/i.test(txt)
          ? `${txt} [el board miente: hay un campo de archivo adicional sin completar, el CV se subio bien]`
          : txt;
      }).join(' | ');
      log('blocked', `${target.company} | ${target.title} — ${outcome.reason}${errSummary ? ' | fields: ' + errSummary : ''}`, 'warn');
      markResult(db, target, 'found', `BLOCKED: ${outcome.reason}${errSummary ? ' | fields: ' + errSummary : ''}`);
      blocked++;
    }
  } catch (e) {
    log('error', `${target.company} | ${target.title}: ${e.message.slice(0, 80)}`, 'error');
    markResult(db, target, 'found', `BLOCKED: Error — ${e.message.slice(0, 80)}`);
    blocked++;
  }
  await pausaEntrePostulaciones(seAplico);
}

try { await closeBrowser(); } catch {}
console.log(`\n──────────────────────`);
// El mismo contador servia para las tres modalidades, asi que una corrida en
// seco cerraba con "Applied/submitted: 3" sin haber enviado nada. Leer esa
// linea y creerle es exactamente el error que este proyecto viene arreglando en
// todos lados: un numero que parece un resultado y no lo es.
if (DRY_RUN) {
  console.log(`🧪 Formularios completados SIN enviar: ${applied}  (dry-run: no se postulo a nada)`);
} else if (FILL_CHECK) {
  console.log(`🧪 Formularios completados SIN enviar: ${applied}  (fill-check: no se postulo a nada)`);
} else {
  console.log(`✅ Applied/submitted: ${applied}`);
}
console.log(`🚫 Blocked (reason in DB): ${blocked}`);
console.log(`⏭  Already done: ${skipped}`);
console.log(`🌎 Filtered out (role/location): ${filteredOut}`);
db.close();
process.exit(0);
