/**
 * browser-utils.mjs — Shared browser management for all job-hunter agents
 *
 * Priority:
 *   1. CDP mirror :9223  — Profile 1 rsync copy, real sessions (X, Gmail, LinkedIn)
 *   2. Start mirror now  — if not running, starts it headless and waits
 *   3. Playwright headless — last resort, no real sessions but never opens a window
 */

import { chromium } from 'playwright';
import { exec, execSync } from 'child_process';
import { mkdirSync } from 'fs';
import os from 'os';
import 'dotenv/config';

const CHROME_BIN  = process.env.CHROME_BIN  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE1    = process.env.CHROME_PROFILE || `${os.homedir()}/Library/Application Support/Google/Chrome/Profile 1`;
const MIRROR_DIR  = '/tmp/chrome-p1-mirror';
const MIRROR_PORT = 9223;
const MIRROR_CDP  = `http://localhost:${MIRROR_PORT}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function isMirrorUp() {
  try {
    const r = await fetch(`${MIRROR_CDP}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function startMirror() {
  console.log('[browser-utils] Starting headless Profile 1 mirror...');
  try {
    mkdirSync(`${MIRROR_DIR}/Default`, { recursive: true });
    execSync(
      `rsync -a --quiet "${PROFILE1}/" "${MIRROR_DIR}/Default/" ` +
      `--exclude="*.log" --exclude="GPUCache" --exclude="Code Cache" --exclude="blob_storage"`,
      { timeout: 30000 }
    );
  } catch (e) {
    console.log(`[browser-utils] rsync warn: ${e.message.slice(0, 60)}`);
  }

  // Clean stale singleton locks that block Chrome from starting
  try {
    execSync(`rm -f "${MIRROR_DIR}/SingletonLock" "${MIRROR_DIR}/SingletonCookie" "${MIRROR_DIR}/SingletonSocket"`);
  } catch {}

  // Kill any zombie Chrome processes holding port 9223 that don't respond to CDP
  try {
    execSync(`lsof -ti :${MIRROR_PORT} | xargs kill -9 2>/dev/null || true`);
    await new Promise(r => setTimeout(r, 500));
  } catch {}

  // FIX: detach properly so Chrome survives after parent script exits
  const child = exec(
    `"${CHROME_BIN}" --user-data-dir="${MIRROR_DIR}" ` +
    `--remote-debugging-port=${MIRROR_PORT} ` +
    `--headless=new --no-first-run --no-default-browser-check ` +
    `--disable-background-networking --disable-sync about:blank`,
    { detached: true, stdio: 'ignore' }
  );
  child.unref(); // let Chrome outlive this process

  // Wait up to 25s for CDP to be ready
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isMirrorUp()) {
      console.log(`[browser-utils] ✅ Mirror up on :${MIRROR_PORT}`);
      return true;
    }
  }
  console.log('[browser-utils] ⚠ Mirror timed out — falling back to Playwright headless');
  return false;
}

async function connectMirror() {
  // FIX: always create a FRESH context — never reuse contexts()[0] which may have stale/broken pages
  const browser = await chromium.connectOverCDP(MIRROR_CDP);
  const context = await browser.newContext({ userAgent: UA });
  return { browser, context };
}

/**
 * Get a browser + page ready to use. Always headless.
 * Returns { page, context, browser, usingMirror, close }
 */
export async function getBrowser({ newPage = true } = {}) {
  // 1. Try existing mirror
  if (await isMirrorUp()) {
    try {
      const { browser, context } = await connectMirror();
      const page = newPage ? await context.newPage() : null;
      console.log('[browser-utils] ✅ Connected to CDP mirror (real sessions)');
      return {
        browser, context, page, usingMirror: true,
        close: async () => {
          try { await page?.close(); } catch {}
          try { await context.close(); } catch {}
          // Disconnect Playwright from CDP (doesn't kill Chrome, just releases WebSocket)
          try { await browser.close(); } catch {}
        },
      };
    } catch (e) {
      console.log(`[browser-utils] CDP connect failed: ${e.message.slice(0, 80)}`);
    }
  }

  // 2. Start mirror and retry
  const started = await startMirror();
  if (started) {
    try {
      const { browser, context } = await connectMirror();
      const page = newPage ? await context.newPage() : null;
      console.log('[browser-utils] ✅ Mirror started + connected');
      return {
        browser, context, page, usingMirror: true,
        close: async () => {
          try { await page?.close(); } catch {}
          try { await context.close(); } catch {}
        },
      };
    } catch (e) {
      console.log(`[browser-utils] Mirror connect failed after start: ${e.message.slice(0, 80)}`);
    }
  }

  // 3. Last resort: Playwright headless
  console.log('[browser-utils] ⚠ Using Playwright headless (no real sessions)');
  const browser  = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const context  = await browser.newContext({ userAgent: UA });
  const page     = newPage ? await context.newPage() : null;
  return {
    browser, context, page, usingMirror: false,
    close: async () => {
      try { await page?.close(); } catch {}
      try { await context.close(); } catch {}
      try { await browser.close(); } catch {}
    },
  };
}

/**
 * Two pages from same context (Mob: platform + Gmail)
 */
export async function getBrowserWithTwoPages() {
  const result = await getBrowser({ newPage: false });
  const page1  = await result.context.newPage();
  const page2  = await result.context.newPage();
  return {
    ...result,
    page:      page1,
    gmailPage: page2,
    close: async () => {
      try { await page1.close(); } catch {}
      try { await page2.close(); } catch {}
      try { await result.context.close(); } catch {}
      if (!result.usingMirror) {
        try { await result.browser.close(); } catch {}
      }
    },
  };
}
