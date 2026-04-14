/**
 * launch-mirror.mjs — Lanza un Chrome mirror con CDP
 * Uso:
 *   node launch-mirror.mjs                   → Profile 1 (your-main-profile) on :9223
 *   node launch-mirror.mjs --profile=nuggets → perfil nuggets en :9224
 *   node launch-mirror.mjs --profile=1       → Profile 1 en :9223
 */
import { execSync, exec } from 'child_process';
import { mkdirSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_DIR = '~/Library/Application Support/Google/Chrome';

const PROFILES = {
  '1':       { dir: 'Profile 1', port: 9223, desc: 'your-profile' },
  'profile1':{ dir: 'Profile 1', port: 9223, desc: 'your-profile' },
  'nuggets': { dir: 'nuggets',   port: 9224, desc: 'Tu Chrome (Nuggets)' },
};

const profileArg = process.argv.find(a => a.startsWith('--profile='))?.split('=')[1] || '1';
const profile = PROFILES[profileArg.toLowerCase()] || PROFILES['1'];

const MIRROR = `/tmp/chrome-${profileArg.toLowerCase()}-mirror`;
const SOURCE = `${CHROME_DIR}/${profile.dir}`;

async function isCDPRunning(port) {
  try {
    const r = await fetch(`http://localhost:${port}/json/version`);
    const d = await r.json();
    return d.Browser || true;
  } catch { return false; }
}

const already = await isCDPRunning(profile.port);
if (already) {
  console.log(`✅ Mirror already running on :${profile.port} — ${already}`);
  process.exit(0);
}

console.log(`📂 Mirroring Chrome profile: ${profile.dir} (${profile.desc})`);
mkdirSync(`${MIRROR}/Default`, { recursive: true });

execSync(
  `rsync -a --quiet "${SOURCE}/" "${MIRROR}/Default/" ` +
  `--exclude="*.log" --exclude="GPUCache" --exclude="Code Cache" ` +
  `--exclude="BudgetDatabase" --exclude="blob_storage" --exclude="*.tmp"`,
  { stdio: 'pipe' }
);

const size = execSync(`du -sh "${MIRROR}" 2>/dev/null || echo "?"`)
  .toString().split('\t')[0].trim();
console.log(`   Mirror size: ${size}`);

console.log(`🚀 Launching Chrome on port ${profile.port}...`);
exec(
  `"${CHROME}" --user-data-dir="${MIRROR}" --remote-debugging-port=${profile.port} ` +
  `--no-first-run --no-default-browser-check ` +
  `--disable-features=OfferMigrationToDiceUsers about:blank`,
  { detached: true }
);

for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const v = await isCDPRunning(profile.port);
  if (v) {
    console.log(`✅ Chrome mirror ready on :${profile.port} (${profile.desc})`);
    console.log(`   chromium.connectOverCDP('http://localhost:${profile.port}')`);
    process.exit(0);
  }
}

console.error('❌ Chrome mirror did not start');
process.exit(1);
