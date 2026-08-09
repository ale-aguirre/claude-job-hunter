/**
 * eval-report.mjs — Retrospective evaluation of the autonomous pipeline
 *
 * Measures what the agents actually achieved against the DB of record:
 * delivery rate per channel, orchestrator reliability, funnel conversion.
 * Read-only. Run: node eval-report.mjs [--json]
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('applications.db', { readonly: true });
const asJson = process.argv.includes('--json');

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

// --- Funnel -----------------------------------------------------------------
const byStatus = Object.fromEntries(
  all('SELECT status, COUNT(*) n FROM applications GROUP BY 1').map(r => [r.status, r.n])
);
const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
const applied = byStatus.applied || 0;

// --- Delivery verification --------------------------------------------------
// The applier writes its own outcome into notes. CONFIRMED means it re-read the
// page after submit and saw a success state; UNVERIFIED means the click landed
// but nothing proved it went through.
const confirmed = one(
  "SELECT COUNT(*) n FROM applications WHERE status='applied' AND notes LIKE 'CONFIRMED%'"
).n;
const unverified = one(
  "SELECT COUNT(*) n FROM applications WHERE status='applied' AND notes LIKE 'UNVERIFIED%'"
).n;
const emailed = one(
  "SELECT COUNT(*) n FROM applications WHERE status='applied' AND (notes LIKE 'emailed%' OR notes LIKE '%| email:%')"
).n;
const otherApplied = applied - confirmed - unverified - emailed;

// --- Delivery rate per channel ----------------------------------------------
// Channel comes from the target URL, not from notes: notes only carry the
// outcome, so grouping by notes hides which board produced the failures.
const hosts = all(`
  SELECT
    CASE
      WHEN notes LIKE 'emailed%'
        OR notes LIKE '%| email:%'      THEN 'Direct email'
      WHEN url LIKE '%ashbyhq.com%'     THEN 'Ashby'
      WHEN url LIKE '%greenhouse.io%'   THEN 'Greenhouse'
      WHEN url LIKE '%himalayas.app%'   THEN 'Himalayas'
      WHEN url LIKE '%jobicy.com%'      THEN 'Jobicy'
      WHEN url LIKE '%arbeitnow.com%'   THEN 'Arbeitnow'
      WHEN url LIKE '%lever.co%'        THEN 'Lever'
      ELSE 'Other'
    END host,
    SUM(notes LIKE 'CONFIRMED%')  ok,
    SUM(notes LIKE 'UNVERIFIED%') unv,
    COUNT(*) n
  FROM applications WHERE status='applied'
  GROUP BY 1 ORDER BY n DESC
`);

// --- Orchestrator reliability ----------------------------------------------
const tasks = all(`
  SELECT task_type,
         SUM(status='completed') ok,
         SUM(status='failed')    failed,
         SUM(status='paused')    paused,
         COUNT(*) n
  FROM task_queue GROUP BY 1 ORDER BY n DESC
`);
const taskTotal = tasks.reduce((a, t) => a + t.n, 0);
const taskOk = tasks.reduce((a, t) => a + t.ok, 0);

// Median wall-clock per completed task, in seconds.
const durations = all(`
  SELECT (julianday(completed_at) - julianday(started_at)) * 86400 secs
  FROM task_queue
  WHERE status='completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
  ORDER BY 1
`).map(r => r.secs);
const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;

// --- Auto-recovery: the QA auditor pausing bad agents ------------------------
const signals = all(
  'SELECT agent_key, signal, reason, created_at, resolved_at FROM agent_signals ORDER BY id'
);
const qa = all(
  "SELECT status, COUNT(*) n FROM agent_log WHERE agent='QA-Audit' GROUP BY 1"
);

// --- Source quality: what the scouts found vs what survived triage -----------
const sources = all(`
  SELECT source,
         COUNT(*) n,
         SUM(status='applied')  applied,
         SUM(status='archived') archived,
         SUM(status='skipped')  skipped
  FROM applications GROUP BY 1 ORDER BY n DESC
`);

// --- Coverage: found leads never acted on -----------------------------------
const stale = one(
  "SELECT COUNT(*) n FROM applications WHERE status='found' AND applied_at > '2026-06-01'"
).n;
const lastApply = one(
  "SELECT MAX(applied_at) d FROM applications WHERE status='applied'"
).d;
const lastFound = one('SELECT MAX(applied_at) d FROM applications').d;

const report = {
  funnel: { total, ...byStatus },
  delivery: {
    applied,
    confirmed,
    unverified,
    emailed,
    other: otherApplied,
    confirmed_rate: Number(pct(confirmed, applied)),
  },
  hosts,
  orchestrator: {
    tasks: taskTotal,
    completed: taskOk,
    success_rate: Number(pct(taskOk, taskTotal)),
    median_task_secs: Math.round(median),
    by_type: tasks,
  },
  qa: { verdicts: qa, signals },
  sources,
  coverage: { stale_found_since_june: stale, last_apply: lastApply, last_scout: lastFound },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  db.close();
  process.exit(0);
}

const bar = (n, d, w = 24) => '█'.repeat(Math.round((n / (d || 1)) * w)).padEnd(w, '·');

console.log('\n=== JOB-HUNTER — RETROSPECTIVE EVAL ===');
console.log(`DB of record: applications.db | ${total} leads | scouted through ${lastFound}\n`);

console.log('FUNNEL');
for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(10)} ${String(n).padStart(5)}  ${bar(n, total)} ${pct(n, total)}%`);
}

console.log('\nDELIVERY (of the ' + applied + ' the agent submitted)');
console.log(`  confirmed on page   ${String(confirmed).padStart(4)}  ${pct(confirmed, applied)}%`);
console.log(`  submitted, no proof ${String(unverified).padStart(4)}  ${pct(unverified, applied)}%`);
console.log(`  sent by email       ${String(emailed).padStart(4)}  ${pct(emailed, applied)}%`);
console.log(`  other               ${String(otherApplied).padStart(4)}  ${pct(otherApplied, applied)}%`);

console.log('\nDELIVERY RATE PER CHANNEL');
console.log('  channel          sent   confirmed   unproven    rate');
for (const h of hosts) {
  // Email has no page to re-read, so a rate would be meaningless, not zero.
  const rate = h.host === 'Direct email' ? '  n/a' : `${pct(h.ok, h.n).padStart(5)}%`;
  console.log(
    `  ${h.host.padEnd(16)} ${String(h.n).padStart(4)}   ${String(h.ok).padStart(9)}   ${String(
      h.unv
    ).padStart(8)}   ${rate}`
  );
}

console.log('\nORCHESTRATOR (task_queue)');
console.log(
  `  ${taskTotal} tasks dispatched | ${pct(taskOk, taskTotal)}% completed | median ${Math.round(median)}s per task`
);
console.log('  task_type        ok  failed  paused   success');
for (const t of tasks) {
  console.log(
    `  ${t.task_type.padEnd(15)} ${String(t.ok).padStart(3)} ${String(t.failed).padStart(6)} ${String(
      t.paused
    ).padStart(7)}   ${pct(t.ok, t.n).padStart(5)}%`
  );
}

console.log('\nQA AUDITOR');
for (const q of qa) console.log(`  verdict ${q.status.padEnd(6)} ${q.n}`);
for (const s of signals) {
  const state = s.resolved_at ? `resolved ${s.resolved_at}` : 'still open';
  console.log(`  ${s.signal} ${s.agent_key} — ${s.reason} (${state})`);
}

console.log('\nSOURCE QUALITY');
console.log('  source      found  applied  archived  skipped   yield');
for (const s of sources) {
  console.log(
    `  ${s.source.padEnd(11)} ${String(s.n).padStart(5)} ${String(s.applied).padStart(8)} ${String(
      s.archived
    ).padStart(9)} ${String(s.skipped).padStart(8)}   ${pct(s.applied, s.n).padStart(5)}%`
  );
}

console.log('\nCOVERAGE GAP');
console.log(`  last application sent : ${lastApply}`);
console.log(`  last lead scouted     : ${lastFound}`);
console.log(`  leads found since june never acted on: ${stale}`);
console.log('');

db.close();
