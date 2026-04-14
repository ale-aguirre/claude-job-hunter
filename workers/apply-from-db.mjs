/**
 * apply-from-db.mjs — Apply to DB jobs with career/jobs page URLs
 * Uses OpenFang writer for personalized cover letters (falls back to BASE_COVER)
 *
 * Run: node apply-from-db.mjs [--dry-run] [--limit=10] [--visible]
 */
import { getBrowser } from './browser-utils.mjs';
import { openDB, logDB, markResult } from './db-utils.mjs';
import { BASE_COVER, PROFILE_TEXT, PROFILE } from './config.mjs';
import { getProfileKeywords } from './profile-extractor.mjs';
import { fillForm, uploadCV, clickSubmit, clickApplyLink, verifySubmission } from './form-utils.mjs';
import { sendMessage, isRunning } from './groq-client.mjs';
import { getCVText } from './cv-reader.mjs';

const db  = openDB();
const args = process.argv.slice(2);

// Dynamic keywords from user's CV/profile
const profileKw      = await getProfileKeywords();
const APPLY_KEYWORDS = profileKw.searchTerms;
const DRY_RUN = args.includes('--dry-run');
const LIMIT   = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '8');

const AGENT = 'ApplyFromDB';
const log = (action, detail = '', status = 'ok') => logDB(db, AGENT, action, detail, status);

const OF_AVAILABLE = await isRunning();
console.log(`[apply-from-db] LLM: ${OF_AVAILABLE ? '✓ Groq available' : '✗ offline (base cover)'}`);

// Pre-load CV text once for all cover letters in this run
const cvText = await getCVText();
const candidateContext = cvText
  ? `CV Summary:\n${cvText.slice(0, 2000)}`
  : `Candidate: ${PROFILE_TEXT}`;

async function getCoverLetter(job) {
  if (!OF_AVAILABLE) return BASE_COVER;
  try {
    const prompt = `Based on this candidate's background:
---
${candidateContext}
---

Write a concise cover letter (max 150 words) for:
Company: ${job.company}
Role: ${job.title}
URL: ${job.url}

Requirements:
- Match 2-3 specific skills from the CV to this role
- Direct, no corporate fluff
- Show genuine interest in the company
- End with clear CTA
- Sign as ${PROFILE.firstName} ${PROFILE.lastName} | ${PROFILE.email}${PROFILE.linkedin ? ' | ' + PROFILE.linkedin : ''}`;
    return (await sendMessage('writer', prompt)) || BASE_COVER;
  } catch { return BASE_COVER; }
}

const allCandidates = db.prepare(`
  SELECT id, company, title, url, notes FROM applications
  WHERE status = 'found'
    AND (notes NOT LIKE 'BLOCKED:%' OR notes IS NULL)
    AND (
      url LIKE '%/jobs/%' OR url LIKE '%/careers/%' OR url LIKE '%/job/%'
      OR url LIKE '%/positions/%' OR url LIKE '%/openings/%'
      OR url LIKE '%wellfound.com%'
      OR url LIKE '%himalayas.app%'
      OR url LIKE '%contra.com%'
      OR url LIKE '%Torre.co%' OR url LIKE '%torre.co%'
    )
    -- Exclude listing aggregators (they show job listings, not apply forms)
    AND url NOT LIKE '%remotive.com%'
    AND url NOT LIKE '%remoteok.com%'
    AND url NOT LIKE '%weworkremotely.com%'
    -- Exclude groq-generated career homepages (too generic, no apply form)
    AND platform NOT LIKE 'groq-%'
    AND url NOT LIKE '%ashbyhq.com%'
    AND url NOT LIKE '%lever.co%'
    AND url NOT LIKE '%greenhouse.io%'
  LIMIT 200
`).all();

