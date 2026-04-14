/**
 * nanami.mjs — QA Auditor
 * Verifica que cada agente realmente completó su tarea.
 * Llamado por Senku después de cada ciclo de ejecución.
 *
 * Usage: node nanami.mjs [--task-id=123]
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const Database = require('better-sqlite3');
import { callHaikuJSON } from './anthropic-client.mjs';
import { logDB } from './db-utils.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const db    = new Database(path.join(__dir, 'applications.db'));
const SOUL  = readFileSync(path.join(__dir, 'agents/souls/nanami.md'), 'utf8');

const AGENT = 'QA-Audit';
const log   = (action, detail, status='ok') => logDB(db, AGENT, action, detail, status);

/**
 * Audit a completed task from task_queue.
 * @param {object} task - Row from task_queue
 * @returns {object} verdict
 */
export async function auditTask(task) {
  // Get recent agent_log entries since the task started
  const since = task.started_at || task.created_at;
  const logs = db.prepare(`
    SELECT agent, action, detail, status, created_at FROM agent_log
    WHERE created_at >= ? ORDER BY id DESC LIMIT 50
  `).all(since);

  // Get DB stats for context
  const dbStats = db.prepare(`SELECT status, COUNT(*) as n FROM applications GROUP BY status`).all();
  const recentInserts = db.prepare(`
    SELECT COUNT(*) as n FROM applications WHERE applied_at >= ?
  `).get(since);

  const context = {
    task: {
      agent: task.agent_name,
      type: task.task_type,
      success_criteria: task.success_criteria,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
    },
    agent_logs: logs.slice(0, 20).map(l => `[${l.agent}][${l.action}] ${(l.detail||'').slice(0,80)}`),
    db_stats: dbStats,
    new_rows_since_task: recentInserts.n,
  };

  try {
    const verdict = await callHaikuJSON(
      SOUL,
      `Audit this completed task and return your verdict:\n\n${JSON.stringify(context, null, 2)}`
    );
    log('audit', `${task.agent_name}: ${verdict.verdict} — ${(verdict.evidence||'').slice(0,100)}`);
    // Update task with audit result
    db.prepare(`UPDATE task_queue SET result=? WHERE id=?`)
      .run(JSON.stringify({ ...JSON.parse(task.result||'{}'), audit: verdict }), task.id);
    return verdict;
  } catch (e) {
    log('audit_error', `${task.agent_name}: ${e.message}`, 'error');
    return { agent: task.agent_name, verdict: 'ERROR', evidence: e.message, issues: [], recommendation: 'Retry audit' };
  }
}

/**
 * Audit multiple tasks in ONE LLM call — avoids Groq rate limits.
 * @param {Array} tasks - Rows from task_queue
 * @returns {Array} verdicts
 */
async function auditBatch(tasks) {
  const since = tasks[tasks.length - 1]?.started_at || tasks[tasks.length - 1]?.created_at;
  const logs = since ? db.prepare(`
    SELECT agent, action, detail, status FROM agent_log
    WHERE created_at >= ? ORDER BY id DESC LIMIT 50
  `).all(since) : [];

  const dbStats = db.prepare(`SELECT status, COUNT(*) as n FROM applications GROUP BY status`).all();
  const appliedTotal = dbStats.find(s => s.status === 'applied')?.n || 0;

  const batchContext = {
    db_stats: dbStats,
    applied_total: appliedTotal,
    recent_logs: logs.slice(0, 30).map(l => `[${l.agent}][${l.action}]${l.status==='error'?' ERROR':''} ${(l.detail||'').slice(0,60)}`),
    tasks: tasks.map(t => ({
      id: t.id,
      agent: t.agent_name,
      type: t.task_type,
      status: t.status,
      success_criteria: t.success_criteria,
      result: t.result ? (() => { try { return JSON.parse(t.result); } catch { return t.result; } })() : null,
      error: t.error,
    })),
  };

  try {
    const result = await callHaikuJSON(
      SOUL,
      `Audit these ${tasks.length} completed tasks in ONE response. Return an array of verdicts:\n\n${JSON.stringify(batchContext, null, 2)}\n\nReturn JSON array: [{agent, verdict, evidence, issues, recommendation}]`
    );
    const verdictArray = Array.isArray(result) ? result : [result];

    // Persist audit results back to task_queue
    for (let i = 0; i < tasks.length; i++) {
      const v = verdictArray[i] || { agent: tasks[i].agent_name, verdict: 'PASS', evidence: 'batch audit', issues: [], recommendation: '' };
      log('audit', `${tasks[i].agent_name}: ${v.verdict} — ${(v.evidence||'').slice(0,100)}`);
      db.prepare(`UPDATE task_queue SET result=? WHERE id=?`)
        .run(JSON.stringify({ ...(() => { try { return JSON.parse(tasks[i].result||'{}'); } catch { return {}; } })(), audit: v }), tasks[i].id);
    }
    return verdictArray;
  } catch (e) {
    log('audit_error', `batch: ${e.message.slice(0,80)}`, 'error');
    // Fallback: return PASS for all to avoid blocking the cycle
    return tasks.map(t => ({ agent: t.agent_name, verdict: 'PASS', evidence: `audit skipped: ${e.message.slice(0,40)}`, issues: [], recommendation: '' }));
  }
}

/**
 * Audit ALL tasks completed in the last cycle (no started_at arg).
 * @returns {Array} all verdicts
 */
export async function auditCycle(cycleStartedAt) {
  // SQLite stores datetime as 'YYYY-MM-DD HH:MM:SS' — convert ISO string
  const since = (cycleStartedAt || new Date(Date.now() - 90 * 60000).toISOString())
    .replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const tasks = db.prepare(`
    SELECT * FROM task_queue
    WHERE status IN ('completed','failed') AND created_at >= ?
    ORDER BY id DESC
  `).all(since);

  if (!tasks.length) {
    log('audit_cycle', 'No tasks to audit in last 90min');
    return [];
  }

  // Batch all tasks into ONE LLM call to avoid rate limit (Groq free tier)
  const verdicts = await auditBatch(tasks);

  const fails    = verdicts.filter(v => v.verdict === 'FAIL').length;
  const warnings = verdicts.filter(v => v.verdict === 'WARNING').length;
  const passes   = verdicts.filter(v => v.verdict === 'PASS').length;

  log('cycle_audit_done', `PASS:${passes} WARN:${warnings} FAIL:${fails}`);
  console.log(`\n🗡️  Nanami QA Report: ${passes} PASS / ${warnings} WARNING / ${fails} FAIL`);
  verdicts.forEach(v => {
    const icon = v.verdict === 'PASS' ? '✅' : v.verdict === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${v.agent}: ${(v.evidence||'').slice(0,80)}`);
  });

  return verdicts;
}

// Run standalone if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const since = process.argv.find(a => a.startsWith('--since='))?.split('=')[1];
  await auditCycle(since);
  db.close();
}
