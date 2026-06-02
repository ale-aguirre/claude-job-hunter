/**
 * apply-now.mjs — One-shot job application from URL or pasted text
 *
 * Usage:
 *   node apply-now.mjs --url="https://company.com/jobs/123" [--dry-run]
 *   node apply-now.mjs --text="Full job description..." [--dry-run]
 *
 * Flow:
 *   1. Fetch job page (Playwright or simple fetch)
 *   2. Analyze with LLM → extract company, title, contact method
 *   3. Generate tailored cover letter with Claude/Groq
 *   4. Print preview (always)
 *   5. If not --dry-run:
 *      a. Email found → send via SMTP (or emit [GMAIL_DRAFT_NEEDED] if no SMTP config)
 *      b. Form found → Playwright fill + upload CV + submit
 *   6. Log result to applications.db
 */

import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { existsSync } from 'fs';

import { getBrowser }                                          from './browser-utils.mjs';
import { fillForm, uploadCV, clickSubmit, clickApplyLink,
         verifySubmission }                                    from './form-utils.mjs';
import { openDB, logDB }                                       from './db-utils.mjs';
import { callFast, callSmart }                                 from './anthropic-client.mjs';
import { PROFILE, CV_PATH, PROFILE_TEXT }                     from './config.mjs';
import { getCVText }                                           from './cv-reader.mjs';

// ── Args ─────────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const getArg  = (prefix) => rawArgs.find(a => a.startsWith(prefix))?.split('=').slice(1).join('=') || '';

const URL_ARG  = getArg('--url=');
const TEXT_ARG = getArg('--text=');
const DRY_RUN  = rawArgs.includes('--dry-run');

if (!URL_ARG && !TEXT_ARG) {
  console.error('Usage: node apply-now.mjs --url="https://..." [--dry-run]');
  console.error('       node apply-now.mjs --text="Job description..." [--dry-run]');
  process.exit(1);
}

const SEP = '─'.repeat(62);

// ── DB ───────────────────────────────────────────────────────────────────────

const db  = openDB();
const log = (action, detail, status = 'ok') => logDB(db, 'apply-now', action, detail, status);

// Ensure apply-now jobs land in applications table even if not pre-discovered
db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company     TEXT,
    title       TEXT,
    url         TEXT,
    status      TEXT DEFAULT 'found',
    platform    TEXT,
    source      TEXT,
    ats         TEXT,
    notes       TEXT,
    created_at  DATETIME DEFAULT (datetime('now')),
    updated_at  DATETIME DEFAULT (datetime('now'))
  )
`);

// ── Step 1: Fetch job content ─────────────────────────────────────────────────

let jobText = TEXT_ARG;
let browserResult, page;

if (URL_ARG && !TEXT_ARG) {
  console.log(`\n[apply-now] Fetching: ${URL_ARG.slice(0, 80)}...`);

  // Detect LinkedIn → special warning
  if (/linkedin\.com/.test(URL_ARG)) {
    console.log('\n⚠️  LinkedIn detected.');
    console.log('LinkedIn Easy Apply requires an active session and uses a multi-step dialog.');
    console.log('Recommended: open the URL in your browser and apply manually, or use the LinkedIn app.');
    console.log('\nAlternatively, paste the job description text:');
    console.log('  node apply-now.mjs --text="<paste job text here>" [--dry-run]');
    db.close();
    process.exit(0);
  }

  // Try simple HTTP fetch first (faster, no browser startup)
  try {
    const r = await fetch(URL_ARG, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (r.ok) {
      const html  = await r.text();
      jobText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 8000);
    }
  } catch (e) {
    console.log(`[apply-now] Simple fetch failed (${e.message.slice(0, 50)}), trying Playwright...`);
  }

  // Fall back to Playwright if content is thin
  if (!jobText || jobText.length < 300) {
    console.log('[apply-now] Starting browser...');
    browserResult = await getBrowser({ newPage: true });
    page          = browserResult.page;
    try {
      await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      jobText = await page.evaluate(() => document.body.innerText);
      jobText = jobText.replace(/\s{2,}/g, ' ').trim().slice(0, 8000);
    } catch (e) {
      console.error(`[apply-now] Could not load page: ${e.message.slice(0, 80)}`);
      await browserResult.close();
      db.close();
      process.exit(1);
    }
  }
}

// ── Step 2: Analyze job ───────────────────────────────────────────────────────

console.log('[apply-now] Analyzing job posting...');

const analyzePrompt = `Analyze this job posting and return ONLY a JSON object. No markdown, no explanation.