// Role exclusion list — from profile-extractor (based on actual seniority level)
const EXCL_KW = profileKw.excludeTerms || [];
const candidates = allCandidates
  .filter(j => {
    const t = j.title.toLowerCase();
    if (EXCL_KW.some(k => t.includes(k.toLowerCase()))) return false;
    return APPLY_KEYWORDS.some(k => t.includes(k.toLowerCase()));
  })
  .slice(0, LIMIT);

console.log(`\n🎯 apply-from-db — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log(`Candidates from DB: ${candidates.length}\n`);

if (candidates.length === 0) {
  console.log('No eligible jobs found in DB. Run scouts to discover more.');
  db.close();
  process.exit(0);
}

const { context, close: closeBrowser } = await getBrowser({ newPage: false });
const page = await context.newPage();

let applied = 0, blocked = 0;

for (const job of candidates) {
  console.log(`\n→ ${job.company} | ${job.title}\n  ${job.url?.slice(0, 70)}`);

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);
    const currentUrl = page.url();

    const title = await page.title();
    if (title.includes('404') || title.includes('not found') || title.includes('closed')) {
      log('blocked', `${job.company} | ${job.title} — job closed/404`, 'warn');
      markResult(db, job, 'found', `BLOCKED: Job closed or 404 — ${title}`);
      blocked++; continue;
    }

    const hasForm = await Promise.race([
      page.$('form input[type="email"], input[name="email"], input[name="firstName"], input[name="first_name"]'),
      new Promise(r => setTimeout(() => r(null), 5000)),
    ]);
    if (!hasForm) {
      const href = await Promise.race([
        clickApplyLink(page),
        new Promise(r => setTimeout(() => r(null), 10000)),
      ]);
      if (!href) {
        log('blocked', `${job.company} | ${job.title} — no Apply button at ${currentUrl.slice(0, 50)}`, 'warn');
        markResult(db, job, 'found', `BLOCKED: No Apply button found at ${currentUrl.slice(0, 80)}`);
        blocked++; continue;
      }
    }

    const cover = await getCoverLetter(job);
    await Promise.race([fillForm(page, cover), new Promise(r => setTimeout(r, 8000))]);
    await Promise.race([uploadCV(page),         new Promise(r => setTimeout(r, 5000))]);

    if (DRY_RUN) {
      log('dry_run', `${job.company} | ${job.title} → form found & filled`);
      markResult(db, job, 'found', 'DRY_RUN: form found and filled');
      applied++; continue;
    }

    const submitted = await clickSubmit(page);
    if (submitted) {
      const proof = await verifySubmission(page, { company: job.company, originalUrl: job.url });
      if (proof.confirmed) {
        log('applied', `${job.company} | ${job.title} → CONFIRMED at ${proof.finalUrl.slice(0, 60)}`);
        markResult(db, job, 'applied', `CONFIRMED at ${proof.finalUrl} | screenshot: ${proof.screenshotPath}`);
      } else {
        log('applied', `${job.company} | ${job.title} → UNVERIFIED | screenshot: ${proof.screenshotPath}`);
        markResult(db, job, 'applied', `UNVERIFIED: submit clicked | screenshot: ${proof.screenshotPath}`);
      }
      applied++;
    } else {
      log('blocked', `${job.company} | ${job.title} — form filled but no submit button`, 'warn');
      markResult(db, job, 'found', 'BLOCKED: Form filled but no submit button');
      blocked++;
    }
  } catch (e) {
    log('error', `${job.company} | ${job.title}: ${e.message.slice(0, 80)}`, 'error');
    markResult(db, job, 'found', `BLOCKED: ${e.message.slice(0, 80)}`);
    blocked++;
  }
  await new Promise(r => setTimeout(r, 2500));
}

try { await page.close(); } catch {}
try { await closeBrowser(); } catch {}
console.log('\n──────────────────────');
console.log(`✅ Applied: ${applied}`);
console.log(`🚫 Blocked: ${blocked}`);
db.close();
process.exit(0);
