/**
 * scout-api.mjs — Fast job scraper via public APIs (NO browser)
 *
 * Searches are driven by the user's REAL CV/profile via profile-extractor.mjs —
 * not hardcoded developer keywords. A salesperson gets sales jobs.
 * A programmer gets dev jobs. The system adapts to whoever is using it.
 *
 * Sources:
 *   Remote: Remotive, RemoteOK, Greenhouse, Lever, Himalayas, WeWorkRemotely,
 *           Contra, Torre, Arbeitnow, TheMuse, GetOnBrd, Jobicy, Groq LLM
 *   Local:  Bumeran (AR), Computrabajo (AR/LATAM), Workana (LATAM freelance)
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { getProfileKeywords } from './profile-extractor.mjs';

const require  = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db       = new Database(new URL('applications.db', import.meta.url).pathname);
const GROQ_KEY = process.env.GROQ_API_KEY || '';

// ─── Job preferences from .env ─────────────────────────────────────────────
const JOB_TYPE       = process.env.JOB_TYPE       || 'any';
const PREFER_EASY    = process.env.PREFER_EASY_JOBS === 'true';

// ─── Load profile keywords (dynamic from CV) ────────────────────────────────
console.log(`\n🌍 scout-api — Fast worldwide job scraping`);
console.log(`Time: ${new Date().toISOString()}`);

const profileKw = await getProfileKeywords();
const SEARCH_TAGS   = profileKw.searchTerms.slice(0, 20);
const EXCLUDE_TERMS = profileKw.excludeTerms || [];
const CITY          = profileKw.city || '';
const COUNTRY       = profileKw.country || 'ar';
const LOCAL_SEARCH  = profileKw.localSearch && !!CITY;

console.log(`Profile: ${profileKw.seniority} | Tags: ${SEARCH_TAGS.slice(0,5).join(',')}${CITY ? ` | City: ${CITY}` : ''}`);

// ─── Exclusion filters (configurable via .env) ─────────────────────────────
const EXCLUDE_REGIONS_DEFAULT = 'africa,nigeria,kenya,ghana,egypt,ethiopia,middle east,saudi arabia,uae,dubai,qatar,iran,iraq,pakistan,bangladesh';
const EXCLUDE_REGIONS = (process.env.EXCLUDE_REGIONS || EXCLUDE_REGIONS_DEFAULT)
  .split(',').map(r => r.trim().toLowerCase()).filter(Boolean);

// Custom search queries from .env (pipe-separated)
const CUSTOM_QUERIES = (process.env.SEARCH_QUERIES || '').split('|').map(q => q.trim()).filter(Boolean);

// Extra keywords from .env — user can add AI/agentic terms without CV regeneration
const EXTRA_KEYWORDS = (process.env.EXTRA_KEYWORDS || '').split(',').map(k => k.trim()).filter(Boolean);
const ALL_SEARCH_TERMS = [...new Set([...SEARCH_TAGS, ...EXTRA_KEYWORDS])];
if (EXTRA_KEYWORDS.length) console.log(`Extra keywords: ${EXTRA_KEYWORDS.join(', ')}`);

// Aggregator domains — never insert these (we scrape them directly via their APIs)
const AGGREGATOR_DOMAINS = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'monster.com'];

function isExcluded(text = '') {
  const t = text.toLowerCase();
  return EXCLUDE_REGIONS.some(r => t.includes(r))
    || EXCLUDE_TERMS.some(r => t.includes(r));
}

// Salary filter patterns — reject low-pay jobs (< $2000/month)
const LOW_SALARY_PATTERNS = [
  /\$\d{1,2}\/hr/i,                          // $8/hr, $15/hr (2-digit)
  /\$(?:1[0-9]{2}|[1-9][0-9]?)\s*per\s*hour/i, // $12 per hour, $150 per hour
  /INR|PKR|NGN/i,                            // Indian Rupees, Pakistani Rupees, Nigerian Naira
];

// Monthly salary cap — reject if explicit monthly figure < $2000
const LOW_MONTHLY_RE = /\$(\d[\d,]*)\s*(?:\/month|per month|\/mo\b)/i;

function hasLowSalary(text = '') {
  if (LOW_SALARY_PATTERNS.some(p => p.test(text))) return true;
  const monthMatch = LOW_MONTHLY_RE.exec(text);
  if (monthMatch) {
    const amount = parseInt(monthMatch[1].replace(/,/g, ''), 10);
    if (amount < 2000) return true;
  }
  return false;
}

function isRelevant(title = '', tags = [], notes = '') {
  const combined = `${title} ${tags.join(' ')} ${notes}`.toLowerCase();

  // Reject if low salary detected
  if (hasLowSalary(combined)) return false;

  // Accept if matches search terms
  return ALL_SEARCH_TERMS.some(k => combined.includes(k.toLowerCase()));
}

// ─── URL validator ─────────────────────────────────────────────────────────
async function validateUrl(url, timeout = 3000) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), timeout);
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    return r.status < 400;
  } catch { return false; }
}

// ─── DB helpers ────────────────────────────────────────────────────────────
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO applications (company,title,url,source,status,notes,platform,posted_at)
  VALUES (?,?,?,?,?,?,?,?)
`);
const updateStmt = db.prepare(`
  UPDATE applications SET notes=?, updated_at=datetime('now') WHERE url=? AND status='found'
`);

// Only block TRUE career homepages — ATS company pages + root /careers paths
// DO NOT block /careers/specific-job-title or /careers/job-123 — those are specific jobs
const CAREER_PAGE_PATTERNS = [
  /^https?:\/\/jobs\.ashbyhq\.com\/[^/]+\/?$/,      // Ashby company page (no specific job)
  /^https?:\/\/boards\.greenhouse\.io\/[^/]+\/?$/,   // Greenhouse company page
  /^https?:\/\/jobs\.lever\.co\/[^/]+\/?$/,          // Lever company page
  /\/careers\/?$/, /\/jobs\/?$/, /\/job-openings\/?$/, /\/openings\/?$/,
  /\/work-with-us\/?$/, /\/join-us\/?$/, /\/hiring\/?$/,
  /\/about\/careers\/?$/, /\/company\/careers\/?$/,
  // NOTE: removed /\/careers\/[^/]*\/?$/ — was blocking specific job URLs like /careers/react-developer-123
];
function isSpecificJobUrl(url) {
  return !CAREER_PAGE_PATTERNS.some(p => p.test(url));
}

function upsertJob(company, title, url, platform, notes, postedAt = null) {
  if (!url || !url.startsWith('http')) return false;
  if (!isSpecificJobUrl(url)) return false;
  // Block aggregator URLs — we scrape those directly via their APIs
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (AGGREGATOR_DOMAINS.some(d => host.includes(d))) return false;
  } catch { return false; }
  const ex = db.prepare('SELECT id,status FROM applications WHERE url=?').get(url);
  if (ex) {
    // Never revive dead/archived/applied/interview/offer jobs
    if (['dead', 'archived', 'applied', 'interview', 'offer'].includes(ex.status)) return false;
    if (ex.status !== 'applied') updateStmt.run(notes, url);
    return false;
  }
  insertStmt.run(company, title, url, 'API', 'found', notes, platform, postedAt);
  return true;
}

let totalNew = 0;

// ─── 1. REMOTIVE ────────────────────────────────────────────────────────────
async function scrapeRemotive() {
  const typeMap   = { 'full-time': 'full_time', 'contract': 'contract', 'freelance': 'freelance' };
  const typeParam = JOB_TYPE !== 'any' && typeMap[JOB_TYPE] ? `&job_types=${typeMap[JOB_TYPE]}` : '';
  let count = 0;
  for (const q of SEARCH_TAGS.slice(0, 6)) {
    try {
      const r = await fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50${typeParam}`);
      const d = await r.json();
      for (const job of (d.jobs || [])) {
        if (isExcluded(job.candidate_required_location) || isExcluded(job.company_name)) continue;
        const notes = [
          job.candidate_required_location && `Location: ${job.candidate_required_location}`,
          job.salary && `Salary: ${job.salary}`,
          job.job_type,
          `tags: ${(job.tags||[]).join(',')}`,
        ].filter(Boolean).join(' | ');
        if (!isRelevant(job.title, job.tags || [], notes)) continue;
        const postedAt = job.publication_date || job.created_at || null;
        if (upsertJob(job.company_name, job.title, job.url, 'remotive', notes, postedAt)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`  Remotive: +${count} new`);
  return count;
}

// ─── 2. REMOTEOK ────────────────────────────────────────────────────────────
async function scrapeRemoteOK() {
  let count = 0;
  try {
    const r = await fetch('https://remoteok.com/api', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await r.json();
    for (const job of data.filter(j => j && j.position && j.url)) {
      if (isExcluded(job.location || '')) continue;
      const notes = [job.location, job.salary_min && `$${job.salary_min}-${job.salary_max}`, `tags: ${(job.tags||[]).slice(0,5).join(',')}`].filter(Boolean).join(' | ');
      if (!isRelevant(job.position, job.tags || [], notes)) continue;
      if (JOB_TYPE !== 'any') {
        const tags = (job.tags || []).join(' ').toLowerCase();
        const wanted = { contract: ['contract'], freelance: ['freelance', 'contract'], 'full-time': ['full_time', 'fulltime'] }[JOB_TYPE] || [];
        if (wanted.length && !wanted.some(t => tags.includes(t))) continue;
      }
      const url = job.url.startsWith('http') ? job.url : `https://remoteok.com${job.url}`;
      const postedAt = job.date || null;
      if (upsertJob(job.company || 'Unknown', job.position, url, 'remoteok', notes, postedAt)) count++;
    }
  } catch { /* skip */ }
  console.log(`  RemoteOK: +${count} new`);
  return count;
}

