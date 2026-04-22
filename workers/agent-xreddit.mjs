/**
 * agent-xreddit.mjs — Kaguya: Social Scout
 * Orden: 1. X.com via API directa (tokens de Siftly DB) → 2. Reddit JSON
 *
 * X: usa auth_token + ct0 de Siftly DB — sin CDP, sin Playwright.
 * Extrae: company, role, authorHandle, email si existe en el post.
 * Reddit: r/forhire solo, posts < 7 días, con email de contacto.
 */
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { openDB, logDB, upsertJob } from './db-utils.mjs';
import { existsSync } from 'fs';

const db      = openDB();
const GROQ_KEY = process.env.GROQ_API_KEY || '';

const SIFTLY_DB = process.env.SIFTLY_DB_PATH ||
  `${process.env.HOME}/Downloads/Alexis/tools/Siftly/prisma/dev.db`;

// X Bearer — mismo que usa el web client de X (público)
const X_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const AGENT = 'XRedditAgent';
const log = (action, detail, status = 'ok') => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}][kaguya] ${detail}`);
  logDB(db, AGENT, action, detail, status);
};

const upsert = (company, title, url, platform, notes) =>
  upsertJob(db, { company, title, url, source: 'xreddit', notes, platform });

const humanDelay = (minS, maxS) =>
  new Promise(r => setTimeout(r, (minS + Math.random() * (maxS - minS)) * 1000));

// Strip HTML entities + tags (HN Algolia returns HTML-encoded text)
function stripHtml(html = '') {
  return html
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/gi, '$1') // expand links
    .replace(/<[^>]+>/g, ' ')                                      // remove tags
    .replace(/&#x2F;/gi, '/').replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x3A;/gi, ':')
    .replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ─── X query searches ──────────────────────────────────────────────────────
const X_QUERIES = process.env.X_SEARCHES
  ? process.env.X_SEARCHES.split('|').map(s => s.trim()).filter(Boolean).slice(0, 3)
  : [
    'hiring "ai agent" developer remote -is:retweet',
    'hiring "claude api" OR "mcp server" developer -is:retweet',
    '"looking for" "typescript" OR "nextjs" developer remote apply -is:retweet',
  ];

// ─── Extract job info via Groq ─────────────────────────────────────────────
async function extractJobInfo(text, source, authorHandle) {
  if (!GROQ_KEY || text.length < 30) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 200,
        messages: [{
          role: 'system',
          content: 'Extract job info from this social post. Return JSON only: {company,role,email,remote,relevant,contact_type} where relevant=true only if it\'s a REAL job offer (not "I\'m looking for work"), remote=true if remote/LATAM ok, contact_type="email"|"dm"|"link"|"unknown", email=null if not present in text.',
        }, { role: 'user', content: `Author: @${authorHandle}\nSource: ${source}\n${text.slice(0, 600)}` }],
      }),
    });
    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content || '';
    const m = raw.match(/\{[\s\S]*?\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

let totalX = 0, totalReddit = 0;

// ═══════════════════════════════════════════════════════════════════════
// 1. X.COM SEARCH — API directa con tokens de Siftly DB
// ═══════════════════════════════════════════════════════════════════════
log('x_start', `Buscando en X.com (${X_QUERIES.length} queries)`);

let xAuthToken = '', xCt0 = '';
try {
  if (existsSync(SIFTLY_DB)) {
    const siftlyDb = require('better-sqlite3')(SIFTLY_DB, { readonly: true });
    const authRow = siftlyDb.prepare("SELECT value FROM Setting WHERE key='x_auth_token'").get();
    const ct0Row  = siftlyDb.prepare("SELECT value FROM Setting WHERE key='x_ct0'").get();
    xAuthToken = authRow?.value || '';
    xCt0       = ct0Row?.value  || '';
    siftlyDb.close();
    if (xAuthToken) log('x_tokens_ok', 'Tokens de Siftly DB cargados');
  }
} catch (e) {
  log('x_tokens_error', e.message.slice(0, 80), 'warn');
}

if (xAuthToken && xCt0) {
  for (const query of X_QUERIES) {
    await humanDelay(3, 7);
    try {
      const url = `https://twitter.com/i/api/2/search/adaptive.json?q=${encodeURIComponent(query)}&count=20&tweet_mode=extended&f=live&result_type=recent`;
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${X_BEARER}`,
          'X-Csrf-Token': xCt0,
          Cookie: `auth_token=${xAuthToken}; ct0=${xCt0}`,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes',
          'X-Twitter-Client-Language': 'en',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://x.com/search',
          Accept: '*/*',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (r.status === 429) { log('x_rate_limit', 'Rate limit — esperando', 'warn'); await humanDelay(30, 60); continue; }
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        log('x_error', `${r.status} para "${query.slice(0,40)}" — ${body.slice(0,100)}`, 'warn');
        continue;
      }

      const data = await r.json();
      // adaptive.json devuelve tweets en globalObjects.tweets
      const tweetsMap = data?.globalObjects?.tweets || {};
      const usersMap  = data?.globalObjects?.users  || {};
      const tweets = Object.values(tweetsMap).map(t => ({
        ...t,
        user: usersMap[t.user_id_str] || {},
      }));
      log('x_results', `"${query.slice(0,40)}": ${tweets.length} tweets`);

      for (const tweet of tweets) {
        const text   = tweet.full_text || tweet.text || '';
        const handle   = tweet.user?.screen_name || '';
        const name     = tweet.user?.name || tweet.user?.name || '';
        const tweetId  = tweet.id_str || tweet.id;
        const tweetUrl = `https://x.com/${handle}/status/${tweetId}`;

        const info = await extractJobInfo(text, 'x.com', handle);
        if (!info?.relevant) continue;

        const notes = [
          `X.com @${handle}`,
          info.email   && `email: ${info.email}`,
          info.remote  && 'remote',
          `contact: ${info.contact_type || 'dm'}`,
          `poster: ${name}`,
        ].filter(Boolean).join(' | ');

        if (upsert(info.company || name || handle, info.role || query.slice(0, 60), tweetUrl, 'x_search', notes)) {
          log('x_saved', `${info.company || handle} — ${info.role} (contact: ${info.contact_type})`);
          totalX++;
        }
      }
    } catch (e) {
      log('x_error', `"${query.slice(0,40)}": ${e.message.slice(0, 80)}`, 'warn');
    }
  }
} else {
  log('x_skip', 'Sin tokens X — saltando búsqueda en X.com', 'warn');
}

