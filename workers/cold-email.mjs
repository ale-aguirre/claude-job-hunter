/**
 * cold-email.mjs — Izumi: Cold Outreach Agent
 * Lee leads de la DB con email real → Groq escribe pitch personalizado →
 * crea borradores en email_drafts → (--send) envía via Gmail SMTP
 *
 * Fuentes: xreddit, reddit, hackernews (posts de CTOs/founders con email)
 * Uso: node cold-email.mjs [--dry-run] [--send] [--limit=5]
 */
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { openDB, logDB } from './db-utils.mjs';
import nodemailer from 'nodemailer';

const db = openDB();
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GMAIL_USER = process.env.EMAIL || '';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');
const DO_SEND  = process.argv.includes('--send');
const LIMIT    = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '10');

const PROFILE_TEXT = process.env.PROFILE_TEXT || '';
const FIRST_NAME   = process.env.FIRST_NAME   || '';
const LAST_NAME    = process.env.LAST_NAME    || '';
const GITHUB       = process.env.GITHUB       || '';

const AGENT = 'Izumi';
const log = (action, detail, status = 'ok') => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}][izumi] ${detail}`);
  logDB(db, AGENT, action, detail, status);
};

// ─── Ensure email_drafts table ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS email_drafts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id      INTEGER,
    to_email    TEXT NOT NULL,
    subject     TEXT,
    body_text   TEXT,
    body_html   TEXT,
    status      TEXT DEFAULT 'pending',  -- pending | sent | skipped
    created_at  DATETIME DEFAULT (datetime('now')),
    sent_at     DATETIME
  )
`);

// ─── Pick leads with real emails not yet drafted ────────────────────────────
const EMAIL_RE = /email:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i;

const candidates = db.prepare(`
  SELECT a.id, a.company, a.title, a.url, a.platform, a.notes, a.source
  FROM applications a
  WHERE a.source IN ('xreddit','reddit','hackernews')
    AND a.notes LIKE '%email:%'
    AND a.status NOT IN ('applied','emailed','skipped')
    AND a.id NOT IN (SELECT app_id FROM email_drafts WHERE app_id IS NOT NULL)
  ORDER BY a.rowid DESC
  LIMIT ?
`).all(LIMIT);

// Dominios de job boards — no son emails directos de contratadores
const JOBBOARD_DOMAINS = [
  'weworkremotely.com','linkedin.com','indeed.com','glassdoor.com',
  'greenhouse.io','lever.co','ashbyhq.com','workable.com','bamboohr.com',
  'myworkdayjobs.com','jobs.com','ziprecruiter.com','monster.com',
];

// Filter to those with a parseable real email (not a job board)
const leads = candidates.map(r => {
  const m = (r.notes || '').match(EMAIL_RE);
  if (!m) return null;
  const email = m[1];
  const domain = email.split('@')[1]?.toLowerCase() || '';
  if (JOBBOARD_DOMAINS.some(jb => domain.includes(jb))) return null;
  return { ...r, email };
}).filter(Boolean);

log('start', `${leads.length} leads con email real (limit ${LIMIT})`);

if (leads.length === 0) {
  log('no_leads', 'No hay leads nuevos con email. Esperando próximo ciclo de Kaguya.', 'warn');
  db.close();
  process.exit(0);
}

// ─── Generate personalized pitch via Groq ───────────────────────────────────
async function generatePitch(lead) {
  if (!GROQ_KEY) return null;

  // Parse contact info from notes
  const posterMatch  = (lead.notes || '').match(/poster:\s*(?:u\/|@)?([^\s|]+)/);
  const platform     = lead.platform || lead.source || 'social';
  const poster       = posterMatch?.[1] || 'there';
  const jobContext   = `${lead.company} — ${lead.title} (${platform})`;

  const system = `You are ${FIRST_NAME} ${LAST_NAME}, writing a short cold outreach to someone who posted a developer job on Hacker News "Who is Hiring" thread.

Rules:
- 3 short paragraphs, NO subject line in the body
- Para 1: one sentence referencing their specific company/product (not generic)
- Para 2: one concrete project from the profile below that fits their stack or domain
- Para 3: soft ask — suggest a quick async exchange or share GitHub
- Read the job post carefully: DO NOT invent restrictions or misquote what they're building
- NO: "I noticed your post", "I would love to", "passionate about", "synergy"
- NO corporate speak, NO bullet points
- MUST end with: ${FIRST_NAME} | ${GMAIL_USER} | ${GITHUB}
- Max 160 words total`;

  const user = `Job context: ${jobContext}
Poster: ${poster}
Platform: ${platform}
Notes: ${(lead.notes || '').slice(0, 200)}

${FIRST_NAME}'s profile:
${PROFILE_TEXT}`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        temperature: 0.7,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    log('groq_error', e.message.slice(0, 80), 'warn');
    return null;
  }
}

