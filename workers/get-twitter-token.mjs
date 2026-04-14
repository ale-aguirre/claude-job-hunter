/**
 * get-twitter-token.mjs — Extract X.com auth cookies from Chrome mirror
 * Writes TWITTER_AUTH_TOKEN and TWITTER_CT0 to .env automatically
 * Run: node get-twitter-token.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { exec, execSync } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE1   = `${os.homedir()}/Library/Application Support/Google/Chrome/Profile 1`;
const MIRROR_DIR = '/tmp/chrome-p1-mirror';
const PORT       = 9223;
const ENV_PATH   = path.join(__dir, '.env');

async function isUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function startMirror() {
  console.log('Starting Chrome mirror (rsync Profile 1)...');
  try {
    execSync(`mkdir -p "${MIRROR_DIR}/Default"`);
    execSync(
      `rsync -a --quiet "${PROFILE1}/" "${MIRROR_DIR}/Default/" ` +
      `--exclude="*.log" --exclude="GPUCache" --exclude="Code Cache" --exclude="blob_storage"`,
      { timeout: 30000 }
    );
    execSync(`rm -f "${MIRROR_DIR}/SingletonLock" "${MIRROR_DIR}/SingletonCookie" "${MIRROR_DIR}/SingletonSocket"`);
    execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`);
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.log('rsync warn:', e.message.slice(0, 60));
  }

  const child = exec(
    `"${CHROME_BIN}" --user-data-dir="${MIRROR_DIR}" --remote-debugging-port=${PORT} ` +
    `--headless=new --no-first-run --no-default-browser-check about:blank`,
    { detached: true, stdio: 'ignore' }
  );
  child.unref();

  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isUp()) { console.log('Mirror up.'); return true; }
  }
  console.error('Mirror timed out.');
  return false;
}

// Start mirror if needed
if (!(await isUp())) {
  const ok = await startMirror();
  if (!ok) process.exit(1);
}

// Connect and read X.com cookies
const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
const context  = browser.contexts()[0] || await browser.newContext();

// Navigate to x.com to ensure cookies are loaded
const page = await context.newPage();
try {
  await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2000));
} catch (e) {
  console.log('Navigation warn:', e.message.slice(0, 60));
}

const cookies = await context.cookies('https://x.com');
const authToken = cookies.find(c => c.name === 'auth_token')?.value || '';
const ct0       = cookies.find(c => c.name === 'ct0')?.value || '';
const twid      = cookies.find(c => c.name === 'twid')?.value || '';

await page.close();

if (!authToken) {
  console.error('❌ auth_token not found — are you logged in to X.com in Chrome Profile 1?');
  process.exit(1);
}

console.log(`✅ Found cookies:`);
console.log(`  auth_token: ${authToken.slice(0, 8)}...`);
console.log(`  ct0:        ${ct0.slice(0, 8)}...`);
console.log(`  twid:       ${twid}`);

// Update .env
let env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';

function setEnvVar(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, `${key}=${value}`);
  return content + `\n${key}=${value}`;
}

env = setEnvVar(env, 'TWITTER_AUTH_TOKEN', authToken);
env = setEnvVar(env, 'TWITTER_CT0', ct0);
if (twid) env = setEnvVar(env, 'TWITTER_TWID', twid);

writeFileSync(ENV_PATH, env);
console.log(`\n✅ .env updated with fresh X.com tokens`);