Job text (may be truncated):
${(jobText || '').slice(0, 4500)}

URL (if available): ${URL_ARG || 'none'}

Return this exact JSON:
{
  "company": "company name (string, or 'Unknown' if not found)",
  "title": "exact job title (string)",
  "email": "contact/apply email if explicitly shown in text, or null",
  "method": "email" or "form" or "link",
  "apply_url": "direct application URL if found (e.g. link to a form page), or null",
  "requirements": ["top 3–5 requirements as short phrases"],
  "seniority": "junior" or "mid" or "senior" or "unknown",
  "match_score": integer 1–10
}

Rules for method:
- "email"  → page instructs candidate to send CV/application to an email address
- "form"   → page has or links to an online application form
- "link"   → page has an Apply button/link that leads to a separate form page`;

let jobInfo = {
  company: 'Unknown',
  title: 'Position',
  email: null,
  method: 'form',
  apply_url: URL_ARG || null,
  requirements: [],
  seniority: 'unknown',
  match_score: 5,
};

try {
  const raw   = await callFast(
    'You are a job posting data extractor. Return only valid JSON, nothing else.',
    analyzePrompt,
    800,
  );
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in LLM response');
  jobInfo = { ...jobInfo, ...JSON.parse(match[0]) };
} catch (e) {
  console.warn(`[apply-now] Analysis warn: ${e.message.slice(0, 80)} — using defaults`);
}

console.log(`[apply-now] ${jobInfo.title} @ ${jobInfo.company} | method=${jobInfo.method} | match=${jobInfo.match_score}/10`);

// ── Step 3: Generate tailored cover letter ────────────────────────────────────

console.log('[apply-now] Writing cover letter...');

const cvText = await getCVText();
const candidateContext = cvText
  ? `Candidate CV:\n${cvText.slice(0, 2500)}`
  : `Candidate profile: ${PROFILE_TEXT}`;

const coverPrompt = `${candidateContext}

Write a tailored cover letter (max 180 words) for this specific role:
Company: ${jobInfo.company}
Title: ${jobInfo.title}
Key requirements: ${jobInfo.requirements.join(', ')}

Rules:
- Match 2–3 specific skills from the CV to THIS role's requirements
- First sentence: who I am + what I bring (no "I am writing to apply for")
- One sentence showing genuine, specific interest in this company/problem
- Clear CTA in the last sentence
- NO: "I am passionate about", "synergy", bullet points, corporate speak
- Signature exactly as: ${PROFILE.firstName} ${PROFILE.lastName}${PROFILE.email ? '\n' + PROFILE.email : ''}${PROFILE.linkedin ? '\n' + PROFILE.linkedin : ''}${PROFILE.github ? '\n' + PROFILE.github : ''}`;

let coverLetter = '';
try {
  coverLetter = await callSmart(
    'You are a professional cover letter writer who writes concise, direct letters that get responses. No fluff.',
    coverPrompt,
    600,
  );
} catch (e) {
  console.warn(`[apply-now] Cover letter warn: ${e.message.slice(0, 60)} — using base cover`);
  coverLetter = `Hi,

${PROFILE_TEXT}

I'd love to bring this to ${jobInfo.company} — happy to chat whenever works for you.