log('x_done', `+${totalX} nuevos de X.com`);

// ═══════════════════════════════════════════════════════════════════════
// 2. REDDIT r/forhire — posts < 7 días con contacto
// ═══════════════════════════════════════════════════════════════════════
const WEEK_AGO = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;

const REDDIT_SEARCHES = [
  { sub: 'r/forhire',  q: 'hiring typescript OR nextjs OR "ai agent" OR "claude api"' },
  { sub: 'r/forhire',  q: 'hiring remote developer LATAM OR argentina' },
  { sub: 'r/remotejs', q: 'hiring' },
];

log('reddit_start', `Buscando en Reddit (${REDDIT_SEARCHES.length} queries)`);

for (const { sub, q } of REDDIT_SEARCHES) {
  await humanDelay(4, 8);
  try {
    const url = `https://www.reddit.com/${sub}/search.json?q=${encodeURIComponent(q)}&sort=new&limit=25&restrict_sr=1`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'job-hunter-bot/1.0 (personal project)' },
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 429) { log('reddit_rate_limit', `Rate limit en ${sub}`, 'warn'); break; }
    if (!r.ok) { log('reddit_error', `${sub}: HTTP ${r.status}`, 'warn'); continue; }

    const data  = await r.json();
    const posts = data?.data?.children || [];
    // solo posts recientes
    const fresh = posts.filter(p => (p.data?.created_utc || 0) > WEEK_AGO);
    log('reddit_results', `${sub}: ${posts.length} posts, ${fresh.length} recientes`);

    for (const { data: post } of fresh) {
      if (!post.title) continue;
      // Saltar posts de personas buscando trabajo (no empresas contratando)
      const titleLower = post.title.toLowerCase();
      if (titleLower.startsWith('[for hire]') || titleLower.startsWith('for hire:') ||
          titleLower.includes('looking for work') || titleLower.includes('looking for a job') ||
          titleLower.startsWith('[available]') || titleLower.includes('seeking employment')) continue;

      const text = `${post.title}\n${(post.selftext || '').slice(0, 500)}`;
      const info = await extractJobInfo(text, sub, post.author);

      // solo posts de empresas/CTOs contratando con email real
      if (!info?.relevant) continue;
      if (!info.email || info.email === 'null' || info.email === 'none') continue;

      const postUrl = `https://reddit.com${post.permalink}`;
      const notes = [
        `Reddit ${sub}`,
        info.email && `email: ${info.email}`,
        `poster: u/${post.author}`,
        `contact: ${info.contact_type || 'reddit'}`,
        post.created_utc && `posted: ${new Date(post.created_utc * 1000).toISOString().slice(0, 10)}`,
      ].filter(Boolean).join(' | ');

      if (upsert(info.company || post.author, info.role || post.title?.slice(0, 60), postUrl, 'reddit', notes)) {
        log('reddit_saved', `${info.company || post.author} — ${info.role || 'dev role'}${info.email ? ' (tiene email)' : ''}`);
        totalReddit++;
      }
    }
  } catch (e) {
    log('reddit_error', e.message.slice(0, 80), 'warn');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. HACKER NEWS "Who is Hiring" — thread mensual, emails reales de founders
// ═══════════════════════════════════════════════════════════════════════
let totalHN = 0;
log('hn_start', 'Buscando en HN Who is Hiring (thread mensual)');

try {
  // Buscar el thread más reciente de "Ask HN: Who is hiring"
  const searchUrl = `https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story,ask_hn&numericFilters=created_at_i>${Math.floor(Date.now()/1000) - 60*24*3600}`;
  const sr = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
  const sd = await sr.json();
  const thread = sd?.hits?.find(h => h.title?.toLowerCase().includes('who is hiring'));

  if (thread) {
    log('hn_thread', `Thread: ${thread.title} (${thread.objectID})`);
    // Obtener los comentarios del thread (son los hiring posts)
    const commentsUrl = `https://hn.algolia.com/api/v1/items/${thread.objectID}`;
    const cr = await fetch(commentsUrl, { signal: AbortSignal.timeout(15000) });
    const cd = await cr.json();
    const comments = cd?.children || [];
    log('hn_comments', `${comments.length} posts en el thread`);

    const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
    const TECH_KEYWORDS = ['typescript','javascript','node','react','nextjs','next.js',
      'ai','agent','llm','fullstack','full-stack','full stack','python','rust','go',
      'backend','frontend','engineer','developer','automation','playwright'];
    const SKIP_DOMAINS = ['gmail.com','yahoo.com','hotmail.com','proton.me','protonmail.com','outlook.com','icloud.com'];

    // Parse "Company (Location) — Role — Tech" from first line of HN post (deterministic, no Groq)
    function parseHnHeader(text) {
      const firstLine = text.split('\n')[0].slice(0, 200);
      // Pattern: "Company ... — Role"  or  "Company | Role"
      const dashParts = firstLine.split(/\s[—–-]{1,2}\s/);
      const pipeParts = firstLine.split(/\s\|\s/);
      const parts = dashParts.length >= 2 ? dashParts : pipeParts.length >= 2 ? pipeParts : null;
      if (!parts) return { company: null, role: null };
      // company is before first separator (strip location in parens)
      const company = parts[0].replace(/\s*\(.*?\)/g, '').trim().slice(0, 60);
      const role = parts[1]?.replace(/\s*\(.*?\)/g, '').trim().slice(0, 80) || null;
      return { company: company || null, role: role || null };
    }

    for (const comment of comments.slice(0, 200)) {
      const raw = comment.text || '';
      if (!raw || raw.length < 50) continue;
      const text = stripHtml(raw);
      const lower = text.toLowerCase();

      const emailMatch = text.match(emailRe);
      const email = emailMatch?.[0] || null;
      const emailDomain = email?.split('@')[1]?.toLowerCase() || '';
      const hasCorpEmail = email && !SKIP_DOMAINS.some(d => emailDomain === d);
      const hasTech = TECH_KEYWORDS.some(k => lower.includes(k));
      const isRemote = lower.includes('remote') || lower.includes('anywhere') || lower.includes('worldwide');

      // Fast path: email corporativo + tech keyword → parseo determinístico del header
      if (hasCorpEmail && hasTech) {
        const { company, role } = parseHnHeader(text);
        const hnUrl = `https://news.ycombinator.com/item?id=${comment.id}`;
        const notes = [
          'HN Who is Hiring',
          `email: ${email}`,
          `poster: ${comment.author}`,
          'contact: email',
          isRemote && 'remote',
        ].filter(Boolean).join(' | ');

        const finalCompany = company || comment.author;
        const finalRole    = role || 'dev role';
        if (upsert(finalCompany, finalRole, hnUrl, 'hackernews', notes)) {
          log('hn_saved', `${finalCompany} — ${finalRole} (${email})`);
          totalHN++;
        }
      }
    }
  } else {
    log('hn_no_thread', 'No se encontró thread de este mes aún', 'warn');
  }
} catch (e) {
  log('hn_error', e.message.slice(0, 80), 'warn');
}

log('complete', `+${totalX} x.com +${totalReddit} reddit +${totalHN} hn`);
console.log(`\nKaguya done: X +${totalX} | Reddit +${totalReddit} | HN +${totalHN}`);
db.close();
process.exit(0);
