/**
 * senku.mjs — Senku: Orchestrator
 *
 * Pattern: Anthropic orchestrator-worker — each agent receives a structured
 * TASK ORDER (objective + constraints + success_criteria).
 * Results → Nanami QA → Senku adjusts next cycle.
 *
 * CRITICAL FIX: LLM returns task_type only. Script resolution is deterministic
 * via AGENT_REGISTRY — never trust LLM for script names.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const execAsync = promisify(exec);
const Database  = require('better-sqlite3');
import { callHaikuJSON, backend } from './anthropic-client.mjs';
import { logDB } from './db-utils.mjs';
import { auditCycle } from './nanami.mjs';

const __dir    = path.dirname(fileURLToPath(import.meta.url));
const db       = new Database(path.join(__dir, 'applications.db'));
const MEM_PATH = path.join(__dir, 'agents/memory/senku.json');
const DRY_RUN  = process.argv.includes('--dry-run');

const AGENT = 'OpenFangOrchestrator';
const log   = (action, detail, status='ok') => logDB(db, AGENT, action, detail, status);

// ── AGENT REGISTRY — source of truth for script names (LLM never decides this) ─
// Future tabs: add 'monetization', 'research' entries here when ready
const AGENT_REGISTRY = {
  'scout':         { script: 'scout-api.mjs',       name: 'Fern',   defaultArgs: [],             timeout: 120000  },
  'xreddit':       { script: 'agent-xreddit.mjs',   name: 'Kaguya', defaultArgs: [],             timeout: 300000  },
  'register':      { script: 'agent-mob.mjs',       name: 'Mob',    defaultArgs: ['--limit=5'],  timeout: 300000  },
  'ats_apply':     { script: 'apply-ats.mjs',       name: 'Reigen', defaultArgs: ['--limit=5'],  timeout: 600000  },
  'apply_from_db': { script: 'apply-from-db.mjs',  name: 'Reigen', defaultArgs: ['--limit=3'],  timeout: 600000  },
  'cold_email':    { script: 'cold-email.mjs',      name: 'Reigen', defaultArgs: [],             timeout: 120000  },
  'bookmarks':          { script: 'agent-bookmarks.mjs',          name: 'Rin',    defaultArgs: [], timeout: 120000  },
  'bookmarks_research': { script: 'agent-bookmarks-research.mjs',  name: 'Rin',    defaultArgs: [], timeout: 300000  },
};

// Load soul — if missing, use a minimal inline soul
let SOUL = '';
try { SOUL = readFileSync(path.join(__dir, 'agents/souls/senku.md'), 'utf8'); }
catch { SOUL = 'You are Senku, job-hunting orchestrator. Be scientific and data-driven.'; }

// ── Memory ───────────────────────────────────────────────────────────────────
function loadMemory() {
  if (!existsSync(MEM_PATH)) return { cycles: 0, last_plan: null, bottleneck: null, notes: [] };
  try { return JSON.parse(readFileSync(MEM_PATH, 'utf8')); } catch { return {}; }
}
function saveMemory(mem) {
  mkdirSync(path.dirname(MEM_PATH), { recursive: true });
  writeFileSync(MEM_PATH, JSON.stringify(mem, null, 2));
}

// ── Signals (pause/resume from Nanami or user) ───────────────────────────────
function getSignal(agentKey) {
  const row = db.prepare(
    `SELECT signal, reason FROM agent_signals WHERE agent_key=? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1`
  ).get(agentKey);
  return row || null;
}
function resolveSignal(agentKey) {
  db.prepare(`UPDATE agent_signals SET resolved_at=datetime('now') WHERE agent_key=? AND resolved_at IS NULL`).run(agentKey);
}

// ── DB State ─────────────────────────────────────────────────────────────────
function getState() {
  const counts  = db.prepare(`SELECT status, COUNT(*) as n FROM applications GROUP BY status`).all();
  const blocked = db.prepare(`SELECT COUNT(*) as n FROM applications WHERE status='found' AND notes LIKE 'BLOCKED:%'`).get().n;
  const atsReady = db.prepare(`
    SELECT COUNT(*) as n FROM applications WHERE status='found'
    AND (notes NOT LIKE 'BLOCKED:%' OR notes IS NULL)
    AND (url LIKE '%greenhouse.io%' OR url LIKE '%lever.co%' OR url LIKE '%ashbyhq.com%' OR url LIKE '%workable.com%')
  `).get().n;
  const recentApps = db.prepare(
    `SELECT COUNT(*) as n FROM applications WHERE status='applied' AND updated_at >= datetime('now','-2 hours')`
  ).get().n;
  const lastLogs = db.prepare(
    `SELECT agent, action, detail, status FROM agent_log ORDER BY id DESC LIMIT 20`
  ).all();
  const recentFails = lastLogs.filter(l => l.status === 'error').length;

  const m = {};
  counts.forEach(c => m[c.status] = c.n);

  return {
    found: m.found || 0,
    applied: m.applied || 0,
    interview: m.interview || 0,
    blocked,
    ats_ready: atsReady,
    applied_last_2h: recentApps,
    recent_errors: recentFails,
    last_actions: lastLogs.slice(0, 8).map(l => `[${l.agent}:${l.action}]${l.status==='error'?' ERROR':''}`),
  };
}

// ── Enqueue task in DB ────────────────────────────────────────────────────────
function enqueueTask(taskType, taskDef, taskId = null) {
  return db.prepare(`
    INSERT INTO task_queue (agent_name, task_type, payload, status, priority, reason, success_criteria)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    taskDef.name,
    taskType,
    JSON.stringify(taskDef),
    'pending',
    taskDef.priority || 5,
    taskDef.reason || '',
    taskDef.success_criteria || '',
  ).lastInsertRowid;
}

// ── Execute a registered task with structured order ───────────────────────────
async function runTask(taskType, overrides = {}, taskId) {
  const reg = AGENT_REGISTRY[taskType];
  if (!reg) {
    log('error', `Unknown task_type: "${taskType}" — not in AGENT_REGISTRY`, 'error');
    return { ok: false, error: `Unknown task_type: ${taskType}` };
  }

  // Check pause signal before running
  const signal = getSignal(taskType);
  if (signal?.signal === 'pause') {
    log('paused', `${taskType} paused by ${signal.reason || 'Nanami'} — skipping`, 'warn');
    if (taskId) db.prepare(`UPDATE task_queue SET status='paused', result='{"reason":"paused"}' WHERE id=?`).run(taskId);
    return { ok: false, paused: true };
  }

  let args = overrides.args || reg.defaultArgs;
  // Cap --limit to sane values: browser agents max 5, scouts max 50
  const MAX_LIMITS = { ats_apply: 5, apply_from_db: 3, register: 5, scout: 50, xreddit: 10, bookmarks: 50 };
  const maxLimit = MAX_LIMITS[taskType];
  if (maxLimit) {
    args = args.map(a => {
      if (a.startsWith('--limit=')) {
        const n = parseInt(a.split('=')[1]);
        return `--limit=${Math.min(n, maxLimit)}`;
      }
      return a;
    });
  }
  const cmd  = `node ${path.join(__dir, reg.script)} ${args.join(' ')}`;

  if (taskId) db.prepare(`UPDATE task_queue SET status='in_progress', started_at=datetime('now') WHERE id=?`).run(taskId);
  log('running', `${reg.name} → ${reg.script} ${args.join(' ')}`);

  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: __dir, timeout: reg.timeout });
    const out = (stdout + stderr).slice(0, 600);
    if (taskId) db.prepare(`UPDATE task_queue SET status='completed', completed_at=datetime('now'), result=? WHERE id=?`)
      .run(JSON.stringify({ output: out }), taskId);
    log('done', `${reg.name}: ${out.replace(/\n/g,' ').slice(0,150)}`);
    return { ok: true, output: out };
  } catch (e) {
    const errMsg  = e.message || '';
    const errOut  = (e.stderr || e.stdout || '').slice(0, 400);
    const fullErr = (errMsg + (errOut ? '\n--- stderr ---\n' + errOut : '')).slice(0, 600);
    if (taskId) db.prepare(`UPDATE task_queue SET status='failed', completed_at=datetime('now'), error=? WHERE id=?`).run(fullErr, taskId);
    log('error', `${reg.name} (${reg.script}): ${fullErr.replace(/\n/g,' ').slice(0,200)}`, 'error');
    return { ok: false, error: fullErr };
  }
}

// ── Build plan with LLM — only task_type + args + reason, NOT script names ───
async function buildPlan(state, mem) {
  // What task_types are available (tell the LLM)
  const availableTasks = Object.entries(AGENT_REGISTRY).map(([k, v]) =>
    `  - "${k}": runs ${v.name} (${v.script})`
  ).join('\n');

  // Check mob-registerable jobs
  const mobPending = db.prepare(`
    SELECT COUNT(*) as n FROM applications WHERE status='found'
    AND (notes IS NULL OR (notes NOT LIKE 'MOB_REGISTERED:%' AND notes NOT LIKE 'BLOCKED:%'))
    AND (url LIKE '%wellfound.com%' OR url LIKE '%himalayas.app%'
      OR url LIKE '%torre.co%' OR url LIKE '%getonbrd.com%' OR url LIKE '%contra.com%')
  `).get().n;

  const mobReady = db.prepare(`
    SELECT COUNT(*) as n FROM applications WHERE status='found'
    AND notes LIKE 'MOB_REGISTERED:%'
  `).get().n;

  const prompt = `
CURRENT STATE:
- found: ${state.found} | applied: ${state.applied} | ats_ready: ${state.ats_ready}
- applied_last_2h: ${state.applied_last_2h} | blocked: ${state.blocked} | recent_errors: ${state.recent_errors}
- mob_pending (need registration): ${mobPending} | mob_ready (registered, not applied): ${mobReady}
- last_actions: ${state.last_actions.join(', ')}

PREVIOUS BOTTLENECK: ${mem.bottleneck || 'none'}
CYCLE COUNT: ${mem.cycles}

AVAILABLE TASK TYPES (use ONLY these exact strings):
${availableTasks}

RULES:
- ALWAYS include "scout" — job discovery is the pipeline engine
- Every 2 cycles OR if found < 50: include "xreddit" for social leads
- If mob_pending > 0: include "register" so Mob registers candidates before Reigen applies
- If mob_ready > 0 OR ats_ready > 5: include "ats_apply" and "apply_from_db"
- If found > 300 and applied_last_2h == 0: ALWAYS include ats_apply — no excuses
- Every 4th cycle: include "cold_email" for direct contacts without apply forms
- If recent_errors > 3 for a specific agent: skip that task_type this cycle
- NEVER include a task_type that is not in the AVAILABLE TASK TYPES list

Return JSON:
{
  "cycle_analysis": "1-2 sentence analysis",
  "priority": "scout|apply|both",
  "tasks": [
    {
      "task_type": "scout",
      "args": [],
      "reason": "why now",
      "success_criteria": "what Nanami verifies",
      "priority": 1
    }
  ]
}`;

  return callHaikuJSON(SOUL, prompt);
}

// ── Main Cycle ────────────────────────────────────────────────────────────────
async function orchestrate() {
  const cycleStart = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const mem   = loadMemory();
  const state = getState();
  mem.cycles  = (mem.cycles || 0) + 1;

  log('cycle_start', `Cycle #${mem.cycles} | LLM: ${backend()}`);
  console.log(`\n⚗️  Senku Cycle #${mem.cycles} — ${backend()}`);
  console.log(`   found:${state.found} applied:${state.applied} ats_ready:${state.ats_ready} errors:${state.recent_errors}`);

  // Build plan
  let plan;
  try {
    plan = await buildPlan(state, mem);
    mem.last_plan = plan;
    log('plan_ready', `${plan.priority} | ${(plan.tasks||[]).length} tasks | ${plan.cycle_analysis?.slice(0,80) || ''}`);
    console.log(`\n   📋 ${plan.cycle_analysis}`);
    console.log(`   Priority: ${plan.priority} | Tasks: ${(plan.tasks||[]).length}`);
  } catch (e) {
    log('plan_fallback', e.message.slice(0,80), 'warn');
    // Default plan — fully deterministic, no LLM needed
    plan = {
      cycle_analysis: 'LLM unavailable — default pipeline (Fern→Mob→Reigen)',
      priority: state.applied_last_2h === 0 && state.ats_ready > 0 ? 'apply' : 'both',
      tasks: [
        { task_type: 'scout',         args: [],              reason: 'Keep pipeline filled',         success_criteria: 'found count increases',   priority: 1 },
        { task_type: 'xreddit',       args: [],              reason: 'Social leads',                  success_criteria: '0+ new leads',            priority: 2 },
        { task_type: 'register',      args: ['--limit=5'],   reason: 'Register on platforms (Mob)',   success_criteria: 'mob_registered count > 0', priority: 3 },
        { task_type: 'ats_apply',     args: ['--limit=10'],  reason: 'Submit ATS forms (Reigen)',     success_criteria: 'applied count > prev',    priority: 4 },
        { task_type: 'apply_from_db', args: ['--limit=5'],   reason: 'Career page applications',     success_criteria: 'applied count > prev',    priority: 5 },
      ],
    };
  }

  if (DRY_RUN) {
    console.log('\n   [DRY RUN] Would execute:');
    plan.tasks?.forEach(t => {
      const reg = AGENT_REGISTRY[t.task_type];
      console.log(`     ${t.task_type} → ${reg?.script || '⚠️ NOT IN REGISTRY'} ${(t.args||[]).join(' ')}`);
    });
    saveMemory(mem);
    db.close();
    return;
  }

  // Execute tasks in priority order
  const sortedTasks = (plan.tasks || []).sort((a, b) => (a.priority || 5) - (b.priority || 5));

  for (const task of sortedTasks) {
    if (!AGENT_REGISTRY[task.task_type]) {
      log('warn', `task_type "${task.task_type}" not in registry — skipping`, 'warn');
      continue;
    }
    const reg = AGENT_REGISTRY[task.task_type];
    console.log(`\n   → [${task.task_type}] ${reg.name}: ${task.reason || ''}`);

    const taskId = enqueueTask(task.task_type, {
      name: reg.name,
      reason: task.reason || '',
      success_criteria: task.success_criteria || '',
      priority: task.priority || 5,
      ...task,
    });

    const result = await runTask(task.task_type, { args: task.args }, taskId);

    if (!result.ok && !result.paused) {
      console.log(`   ❌ ${reg.name} failed — Nanami will flag this`);
    } else if (result.paused) {
      console.log(`   ⏸️  ${reg.name} paused — signal active`);
    } else {
      console.log(`   ✅ ${reg.name} done`);
    }
  }

  // Nanami QA
  console.log('\n   🗡️  Nanami auditing cycle...');
  const verdicts = await auditCycle(cycleStart);

  // Update memory from audit
  const fails = verdicts.filter(v => v.verdict === 'FAIL');
  if (fails.length) {
    mem.bottleneck = fails.map(v => `${v.agent}: ${(v.recommendation||'').slice(0,60)}`).join('; ');
    mem.notes = [...(mem.notes||[]), `Cycle #${mem.cycles}: ${fails.map(v=>v.agent).join(',')}`].slice(-10);

    // Nanami auto-pauses agents with repeated failures (3+ consecutive)
    for (const fail of fails) {
      const taskType = Object.entries(AGENT_REGISTRY).find(([,v]) => v.name === fail.agent)?.[0];
      if (!taskType) continue;
      const recentFails = db.prepare(`
        SELECT COUNT(*) as n FROM task_queue
        WHERE agent_name=? AND status='failed' AND created_at >= datetime('now','-3 hours')
      `).get(AGENT_REGISTRY[taskType].name).n;

      if (recentFails >= 3) {
        db.prepare(`INSERT INTO agent_signals (agent_key, signal, reason, created_by) VALUES (?,?,?,?)`)
          .run(taskType, 'pause', `${recentFails} failures in 3h — ${fail.recommendation?.slice(0,80) || ''}`, 'Nanami');
        log('agent_paused', `${taskType} paused by Nanami after ${recentFails} failures`, 'warn');
        console.log(`   ⏸️  Nanami paused ${taskType} (${recentFails} recent failures)`);
      }
    }
  } else {
    mem.bottleneck = null;
    // Auto-resume paused agents if no failures this cycle
    for (const taskType of Object.keys(AGENT_REGISTRY)) {
      const signal = getSignal(taskType);
      if (signal?.signal === 'pause') {
        resolveSignal(taskType);
        log('agent_resumed', `${taskType} auto-resumed — clean cycle`);
        console.log(`   ▶️  ${taskType} auto-resumed`);
      }
    }
  }

  const final = getState();
  log('cycle_done', `applied:${final.applied} found:${final.found} blocked:${final.blocked}`);
  saveMemory(mem);
  console.log(`\n✅ Cycle #${mem.cycles} | applied:${final.applied} found:${final.found} blocked:${final.blocked}`);
  db.close();
}

await orchestrate();
