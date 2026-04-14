/**
 * agent-mob.mjs — Mob (Shigeo Kageyama) — Registration + Email Validation Agent
 * Does the boring sequential work nobody else wants to do.
 *
 * Flow: Fern discovers → Mob registers + validates → Reigen applies
 *
 * What Mob does per job:
 *   1. Check if we already have an active session on that platform
 *   2. If not: fill signup form with profile data
 *   3. Go to Gmail (via CDP real session) → find verification email → click link
 *   4. Mark DB note as MOB_REGISTERED: so Reigen knows it's ready
 *
 * Run: node agent-mob.mjs [--dry-run] [--limit=5] [--visible]
 */
import { getBrowserWithTwoPages } from './browser-utils.mjs';
import { openDB, logDB, markResult } from './db-utils.mjs';
import { PROFILE as BASE_PROFILE } from './config.mjs';

const db = openDB();

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const HEADLESS  = !args.includes('--visible');
const LIMIT     = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '6');
const ONLY_PLAT = args.find(a => a.startsWith('--platform='))?.split('=')[1];

// Extends base profile with mob-specific fields
const PROFILE = {
  ...BASE_PROFILE,
  fullName: `${BASE_PROFILE.firstName} ${BASE_PROFILE.lastName}`,
  password: process.env.JH_PASSWORD || 'HuntDesk2025!',
  title:    'React / Next.js Developer',
  location: BASE_PROFILE.city,
};