// ─── 3. GREENHOUSE ──────────────────────────────────────────────────────────
// Large list of companies — filtered dynamically by isRelevant() based on the user's CV
const GREENHOUSE_BOARDS = [
  // Dev tools (frontend/fullstack roles frecuentes)
  'notion', 'figma', 'vercel', 'supabase', 'liveblocks', 'convex',
  'render', 'railway', 'stytch', 'workos',
  // Fintech/HR remote-friendly
  'plaid', 'deel', 'remote', 'oyster', 'gusto',
  // Dev platforms
  'gitlab', 'sentry', 'zapier', 'airtable', 'retool', 'webflow', 'framer',
  // LATAM-friendly
  'auth0', 'globant', 'mercadolibre',
  // AI companies (creciendo, contratan fullstack)
  'huggingface', 'cohere', 'runway',
];

async function scrapeGreenhouse() {
  let count = 0;
  for (const board of GREENHOUSE_BOARDS) {
    try {
      const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
      if (!r.ok) continue;
      const d = await r.json();
      for (const job of (d.jobs || [])) {
        const loc = (job.location?.name || '').toLowerCase();
        if (isExcluded(loc)) continue;
        // Accept: remote, anywhere, empty location, LATAM, or any location NOT in exclude list
        const isRemote = loc.includes('remote') || loc.includes('anywhere') || loc === '' || loc.includes('latam') || loc.includes('worldwide') || loc.includes('global');
        if (!isRemote && isExcluded(loc)) continue;
        if (!isRemote && loc && !loc.includes('us') && !loc.includes('america') && !loc.includes('europe')) continue;
        if (!isRelevant(job.title, [])) continue;
        const url   = `https://boards.greenhouse.io/${board}/jobs/${job.id}`;
        const notes = `Greenhouse/${board} | ${job.location?.name || 'Remote'}`;
        const postedAt = job.updated_at || null;
        if (upsertJob(board, job.title, url, 'greenhouse', notes, postedAt)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`  Greenhouse: +${count} new`);
  return count;
}

// ─── 4. ASHBY ───────────────────────────────────────────────────────────────
// Ashby is the ATS of choice for modern startups (especially LATAM-friendly remote ones)
// Only boards confirmed to have jobs via API (404s are skipped anyway but this keeps the list clean)
const ASHBY_BOARDS = [
  // Dev tools with React/TS roles
  'linear', 'plain', 'apify', 'infisical', 'neon', 'clerk',
  'raycast', 'convex-dev', 'checkly', 'modal', 'cursor',
  // Fintech/remote
  'ramp', 'deel', 'oyster', 'vanta', 'column',
  // Talent platforms (LATAM-friendly)
  'g2i', 'andela', 'braintrust',
  // AI companies
  'perplexity', 'openai', 'cognition', 'runway',
  // Others worth trying
  'inngest', 'trigger', 'highlight', 'june', 'statsig',
];

async function scrapeAshby() {
  let count = 0;
  for (const board of ASHBY_BOARDS) {
    try {
      const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${board}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!r.ok) continue;
      const d = await r.json();
      for (const job of (d.jobs || [])) {
        const ashbyLoc = (job.location || '').toLowerCase();
        const ashbyRemote = job.isRemote || ashbyLoc.includes('remote') || ashbyLoc.includes('anywhere') || ashbyLoc.includes('latam') || ashbyLoc.includes('worldwide') || !ashbyLoc;
        if (!ashbyRemote && isExcluded(ashbyLoc)) continue;
        if (isExcluded(job.location || '')) continue;
        if (!isRelevant(job.title, [])) continue;
        const url   = job.jobUrl || job.jobPostingUrl || `https://jobs.ashbyhq.com/${board}/${job.id}`;
        const notes = `Ashby/${board} | ${job.location || 'Remote'} | ${job.employmentType || ''}`;
        const postedAt = job.publishedAt || job.updatedAt || null;
        if (upsertJob(board, job.title, url, 'ashby', notes, postedAt)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`  Ashby: +${count} new`);
  return count;
}

// ─── 5. LEVER ───────────────────────────────────────────────────────────────
const LEVER_BOARDS = [
  'netlify', 'temporal', 'neon-1', 'inngest', 'trigger', 'qstash',
  'upstash', 'posthog', 'cal', 'infisical', 'dub', 'documenso',
  'astro', 'prisma', 'drizzle', 'neon', 'sanity',
  'resend', 'loops', 'plainapp',
];

async function scrapeLever() {
  let count = 0;
  for (const board of LEVER_BOARDS) {
    try {
      const r = await fetch(`https://api.lever.co/v0/postings/${board}?mode=json`);
      if (!r.ok) continue;
      const jobs = await r.json();
      for (const job of (Array.isArray(jobs) ? jobs : [])) {
        const loc = (job.categories?.location || job.workplaceType || '').toLowerCase();
        if (isExcluded(loc)) continue;
        const notes = `Lever/${board} | ${job.categories?.location || 'Remote'} | ${job.categories?.team || ''}`;
        if (!isRelevant(job.text || '', [], notes)) continue;
        const postedAt = job.createdAt ? new Date(job.createdAt).toISOString() : null;
        if (upsertJob(board, job.text, job.hostedUrl || `https://jobs.lever.co/${board}/${job.id}`, 'lever', notes, postedAt)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`  Lever: +${count} new`);
  return count;
}

// ─── 5. HIMALAYAS ───────────────────────────────────────────────────────────
async function scrapeHimalayas() {
  let count = 0;
  const searchQ = SEARCH_TAGS[0] || 'developer';
  try {
    const r = await fetch(`https://himalayas.app/jobs/rss?q=${encodeURIComponent(searchQ)}&remote=true`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const xml   = await r.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    for (const item of items.slice(0, 30)) {
      const title   = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || '';
      const link    = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const company = item.match(/<author>(.*?)<\/author>/)?.[1] || 'Unknown';
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || null;
      const postedAt = pubDate ? new Date(pubDate).toISOString() : null;
      if (!isRelevant(title, [])) continue;
      if (upsertJob(company, title, link, 'himalayas', 'Himalayas remote', postedAt)) count++;
    }
  } catch { /* skip */ }
  console.log(`  Himalayas: +${count} new`);
  return count;
}

// ─── 6. WE WORK REMOTELY ────────────────────────────────────────────────────
async function scrapeWeWorkRemotely() {
  let count = 0;
  // Map profile to WWR categories
  const isDevProfile = SEARCH_TAGS.some(t => ['developer','engineer','react','javascript','typescript','frontend','backend','fullstack','devops','qa'].some(k => t.includes(k)));
  const categories   = isDevProfile ? ['programming', 'full-stack'] : ['management-finance', 'customer-support', 'marketing-sales', 'executive'];
  for (const cat of categories) {
    try {
      const r = await fetch(`https://weworkremotely.com/categories/remote-${cat}-jobs.rss`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const xml   = await r.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 20)) {
        const title   = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || '';
        const link    = item.match(/<link>(.*?)<\/link>/)?.[2] || item.match(/<link>(.*?)<\/link>/)?.[1] || '';
        const company = item.match(/<region><!\[CDATA\[(.*?)\]\]>/)?.[1] || 'Unknown';
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || null;
        const postedAt = pubDate ? new Date(pubDate).toISOString() : null;
        if (!isRelevant(title, [])) continue;
        const url = link.startsWith('http') ? link : `https://weworkremotely.com${link}`;
        if (upsertJob(company, title, url, 'weworkremotely', 'WeWorkRemotely', postedAt)) count++;
      }
    } catch { /* skip */ }
  }
  console.log(`  WeWorkRemotely: +${count} new`);
  return count;
}

// ─── 7. CONTRA ──────────────────────────────────────────────────────────────
async function scrapeContra() {
  let count = 0;
  try {
    const r = await fetch('https://contra.com/sitemaps/hire-pages/1.xml', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml  = await r.text();
    const urls = [...xml.matchAll(/<loc>(https:\/\/contra\.com\/p\/[^<]+)<\/loc>/g)].map(m => m[1]);
    for (const url of urls.slice(0, 30)) {
      const title = url.split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (!isRelevant(title, [])) continue;
      if (upsertJob('Contra', title, url, 'contra', 'Contra | freelance')) count++;
    }
  } catch { /* skip */ }
  console.log(`  Contra: +${count} new`);
  return count;
}

// ─── 8. TORRE ───────────────────────────────────────────────────────────────
async function scrapeTorre() {
  let count = 0;
  const skills = SEARCH_TAGS.slice(0, 4).map(t =>
    t === 'nextjs' ? 'Next.js' : t === 'typescript' ? 'TypeScript' : t.charAt(0).toUpperCase() + t.slice(1)
  );
  for (const skill of skills) {
    try {
      const r = await fetch('https://search.torre.co/opportunities/_search/?language=en&size=15', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ and: [{ skill: { term: skill, experience: 'potential-to-develop' } }], size: 15 }),
      });
      if (!r.ok) continue;
      const d = await r.json();
      for (const job of (d.results || [])) {
        const title  = job.objective || '';
        const slug   = job.slug || '';
        const url    = slug ? `https://torre.co/jobs/${slug}` : '';
        if (!url || !isRelevant(title, [])) continue;
        const company = job.organizations?.[0]?.name || 'Torre';
        const notes   = `Torre | ${job.commitment || 'contract'} | ${job.remote ? 'remote' : 'on-site'} | LATAM`;
        if (upsertJob(company, title, url, 'torre', notes)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  Torre: +${count} new`);
  return count;
}

// ─── 9. ARBEITNOW ───────────────────────────────────────────────────────────
async function scrapeArbeitnow() {
  let count = 0;
  for (const q of SEARCH_TAGS.slice(0, 4).map(t => t.replace(/\s+/g, '+'))) {
    try {
      const r = await fetch(`https://www.arbeitnow.com/api/job-board-api?search=${encodeURIComponent(q)}&remote=true`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const d = await r.json();
      for (const job of (d.data || [])) {
        if (!isRelevant(job.title, job.tags || [])) continue;
        if (isExcluded(job.location || '')) continue;
        const notes = `Arbeitnow | ${job.job_types?.join(',') || ''} | ${job.location || 'Remote'}`;
        const postedAt = job.created_at || null;
        if (upsertJob(job.company_name || 'Unknown', job.title, job.url, 'arbeitnow', notes, postedAt)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`  Arbeitnow: +${count} new`);
  return count;
}

// ─── 10. THE MUSE ───────────────────────────────────────────────────────────
async function scrapeTheMuse() {
  let count = 0;
  try {
    const r = await fetch('https://www.themuse.com/api/public/jobs?level=Entry+Level&page=0', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { console.log(`  TheMuse: skip (${r.status})`); return 0; }
    const d = await r.json();
    for (const job of (d.results || [])) {
      const url = job.refs?.landing_page || '';
      if (!url) continue;
      const notes = `TheMuse | ${(job.locations || []).map(l => l.name).join(', ') || 'Remote'}`;
      if (!isRelevant(job.name || '', [], notes)) continue;
      if (upsertJob(job.company?.name || 'Unknown', job.name, url, 'themuse', notes)) count++;
    }
  } catch { /* skip */ }
  console.log(`  TheMuse: +${count} new`);
  return count;
}

// ─── 11. GETONBRD ───────────────────────────────────────────────────────────
async function scrapeGetOnBrd() {
  if (!PREFER_EASY) return 0;
  let count = 0;
  try {
    const r = await fetch('https://www.getonbrd.com/api/v0/categories/programming/jobs?per_page=20&remote=1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { console.log(`  GetOnBrd: skip (${r.status})`); return 0; }
    const d = await r.json();
    for (const job of (d.data || [])) {
      const attr    = job.attributes || {};
      const company = attr.company?.data?.attributes?.name || 'Unknown';
      const url   = attr.url || `https://www.getonbrd.com/jobs/${job.id}`;
      const notes = `GetOnBrd | ${attr.modality || ''} | ${attr.country || 'LATAM'}`;
      if (!isRelevant(attr.title || '', attr.tags || [], notes)) continue;
      if (upsertJob(company, attr.title, url, 'getonbrd', notes)) count++;
    }
  } catch { /* skip */ }
  console.log(`  GetOnBrd: +${count} new`);
  return count;
}

// ─── 12. JOBICY ─────────────────────────────────────────────────────────────
async function scrapeJobicy() {
  let count = 0;
  for (const tag of SEARCH_TAGS.slice(0, 3)) {
    try {
      const r = await fetch(`https://jobicy.com/api/v2/remote-jobs?count=30&tag=${encodeURIComponent(tag)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const d = await r.json();
      for (const job of (d.jobs || [])) {
        if (isExcluded(job.jobGeo || '')) continue;
        const url = job.url || '';
        if (!url || !url.startsWith('http')) continue;
        const notes = `Jobicy | ${job.jobType || ''} | ${job.jobGeo || 'Remote'}${job.annualSalaryMin ? ` | $${job.annualSalaryMin}-${job.annualSalaryMax}` : ''}`;
        if (!isRelevant(job.jobTitle || '', job.jobIndustry || [], notes)) continue;
        const postedAt = job.pubDate || null;
        if (upsertJob(job.companyName || 'Unknown', job.jobTitle, url, 'jobicy', notes, postedAt)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`  Jobicy: +${count} new`);
  return count;
}

// ─── 13. BUMERAN (Argentina) ─────────────────────────────────────────────────
// Argentina's biggest job portal — server-side rendered, scrapeable
async function scrapeBumeran() {
  let count = 0;
  const citySlug = CITY
    ? CITY.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/\s+/g, '-')
    : '';

  for (const kw of SEARCH_TAGS.slice(0, 4)) {
    const kwSlug = kw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const url    = citySlug
      ? `https://www.bumeran.com.ar/empleos-busqueda-${kwSlug}-en-${citySlug}.html`
      : `https://www.bumeran.com.ar/empleos-busqueda-${kwSlug}.html`;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (!r.ok) continue;
      const html = await r.text();

      // Try __NEXT_DATA__ (Bumeran uses Next.js)
      const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (ndMatch) {
        try {
          const nd   = JSON.parse(ndMatch[1]);
          const jobs = nd.props?.pageProps?.avisos
            || nd.props?.pageProps?.jobs
            || nd.props?.pageProps?.data?.avisos
            || [];
          for (const job of jobs) {
            const title   = job.titulo || job.title || '';
            const company = job.empresa?.denominacion || job.company || 'Unknown';
            const id      = job.id || job.idAviso;
            const slug    = (title).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50);
            const jobUrl  = id ? `https://www.bumeran.com.ar/aviso/${id}-${slug}.html` : '';
            if (!jobUrl || !isRelevant(title, [])) continue;
            if (isExcluded(title)) continue;
            const notes = `Bumeran | ${CITY || 'Argentina'} | ${job.modalidad || ''}`;
            if (upsertJob(company, title, jobUrl, 'bumeran', notes)) count++;
          }
        } catch { /* json parse error, try fallback */ }
      }

      // Fallback: extract /aviso/ URLs from raw HTML
      if (count === 0) {
        const jobUrls = [...new Set([...html.matchAll(/href="(https?:\/\/www\.bumeran\.com\.ar\/aviso\/[^"?#]+)"/g)].map(m => m[1]))];
        for (const jobUrl of jobUrls.slice(0, 20)) {
          const titleMatch = html.match(new RegExp(`href="${jobUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*([^<]{10,100})`));
          const title = titleMatch?.[1]?.trim() || jobUrl.split('/').pop().replace(/-/g, ' ').replace(/\.html$/, '');
          if (!isRelevant(title, [])) continue;
          if (upsertJob('Bumeran', title, jobUrl, 'bumeran', `Bumeran | ${CITY || 'Argentina'}`)) count++;
        }
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`  Bumeran${CITY ? ` (${CITY})` : ''}: +${count} new`);
  return count;
}

// ─── 14. COMPUTRABAJO (Argentina/LATAM) ──────────────────────────────────────
// Major LATAM job portal with city-level search
async function scrapeComputrabajo() {
  let count = 0;
  for (const kw of SEARCH_TAGS.slice(0, 4)) {
    const kwSlug = kw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const url    = CITY
      ? `https://www.computrabajo.com.ar/trabajo-de-${kwSlug}?l=${encodeURIComponent(CITY.toLowerCase())}`
      : `https://www.computrabajo.com.ar/trabajo-de-${kwSlug}`;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!r.ok) continue;
      const html = await r.text();

      // Extract job offer links: /oferta-de-trabajo/{slug}
      const jobUrls = [...new Set(
        [...html.matchAll(/href="(\/oferta-de-trabajo\/[^"?#]+)"/g)].map(m => `https://www.computrabajo.com.ar${m[1]}`)
      )].slice(0, 25);

      for (const jobUrl of jobUrls) {
        // Try to extract title from a title tag near the link
        const slug  = jobUrl.split('/').pop();
        const title = slug.replace(/-[a-z0-9]{6,}$/, '').replace(/-/g, ' ');
        if (!isRelevant(title, [])) continue;
        if (isExcluded(title)) continue;
        const notes = `Computrabajo | ${CITY || 'Argentina'} | ${JOB_TYPE || 'any'}`;
        if (upsertJob('Computrabajo', title, jobUrl, 'computrabajo', notes)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`  Computrabajo${CITY ? ` (${CITY})` : ''}: +${count} new`);
  return count;
}

// ─── 15. WORKANA (LATAM freelance) ───────────────────────────────────────────
async function scrapeWorkana() {
  let count = 0;
  for (const kw of SEARCH_TAGS.slice(0, 3)) {
    try {
      const r = await fetch(
        `https://www.workana.com/jobs?language=es&q=${encodeURIComponent(kw)}&remote=1`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,application/xhtml+xml' } }
      );
      if (!r.ok) continue;
      const html = await r.text();

      // Workana job URLs: /job/{id}-{slug}
      const jobUrls = [...new Set(
        [...html.matchAll(/href="(https?:\/\/www\.workana\.com\/job\/[^"?#]+)"/g)].map(m => m[1])
      )].slice(0, 20);

      for (const jobUrl of jobUrls) {
        const slug  = jobUrl.split('/').pop();
        const title = slug.replace(/-[a-z0-9]{6,}$/, '').replace(/-/g, ' ');
        if (!isRelevant(title, [])) continue;
        if (isExcluded(title)) continue;
        const notes = `Workana | freelance | LATAM`;
        if (upsertJob('Workana', title, jobUrl, 'workana', notes)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 600));
  }
  console.log(`  Workana: +${count} new`);
  return count;
}

// ─── 16. GROQ LLM — profile-aware local + niche boards ──────────────────────
async function scrapeViaGroq() {
  if (!GROQ_KEY) { console.log('  Groq: no key, skip'); return 0; }
  // Skip if already ran in last 20h (save token budget for apply/email agents)
  try {
    const lastRun = db.prepare(
      `SELECT created_at FROM agent_log WHERE agent='ScoutAPI' AND action='groq_done' ORDER BY id DESC LIMIT 1`
    ).get();
    if (lastRun) {
      const hrs = (Date.now() - new Date(lastRun.created_at + 'Z').getTime()) / 3600000;
      if (hrs < 20) { console.log(`  Groq: ran ${hrs.toFixed(1)}h ago — skipping (token budget)`); return 0; }
    }
  } catch {}

  const topRoles  = (profileKw.roles  || SEARCH_TAGS).slice(0, 3).join(', ');
  const topSkills = (profileKw.skills || SEARCH_TAGS).slice(0, 5).join(', ');
  const cityLine  = CITY ? `, located in ${CITY}, ${COUNTRY === 'ar' ? 'Argentina' : COUNTRY}` : '';

  const prompts = [
    {
      id: 'remote-boards',
      prompt: `List 10 remote job boards or platforms hiring for: ${topRoles} (skills: ${topSkills}). Include LATAM-friendly boards. For each: platform name, URL (jobs listing page), notes. Return JSON array: [{company, title, url, notes}]`,
    },
    {
      id: 'companies-hiring',
      prompt: `List 8 companies or startups currently hiring remotely for roles like: ${topRoles}${cityLine}. Include their careers/jobs page URL. Return JSON array: [{company, title, url, notes}]`,
    },
    // Add local search prompt only if city is set
    ...(CITY ? [{
      id: 'local-companies',
      prompt: `List 10 companies in ${CITY}${COUNTRY === 'ar' ? ', Argentina' : ''} that hire people with skills in: ${topSkills}. Include: consultoras, tech companies, startups. Include their careers page or main website URL. Return JSON array: [{company, title, url, notes}]`,
    }] : []),
  ];

  let count = 0;
  for (const p of prompts) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1500,
          messages: [
            { role: 'system', content: 'Job market researcher. Return valid JSON arrays only with real URLs.' },
            { role: 'user',   content: p.prompt }
          ]
        })
      });
      const d   = await r.json();
      const raw = d.choices?.[0]?.message?.content || '';
      const m   = raw.match(/\[[\s\S]*\]/);
      if (!m) continue;
      const items = JSON.parse(m[0]);
      for (const item of items) {
        const url = item.url || item.applyUrl;
        if (!url || !url.startsWith('http')) continue;
        if (!await validateUrl(url)) continue;
        const company = item.company || item.platform || 'Unknown';
        const title   = item.title   || item.type   || 'Remote Position';
        const notes   = [item.salary, item.location, item.notes, `groq:${p.id}`].filter(Boolean).join(' | ');
        if (upsertJob(company, title, url, `groq-${p.id}`, notes)) count++;
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`  Groq LLM: +${count} new`);
  try { db.prepare(`INSERT INTO agent_log (agent,action,detail,status) VALUES ('ScoutAPI','groq_done',?,?)`).run(`+${count} leads`, 'ok'); } catch {}
  return count;
}

// ─── 17. HACKERNEWS "Who is Hiring" ──────────────────────────────────────────
// Monthly thread on HN — fetch latest, parse comments for job postings
async function scrapeHNWhoIsHiring() {
  let count = 0;
  try {
    // Search for latest "Who is hiring" thread via Algolia HN API
    const searchUrl = 'https://hn.algolia.com/api/v1/search?query=%22Ask+HN%3A+Who+is+hiring%22&tags=ask_hn&hitsPerPage=1';
    const sr = await fetch(searchUrl);
    if (!sr.ok) { console.log('  HN Who is Hiring: search failed'); return 0; }
    const sd = await sr.json();
    const threadId = sd.hits?.[0]?.objectID;
    if (!threadId) { console.log('  HN Who is Hiring: no thread found'); return 0; }

    // Fetch thread comments via Firebase API
    const tr = await fetch(`https://hacker-news.firebaseio.com/v0/item/${threadId}.json`);
    if (!tr.ok) { console.log('  HN Who is Hiring: thread fetch failed'); return 0; }
    const thread = await tr.json();
    const kids = (thread.kids || []).slice(0, 80); // top 80 comments

    // Fetch each comment (batch of 10 for speed)
    for (let i = 0; i < kids.length; i += 10) {
      const batch = kids.slice(i, i + 10);
      const comments = await Promise.allSettled(
        batch.map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()))
      );

      for (const result of comments) {
        if (result.status !== 'fulfilled' || !result.value?.text) continue;
        const c = result.value;
        const text = c.text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        // Extract company name (usually first line: "Company | Location | Remote | ...")
        const firstLine = text.split('\n')[0] || text.slice(0, 200);
        const parts = firstLine.split('|').map(p => p.trim());
        const company = parts[0]?.slice(0, 60) || 'HN Company';

        // Check relevance
        if (!isRelevant(text.slice(0, 300), [])) continue;

        // Extract URL from comment
        const urlMatch = text.match(/https?:\/\/[^\s<"]+/);
        const jobUrl = urlMatch?.[0] || `https://news.ycombinator.com/item?id=${c.id}`;
        const title = parts.length > 1 ? parts.slice(0, 2).join(' - ').slice(0, 100) : `HN Job: ${company}`;
        const postedAt = c.time ? new Date(c.time * 1000).toISOString() : null;
        const notes = `HN Who is Hiring | ${parts.slice(1, 4).join(' | ').slice(0, 100)}`;

        if (upsertJob(company, title, jobUrl, 'hn-hiring', notes, postedAt)) count++;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) { console.log(`  HN Who is Hiring: error ${e.message?.slice(0,60)}`); }
  console.log(`  HN Who is Hiring: +${count} new`);
  return count;
}

// Google/Indeed/Career discovery moved to scout-browser.mjs (needs real browser, not fetch)

// ─── RUN ──────────────────────────────────────────────────────────────────
const results = await Promise.allSettled([
  scrapeRemotive(),
  scrapeRemoteOK(),
  scrapeWeWorkRemotely(),
  scrapeGreenhouse(),
  scrapeLever(),
  scrapeAshby(),
  scrapeHimalayas(),
  scrapeContra(),
  scrapeTorre(),
  scrapeArbeitnow(),
  scrapeTheMuse(),
  scrapeGetOnBrd(),
  scrapeJobicy(),
  scrapeWorkana(),
  // Local LATAM portals — always run (even without city, search nationally)
  scrapeBumeran(),
  scrapeComputrabajo(),
]);

// Sequential sources (rate-limited or heavier)
const hnCount   = await scrapeHNWhoIsHiring();
const groqCount = await scrapeViaGroq();

const total = results.reduce((s, r) => s + (r.value || 0), 0) + hnCount + groqCount;
console.log(`\n✅ scout-api done: +${total} new jobs`);

db.prepare('INSERT INTO agent_log (agent,action,detail,status) VALUES (?,?,?,?)').run(
  'ScoutAPI', 'scan_complete', `+${total} new jobs`, 'ok'
);
db.close();

if (process.send) process.send({ type: 'scout:done', newJobs: total });
