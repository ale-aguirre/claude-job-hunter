/**
 * agent-xreddit.mjs — Kaguya: Social Scout
 * Orden: 1. Siftly bookmarks (siempre primero) → 2. X.com via API auth → 3. Reddit JSON
 *
 * X.com: usa auth_token + ct0 real (de MCP settings) — sin Chrome, sin CDP.
 * Comportamiento humano: delays variables, máx 2 búsquedas por run, respeta rate limits.
 */
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { openDB, logDB, upsertJob } from './db-utils.mjs';
import { getBrowser } from './browser-utils.mjs';

const db          = openDB();
const GROQ_KEY    = process.env.GROQ_API_KEY     || '';
const SIFTLY_PORT = process.env.SIFTLY_PORT      || '3000';
const X_AUTH      = process.env.TWITTER_AUTH_TOKEN || '';
const X_CT0       = process.env.TWITTER_CT0        || '';
const SEARCH_TAGS = (process.env.SEARCH_TAGS || 'react,typescript').split(',').map(s => s.trim()).filter(Boolean);
const SEARCH_LOC  = process.env.SEARCH_LOCATION || 'remote';

// Max 3 X queries per run — más es ban-risk
// Default queries: 2 English + 1 Spanish/LATAM rotation
const _defaultXQueries = [
  ...SEARCH_TAGS.slice(0, 2).map(t => `hiring ${t} developer remote -is:retweet lang:en`),
  `contratando desarrollador ${SEARCH_TAGS[0] || 'react'} remoto -is:retweet lang:es`,
  `"hiring" "LATAM" "${SEARCH_TAGS[0] || 'react'}" developer -is:retweet`,
  `"looking for" "frontend" "remote" "apply" -is:retweet lang:en`,
];
const X_QUERIES = process.env.X_SEARCHES
  ? process.env.X_SEARCHES.split('|').map(s => s.trim()).filter(Boolean).slice(0, 3)
  : _defaultXQueries.slice(0, 3);

const SIFTLY_DB   = process.env.SIFTLY_DB_PATH ||
  `${process.env.HOME}/Downloads/Alexis/tools/Siftly/prisma/dev.db`;

const AGENT = 'XRedditAgent';
const log   = (action, detail, status = 'ok') => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}][kaguya] ${detail}`);
  logDB(db, AGENT, action, detail, status);
};

const upsert = (company, title, url, platform, notes) =>
  upsertJob(db, { company, title, url, source: 'xreddit', notes, platform });

// Delay humano: entre min y max segundos
const humanDelay = (minS, maxS) =>
  new Promise(r => setTimeout(r, (minS + Math.random() * (maxS - minS)) * 1000));

// Extraer info de trabajo con Groq
async function extractJobInfo(text, source) {
  if (!GROQ_KEY || text.length < 40) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 200,
        messages: [{
          role: 'system',
          content: 'Extract job info. ONLY use emails literally present in text. Return JSON: {company,role,email,applyUrl,salary,remote,relevant} where relevant=true only for tech/remote roles. If no real email, email=null.'
        }, { role: 'user', content: `Source: ${source}\n${text.slice(0, 600)}` }]
      })
    });
    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content || '';
    const m = raw.match(/\{[\s\S]*?\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

let totalSiftly = 0, totalX = 0, totalReddit = 0;

// ═══════════════════════════════════════════════════════════════════
// 1. SIFTLY BOOKMARKS — siempre primero, lee directo de SQLite
// Siftly guarda tweets (X bookmarks del usuario) con texto completo
// ═══════════════════════════════════════════════════════════════════
log('siftly_start', `Leyendo Siftly DB directo: ${SIFTLY_DB}`);
try {
  const { existsSync } = await import('fs');
  if (!existsSync(SIFTLY_DB)) throw new Error(`DB no encontrada: ${SIFTLY_DB}`);

  const siftlyDb = require('better-sqlite3')(SIFTLY_DB, { readonly: true });
  const tweets   = siftlyDb.prepare('SELECT tweetId, text, authorHandle, authorName FROM Bookmark').all();
  siftlyDb.close();
  log('siftly_fetched', `${tweets.length} tweets en Siftly DB`);

  const JOB_SIGNALS = [
    'we are hiring','looking for','open position','join us','apply now','job opening',
    'remote job','full-time','we need','is hiring','hiring now','job opportunity',
    'seeking a','seeking an','dm me','send resume','send cv','email us'
  ];

  const relevant = tweets
    .filter(t => {
      const text = (t.text || '').toLowerCase();
      return JOB_SIGNALS.some(s => text.includes(s));
    })
    .slice(0, 20); // cap — avoid 80+ sequential Groq calls per run

  log('siftly_relevant', `${relevant.length} tweets con señales de hiring (cap 20)`);

  for (const tweet of relevant) {
    const tweetUrl = `https://x.com/i/status/${tweet.tweetId}`;
    const info = await extractJobInfo(tweet.text, 'siftly-tweet');
    if (!info?.relevant) continue;
    const company = info?.company || tweet.authorName || tweet.authorHandle || 'X.com';
    const role    = info?.role    || tweet.text?.split('\n')[0]?.slice(0, 60) || 'Hiring Post';
    const notes   = [
      `Siftly tweet @${tweet.authorHandle}`,
      info.salary && `salary: ${info.salary}`,
      info.email  && `email: ${info.email}`,
      info.remote ? 'remote' : null,
    ].filter(Boolean).join(' | ');
    if (upsert(company, role, tweetUrl, 'siftly', notes)) {
      log('siftly_saved', `${company} — ${role}${info.email ? ' (email!)' : ''}`);
      totalSiftly++;
    }
  }
  log('siftly_done', `+${totalSiftly} nuevos de ${relevant.length} tweets relevantes`);
} catch (e) {
  // Error reportado a agent_log — Senku lo leerá en el próximo ciclo y puede ajustar
  log('siftly_error', `FALLO Siftly: ${e.message.slice(0, 120)}`, 'error');
  console.error(`[kaguya] ⚠️ Siftly DB no disponible: ${e.message.slice(0, 80)}`);
}