${PROFILE.firstName} ${PROFILE.lastName}
${PROFILE.email}${PROFILE.linkedin ? '\n' + PROFILE.linkedin : ''}${PROFILE.github ? '\n' + PROFILE.github : ''}`;
}

// ── Step 4: Preview ───────────────────────────────────────────────────────────

console.log(`\n${SEP}`);
console.log('APPLY-NOW PREVIEW');
console.log(SEP);
console.log(`Job:      ${jobInfo.title} @ ${jobInfo.company}`);
console.log(`Source:   ${URL_ARG || '(text input)'}`);
console.log(`Method:   ${jobInfo.method.toUpperCase()}`);
if (jobInfo.method === 'email' && jobInfo.email) {
  console.log(`Send to:  ${jobInfo.email}`);
  console.log(`Subject:  ${jobInfo.title} — ${PROFILE.firstName} ${PROFILE.lastName}`);
}
if (jobInfo.apply_url && jobInfo.method !== 'email') {
  console.log(`Form URL: ${jobInfo.apply_url}`);
}
console.log(`CV:       ${CV_PATH ? (existsSync(CV_PATH) ? '✓ found' : '✗ not found') : 'not configured'}`);
console.log(`Match:    ${jobInfo.match_score}/10 | Seniority: ${jobInfo.seniority}`);
if (jobInfo.requirements.length) {
  console.log(`Requires: ${jobInfo.requirements.slice(0, 3).join(' · ')}`);
}
console.log(`\n${SEP}`);
console.log('COVER LETTER:');
console.log(SEP);
console.log(coverLetter);
console.log(SEP);

if (DRY_RUN) {
  console.log('\n[DRY RUN] Nothing sent. Confirm and re-run without --dry-run to apply.');
  log('dry_run', `${jobInfo.company} | ${jobInfo.title} | method=${jobInfo.method}`);
  if (page) await browserResult.close();
  db.close();
  process.exit(0);
}

// ── Step 5: Execute ───────────────────────────────────────────────────────────

if (jobInfo.method === 'email' && jobInfo.email) {
  // ── Email application ──────────────────────────────────────────────────────
  const GMAIL_USER = process.env.EMAIL        || '';
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';
  const subject    = `${jobInfo.title} — ${PROFILE.firstName} ${PROFILE.lastName}`;

  if (GMAIL_PASS && GMAIL_USER) {
    // Send directly via SMTP
    const nodemailer = require('nodemailer');
    const transport  = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    const attachments = (CV_PATH && existsSync(CV_PATH))
      ? [{ filename: `CV_${PROFILE.firstName}_${PROFILE.lastName}.pdf`, path: CV_PATH }]
      : [];

    await transport.sendMail({
      from:        `"${PROFILE.firstName} ${PROFILE.lastName}" <${GMAIL_USER}>`,
      to:          jobInfo.email,
      subject,
      text:        coverLetter,
      attachments,
    });

    console.log(`\n✅ Email sent to ${jobInfo.email}`);
    log('applied', `${jobInfo.company} | ${jobInfo.title} → email to ${jobInfo.email}`);

  } else {
    // No SMTP config → emit structured block for Claude to pick up with Gmail MCP
    console.log('\n[GMAIL_DRAFT_NEEDED]');
    console.log(`TO: ${jobInfo.email}`);
    console.log(`SUBJECT: ${subject}`);
    console.log(`ATTACH_CV: ${CV_PATH || 'none'}`);
    console.log('BODY:');
    console.log(coverLetter);
    console.log('[/GMAIL_DRAFT_NEEDED]');
    console.log('\n(No GMAIL_APP_PASSWORD in .env — Gmail draft emitted for Claude to send via MCP)');
    log('draft_emitted', `${jobInfo.company} | ${jobInfo.title} → ${jobInfo.email}`);
  }

  // Save to DB
  db.prepare(`
    INSERT INTO applications (company, title, url, status, platform, source, notes, updated_at)
    VALUES (?, ?, ?, 'applied', 'direct', 'apply-now', ?, datetime('now'))
  `).run(
    jobInfo.company,
    jobInfo.title,
    URL_ARG || jobInfo.email,
    GMAIL_PASS ? `Email sent to ${jobInfo.email}` : `Draft emitted for ${jobInfo.email}`,
  );

} else {
  // ── Web form application ───────────────────────────────────────────────────
  const targetUrl = jobInfo.apply_url || URL_ARG;

  if (!targetUrl) {
    console.error('\n[apply-now] No URL available for form filling.');
    console.error('Provide --url=... or include the apply URL in the job text.');
    if (page) await browserResult.close();
    db.close();
    process.exit(1);
  }

  if (!page) {
    console.log('[apply-now] Starting browser...');
    browserResult = await getBrowser({ newPage: true });
    page          = browserResult.page;
  }

  // Navigate to apply page if different from current
  try {
    const current = page.url();
    if (current !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
    }
  } catch (e) {
    console.error(`[apply-now] Navigation failed: ${e.message.slice(0, 80)}`);
    await browserResult.close();
    db.close();
    process.exit(1);
  }

  // Dismiss cookie banners
  await page.evaluate(() => {
    document.querySelectorAll('[class*="cookie"],[id*="cookie"],[class*="gdpr"],[id*="gdpr"]')
      .forEach(el => { try { el.remove(); } catch {} });
  }).catch(() => {});

  // Find form or click Apply link
  const hasForm = await page.$('form, input[type="email"], input[name="email"], input[name="first_name"], input[name="firstName"]');
  if (!hasForm) {
    console.log('[apply-now] No form detected — looking for Apply button...');
    const href = await Promise.race([
      clickApplyLink(page),
      new Promise(r => setTimeout(() => r(null), 10000)),
    ]);
    if (!href) {
      console.error('[apply-now] No form or Apply button found. Cannot submit.');
      log('blocked', `${jobInfo.company} | ${jobInfo.title} — no form or apply button`);
      db.prepare(`
        INSERT INTO applications (company, title, url, status, platform, source, notes, updated_at)
        VALUES (?, ?, ?, 'found', 'direct', 'apply-now', 'BLOCKED: no form or apply button', datetime('now'))
      `).run(jobInfo.company, jobInfo.title, targetUrl);
      await browserResult.close();
      db.close();
      process.exit(1);
    }
    await page.waitForTimeout(2000);
  }

  // Fill + upload + submit
  await Promise.race([fillForm(page, coverLetter),   new Promise(r => setTimeout(r, 10000))]);
  await Promise.race([uploadCV(page),                new Promise(r => setTimeout(r, 5000))]);

  console.log('[apply-now] Form filled. Submitting...');
  const submitted = await clickSubmit(page);

  if (submitted) {
    const proof = await verifySubmission(page, {
      company:     jobInfo.company,
      originalUrl: targetUrl,
    });

    if (proof.confirmed) {
      console.log(`\n✅ Application submitted — confirmed at ${proof.finalUrl.slice(0, 60)}`);
      log('applied', `${jobInfo.company} | ${jobInfo.title} → CONFIRMED`);
      db.prepare(`
        INSERT INTO applications (company, title, url, status, platform, source, notes, updated_at)
        VALUES (?, ?, ?, 'applied', 'direct', 'apply-now', ?, datetime('now'))
      `).run(jobInfo.company, jobInfo.title, targetUrl, `CONFIRMED: ${proof.finalUrl}`);
    } else {
      console.log('\n⚠️  Submit clicked but confirmation unclear. Screenshot saved.');
      if (proof.screenshotPath) console.log(`   Screenshot: ${proof.screenshotPath}`);
      log('applied', `${jobInfo.company} | ${jobInfo.title} → UNVERIFIED`);
      db.prepare(`
        INSERT INTO applications (company, title, url, status, platform, source, notes, updated_at)
        VALUES (?, ?, ?, 'applied', 'direct', 'apply-now', ?, datetime('now'))
      `).run(jobInfo.company, jobInfo.title, targetUrl, `UNVERIFIED | screenshot: ${proof.screenshotPath || 'none'}`);
    }
  } else {
    console.log('\n❌ Form filled but no submit button found. Check page manually.');
    log('blocked', `${jobInfo.company} | ${jobInfo.title} — form filled, no submit`);
    db.prepare(`
      INSERT INTO applications (company, title, url, status, platform, source, notes, updated_at)
      VALUES (?, ?, ?, 'found', 'direct', 'apply-now', 'BLOCKED: form filled but no submit button', datetime('now'))
    `).run(jobInfo.company, jobInfo.title, targetUrl);
  }

  await browserResult.close();
}

db.close();
process.exit(0);