// ─── Platform registry ────────────────────────────────────────────────────────
// Each platform: urlPattern, checkSession, signupUrl, fillForm, emailSenderHint
const PLATFORMS = {
  wellfound: {
    name: 'Wellfound',
    pattern: /wellfound\.com/,
    checkUrl: 'https://wellfound.com/jobs',
    isLoggedIn: async (page) => {
      await page.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded', timeout: 20000 });
      return !(await page.$('a[href*="/login"], a[href*="/register"], button:has-text("Sign up")'));
    },
    signup: async (page) => {
      await page.goto('https://wellfound.com/register/candidate', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      await tryFill(page, 'input[name="user[name]"], input[placeholder*="Name"], input[name="name"]', PROFILE.fullName);
      await tryFill(page, 'input[type="email"], input[name="user[email]"], input[name="email"]', PROFILE.email);
      await tryFill(page, 'input[type="password"], input[name="user[password]"], input[name="password"]', PROFILE.password);
      return await trySubmit(page);
    },
    emailHint: 'wellfound.com',
  },

  himalayas: {
    name: 'Himalayas',
    pattern: /himalayas\.app/,
    checkUrl: 'https://himalayas.app/jobs',
    isLoggedIn: async (page) => {
      await page.goto('https://himalayas.app/profile', { waitUntil: 'domcontentloaded', timeout: 20000 });
      return !page.url().includes('/login') && !page.url().includes('/auth');
    },
    signup: async (page) => {
      await page.goto('https://himalayas.app/auth/sign-up', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      await tryFill(page, 'input[type="email"], input[name="email"]', PROFILE.email);
      await tryFill(page, 'input[name="name"], input[placeholder*="name"]', PROFILE.fullName);
      await tryFill(page, 'input[type="password"]', PROFILE.password);
      return await trySubmit(page);
    },
    emailHint: 'himalayas',
  },

  torre: {
    name: 'Torre',
    pattern: /torre\.co/,
    checkUrl: 'https://torre.co',
    isLoggedIn: async (page) => {
      await page.goto('https://torre.co/opportunities', { waitUntil: 'domcontentloaded', timeout: 20000 });
      return !(await page.$('[data-testid="login"], a[href*="/auth/login"]'));
    },
    signup: async (page) => {
      await page.goto('https://torre.co/auth/sign-up', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      await tryFill(page, 'input[type="email"], input[name="email"]', PROFILE.email);
      await tryFill(page, 'input[name="name"], input[placeholder*="Name"]', PROFILE.fullName);
      await tryFill(page, 'input[type="password"]', PROFILE.password);
      return await trySubmit(page);
    },
    emailHint: 'torre',
  },

  getonbrd: {
    name: 'GetOnBrd',
    pattern: /getonbrd\.com/,
    checkUrl: 'https://getonbrd.com',
    isLoggedIn: async (page) => {
      await page.goto('https://www.getonbrd.com/account', { waitUntil: 'domcontentloaded', timeout: 20000 });
      return !page.url().includes('/users/sign_in') && !page.url().includes('/login');
    },
    signup: async (page) => {
      await page.goto('https://www.getonbrd.com/users/sign_up', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      await tryFill(page, 'input[name="user[email]"], input[type="email"]', PROFILE.email);
      await tryFill(page, 'input[name="user[password]"], input[type="password"]', PROFILE.password);
      await tryFill(page, 'input[name="user[password_confirmation]"]', PROFILE.password);
      return await trySubmit(page);
    },
    emailHint: 'getonbrd',
  },

  contra: {
    name: 'Contra',
    pattern: /contra\.com/,
    checkUrl: 'https://contra.com',
    isLoggedIn: async (page) => {
      await page.goto('https://contra.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 20000 });
      return !page.url().includes('/login') && !page.url().includes('/signup');
    },
    signup: async (page) => {
      await page.goto('https://contra.com/signup', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      await tryFill(page, 'input[type="email"], input[name="email"]', PROFILE.email);
      await tryFill(page, 'input[type="password"], input[name="password"]', PROFILE.password);
      await tryFill(page, 'input[name="firstName"], input[placeholder*="First"]', PROFILE.firstName);
      await tryFill(page, 'input[name="lastName"], input[placeholder*="Last"]', PROFILE.lastName);
      return await trySubmit(page);
    },
    emailHint: 'contra.com',
  },

  remoteok: {
    name: 'RemoteOK',
    pattern: /remoteok\.com/,
    checkUrl: 'https://remoteok.com',
    isLoggedIn: async (page) => {
      // RemoteOK doesn't require registration for applying — Mob skips
      return true;
    },
    signup: async () => true,
    emailHint: null,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function tryFill(page, selector, value) {
  if (!value) return;
  try { await page.fill(selector, value); return true; } catch { return false; }
}

async function trySubmit(page) {
  const sels = [
    'button[type="submit"]', 'input[type="submit"]',
    'button:has-text("Sign up")', 'button:has-text("Create account")',
    'button:has-text("Register")', 'button:has-text("Continue")',
    'button:has-text("Get started")', 'button:has-text("Join")',
  ];
  for (const sel of sels) {
    try {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); await page.waitForTimeout(3000); return true; }
    } catch {}
  }
  return false;
}

function log(msg, status = 'info') {
  const icon = { info: '·', ok: '✅', warn: '⚠️', err: '✗', skip: '⏭' }[status] || '·';
  console.log(`[Mob] ${icon} ${msg}`);
  try {
    db.prepare('INSERT INTO agent_log (agent,action,detail,status) VALUES (?,?,?,?)')
      .run('MobAgent', status === 'err' ? 'error' : 'log', String(msg).slice(0, 200), status === 'err' ? 'error' : 'ok');
  } catch {}
}

function markRegistered(jobId, platformName) {
  db.prepare("UPDATE applications SET notes = 'MOB_REGISTERED: ' || ? || ' — ' || datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(platformName, jobId);
}

function markBlocked(jobId, reason) {
  db.prepare("UPDATE applications SET notes = 'BLOCKED: MOB — ' || ?, updated_at = datetime('now') WHERE id = ?")
    .run(String(reason).slice(0, 150), jobId);
}

function alreadyRegistered(jobId) {
  const r = db.prepare('SELECT notes FROM applications WHERE id = ?').get(jobId);
  return r?.notes?.startsWith('MOB_REGISTERED:') || false;
}

// ─── Gmail verification ───────────────────────────────────────────────────────

async function waitForVerificationEmail(gmailPage, hint, maxWaitMs = 90000) {
  if (!hint) return false;
  log(`Waiting for verification email from: ${hint}`);
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      // Navigate to Gmail inbox (stays in same page)
      await gmailPage.goto('https://mail.google.com/mail/u/0/#inbox', {
        waitUntil: 'domcontentloaded', timeout: 15000,
      });
      await gmailPage.waitForTimeout(2000);

      // Search for verification email
      const searchBox = await gmailPage.$('input[aria-label="Search mail"], input[name="q"]');
      if (searchBox) {
        await searchBox.click({ clickCount: 3 });
        await searchBox.type(`from:${hint} (verify OR confirm OR activate OR welcome)`, { delay: 30 });
        await gmailPage.keyboard.press('Enter');
        await gmailPage.waitForTimeout(3000);
      }

      // Look for unread email rows
      const emailRows = await gmailPage.$$('.zA.zE, tr.zA');
      if (emailRows.length > 0) {
        log(`Found ${emailRows.length} email(s) from ${hint}`, 'ok');
        await emailRows[0].click();
        await gmailPage.waitForTimeout(2000);

        // Find verification link in email body
        const verifySelectors = [
          'a[href*="verify"]', 'a[href*="confirm"]', 'a[href*="activate"]',
          'a[href*="validation"]', 'a[href*="token"]', 'a[href*="email_confirmation"]',
        ];
        for (const sel of verifySelectors) {
          const link = await gmailPage.$(sel);
          if (link) {
            const href = await link.getAttribute('href');
            if (href && href.startsWith('http')) {
              log(`Found verification link: ${href.slice(0, 60)}...`, 'ok');
              return href;
            }
          }
        }

        // Fallback: look for any external link in the email
        const allLinks = await gmailPage.$$('a[href^="http"]');
        for (const link of allLinks) {
          const href = await link.getAttribute('href');
          if (href && !href.includes('google.com') && !href.includes('gmail.com') &&
              !href.includes('unsubscribe') && !href.includes('privacy')) {
            log(`Using link: ${href.slice(0, 60)}...`, 'ok');
            return href;
          }
        }
        log('No verification link found in email body', 'warn');
        return null;
      }
    } catch (e) {
      log(`Gmail check error: ${e.message.slice(0, 80)}`, 'warn');
    }

    // Wait 8s before retrying
    await new Promise(r => setTimeout(r, 8000));
    log(`Still waiting for email from ${hint}...`);
  }

  log(`Timeout waiting for verification from ${hint}`, 'warn');
  return null;
}

async function clickVerificationLink(page, verifyUrl) {
  try {
    await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    log(`Verification page: ${finalUrl.slice(0, 80)}`, 'ok');
    return true;
  } catch (e) {
    log(`Failed to open verification link: ${e.message.slice(0, 80)}`, 'err');
    return false;
  }
}

// ─── Core registration flow ───────────────────────────────────────────────────

async function processJob(job, page, gmailPage) {
  if (alreadyRegistered(job.id)) {
    log(`Already registered: ${job.company}`, 'skip');
    return 'already';
  }

  // Find matching platform
  const platform = Object.values(PLATFORMS).find(p => p.pattern.test(job.url || ''));
  if (!platform) {
    log(`No platform handler for: ${job.url?.slice(0, 60)}`, 'skip');
    return 'skip';
  }

  if (ONLY_PLAT && platform.name.toLowerCase() !== ONLY_PLAT.toLowerCase()) {
    return 'skip';
  }

  log(`Processing: ${job.company} — ${job.title} (${platform.name})`);

  // Check if already logged in
  let loggedIn = false;
  try {
    loggedIn = await platform.isLoggedIn(page);
  } catch (e) {
    log(`Session check error: ${e.message.slice(0, 60)}`, 'warn');
  }

  if (loggedIn) {
    log(`Already logged in to ${platform.name} — marking ready`, 'ok');
    if (!DRY_RUN) markRegistered(job.id, `${platform.name} (existing session)`);
    return 'existing';
  }

  log(`Not logged in — starting registration on ${platform.name}`);

  if (DRY_RUN) {
    log(`[DRY RUN] Would register on ${platform.name}`, 'ok');
    return 'dry_run';
  }

  // Register
  let signupOk = false;
  try {
    signupOk = await platform.signup(page);
  } catch (e) {
    log(`Signup error: ${e.message.slice(0, 80)}`, 'err');
    markBlocked(job.id, `Signup failed: ${e.message.slice(0, 80)}`);
    return 'error';
  }

  if (!signupOk) {
    log(`Signup: no submit button found on ${platform.name}`, 'warn');
    markBlocked(job.id, 'Signup: no submit button found');
    return 'error';
  }

  log(`Registration form submitted on ${platform.name}`, 'ok');

  // Email verification
  if (!platform.emailHint) {
    log(`${platform.name} — no email verification needed`, 'ok');
    markRegistered(job.id, platform.name);
    return 'registered';
  }

  const verifyUrl = await waitForVerificationEmail(gmailPage, platform.emailHint);
  if (!verifyUrl) {
    log(`No verification email — marking as blocked`, 'warn');
    markBlocked(job.id, `No verification email from ${platform.name}`);
    return 'no_email';
  }

  const verified = await clickVerificationLink(page, verifyUrl);
  if (verified) {
    log(`Verified on ${platform.name} — Reigen can now apply`, 'ok');
    markRegistered(job.id, platform.name);
    return 'registered';
  } else {
    markBlocked(job.id, `Email verified but link failed`);
    return 'error';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Jobs that need registration: from platforms we know, not yet registered, not already applied
const PLATFORM_URL_PATTERNS = Object.values(PLATFORMS).map(p => p.pattern.source);
const candidates = db.prepare(`
  SELECT id, company, title, url, notes, source FROM applications
  WHERE status = 'found'
    AND (notes IS NULL OR (notes NOT LIKE 'MOB_REGISTERED:%' AND notes NOT LIKE 'BLOCKED:%'))
    AND (
      url LIKE '%wellfound.com%' OR url LIKE '%himalayas.app%'
      OR url LIKE '%torre.co%' OR url LIKE '%getonbrd.com%'
      OR url LIKE '%contra.com%'
    )
  ORDER BY id DESC
  LIMIT ?
`).all(LIMIT);

log(`Starting — ${DRY_RUN ? 'DRY RUN | ' : ''}${HEADLESS ? 'headless' : 'visible'} | ${candidates.length} jobs to process`);
logDB(db, 'MobAgent', 'start', `${candidates.length} candidates`);

if (candidates.length === 0) {
  log('No jobs need registration right now — nothing to do', 'ok');
  db.close();
  process.exit(0);
}

const { browser, context: ctx, page: platformPage, gmailPage, close: closeBrowser } = await getBrowserWithTwoPages();

let registered = 0, skipped = 0, errors = 0, existing = 0;

for (const job of candidates) {
  console.log(`\n── ${job.company} | ${job.title}`);
  console.log(`   ${job.url?.slice(0, 70)}`);

  const result = await processJob(job, platformPage, gmailPage);
  switch (result) {
    case 'registered': registered++; break;
    case 'existing':   existing++;   break;
    case 'skip':
    case 'already':
    case 'dry_run':    skipped++;    break;
    default:           errors++;
  }

  await new Promise(r => setTimeout(r, 3000));
}

await closeBrowser();

console.log('\n──────────────────────────────');
console.log(`✅ Newly registered:   ${registered}`);
console.log(`✓  Existing sessions:  ${existing}`);
console.log(`⏭  Skipped:            ${skipped}`);
console.log(`✗  Errors:             ${errors}`);

logDB(db, 'MobAgent', 'complete', `registered:${registered} existing:${existing} errors:${errors}`);

db.close();