function toHtml(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc.replace(/(https?:\/\/[^\s<,)"]+)/g, '<a href="$1" style="color:#1a73e8">$1</a>');
  const blocks = linked.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return `<div style="font-family:Georgia,serif;font-size:15px;color:#1a1a1a;max-width:560px;line-height:1.7">${blocks.map(b => `<p style="margin:0 0 16px">${b.replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
}

function makeSubject(lead) {
  // Subject fijo y claro — la personalización va en el cuerpo
  const notes = (lead.notes || '').toLowerCase();
  const compLow = (lead.company || '').toLowerCase();
  const isAi = compLow.includes('ai') || compLow.includes('prompt') || compLow.includes('agent')
    || notes.includes('llm') || notes.includes(' ai ') || notes.includes('agent');
  if (isAi) return `${FIRST_NAME} ${LAST_NAME} — AI Agent Developer (Claude API, TypeScript)`;
  return `${FIRST_NAME} ${LAST_NAME} — Full-Stack Developer (TypeScript, Next.js, Node.js)`;
}

// ─── Gmail SMTP transport ────────────────────────────────────────────────────
function makeTransport() {
  if (!GMAIL_USER || !GMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

// ─── Main loop ───────────────────────────────────────────────────────────────
let drafted = 0, sent = 0;
const transport = DO_SEND ? makeTransport() : null;

for (const lead of leads) {
  log('processing', `${lead.company} <${lead.email}>`);

  const body = await generatePitch(lead);
  if (!body || body.length < 50) {
    log('pitch_fail', `${lead.company}: no body generated`, 'warn');
    continue;
  }

  const subject  = makeSubject(lead);
  const bodyHtml = toHtml(body);

  // Save draft to DB
  const row = db.prepare(`
    INSERT INTO email_drafts (app_id, to_email, subject, body_text, body_html, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(lead.id, lead.email, subject, body, bodyHtml, DRY_RUN ? 'dry_run' : 'pending');

  log('draft_saved', `${lead.company} → ${lead.email} (draft #${row.lastInsertRowid})`);

  // Preview
  console.log(`\n── Draft #${row.lastInsertRowid} ──────────────────────────────`);
  console.log(`To: ${lead.email}`);
  console.log(`Subject: ${subject}`);
  console.log(`\n${body}\n`);

  drafted++;

  if (DO_SEND && transport && !DRY_RUN) {
    try {
      await transport.sendMail({
        from: `"${FIRST_NAME} ${LAST_NAME}" <${GMAIL_USER}>`,
        to: lead.email,
        subject,
        text: body,
        html: bodyHtml,
      });
      db.prepare("UPDATE email_drafts SET status='sent', sent_at=datetime('now') WHERE id=?")
        .run(row.lastInsertRowid);
      db.prepare("UPDATE applications SET status='emailed', notes=notes||' | cold_email_sent' WHERE id=?")
        .run(lead.id);
      log('sent', `${lead.email} — ${lead.company}`);
      sent++;
    } catch (e) {
      log('send_error', `${lead.email}: ${e.message.slice(0, 100)}`, 'error');
    }
    await new Promise(r => setTimeout(r, 4000));
  }
}

log('done', `${drafted} borradores | ${sent} enviados`);
console.log(`\nIzumi done: ${drafted} drafts | ${sent} sent`);
db.close();
process.exit(0);
