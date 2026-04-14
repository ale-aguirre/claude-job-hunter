/**
 * apply-ats.mjs — Fill ATS forms (Ashby, Lever, Greenhouse, Workable, Personio)
 * Usage: node apply-ats.mjs [--dry-run] [--visible]
 */
import { getBrowser } from './browser-utils.mjs';
import { openDB, logDB, markResult } from './db-utils.mjs';
import { BASE_COVER } from './config.mjs';
import { fillForm, uploadCV, clickSubmit, clickApplyLink, verifySubmission } from './form-utils.mjs';
import { getProfileKeywords } from './profile-extractor.mjs';

const db  = openDB();
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT   = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '999');

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

function isRelevantTitle(title = '') {
  const t = title.toLowerCase();
  if (EXCLUDE_KEYWORDS.some(k => t.includes(k.toLowerCase()))) return false;
  return APPLY_KEYWORDS.some(k => t.includes(k.toLowerCase()));
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

console.log(`\n🚀 ATS Direct Apply — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log(`Targets from DB: ${targets.length}\n`);

if (targets.length === 0) { db.close(); process.exit(0); }

const { page, close: closeBrowser } = await getBrowser();

let applied = 0, blocked = 0, skipped = 0;

for (const target of targets) {
  const ex = db.prepare('SELECT id FROM applications WHERE url=? AND status=?').get(target.url, 'applied');
  if (ex) { console.log(`⏭  Already applied: ${target.company}`); skipped++; continue; }

  console.log(`\n→ ${target.company} | ${target.title}\n  ${target.url}`);

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const currentUrl = page.url();

    const pageText = await Promise.race([
      page.evaluate(() => document.body.innerText.slice(0, 500)),
      new Promise((_, r) => setTimeout(() => r(new Error('eval timeout')), 5000)),
    ]).catch(() => '');

    // Check for expired/closed job
    const CLOSED_SIGNALS = ['job not found', 'position no longer', 'no longer available', 'job has been closed', 'this job has expired', 'posting has expired', 'page not found', '404'];
    if (CLOSED_SIGNALS.some(s => pageText.toLowerCase().includes(s))) {
      log('job_closed', `${target.company} | ${target.title} — expired/closed`, 'warn');
      markResult(db, target, 'found', `BLOCKED: Job closed/expired — "${pageText.slice(0, 80)}"`);
      blocked++; continue;
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

    await Promise.race([fillForm(page, BASE_COVER), new Promise(r => setTimeout(r, 8000))]);
    await Promise.race([uploadCV(page),             new Promise(r => setTimeout(r, 5000))]);

    if (DRY_RUN) {
      // Un solo log por job en dry-run
      log('dry_run', `${target.company} | ${target.title} → form found & filled (${target.ats})`);
      markResult(db, target, 'found', 'DRY RUN: form found and filled');
      applied++; continue;
    }

    const submitted = await clickSubmit(page);
    if (submitted) {
      const proof = await verifySubmission(page, { company: target.company, originalUrl: target.url });
      if (proof.confirmed) {
        log('applied', `${target.company} | ${target.title} → CONFIRMED at ${proof.finalUrl.slice(0, 60)}`);
        markResult(db, target, 'applied', `CONFIRMED at ${proof.finalUrl} | screenshot: ${proof.screenshotPath}`);
      } else {
        log('applied', `${target.company} | ${target.title} → UNVERIFIED (clicked submit) | screenshot saved`);
        markResult(db, target, 'applied', `UNVERIFIED: submit clicked | screenshot: ${proof.screenshotPath}`);
      }
      applied++;
    } else {
      log('blocked', `${target.company} | ${target.title} — form filled but no submit button`, 'warn');
      markResult(db, target, 'found', 'BLOCKED: Form filled but no submit button');
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
db.close();
process.exit(0);
