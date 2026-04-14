/**
 * apply-batch.mjs — Apply to hardcoded ATS forms + send cold emails
 * Usage: node apply-batch.mjs [--dry-run]
 */
import 'dotenv/config';
import { getBrowser } from './browser-utils.mjs';
import { openDB, logDB, markResult } from './db-utils.mjs';
import { BASE_COVER, CV_PATH, PROFILE, PROFILE_TEXT } from './config.mjs';
import { fillForm, uploadCV, clickSubmit } from './form-utils.mjs';
import { sendGmail } from './gmail-send.mjs';

const db  = openDB();
const DRY_RUN = process.argv.includes('--dry-run');
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OR_KEY   = process.env.OPENROUTER_API_KEY || '';

const AGENT = 'BatchApply';
const log = (action, detail = '', status = 'ok') => logDB(db, AGENT, action, detail, status);
const mark = (company, title, url, status, note) =>
  markResult(db, { company, title, url, source: 'Direct', platform: 'direct' }, status, note);

// ── ATS form targets — add entries when you find jobs with direct ATS URLs ────
// Example entry:
// { company: 'Acme', title: 'Senior Frontend Dev', platform: 'ashby',
//   url: 'https://jobs.ashbyhq.com/acme/...', applyUrl: 'https://jobs.ashbyhq.com/acme/.../application',
//   note: 'Remote, Americas. $120k' }
const ATS_JOBS = [
  // ← add your ATS job targets here
];

// ── Cold email targets — add verified hiring emails ONLY (no guessing) ────────
// Example entry:
// { email: 'jobs@company.com', company: 'Company', role: 'Senior Dev',
//   context: 'Remote SaaS startup. React/TypeScript.', url: 'mailto:jobs@company.com' }
const EMAIL_TARGETS = [
  // ← add only verified/published hiring emails here
];

// ── LLM cover letter generation ───────────────────────────────────────────────
async function genCover(ctx) {
  const messages = [
    { role: 'system', content: `You are ${PROFILE.firstName} ${PROFILE.lastName} writing a job application email. Short, warm, human — not a template. Blank line between each paragraph. No corporate fluff. End with: ${PROFILE.firstName} ${PROFILE.lastName}${PROFILE.linkedin ? ' | ' + PROFILE.linkedin : ''}${PROFILE.github ? ' | ' + PROFILE.github : ''}` },
    { role: 'user',   content: `Write a short application email for: ${ctx}\n\n${PROFILE_TEXT || 'Available for remote work immediately.'}` },
  ];
  if (GROQ_KEY) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 350, messages }),
    });
    const d = await r.json();
    if (!d.error) return d.choices?.[0]?.message?.content || '';
  }
  if (OR_KEY) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/ale-aguirre' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct:free', max_tokens: 350, messages }),
    });
    const d = await r.json();
    return d.choices?.[0]?.message?.content || BASE_COVER;
  }
  return BASE_COVER;
}

function toHtml(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc.replace(/(?<!href=")(https?:\/\/[^\s<,)"]+)/g, '<a href="$1" style="color:#1a73e8">$1</a>');
  const blocks = linked.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a;max-width:560px">${blocks.map(b => `<p style="margin:0 0 14px;line-height:1.7">${b.replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
}

// ── 1. ATS FORMS ─────────────────────────────────────────────────────────────
console.log(`\n🚀 Batch Apply — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log(`ATS forms: ${ATS_JOBS.length} | Cold emails: ${EMAIL_TARGETS.length}\n`);

const { page, close: closeBrowser } = await getBrowser();

let atsApplied = 0, atsBlocked = 0;

for (const job of ATS_JOBS) {
  const ex = db.prepare('SELECT status FROM applications WHERE url=?').get(job.url);
  if (ex?.status === 'applied') { console.log(`⏭  Already applied: ${job.company}`); continue; }

  console.log(`\n→ ATS: ${job.company}`);
  log('ats_navigate', job.applyUrl);

  try {
    await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    // Dismiss cookie banners
    for (const sel of ['button:has-text("Accept")', 'button:has-text("Aceptar")', 'button:has-text("Accept all")', '[id*="accept"]', '.cookie-accept']) {
      await page.click(sel, { force: true, timeout: 2000 }).catch(() => {});
    }
    await page.evaluate(() => {
      document.querySelectorAll('[class*="cookie"],[id*="cookie"],[class*="Cookie"],[id*="consent"]').forEach(el => el.remove());
    }).catch(() => {});

    const txt = await page.evaluate(() => document.body.innerText.slice(0, 300));
    log('page', txt.replace(/\n/g, ' ').slice(0, 120));

    if (txt.toLowerCase().includes('job not found') || txt.toLowerCase().includes('no longer available')) {
      log('closed', job.company, 'warn');
      mark(job.company, job.title, job.url, 'found', 'CLOSED: job no longer available');
      atsBlocked++; continue;
    }

    await fillForm(page, BASE_COVER);
    await uploadCV(page);

    if (DRY_RUN) { log('dry_run', `${job.company} — form found`); atsApplied++; continue; }

    const submitted = await clickSubmit(page);
    if (submitted) {
      await page.waitForTimeout(4000);
      log('submitted', job.company);
      mark(job.company, job.title, job.url, 'applied', `ATS submitted: ${job.applyUrl}`);
      console.log(`✅ Submitted: ${job.company}`);
      atsApplied++;
    } else {
      log('no_submit', job.company, 'warn');
      mark(job.company, job.title, job.url, 'found', `BLOCKED: form loaded but no submit button. Apply manually: ${job.applyUrl}`);
      atsBlocked++;
    }
  } catch (e) {
    log('error', `${job.company}: ${e.message.slice(0, 100)}`, 'error');
    mark(job.company, job.title, job.url, 'found', `BLOCKED: ${e.message.slice(0, 80)}`);
    atsBlocked++;
  }
  await new Promise(r => setTimeout(r, 2000));
}

await closeBrowser();

// ── 2. COLD EMAILS ────────────────────────────────────────────────────────────
console.log('\n── Cold emails ──');
let emailsSent = 0;

for (const t of EMAIL_TARGETS) {
  const ex = db.prepare('SELECT status FROM applications WHERE url=?').get(t.url);
  if (ex?.status === 'applied') { console.log(`⏭  Already emailed: ${t.company}`); continue; }

  console.log(`\n→ ${t.company} <${t.email}>`);
  try {
    const body = await genCover(t.context);
    if (!body || body.length < 50) throw new Error('empty body');
    log('cover_generated', `${t.company}: ${body.length} chars`);

    if (DRY_RUN) { log('dry_run', `Would email ${t.email}`); continue; }

    await sendGmail({
      to: t.email,
      subject: 'Application – Frontend/React Developer (Remote)',
      html: toHtml(body),
      attachmentPath: CV_PATH,
      attachmentName: CV_PATH ? CV_PATH.split('/').pop() : 'CV.pdf',
    });
    console.log(`✅ Email sent to ${t.email}`);
    log('email_sent', t.email);
    mark(t.company, t.role, t.url, 'applied', `Cold email sent to ${t.email}`);
    emailsSent++;
  } catch (e) {
    log('email_error', `${t.company}: ${e.message}`, 'error');
  }
  await new Promise(r => setTimeout(r, 3000));
}

console.log(`\n──────────────────────`);
console.log(`✅ ATS submitted: ${atsApplied} | 🚫 Blocked: ${atsBlocked}`);
console.log(`✉  Emails sent: ${emailsSent}`);
db.close();
