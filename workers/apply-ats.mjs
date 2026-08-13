/**
 * apply-ats.mjs — Fill ATS forms (Ashby, Lever, Greenhouse, Workable, Personio)
 * Usage: node apply-ats.mjs [--dry-run] [--visible]
 */
import { getBrowser } from './browser-utils.mjs';
import { openDB, logDB, markResult } from './db-utils.mjs';
import { BASE_COVER, CV_PATH } from './config.mjs';
import { fillForm, uploadCV, clickApplyLink } from './form-utils.mjs';
import { getProfileKeywords } from './profile-extractor.mjs';
import { uploadCVRobust, fillAllRequiredFields, submitWithRetry, runFillCheck } from './form-answerer.mjs';

const db  = openDB();
const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const FILL_CHECK = args.includes('--fill-check'); // full fill (answers + CV), screenshot, never submits
const LIMIT   = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '999');
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
const EXCLUDE_KEYWORDS = profileKw.excludeTerms || [];

// Hard role exclusion, independent of the LLM-generated profile cache (which
// on 13/8 did not include "manager" and let apply-ats try to fill a form for
// "Engineering Manager, AI Engineering: Chat" — not this candidate's role).
const ROLE_EXCLUDE_RE = /\b(manager|director|vp\b|head of|chief\b|staff\b|principal\b)\b/i;

function isRelevantTitle(title = '') {
  const t = title.toLowerCase();
  if (ROLE_EXCLUDE_RE.test(t)) return false;
  if (EXCLUDE_KEYWORDS.some(k => t.includes(k.toLowerCase()))) return false;
  return APPLY_KEYWORDS.some(k => t.includes(k.toLowerCase()));
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
    if (!r.ok) return '';
    const html = await r.text();
    return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
  } catch { return ''; }
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
function alreadyAppliedToday(company) {
  const count = db.prepare(`
    SELECT COUNT(*) as n FROM applications
    WHERE status='applied' AND company=? AND updated_at >= datetime('now','-1 day')
  `).get(company)?.n || 0;
  return count >= 2; // max 2 per company per day
}

// Note: getonbrd.com removed — requires active session cookies (use apply-from-db.mjs with Chrome mirror instead)
const allDbJobs = db.prepare(`
  SELECT company, title, url FROM applications
  WHERE status='found'
    AND (notes NOT LIKE 'BLOCKED:%' OR notes IS NULL)
    AND (url LIKE '%ashbyhq.com%' OR url LIKE '%lever.co%'
      OR url LIKE '%greenhouse.io%' OR url LIKE '%workable.com%'
      OR url LIKE '%personio.com%'
      OR url LIKE '%careers-page.com%' OR url LIKE '%bairesdev.com%')
`).all();

const dbJobs = allDbJobs.filter(j => isRelevantTitle(j.title) && !alreadyAppliedToday(j.company));
console.log(`Role filter: ${allDbJobs.length} ATS jobs → ${dbJobs.length} relevant (excl. company daily cap)`);

const targets = dbJobs.map(j => ({
  ...j,
  ats: ATS_URL_PATTERNS.find(p => p.pattern.test(j.url))?.ats || 'unknown',
})).slice(0, LIMIT);

const MODE = FILL_CHECK ? 'FILL-CHECK (no submit)' : DRY_RUN ? 'DRY RUN' : 'LIVE';
console.log(`\n🚀 ATS Direct Apply — ${MODE}`);
console.log(`Targets from DB: ${targets.length}\n`);

if (targets.length === 0) { db.close(); process.exit(0); }

const { page, close: closeBrowser } = await getBrowser();

let applied = 0, blocked = 0, skipped = 0, filteredOut = 0;

for (const target of targets) {
  const ex = db.prepare('SELECT id FROM applications WHERE url=? AND status=?').get(target.url, 'applied');
  if (ex) { console.log(`⏭  Already applied: ${target.company}`); skipped++; continue; }

  console.log(`\n→ ${target.company} | ${target.title}\n  ${target.url}`);

  // ── Location filter — server-rendered ATS: skip WITHOUT opening the browser tab.
  const preText = await prefetchText(target.url);
  const isJsShell = !preText || /enable javascript/i.test(preText);
  if (!isJsShell) {
    const loc = extractLocationText(preText, (target.title || "").trim());
    const elig = isLocationEligible(loc);
    if (!elig.ok) {
      log('skipped_location', `${target.company} | ${target.title} — ${elig.reason}`, 'warn');
      markResult(db, target, 'found', `SKIPPED: ${elig.reason}`);
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
        markResult(db, target, 'found', `SKIPPED: ${elig.reason}`);
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
        // Un solo log consolidado por job cuando falla
        log('blocked', `${target.company} | ${target.title} — no form/button at ${currentUrl.slice(0,60)}`, 'warn');
        markResult(db, target, 'found', `BLOCKED: No form or Apply button found at ${currentUrl}`);
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

    if (DRY_RUN) {
      await Promise.race([fillForm(page, BASE_COVER), new Promise(r => setTimeout(r, 8000))]);
      await Promise.race([uploadCV(page),             new Promise(r => setTimeout(r, 5000))]);
      // Un solo log por job en dry-run
      log('dry_run', `${target.company} | ${target.title} → form found & filled (${target.ats})`);
      markResult(db, target, 'found', 'DRY RUN: form found and filled');
      applied++; continue;
    }

    // LIVE: robust CV upload (real filechooser flow) + full required-field
    // answering (deterministic + validated LLM choices) before submitting.
    const cv = await uploadCVRobust(page, CV_PATH);
    if (!cv.ok) {
      log('blocked', `${target.company} | ${target.title} — CV upload failed: ${cv.reason}`, 'warn');
      markResult(db, target, 'found', `BLOCKED: CV upload failed — ${cv.reason}`);
      blocked++; continue;
    }
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

    const outcome = await submitWithRetry(page, target);
    if (outcome.status === 'applied') {
      log('applied', `${target.company} | ${target.title} → CONFIRMED at ${outcome.proof.finalUrl.slice(0, 60)}${outcome.retried ? ' (after retry)' : ''}`);
      markResult(db, target, 'applied', `CONFIRMED at ${outcome.proof.finalUrl} | screenshot: ${outcome.proof.screenshotPath}`);
      applied++;
    } else {
      const errSummary = (outcome.fieldErrors || []).slice(0, 5).map(e => e.label || e.error).join(' | ');
      log('blocked', `${target.company} | ${target.title} — ${outcome.reason}${errSummary ? ' | fields: ' + errSummary : ''}`, 'warn');
      markResult(db, target, 'found', `BLOCKED: ${outcome.reason}${errSummary ? ' | fields: ' + errSummary : ''}`);
      blocked++;
    }
  } catch (e) {
    log('error', `${target.company} | ${target.title}: ${e.message.slice(0, 80)}`, 'error');
    markResult(db, target, 'found', `BLOCKED: Error — ${e.message.slice(0, 80)}`);
    blocked++;
  }
  await new Promise(r => setTimeout(r, 2000));
}

try { await closeBrowser(); } catch {}
console.log(`\n──────────────────────`);
console.log(`✅ Applied/submitted: ${applied}`);
console.log(`🚫 Blocked (reason in DB): ${blocked}`);
console.log(`⏭  Already done: ${skipped}`);
console.log(`🌎 Filtered out (role/location): ${filteredOut}`);
db.close();
process.exit(0);