// ═══════════════════════════════════════════════════════════════════
// 2. X.COM — Playwright con sesión real (CDP mirror)
// La API interna /i/api/2/search fue bloqueada → usamos el browser real
// ═══════════════════════════════════════════════════════════════════
log('x_start', `Buscando en X.com vía browser (${X_QUERIES.length} queries)`);
try {
  const { page: xPage, close: closeX } = await getBrowser();

  for (const query of X_QUERIES) {
    await humanDelay(5, 10);
    try {
      const searchUrl = `https://x.com/search?q=${encodeURIComponent(query + ' -is:retweet lang:en')}&f=live`;
      await xPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await xPage.waitForTimeout(3000);

      // Check if logged in
      const loggedIn = await xPage.$('[data-testid="tweet"]').catch(() => null);
      if (!loggedIn) {
        log('x_not_logged_in', 'No session on X.com in Chrome mirror — skipping X search', 'warn');
        break;
      }

      // Scroll to load more tweets
      await xPage.evaluate(() => window.scrollBy(0, 800));
      await xPage.waitForTimeout(1500);

      // Extract tweet texts + URLs
      const tweets = await xPage.evaluate(() => {
        return [...document.querySelectorAll('[data-testid="tweet"]')].slice(0, 10).map(el => {
          const text = el.querySelector('[data-testid="tweetText"]')?.innerText || '';
          const links = [...el.querySelectorAll('a[href*="/status/"]')];
          const href = links[0]?.href || '';
          return { text, url: href };
        }).filter(t => t.text.length > 30 && t.url);
      });

      log('x_results', `"${query}": ${tweets.length} tweets found`);

      for (const tweet of tweets) {
        const info = await extractJobInfo(tweet.text, 'x.com');
        if (!info?.relevant) continue;
        const notes = [
          'X.com hiring post',
          info.salary && `salary: ${info.salary}`,
          info.email  && `email: ${info.email}`,
          info.remote ? 'remote' : null,
          `query: ${query}`,
        ].filter(Boolean).join(' | ');
        if (upsert(info.company || 'X.com Post', info.role || query, tweet.url, 'x.com', notes)) {
          log('x_saved', `${info.company} — ${info.role}${info.email ? ' (email!)' : ''}`);
          totalX++;
        }
      }
    } catch (e) {
      log('x_error', `"${query}": ${e.message.slice(0, 80)}`, 'warn');
    }
    if (X_QUERIES.indexOf(query) < X_QUERIES.length - 1) await humanDelay(8, 15);
  }

  await closeX();
} catch (e) {
  log('x_error', `Browser X search failed: ${e.message.slice(0, 80)}`, 'error');
}
log('x_done', `+${totalX} nuevos de X.com`);

// ═══════════════════════════════════════════════════════════════════
// 3. REDDIT — JSON API, sin sesión, respeta rate limits
// ═══════════════════════════════════════════════════════════════════
const REDDIT_SEARCHES = [
  { sub: 'r/forhire',     q: `${SEARCH_TAGS[0] || 'react'} developer remote` },
  { sub: 'r/remotejs',    q: 'hiring' },
  { sub: 'r/webdev',      q: 'hiring remote' },
  { sub: 'r/freelance',   q: `${SEARCH_TAGS[0] || 'react'} remote` },
  { sub: 'r/WorkOnline',  q: 'developer frontend' },
];

log('reddit_start', `Buscando en Reddit (${REDDIT_SEARCHES.length} subreddits)`);

for (const { sub, q } of REDDIT_SEARCHES) {
  await humanDelay(5, 10); // delay humano entre subreddits
  try {
    const url = `https://www.reddit.com/${sub}/search.json?q=${encodeURIComponent(q)}&sort=new&limit=10&restrict_sr=1`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'job-hunter-bot/1.0 (personal project)' },
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 429) { log('reddit_rate_limit', `Rate limit en ${sub}`, 'warn'); break; }
    if (!r.ok) { log('reddit_error', `${sub}: HTTP ${r.status}`, 'warn'); continue; }

    const data  = await r.json();
    const posts = data?.data?.children || [];
    log('reddit_results', `${sub}: ${posts.length} posts`);

    for (const { data: post } of posts) {
      if (!post.title) continue;
      const text = `${post.title}\n${(post.selftext || '').slice(0, 400)}`;
      const info = await extractJobInfo(text, sub);
      if (!info?.relevant) continue;

      const postUrl = `https://reddit.com${post.permalink}`;
      const notes   = [`Reddit ${sub}`, info.salary, info.email && `email: ${info.email}`].filter(Boolean).join(' | ');
      if (upsert(info.company || post.author, info.role || post.title?.slice(0, 60), postUrl, 'reddit', notes)) {
        log('reddit_saved', `${info.company} — ${info.role}`);
        totalReddit++;
      }
    }
  } catch (e) {
    log('reddit_error', e.message.slice(0, 80), 'warn');
  }
}

log('complete', `+${totalSiftly} siftly +${totalX} x.com +${totalReddit} reddit`);
console.log(`\n✅ Kaguya done: Siftly +${totalSiftly} | X +${totalX} | Reddit +${totalReddit}`);
db.close();
