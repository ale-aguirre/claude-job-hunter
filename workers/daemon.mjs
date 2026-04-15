/**
 * daemon.mjs — Job Hunter Daemon (v2 — headless, mirror, multi-agent)
 * Ciclo cada 60 min en background:
 *   1. scout-api       → APIs rápidas (sin browser) → Remotive/RemoteOK/Greenhouse/Lever
 *   2. agent-bookmarks → analiza bookmarks Siftly con Groq
 *   3. agent-xreddit   → busca en X y Reddit con mirror headless
 *   4. openfang-scout  → Groq busca plataformas mundiales
 *   5. apply-arc-cdp   → postula HEADLESS (--headless flag)
 *   6. apply-batch     → cold emails con emails VERIFICADOS
 * LLM: Groq llama-3.3-70b (gratis)
 * Browser: Chrome mirror Profile 1 headless :9223 (sesiones reales)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import 'dotenv/config';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dir, 'daemon.log');
const DB  = path.join(__dir, 'applications.db');
const INTERVAL = parseInt(process.argv.find(a=>a.startsWith('--interval='))?.split('=')[1]||'60');
const ONCE = process.argv.includes('--once');
const GROQ_KEY = process.env.GROQ_API_KEY || '';

// Chrome mirror (headless, Profile 1, port 9223)
const CHROME_BIN  = process.env.CHROME_BIN     || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE1    = process.env.CHROME_PROFILE  || `${os.homedir()}/Library/Application Support/Google/Chrome/Profile 1`;
const MIRROR_DIR  = '/tmp/chrome-p1-mirror';
const MIRROR_PORT = 9223;

function ts() { return new Date().toISOString().slice(0,19).replace('T',' '); }
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  // Note: launchd already redirects stdout to daemon.log — no appendFileSync needed
}
function dbLog(action, detail, status='ok') {
  try {
    const db = new Database(DB);
    db.prepare('INSERT INTO agent_log (agent,action,detail,status) VALUES (?,?,?,?)').run('Daemon', action, String(detail).slice(0,200), status);
    db.close();
  } catch {}
}

async function isCDPUp(port) {
  // FIX: use localhost (resolves to ::1 on macOS) — 127.0.0.1 fails when Chrome binds to IPv6
  try { await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

async function ensureMirror() {
  if (await isCDPUp(MIRROR_PORT)) { log('Mirror already running'); return; }
  log('Creating Profile 1 mirror (headless)...');
  mkdirSync(`${MIRROR_DIR}/Default`, { recursive: true });

  // Clean stale singleton locks from crashed Chrome instances
  try { await execAsync(`rm -f "${MIRROR_DIR}/SingletonLock" "${MIRROR_DIR}/SingletonCookie" "${MIRROR_DIR}/SingletonSocket"`); } catch {}
  // Kill zombie processes holding the port that don't respond to CDP
  try { await execAsync(`lsof -ti :${MIRROR_PORT} | xargs kill -9 2>/dev/null || true`); await new Promise(r => setTimeout(r, 500)); } catch {}

  try {
    await execAsync(
      `rsync -a --quiet "${PROFILE1}/" "${MIRROR_DIR}/Default/" ` +
      `--exclude="*.log" --exclude="GPUCache" --exclude="Code Cache" --exclude="blob_storage"`,
      { timeout: 60000 }
    );
  } catch (e) { log(`rsync warn: ${e.message.slice(0,80)}`); }

  // FIX: use unref() so Chrome outlives daemon process (critical for --once mode)
  const child = exec(`"${CHROME_BIN}" --user-data-dir="${MIRROR_DIR}" --remote-debugging-port=${MIRROR_PORT} --headless=new --no-first-run --no-default-browser-check --disable-background-networking --disable-sync about:blank`, { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isCDPUp(MIRROR_PORT)) { log(`✅ Mirror headless up on :${MIRROR_PORT}`); return; }
  }
  log('⚠ Mirror timed out — will retry next cycle');
}

async function runScript(script, label, extraEnv = {}) {
  log(`→ ${label}`);
  try {
    const env = { ...process.env, GROQ_API_KEY: GROQ_KEY, ...extraEnv };
    const { stdout, stderr } = await execAsync(`node ${script}`, {
      cwd: __dir, timeout: 240000, env,
      shell: '/bin/zsh',
    });
    const out = (stdout + stderr).replace(/\n+/g, '\n').trim();
    const last = out.split('\n').slice(-4).join(' | ');
    log(`✓ ${label}: ${last}`);
    dbLog(`done_${label}`, last);
    return true;
  } catch (e) {
    const err = e.message.slice(0,150);
    log(`✗ ${label}: ${err}`);
    dbLog(`error_${label}`, err, 'error');
    return false;
  }
}

function stats() {
  try {
    const db = new Database(DB);
    const a = db.prepare("SELECT COUNT(*) as n FROM applications WHERE status='applied'").get().n;
    const f = db.prepare("SELECT COUNT(*) as n FROM applications WHERE status='found'").get().n;
    const b = db.prepare("SELECT COUNT(*) as n FROM applications WHERE notes LIKE 'BLOCKED:%'").get().n;
    db.close();
    return `applied:${a} found:${f} blocked:${b}`;
  } catch { return 'stats-error'; }
}

function countFoundJobs() {
  try {
    const db = new Database(DB);
    const n = db.prepare("SELECT COUNT(*) as n FROM applications WHERE status='found'").get().n;
    db.close();
    return n;
  } catch { return 0; }
}

async function cycle() {
  log('════════════════════════════════════');
  log(`🔄 Senku Cycle | ${stats()}`);

  // Ensure Chrome mirror is up (browser agents need it)
  await ensureMirror();

  // Snapshot found count before scout runs
  const foundBefore = countFoundJobs();

  // Delegate ALL decision-making to Senku orchestrator
  // Senku reads DB state, calls Haiku, builds task queue, runs agents, calls Nanami QA
  try {
    const { stdout, stderr } = await execAsync(
      `node ${path.join(__dir, 'senku.mjs')}`,
      { cwd: __dir, timeout: 25 * 60 * 1000 } // 25min max per cycle
    );
    const out = stdout + stderr;
    log('senku_done', out.replace(/\n/g,' ').slice(0,200));
    console.log(out);
  } catch (e) {
    const senkuStderr = (e.stderr || '').slice(0, 400);
    log('senku_error', (e.message + (senkuStderr ? '\n' + senkuStderr : '')).slice(0, 400), 'error');
    console.error('[daemon] Senku error:', e.message.slice(0, 200));
    if (senkuStderr) console.error('[daemon] Senku stderr:', senkuStderr);
  }

  // Event-driven: if scout found new jobs, trigger an immediate apply (same cycle)
  const foundAfter = countFoundJobs();
  const newJobs = foundAfter - foundBefore;
  if (newJobs > 0) {
    log(`⚡ scout:done — ${newJobs} new jobs found → triggering immediate apply`);
    dbLog('scout_done_trigger', `${newJobs} new → apply`);
    await runScript(path.join(__dir, 'apply-from-db.mjs'), 'apply_from_db_fast', {});
  }

  log(`✅ Cycle done | ${stats()} | next in ${INTERVAL}min`);
  dbLog('cycle_done', stats());
}

log('🚀 Daemon v2 started');
log(`   Interval: ${INTERVAL}min | headless | mirror Profile1 :${MIRROR_PORT}`);
dbLog('started', `v2 interval=${INTERVAL}min`);

await cycle();
if (!ONCE) {
  setInterval(cycle, INTERVAL * 60 * 1000);
  process.on('SIGTERM', () => { log('SIGTERM — stopping'); process.exit(0); });
  process.on('SIGINT',  () => { log('SIGINT — stopping');  process.exit(0); });
}
