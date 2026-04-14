#!/usr/bin/env node
/**
 * HuntDesk Server
 * node server.mjs
 * Port: 4242
 */
import { createServer } from 'http';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { URL, fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __serverDir = path.dirname(fileURLToPath(import.meta.url));
const _profileArg = process.argv.find(a => a.startsWith('--profile='));
const _profileName = _profileArg?.split('=')[1] || null;
let ENV_PATH;

if (_profileName) {
  const _profileDir = path.join(__serverDir, 'profiles', _profileName);
  mkdirSync(_profileDir, { recursive: true });
  ENV_PATH = path.join(_profileDir, '.env');
  dotenv.config({ path: ENV_PATH });
  process.env.HUNTDESK_DB_PATH = path.join(_profileDir, 'applications.db');
} else {
  ENV_PATH = path.join(__serverDir, '.env');
  dotenv.config();
}

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.PORT || '4242');
const DB_PATH = process.env.HUNTDESK_DB_PATH || new URL('applications.db', import.meta.url).pathname;
const HTML_PATH = new URL('index.html', import.meta.url).pathname;

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company      TEXT NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT,
    source       TEXT DEFAULT 'manual',
    status       TEXT DEFAULT 'found',
    cv_used      TEXT DEFAULT 'CV.pdf',
    easy_apply   INTEGER DEFAULT 0,
    cover_letter TEXT DEFAULT '',
    salary       TEXT DEFAULT '',
    location     TEXT DEFAULT 'Remote',
    applied_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    notes        TEXT DEFAULT '',
    platform     TEXT DEFAULT '',
    pay_hr       REAL DEFAULT 0,
    pay_mo       REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS agent_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent      TEXT NOT NULL,
    action     TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    status     TEXT DEFAULT 'ok',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS income_streams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    type        TEXT DEFAULT 'freelance',
    status      TEXT DEFAULT 'active',
    monthly_usd REAL DEFAULT 0,
    notes       TEXT DEFAULT '',
    updated_at  TEXT DEFAULT (datetime('now'))
  );
`);

// Migrate existing columns silently
try { db.exec(`ALTER TABLE applications ADD COLUMN platform TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE applications ADD COLUMN pay_hr REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE applications ADD COLUMN pay_mo REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE applications ADD COLUMN easy_apply INTEGER DEFAULT 0`); } catch {}

// SSE clients
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(msg));
}

function logAgent(agent, action, detail = '', status = 'ok') {
  db.prepare(`INSERT INTO agent_log (agent,action,detail,status) VALUES (?,?,?,?)`).run(agent, action, detail, status);
  broadcast('log', { agent, action, detail, status, ts: new Date().toISOString() });
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function body(req) {
  return new Promise(r => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { r(JSON.parse(d)); } catch { r({}); } });
  });
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const urlPath = u.pathname;

  // SSE
  if (urlPath === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Activity stream SSE (polls agent_log every 2s)
  if (urlPath === '/api/activity/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: connected\n\n');
    const send = () => {
      try {
        const logs = db.prepare(
          `SELECT agent, action, detail, status, created_at FROM agent_log ORDER BY id DESC LIMIT 20`
        ).all();
        res.write(`data: ${JSON.stringify(logs)}\n\n`);
      } catch { /* db busy */ }
    };
    send(); // immediate first payload
    const interval = setInterval(send, 2000);
    req.on('close', () => clearInterval(interval));
    return;
  }

  // Dashboard HTML
  if (urlPath === '/' || urlPath === '/dashboard') {
    if (existsSync(HTML_PATH)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(HTML_PATH));
    }
    return json(res, { error: 'index.html not found' }, 404);
  }

  // Static src/ (CSS, JS modules)
  if (urlPath.startsWith('/src/')) {
    const ext = urlPath.split('.').pop();
    const mime = ext === 'css' ? 'text/css' : ext === 'js' ? 'application/javascript' : 'text/plain';
    const filePath = new URL('.' + urlPath, import.meta.url).pathname;
    if (existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(filePath));
    }
    return json(res, { error: 'not found' }, 404);
  }

  // Static avatars — serve PNG if available, fall back to SVG placeholder
  if (urlPath.startsWith('/avatars/')) {
    const base = urlPath.replace(/\.(png|svg)$/, '');
    for (const ext of ['.png', '.svg']) {
      const avatarPath = new URL('.' + base + ext, import.meta.url).pathname;
      if (existsSync(avatarPath)) {
        const ct = ext === '.svg' ? 'image/svg+xml' : 'image/png';
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(readFileSync(avatarPath));
      }
    }
    return json(res, { error: 'not found' }, 404);
  }

  // ─── Config (read from .env) ─────────────────────────────
  if (urlPath === '/api/config') {
    return json(res, {
      name:     `${process.env.FIRST_NAME || ''} ${process.env.LAST_NAME || ''}`.trim() || 'Hunter',
      firstName: process.env.FIRST_NAME || '',
      lastName:  process.env.LAST_NAME  || '',
      email:     process.env.EMAIL      || '',
      phone:     process.env.PHONE      || '',
      linkedin:  process.env.LINKEDIN   || '',
      github:    process.env.GITHUB     || '',
      portfolio: process.env.PORTFOLIO  || '',
      city:      process.env.CITY       || '',
      cvPath:    process.env.CV_PATH    || '',
      profileText: process.env.PROFILE_TEXT || '',
      goal:      process.env.SALARY_TARGET   || '$2,500/mo',
      location:  process.env.SEARCH_LOCATION || 'Remote',
      searchTags: process.env.SEARCH_TAGS    || '',
      hasGroq:   !!process.env.GROQ_API_KEY,
      hasOR:     !!process.env.OPENROUTER_API_KEY,
    });
  }

  // ─── Config Save (write to .env) ─────────────────────────
  if (urlPath === '/api/config/save' && req.method === 'POST') {
    const data = await body(req);
    const envPath = ENV_PATH;
    let existing = '';
    try { existing = readFileSync(envPath, 'utf8'); } catch {}
    for (const [key, value] of Object.entries(data)) {
      if (!key.match(/^[A-Z_]+$/)) continue; // safety: only uppercase env var names
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      if (regex.test(existing)) {
        existing = existing.replace(regex, line);
      } else {
        existing += `\n${line}`;
      }
    }
    writeFileSync(envPath, existing);
    // Reload env vars in current process
    for (const [key, value] of Object.entries(data)) {
      process.env[key] = value;
    }
    return json(res, { ok: true });
  }

  // ─── Export (JSON backup) ─────────────────────────────────
  if (urlPath === '/api/export') {
    const apps    = db.prepare('SELECT * FROM applications').all();
    const income  = db.prepare('SELECT * FROM income_streams').all();
    const agentCfgPath = new URL('agents-config.json', import.meta.url).pathname;
    let agentCfg = {};
    try { agentCfg = JSON.parse(readFileSync(agentCfgPath, 'utf8')); } catch {}
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      profile: {
        FIRST_NAME: process.env.FIRST_NAME || '',
        LAST_NAME:  process.env.LAST_NAME  || '',
        EMAIL:      process.env.EMAIL      || '',
        PHONE:      process.env.PHONE      || '',
        LINKEDIN:   process.env.LINKEDIN   || '',
        GITHUB:     process.env.GITHUB     || '',
        PORTFOLIO:  process.env.PORTFOLIO  || '',
        CITY:       process.env.CITY       || '',
        CV_PATH:    process.env.CV_PATH    || '',
        PROFILE_TEXT:     process.env.PROFILE_TEXT     || '',
        SEARCH_TAGS:      process.env.SEARCH_TAGS      || '',
        SEARCH_LOCATION:  process.env.SEARCH_LOCATION  || '',
        SALARY_TARGET:    process.env.SALARY_TARGET    || '',
      },
      // API keys are NOT exported for security — re-enter after import
      applications:   apps,
      income_streams: income,
      agentConfig:    agentCfg,
    };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="huntdesk-backup-${new Date().toISOString().slice(0,10)}.json"`,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(JSON.stringify(backup, null, 2));
  }

  // ─── Import (restore from JSON backup) ───────────────────
  if (urlPath === '/api/import' && req.method === 'POST') {
    const data = await body(req);
    if (!data.profile || !data.version) return json(res, { error: 'Invalid backup file' }, 400);

    // Save profile to .env
    const envPath = ENV_PATH;
    let existing = '';
    try { existing = readFileSync(envPath, 'utf8'); } catch {}
    for (const [key, value] of Object.entries(data.profile)) {
      if (!key.match(/^[A-Z_]+$/)) continue;
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      if (regex.test(existing)) {
        existing = existing.replace(regex, line);
      } else {
        existing += `\n${line}`;
      }
    }
    writeFileSync(envPath, existing);

    // Restore applications (skip duplicates by URL)
    let imported = 0;
    if (Array.isArray(data.applications)) {
      const ins = db.prepare(`INSERT OR IGNORE INTO applications
        (company,title,url,source,status,cover_letter,salary,location,notes,platform,pay_hr,pay_mo,easy_apply,applied_at)
        VALUES (@company,@title,@url,@source,@status,@cover_letter,@salary,@location,@notes,@platform,@pay_hr,@pay_mo,@easy_apply,@applied_at)`);
      for (const a of data.applications) {
        try { ins.run({ company:'?',title:'?',url:'',source:'import',status:'found',cover_letter:'',salary:'',location:'Remote',notes:'',platform:'',pay_hr:0,pay_mo:0,easy_apply:0,applied_at:new Date().toISOString(), ...a }); imported++; } catch {}
      }
    }

    // Restore income streams
    if (Array.isArray(data.income_streams)) {
      const ins2 = db.prepare(`INSERT OR IGNORE INTO income_streams (name,type,status,monthly_usd,notes) VALUES (@name,@type,@status,@monthly_usd,@notes)`);
      for (const s of data.income_streams) {
        try { ins2.run({ name:'?', type:'freelance', status:'active', monthly_usd:0, notes:'', ...s }); } catch {}
      }
    }

    return json(res, { ok: true, imported });
  }

  // ─── Chat with Orchestrator ───────────────────────────────
  if (urlPath === '/api/chat' && req.method === 'POST') {
    const data = await body(req);
    const msg = (data.message || '').trim();
    if (!msg) return json(res, { error: 'empty message' }, 400);

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return json(res, { reply: '⚠️ No GROQ_API_KEY set. Add it in Settings → API Keys to enable chat.' });

    const stats  = db.prepare('SELECT status, COUNT(*) as n FROM applications GROUP BY status').all();
    const recent = db.prepare("SELECT company, title, status FROM applications ORDER BY id DESC LIMIT 8").all();
    const logs   = db.prepare("SELECT agent, action, detail FROM agent_log ORDER BY id DESC LIMIT 5").all();
    const name   = `${process.env.FIRST_NAME || ''} ${process.env.LAST_NAME || ''}`.trim() || 'the user';
    const target = process.env.SALARY_TARGET || '$2,500/mo';

    const ctx = `Candidate: ${name}. Target: ${target} remote.
DB: ${stats.map(s=>`${s.status}:${s.n}`).join(', ')}.
Recent: ${recent.slice(0,5).map(r=>`${r.company}(${r.status})`).join(' | ')}.
Last agent actions: ${logs.map(l=>`${l.agent}:${l.action}`).join(', ')}.`;

    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 800,
          messages: [
            { role: 'system', content: `You are Senku, the job hunt orchestrator AI. You manage an autonomous job hunting system. Context: ${ctx}\n\nBe concise, specific, and actionable. Use bullet points. Focus on what will generate income fastest.` },
            { role: 'user', content: msg },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
      const d = await r.json();
      const reply = d.choices?.[0]?.message?.content || 'No response from LLM.';
      logAgent('Senku', 'chat', msg.slice(0, 100));
      return json(res, { reply });
    } catch (e) {
      return json(res, { reply: `Error: ${e.message}` });
    }
  }

  // ─── Agent Config (custom names + avatar metadata) ────────
  if (urlPath === '/api/agents/config') {
    const cfgPath = new URL('agents-config.json', import.meta.url).pathname;
    if (req.method === 'GET') {
      try { return json(res, JSON.parse(readFileSync(cfgPath, 'utf8'))); }
      catch { return json(res, {}); }
    }
    if (req.method === 'POST') {
      const data = await body(req);
      writeFileSync(cfgPath, JSON.stringify(data, null, 2));
      return json(res, { ok: true });
    }
  }

  // ─── Avatar Upload ────────────────────────────────────────
  if (urlPath.startsWith('/api/agents/') && urlPath.endsWith('/avatar') && req.method === 'POST') {
    const agentName = urlPath.split('/')[3];
    const data = await body(req);
    if (!data.dataUrl || !agentName) return json(res, { error: 'missing data' }, 400);
    // Save as PNG in avatars/
    const match = data.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!match) return json(res, { error: 'invalid image format' }, 400);
    const imgBuf = Buffer.from(match[2], 'base64');
    const avatarPath = new URL(`./avatars/${agentName}.png`, import.meta.url).pathname;
    writeFileSync(avatarPath, imgBuf);
    return json(res, { ok: true, path: `/avatars/${agentName}.png` });
  }

  // ─── Applications ───────────────────────────────────────
  if (urlPath === '/api/applications' && req.method === 'GET') {
    const status = u.searchParams.get('status');
    const apps = status
      ? db.prepare('SELECT * FROM applications WHERE status=? ORDER BY applied_at DESC').all(status)
      : db.prepare('SELECT * FROM applications ORDER BY applied_at DESC').all();
    return json(res, apps);
  }

  if (urlPath === '/api/applications' && req.method === 'POST') {
    const d = await body(req);
    if (d.url) {
      const ex = db.prepare('SELECT id FROM applications WHERE url=?').get(d.url);
      if (ex) return json(res, { duplicate: true, id: ex.id });
    }
    const r = db.prepare(`
      INSERT INTO applications (company,title,url,source,status,cover_letter,salary,location,notes,platform,pay_hr,pay_mo,easy_apply)
      VALUES (@company,@title,@url,@source,@status,@cover_letter,@salary,@location,@notes,@platform,@pay_hr,@pay_mo,@easy_apply)
    `).run({
      company: d.company || '?', title: d.title || '?', url: d.url || '',
      source: d.source || 'manual', status: d.status || 'found',
      cover_letter: d.cover_letter || '', salary: d.salary || '',
      location: d.location || 'Remote', notes: d.notes || '',
      platform: d.platform || '', pay_hr: d.pay_hr || 0, pay_mo: d.pay_mo || 0,
      easy_apply: d.easy_apply ? 1 : 0,
    });
    logAgent('HuntDesk', 'new_opportunity', `${d.company} — ${d.title}`);
    broadcast('refresh', { id: r.lastInsertRowid });
    return json(res, { id: r.lastInsertRowid });
  }

  if (urlPath.startsWith('/api/applications/') && req.method === 'PATCH') {
    const id = parseInt(urlPath.split('/').pop());
    const d = await body(req);
    const fields = Object.keys(d).map(k => `${k}=@${k}`).join(',');
    db.prepare(`UPDATE applications SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...d, id });
    broadcast('refresh', { id });
    logAgent('HuntDesk', 'status_update', `#${id} → ${d.status || 'updated'}`);
    return json(res, { ok: true });
  }

  if (urlPath.startsWith('/api/applications/') && req.method === 'DELETE') {
    const id = parseInt(urlPath.split('/').pop());
    db.prepare('DELETE FROM applications WHERE id=?').run(id);
    broadcast('refresh', { id });
    return json(res, { ok: true });
  }

  // ─── Agent Log ───────────────────────────────────────────
  if (urlPath === '/api/log' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM agent_log ORDER BY created_at DESC LIMIT 200').all();
    return json(res, rows);
  }

  // Last run time per agent key (for timer chips)
  if (urlPath === '/api/agents/last-run' && req.method === 'GET') {
    const rows = db.prepare(`
      SELECT agent, MAX(created_at) as last_run
      FROM agent_log GROUP BY agent
    `).all();
    const daemonRow = db.prepare(`SELECT MAX(created_at) as last_run FROM agent_log WHERE agent='Daemon' AND action='cycle_done'`).get();
    return json(res, { agents: rows, daemonLastCycle: daemonRow?.last_run || null, intervalMin: 60 });
  }

  if (urlPath === '/api/log' && req.method === 'POST') {
    const d = await body(req);
    logAgent(d.agent || 'unknown', d.action || '', d.detail || '', d.status || 'ok');
    return json(res, { ok: true });
  }

  // ─── Stats ───────────────────────────────────────────────
  if (urlPath === '/api/stats') {
    const counts = db.prepare(`
      SELECT status, COUNT(*) as n FROM applications GROUP BY status
    `).all();
    const total = db.prepare('SELECT COUNT(*) as n FROM applications').get();
    const bySource = db.prepare(`
      SELECT source, COUNT(*) as n FROM applications GROUP BY source ORDER BY n DESC LIMIT 10
    `).all();
    const recent = db.prepare(`
      SELECT * FROM applications ORDER BY applied_at DESC LIMIT 5
    `).all();
    const logs = db.prepare('SELECT COUNT(*) as n FROM agent_log').get();
    return json(res, { counts, total: total.n, bySource, recent, logCount: logs.n });
  }

  // ─── Income streams ──────────────────────────────────────
  if (urlPath === '/api/income' && req.method === 'GET') {
    return json(res, db.prepare('SELECT * FROM income_streams ORDER BY monthly_usd DESC').all());
  }
  if (urlPath === '/api/income' && req.method === 'POST') {
    const d = await body(req);
    const r = db.prepare(`
      INSERT INTO income_streams (name,type,status,monthly_usd,notes)
      VALUES (@name,@type,@status,@monthly_usd,@notes)
    `).run({ name: d.name || '?', type: d.type || 'freelance', status: d.status || 'active', monthly_usd: d.monthly_usd || 0, notes: d.notes || '' });
    return json(res, { id: r.lastInsertRowid });
  }
  if (urlPath.startsWith('/api/income/') && req.method === 'PATCH') {
    const id = parseInt(urlPath.split('/').pop());
    const d = await body(req);
    const fields = Object.keys(d).map(k => `${k}=@${k}`).join(',');
    db.prepare(`UPDATE income_streams SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...d, id });
    return json(res, { ok: true });
  }

  // ─── Monetize AI Analysis ─────────────────────────────────
  if (urlPath === '/api/monetize-analyze' && req.method === 'POST') {
    const GROQ_KEY = process.env.GROQ_API_KEY || '';
    if (!GROQ_KEY) return json(res, { error: 'No GROQ_API_KEY' }, 500);

    // Gather DB context
    const sources = db.prepare('SELECT source, COUNT(*) as n FROM applications GROUP BY source ORDER BY n DESC').all();
    const easyPlatforms = db.prepare("SELECT company, title, url, notes FROM applications WHERE platform IN ('ai-training','easy','niche') OR source='OpenFangScout' ORDER BY id DESC LIMIT 30").all();
    const recentLogs = db.prepare("SELECT action, detail FROM agent_log ORDER BY created_at DESC LIMIT 20").all();
    const stats = db.prepare("SELECT status, COUNT(*) as n FROM applications GROUP BY status").all();

    const context = `
Current job DB stats: ${JSON.stringify(stats)}
Sources found: ${JSON.stringify(sources.slice(0, 15))}
Recent agent activity: ${JSON.stringify(recentLogs.slice(0, 10))}
Easy/non-dev platforms found: ${JSON.stringify(easyPlatforms.slice(0, 15))}
User profile: ${process.env.PROFILE_TEXT || 'developer available for remote work'}. Target: ${process.env.SALARY_TARGET || '$2,500/mo'} remote.
Current date: ${new Date().toISOString().slice(0,10)}
    `.trim();

    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 3000,
          messages: [{
            role: 'system',
            content: `You are a monetization strategist and automation architect. Analyze the user's job hunting data and create a concrete E2E income plan. Be brutally honest and practical. Focus on what can generate $2500+/month FAST.`
          }, {
            role: 'user',
            content: `Analyze this job hunting context and create a monetization plan:

${context}

Return JSON with this exact structure:
{
  "summary": "2-3 sentence honest assessment of current situation",
  "topOpportunities": [
    {"name": "...", "type": "immediate|short-term|passive", "estimatedMonthly": 1500, "effort": "low|medium|high", "automatable": true, "howToStart": "...", "url": "...", "daysToFirstPay": 7}
  ],
  "e2ePlan": [
    {"step": 1, "action": "...", "agent": "...", "automated": true, "priority": "urgent|high|medium"}
  ],
  "automationGaps": ["what is NOT automated yet that should be"],
  "weeklyTarget": {"income": 650, "breakdown": "..."},
  "immediateActions": ["action 1 you can do in next 2 hours", "action 2", "action 3"]
}`
          }]
        })
      });
      const d = await r.json();
      const raw = d.choices?.[0]?.message?.content || '';
      const match = raw.match(/\{[\s\S]*\}/);
      const plan = match ? JSON.parse(match[0]) : { error: 'Parse failed', raw: raw.slice(0, 500) };
      logAgent('MonetizeAI', 'analysis_done', JSON.stringify(plan.summary || '').slice(0, 200));
      return json(res, { ok: true, plan, context: { sources: sources.slice(0, 10), stats } });
    } catch (e) {
      logAgent('MonetizeAI', 'error', e.message, 'error');
      return json(res, { error: e.message }, 500);
    }
  }

  // ─── Research history ─────────────────────────────────────
  if (urlPath === '/api/research-history' && req.method === 'GET') {
    const entries = db.prepare(`
      SELECT agent, action, detail, status, created_at
      FROM agent_log
      WHERE agent IN ('SiftlyAnalyst','OpenFangOrchestrator','OpenFangScout')
        AND action IN ('analysis','action_plan','plan','research_response','scout_complete')
      ORDER BY id DESC LIMIT 20
    `).all();
    return json(res, { entries });
  }

  // ─── Research analyze (Siftly → analyst → orchestrator) ───
  if (urlPath === '/api/research-analyze' && req.method === 'POST') {
    const GROQ_KEY = process.env.GROQ_API_KEY || '';
    if (!GROQ_KEY) return json(res, { error: 'No GROQ_API_KEY' }, 500);

    // Fetch bookmarks from Siftly (port 3000)
    const siftlyR = await fetch('http://localhost:3000/api/bookmarks?limit=200').catch(() => null);
    const siftlyD = siftlyR?.ok ? await siftlyR.json().catch(() => ({})) : {};
    const bookmarks = (siftlyD.bookmarks || []).slice(0, 60);
    const bookmarkList = bookmarks.length
      ? bookmarks.map(t => `${t.text?.slice(0, 100)} [${(t.categories || []).map(c => c.name).join(',')}]`).join('\n')
      : 'Siftly offline — using DB context only';

    const recentJobs = db.prepare("SELECT company, title, source FROM applications WHERE status='found' ORDER BY id DESC LIMIT 20").all();
    const stats = db.prepare("SELECT status, COUNT(*) as n FROM applications GROUP BY status").all();

    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 2000,
          messages: [{
            role: 'system',
            content: 'You are a research analyst for a React/Next.js developer in Argentina targeting remote work at $2500+/month. Analyze bookmarks and job data, return actionable JSON insights.'
          }, {
            role: 'user',
            content: `Bookmarks from Siftly (${bookmarks.length}):\n${bookmarkList}\n\nJob DB stats: ${JSON.stringify(stats)}\nRecent found jobs: ${JSON.stringify(recentJobs.slice(0,10))}\n\nReturn JSON:\n{\n  "keyTrends": ["..."],\n  "monetizationOpps": [{"idea":"...","effort":"low|mid|high","income":"$X/month","howTo":"..."}],\n  "quickWin": "One concrete action in next 48h",\n  "newAgentIdeas": [{"name":"...","purpose":"..."}]\n}`
          }]
        })
      });
      const d = await r.json();
      const raw = d.choices?.[0]?.message?.content || '';
      const match = raw.match(/\{[\s\S]*\}/);
      const analysis = match ? JSON.parse(match[0]) : { raw: raw.slice(0, 500) };
      db.prepare('INSERT INTO agent_log (agent,action,detail,status) VALUES (?,?,?,?)').run('SiftlyAnalyst', 'analysis', JSON.stringify(analysis).slice(0, 500), 'ok');
      return json(res, { ok: true, analysis: JSON.stringify(analysis), plan: analysis.quickWin || '' });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ─── Orchestrator plan ────────────────────────────────────
  if (urlPath === '/api/orchestrator-plan' && req.method === 'POST') {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return json(res, { error: 'No GROQ_API_KEY set' }, 503);
    try {
      const stats  = db.prepare('SELECT status, COUNT(*) as n FROM applications GROUP BY status').all();
      const recent = db.prepare("SELECT company, title FROM applications WHERE status='found' ORDER BY id DESC LIMIT 8").all();
      const lastAnalysis = db.prepare("SELECT detail FROM agent_log WHERE agent='SiftlyAnalyst' ORDER BY id DESC LIMIT 1").get();
      const name   = `${process.env.FIRST_NAME || ''} ${process.env.LAST_NAME || ''}`.trim() || 'the user';
      const target = process.env.SALARY_TARGET || '$2,500/mo';

      const task = `You are managing a job hunting + income automation system for ${name} (target: ${target} remote).

Current state:
- DB: ${stats.map(s => `${s.status}:${s.n}`).join(', ')}
- Recent finds: ${recent.map(r => `${r.company}:${r.title}`).slice(0,5).join(' | ')}
- Latest research: ${lastAnalysis?.detail?.slice(0,300) || 'none'}

Create a CONCRETE 3-step action plan for the next 2 hours:
1. Which specific platform to register/apply TODAY for fastest income
2. Which 3 specific jobs to apply to RIGHT NOW and why
3. What automation to fix first (most impactful)

Be brutally specific. No generic advice.`;

      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 1200,
          messages: [{ role: 'system', content: 'You are Senku, a job hunt orchestrator. Be specific, actionable, and blunt.' }, { role: 'user', content: task }]
        }),
        signal: AbortSignal.timeout(30000),
      });
      const d = await r.json();
      const plan = d.choices?.[0]?.message?.content || 'No plan generated.';
      db.prepare('INSERT INTO agent_log (agent,action,detail,status) VALUES (?,?,?,?)').run('OpenFangOrchestrator', 'plan', plan.slice(0,500), 'ok');
      return json(res, { plan });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ─── Trigger hunt (runs scout-api.mjs) ───────────────────
  if (urlPath === '/api/hunt' && req.method === 'POST') {
    logAgent('Hunter', 'hunt_started', 'Buscando empleos en todas las fuentes...');
    const { exec: _exec } = require('child_process');
    _exec(`node scout-api.mjs`, { cwd: __serverDir, timeout: 120000 }, (err, stdout, stderr) => {
      const out = (stdout + stderr).replace(/\n/g, ' ').slice(0, 200);
      if (err) { logAgent('Hunter', 'hunt_error', err.message.slice(0, 100), 'error'); }
      else { logAgent('Hunter', 'hunt_done', out); broadcast('refresh', {}); }
    });
    return json(res, { ok: true, msg: 'Hunt started — buscando empleos...' });
  }

  // ─── CV Upload ────────────────────────────────────────────
  if (urlPath === '/api/cv/upload' && req.method === 'POST') {
    const data = await body(req);
    if (!data.dataBase64 || !data.fileName) return json(res, { error: 'missing data' }, 400);
    const cvDir = path.join(__serverDir, 'profiles');
    mkdirSync(cvDir, { recursive: true });
    const cvFilePath = path.join(cvDir, 'cv.pdf');
    try {
      const buf = Buffer.from(data.dataBase64, 'base64');
      writeFileSync(cvFilePath, buf);
      // Save CV_PATH to .env
      let existing = '';
      try { existing = readFileSync(ENV_PATH, 'utf8'); } catch {}
      const line = `CV_PATH=${cvFilePath}`;
      if (/^CV_PATH=.*/m.test(existing)) { existing = existing.replace(/^CV_PATH=.*/m, line); }
      else { existing += `\n${line}`; }
      writeFileSync(ENV_PATH, existing);
      process.env.CV_PATH = cvFilePath;
      logAgent('HuntDesk', 'cv_uploaded', cvFilePath);
      return json(res, { ok: true, path: cvFilePath });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🎯 HuntDesk running at http://localhost:${PORT}\n`);
  logAgent('HuntDesk', 'server_start', `Listening on :${PORT}`);
});

// ── Live activity poller ────────────────────────────────────────────────────
// Polls agent_log every 3s and pushes new entries to SSE clients
let lastLogId = db.prepare('SELECT MAX(id) as m FROM agent_log').get()?.m || 0;

setInterval(() => {
  if (sseClients.size === 0) return;
  const newEntries = db.prepare(
    'SELECT id, agent, action, detail, status, created_at FROM agent_log WHERE id > ? ORDER BY id ASC LIMIT 20'
  ).all(lastLogId);
  for (const entry of newEntries) {
    broadcast('agent_activity', {
      id: entry.id,
      agent: entry.agent,
      action: entry.action,
      detail: String(entry.detail || '').slice(0, 200),
      status: entry.status,
      ts: entry.created_at,
    });
    lastLogId = entry.id;
  }
  // Also push live stats when there are new entries
  if (newEntries.length > 0) {
    const stats   = db.prepare('SELECT status, COUNT(*) as n FROM applications GROUP BY status').all();
    const blocked = db.prepare("SELECT COUNT(*) as n FROM applications WHERE status='found' AND notes LIKE 'BLOCKED:%'").get()?.n || 0;
    broadcast('stats_update', { stats, blocked });
  }
}, 3000);
