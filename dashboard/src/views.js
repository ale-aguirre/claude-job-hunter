// views.js — Directory, Monetize, Plan, Research views

// ── Directory ─────────────────────────────────────────────────
function renderDirectory() {
  const DIR = [
    {
      region: '🌎 Americas (LATAM-friendly)',
      sites: [
        { name: 'Arc.dev', url: 'https://arc.dev/remote-jobs', pay: '$40–$120/hr', diff: 'easy', note: 'LATAM explicit. No interview until hired.' },
        { name: 'Torre.ai', url: 'https://torre.ai/jobs', pay: '$2k–$6k/mo', diff: 'easy', note: 'LATAM-first. Spanish OK. Apply in minutes.' },
        { name: 'GetOnBrd', url: 'https://www.getonbrd.com', pay: '$3k–$6k/mo', diff: 'easy', note: 'ARG/CL/CO/BR. Direct apply button.' },
        { name: 'Workana', url: 'https://www.workana.com/jobs?category=web-programming&language=es', pay: '$15–$60/hr', diff: 'easy', note: 'LATAM freelance. Bid-based, no interview.' },
        { name: 'BairesDev', url: 'https://www.bairesdev.com/careers/', pay: '$50–$100/hr', diff: 'medium', note: 'ARG company. Short tech assessment only.' },
        { name: 'Braintrust', url: 'https://app.usebraintrust.com/jobs/', pay: '$50–$150/hr', diff: 'easy', note: 'No middleman. Proposal form.' },
        { name: 'Remoto.works', url: 'https://remoto.works', pay: '$2k–$5k/mo', diff: 'easy', note: 'LATAM remote jobs. Direct apply.' },
        { name: 'RemoteJobs.lat', url: 'https://remotejobs.lat', pay: '$2k–$6k/mo', diff: 'easy', note: 'LATAM-specific board.' },
        { name: 'Jobgether', url: 'https://jobgether.com/?loc=latam', pay: '$3k–$8k/mo', diff: 'easy', note: 'Worldwide remote. Many LATAM postings.' },
        { name: 'NoDesk', url: 'https://nodesk.co/remote-jobs/', pay: '$3k–$8k/mo', diff: 'easy', note: 'Curated. Easy apply links.' },
      ]
    },
    {
      region: '🌍 Europe (Remote-OK)',
      sites: [
        { name: 'EuroRemote', url: 'https://euroremote.eu', pay: '€4k–€9k/mo', diff: 'easy', note: 'EU companies hiring worldwide remote.' },
        { name: 'Himalayas', url: 'https://himalayas.app/jobs/remote', pay: '$3k–$10k/mo', diff: 'easy', note: 'Worldwide remote. Direct apply links.' },
        { name: 'Remotive', url: 'https://remotive.com/remote-jobs/software-dev', pay: '$3k–$10k/mo', diff: 'easy', note: 'Worldwide. Many EU startups.' },
        { name: 'Remote.co', url: 'https://remote.co/remote-jobs/developer/', pay: '$4k–$10k/mo', diff: 'easy', note: 'Curated remote-first companies.' },
        { name: 'Working Nomads', url: 'https://www.workingnomads.com/remote-development-jobs', pay: '$3k–$9k/mo', diff: 'easy', note: 'Daily fresh listings. Easy apply.' },
        { name: 'Wellfound (AngelList)', url: 'https://wellfound.com/jobs?remote=true&role=frontend-engineer', pay: '$4k–$12k/mo', diff: 'easy', note: 'Startups. 1-click apply.' },
        { name: 'Otta', url: 'https://otta.com', pay: '£40k–£100k/yr', diff: 'easy', note: 'UK/EU startups. Form-based apply.' },
        { name: 'YunoJuno', url: 'https://www.yunojuno.com', pay: '£400–£700/day', diff: 'easy', note: 'UK freelance. No interview to join.' },
      ]
    },
    {
      region: '🌏 Asia-Pacific & Middle East',
      sites: [
        { name: 'JobStreet (APAC)', url: 'https://www.jobstreet.com/en/job-search/remote-developer-jobs/', pay: '$3k–$7k/mo', diff: 'easy', note: 'SG/MY/AU companies. Many hire remote worldwide.' },
        { name: 'Seek (Australia)', url: 'https://www.seek.com.au/remote-jobs/in-All-Australia', pay: 'AUD 80k–130k', diff: 'easy', note: 'Australian cos hire remote worldwide.' },
        { name: 'Honeypot (DE/NL)', url: 'https://app.honeypot.io', pay: '€60k–€110k', diff: 'easy', note: 'EU tech companies. Quick profile signup.' },
        { name: 'GulfTalent', url: 'https://www.gulftalent.com/jobs/remote', pay: '$3k–$8k/mo', diff: 'easy', note: 'UAE/Saudi remote-friendly tech roles.' },
        { name: 'Uplers', url: 'https://www.uplers.com/talent/', pay: '$25–$60/hr', diff: 'easy', note: 'Matches with US/AU companies. Form signup.' },
        { name: 'Proxify', url: 'https://career.proxify.io', pay: '$40–$80/hr', diff: 'medium', note: 'EU clients. 1h intro call only.' },
      ]
    },
    {
      region: '🌐 Global Platforms',
      sites: [
        { name: 'LinkedIn Jobs (Remote)', url: 'https://www.linkedin.com/jobs/search/?f_WT=2&keywords=react+developer', pay: 'varies', diff: 'easy', note: 'Easy Apply filter. Largest volume.' },
        { name: 'We Work Remotely', url: 'https://weworkremotely.com/categories/remote-programming-jobs', pay: '$4k–$12k/mo', diff: 'easy', note: 'Top remote job board. No registration.' },
        { name: 'Remote OK', url: 'https://remoteok.com/remote-react-jobs', pay: '$3k–$15k/mo', diff: 'easy', note: 'Direct email links. No registration needed.' },
        { name: 'HN Who is Hiring', url: 'https://news.ycombinator.com/item?id=47219668', pay: '$4k–$15k/mo', diff: 'easy', note: 'Monthly thread. Direct email to founders.' },
        { name: 'Toptal (skip)', url: '#', pay: '$60–$200/hr', diff: 'hard', note: '❌ Skip — multi-round technical interviews.' },
        { name: 'Andela', url: 'https://andela.com/talent/', pay: '$3k–$8k/mo', diff: 'easy', note: 'Talent marketplace. Quick assessment.' },
        { name: 'X-Team', url: 'https://x-team.com/join/', pay: '$4k–$8k/mo', diff: 'easy', note: 'Remote community. Simple application form.' },
        { name: 'Contra', url: 'https://contra.com/jobs?category=Engineering', pay: '$50–$150/hr', diff: 'easy', note: 'Freelance. 0% commission. Portfolio-based.' },
        { name: 'Gun.io (skip)', url: '#', pay: '$60–$120/hr', diff: 'hard', note: '❌ Skip — requires coding test.' },
        { name: 'CloudDevs', url: 'https://clouddevs.com/hire-developers/react/', pay: '$45–$80/hr', diff: 'easy', note: 'LATAM-focused. Quick 1h interview.' },
        { name: 'Deel Remote Jobs', url: 'https://www.deel.com/blog/remote-jobs/', pay: '$4k–$12k/mo', diff: 'easy', note: 'Companies using Deel are remote-first.' },
        { name: 'Ashby Job Board', url: 'https://jobs.ashbyhq.com', pay: '$5k–$15k/mo', diff: 'easy', note: 'Modern ATS. Many startups. Simple forms.' },
        { name: 'Greenhouse.io', url: 'https://boards.greenhouse.io', pay: '$5k–$15k/mo', diff: 'easy', note: 'Standard ATS. Common form fields.' },
        { name: 'Lever.co', url: 'https://jobs.lever.co', pay: '$5k–$15k/mo', diff: 'easy', note: 'ATS. Fast form submit.' },
      ]
    },
    {
      region: '💰 AI Training & Microtasks (Quick $)',
      sites: [
        { name: 'Outlier.ai', url: 'https://outlier.ai/for-contributors', pay: '$15–$30/hr', diff: 'easy', note: 'Code tasks. No interview. Pays weekly.' },
        { name: 'Scale AI (Remotasks)', url: 'https://remotasks.com', pay: '$10–$25/hr', diff: 'easy', note: 'AI data labeling. Instant start.' },
        { name: 'Invisible Technologies', url: 'https://www.invisible.email', pay: '$10–$20/hr', diff: 'easy', note: 'AI operations tasks. Remote.' },
        { name: 'DataAnnotation.tech', url: 'https://www.dataannotation.tech', pay: '$13–$25/hr', diff: 'easy', note: 'US-based tasks. Pays via Stripe.' },
        { name: 'Surge AI', url: 'https://www.surgehq.ai/join', pay: '$10–$20/hr', diff: 'easy', note: 'NLP/code review tasks.' },
        { name: 'Appen', url: 'https://connect.appen.com', pay: '$8–$20/hr', diff: 'easy', note: 'Worldwide. Many task types available.' },
      ]
    },
  ];

  const diffBadge = d => d === 'easy'
    ? `<span style="background:#052e16;color:var(--green);font-size:.65rem;padding:1px 6px;border-radius:4px;font-weight:700">${t('diff.easy')}</span>`
    : d === 'medium'
    ? `<span style="background:#451a03;color:var(--amber);font-size:.65rem;padding:1px 6px;border-radius:4px;font-weight:700">${t('diff.medium')}</span>`
    : `<span style="background:#2a0a0a;color:var(--red);font-size:.65rem;padding:1px 6px;border-radius:4px;font-weight:700">${t('diff.hard')}</span>`;

  document.getElementById('directoryView').innerHTML = `
    <div style="max-width:1100px">
      <h2 style="font-size:1rem;font-weight:700;margin-bottom:1.25rem;color:var(--text)">🌍 Remote Job Directory — Sorted Easy-First</h2>
      ${DIR.map(section => `
        <div style="margin-bottom:2rem">
          <div style="font-size:.8rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.75rem;border-bottom:1px solid var(--border);padding-bottom:.4rem">${section.region}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.6rem">
            ${section.sites.map(s => s.url === '#' ? `
              <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:.75rem;opacity:.4">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem">
                  <span style="font-weight:700;font-size:.82rem;color:var(--muted);text-decoration:line-through">${s.name}</span>
                  ${diffBadge(s.diff)}
                </div>
                <div style="font-size:.68rem;color:var(--muted)">${s.note}</div>
              </div>
            ` : `
              <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:.75rem;transition:border-color .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem">
                  <a href="${s.url}" target="_blank" style="font-weight:700;font-size:.82rem;color:var(--blue);text-decoration:none">${s.name} ↗</a>
                  ${diffBadge(s.diff)}
                  <span style="margin-left:auto;font-size:.72rem;color:var(--green);font-weight:600">${s.pay}</span>
                </div>
                <div style="font-size:.7rem;color:var(--muted);line-height:1.4">${s.note}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Monetize ──────────────────────────────────────────────────
let monetizeCache = null;

function renderMonetize() {
  const el = document.getElementById('monetizeView');
  el.innerHTML = `
<div style="max-width:960px;margin:0 auto;font-family:inherit">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
    <h2 style="font-size:1.1rem;font-weight:700;color:var(--text);margin:0">💰 Monetización — Análisis IA + Plan E2E</h2>
    <button id="analyzeBtn" onclick="runMonetizeAnalysis()" style="background:#f97316;color:#fff;border:none;border-radius:8px;padding:.5rem 1rem;font-size:.8rem;font-weight:600;cursor:pointer">
      🤖 Analizar con IA
    </button>
  </div>

  <!-- AI Analysis result -->
  <div id="monetizeAnalysis" style="margin-bottom:1.25rem">
    ${monetizeCache ? renderPlan(monetizeCache) : `
    <div style="background:var(--card);border:1px dashed var(--border);border-radius:10px;padding:2rem;text-align:center;color:var(--text-dim)">
      <div style="font-size:2rem;margin-bottom:.75rem">🤖</div>
      <div style="font-size:.9rem;margin-bottom:.5rem">Análisis IA pendiente</div>
      <div style="font-size:.78rem">Presiona "Analizar con IA" para que Groq analice tu DB, oportunidades encontradas y cree un plan E2E automático</div>
    </div>`}
  </div>

  <!-- Static pipeline -->
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem">
    <h3 style="color:#f97316;font-size:.9rem;margin:0 0 .75rem">🤖 Pipeline E2E Autónomo — Arquitectura Actual</h3>
    <div style="background:var(--bg);border-radius:8px;padding:1rem;font-family:monospace;font-size:.76rem;color:var(--text-dim);line-height:1.8">
[scout-api.mjs]       → Remotive+RemoteOK+Greenhouse+Lever+Groq (paralelo, sin browser)<br>
[openfang-scout.mjs]  → Groq: dev + AI gigs + NO-DEV + content + niche boards<br>
[agent-bookmarks.mjs] → Siftly :3000 → Groq filtra bookmarks job-relevant<br>
[agent-xreddit.mjs]   → Chrome mirror :9223 headless → X/Reddit hiring posts<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↓ DB: applications (found: 434)<br>
[apply-arc-cdp.mjs]   → Arc.dev headless (Chrome mirror :9223)<br>
[apply-batch.mjs]     → ATS forms + cold emails (solo emails VERIFICADOS)<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↓<br>
[daemon.mjs]          → loop cada 60min, launchd auto-start, PID activo<br>
[server.mjs :4242]    → dashboard SSE tiempo real
    </div>
  </div>
</div>`;
}

function renderPlan(data) {
  const p = data.plan;
  if (!p || p.error) return `<div style="background:var(--card);border:1px solid #ef4444;border-radius:10px;padding:1rem;color:#ef4444;font-size:.82rem">Error: ${p?.error || 'Unknown'}</div>`;

  const typeColor = { immediate: '#22c55e', 'short-term': '#3b82f6', passive: '#a855f7' };
  const effortColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  const prioColor = { urgent: '#ef4444', high: '#f97316', medium: '#3b82f6' };

  return `
  <!-- Summary -->
  <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid #f97316;border-radius:10px;padding:1.25rem;margin-bottom:1rem">
    <div style="font-size:.78rem;color:#f97316;font-weight:600;margin-bottom:.5rem">🧠 ANÁLISIS IA — ${new Date().toLocaleTimeString()}</div>
    <p style="color:var(--text);font-size:.85rem;margin:0;line-height:1.6">${p.summary || ''}</p>
    ${p.weeklyTarget ? `<div style="margin-top:.75rem;padding:.5rem .75rem;background:var(--bg);border-radius:6px;font-size:.78rem;color:#22c55e">
      🎯 Target semanal: <strong>$${p.weeklyTarget.income}</strong> — ${p.weeklyTarget.breakdown || ''}
    </div>` : ''}
  </div>

  <!-- Immediate actions -->
  ${p.immediateActions?.length ? `
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin-bottom:1rem">
    <h3 style="color:#ef4444;font-size:.85rem;margin:0 0 .75rem">⚡ Acciones INMEDIATAS (próximas 2hs)</h3>
    ${p.immediateActions.map((a,i) => `
      <div style="display:flex;gap:.75rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <span style="background:#ef4444;color:#fff;border-radius:50%;width:20px;height:20px;font-size:.7rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</span>
        <span style="color:var(--text);font-size:.82rem">${a}</span>
      </div>`).join('')}
  </div>` : ''}

  <!-- Top opportunities -->
  ${p.topOpportunities?.length ? `
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin-bottom:1rem">
    <h3 style="color:#22c55e;font-size:.85rem;margin:0 0 .75rem">💡 Top Oportunidades Identificadas</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      ${p.topOpportunities.map(o => `
        <a href="${o.url||'#'}" target="_blank" style="display:block;text-decoration:none;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.85rem;transition:border-color .2s" onmouseover="this.style.borderColor='#22c55e'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.4rem">
            <span style="font-weight:600;color:var(--text);font-size:.82rem">${o.name}</span>
            <span style="font-size:.7rem;padding:.15rem .4rem;border-radius:4px;background:${typeColor[o.type]||'#666'}22;color:${typeColor[o.type]||'#aaa'}">${o.type}</span>
          </div>
          <div style="color:#22c55e;font-size:.8rem;margin:.2rem 0">$${o.estimatedMonthly?.toLocaleString()||'?'}/mes</div>
          <div style="color:var(--text-dim);font-size:.74rem">${o.howToStart||''}</div>
          <div style="display:flex;gap:.5rem;margin-top:.4rem">
            <span style="font-size:.7rem;color:${effortColor[o.effort]||'#aaa'}">esfuerzo: ${o.effort||'?'}</span>
            ${o.daysToFirstPay ? `<span style="font-size:.7rem;color:var(--text-dim)">· ${o.daysToFirstPay}d primer pago</span>` : ''}
            ${o.automatable ? '<span style="font-size:.7rem;color:#3b82f6">· automatizable</span>' : ''}
          </div>
        </a>`).join('')}
    </div>
  </div>` : ''}

  <!-- E2E Plan steps -->
  ${p.e2ePlan?.length ? `
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin-bottom:1rem">
    <h3 style="color:#3b82f6;font-size:.85rem;margin:0 0 .75rem">🔁 Plan E2E Paso a Paso</h3>
    ${p.e2ePlan.map(s => `
      <div style="display:flex;gap:.75rem;padding:.6rem 0;border-bottom:1px solid var(--border);align-items:flex-start">
        <span style="font-size:.7rem;padding:.2rem .4rem;border-radius:4px;background:${prioColor[s.priority]||'#666'}22;color:${prioColor[s.priority]||'#aaa'};flex-shrink:0">${s.priority||'medium'}</span>
        <div style="flex:1">
          <div style="color:var(--text);font-size:.82rem;font-weight:500">${s.action||''}</div>
          <div style="color:var(--text-dim);font-size:.74rem;margin-top:.2rem">
            agente: ${s.agent||'manual'} · ${s.automated ? '🤖 automatizado' : '👤 manual'}
          </div>
        </div>
      </div>`).join('')}
  </div>` : ''}

  <!-- Automation gaps -->
  ${p.automationGaps?.length ? `
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:1.25rem">
    <h3 style="color:#f59e0b;font-size:.85rem;margin:0 0 .75rem">⚠️ Gaps de Automatización (pendiente)</h3>
    ${p.automationGaps.map(g => `<div style="color:var(--text-dim);font-size:.8rem;padding:.3rem 0;border-bottom:1px solid var(--border)">• ${g}</div>`).join('')}
  </div>` : ''}
  `;
}

async function runMonetizeAnalysis() {
  const btn = document.getElementById('analyzeBtn');
  const box = document.getElementById('monetizeAnalysis');
  btn.disabled = true;
  btn.textContent = '⏳ Analizando...';
  box.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:2rem;text-align:center;color:var(--text-dim)">
    <div style="font-size:.9rem">🤖 Groq analizando DB + oportunidades + generando plan E2E...</div>
  </div>`;

  try {
    const r = await fetch('/api/monetize-analyze', { method: 'POST' });
    const data = await r.json();
    monetizeCache = data;
    box.innerHTML = renderPlan(data);
  } catch(e) {
    box.innerHTML = `<div style="background:var(--card);border:1px solid #ef4444;border-radius:10px;padding:1rem;color:#ef4444;font-size:.82rem">Error: ${e.message}</div>`;
  }
  btn.disabled = false;
  btn.textContent = '🤖 Re-analizar';
}

// ── Research Tab ──────────────────────────────────────────────
let researchCache = null;

function renderResearch() {
  const el = document.getElementById('researchView');
  el.innerHTML = `
  <div style="display:flex;gap:.75rem;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap">
    <h2 style="font-size:1rem;font-weight:700;color:var(--text);margin:0">🔬 Investigación & Propuestas</h2>
    <button id="researchRunBtn" onclick="runResearch()" style="background:#8b5cf6;color:#fff;border:none;border-radius:8px;padding:.5rem 1rem;font-size:.8rem;font-weight:600;cursor:pointer">
      🤖 Analizar Siftly + Proponer
    </button>
    <button onclick="runOrchestratorPlan()" style="background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:.5rem 1rem;font-size:.8rem;font-weight:600;cursor:pointer">
      🗺 Plan Orquestador
    </button>
  </div>
  <div id="researchContent">
    ${researchCache ? renderResearchData(researchCache) : renderResearchHistory()}
  </div>`;
}

function renderResearchHistory() {
  return `<div style="background:var(--card);border-radius:10px;padding:1.25rem;border:1px solid var(--border)">
    <p style="color:var(--muted);font-size:.85rem;margin:0 0 .75rem">Últimos análisis del orquestador:</p>
    <div id="researchHistoryList" style="display:flex;flex-direction:column;gap:.75rem">
      <div style="color:var(--muted);font-size:.8rem">Cargando historial...</div>
    </div>
    <script>loadResearchHistory()<\/script>
  </div>`;
}

async function loadResearchHistory() {
  try {
    const r = await fetch('/api/research-history');
    const data = await r.json();
    const el = document.getElementById('researchHistoryList');
    if (!el) return;
    if (!data.entries?.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:.8rem">No hay análisis todavía. Haz clic en "Analizar Siftly".</div>';
      return;
    }
    el.innerHTML = data.entries.map(e => `
      <div style="background:var(--bg);border-radius:8px;padding:.875rem;border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
          <span style="font-size:.75rem;font-weight:600;color:${e.agent==='OpenFangOrchestrator'?'#f97316':e.agent==='SiftlyAnalyst'?'#8b5cf6':'#3b82f6'}">${e.agent} · ${e.action}</span>
          <span style="font-size:.7rem;color:var(--muted)">${new Date(e.created_at).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'})}</span>
        </div>
        <p style="font-size:.82rem;color:var(--text);margin:0;white-space:pre-wrap;line-height:1.5">${e.detail}</p>
      </div>`).join('');
  } catch {}
}

function renderResearchData(data) {
  const sections = [];
  if (data.analysis) {
    sections.push(`<div style="background:var(--card);border-radius:10px;padding:1.25rem;border:1px solid #8b5cf6;margin-bottom:1rem">
      <h3 style="font-size:.85rem;font-weight:700;color:#8b5cf6;margin:0 0 .75rem">📊 Análisis de Bookmarks (Siftly)</h3>
      <pre style="font-size:.78rem;color:var(--text);white-space:pre-wrap;line-height:1.5;margin:0">${data.analysis}</pre>
    </div>`);
  }
  if (data.plan) {
    sections.push(`<div style="background:var(--card);border-radius:10px;padding:1.25rem;border:1px solid #f97316;margin-bottom:1rem">
      <h3 style="font-size:.85rem;font-weight:700;color:#f97316;margin:0 0 .75rem">🗺 Plan del Orquestador</h3>
      <pre style="font-size:.78rem;color:var(--text);white-space:pre-wrap;line-height:1.5;margin:0">${data.plan}</pre>
    </div>`);
  }
  return sections.join('') || '<div style="color:var(--muted)">Sin datos</div>';
}

async function runResearch() {
  const btn = document.getElementById('researchRunBtn');
  btn.disabled = true; btn.textContent = '⏳ Analizando...';
  document.getElementById('researchContent').innerHTML = `
    <div style="background:var(--card);border-radius:10px;padding:1.5rem;text-align:center;border:1px solid var(--border)">
      <div style="font-size:1.5rem;margin-bottom:.5rem">🔬</div>
      <p style="color:var(--muted);font-size:.85rem">Analizando 1000+ bookmarks de Siftly con OpenFang analyst + orchestrator...<br>Esto puede tardar 2-3 minutos (deepseek-r1 local)</p>
    </div>`;
  try {
    const r = await fetch('/api/research-analyze', { method: 'POST' });
    const data = await r.json();
    researchCache = data;
    document.getElementById('researchContent').innerHTML = renderResearchData(data);
  } catch(e) {
    document.getElementById('researchContent').innerHTML = `<div style="background:var(--card);border:1px solid #ef4444;border-radius:10px;padding:1rem;color:#ef4444;font-size:.82rem">Error: ${e.message}</div>`;
  }
  btn.disabled = false; btn.textContent = '🤖 Re-analizar';
}

async function runOrchestratorPlan() {
  document.getElementById('researchContent').innerHTML = `
    <div style="background:var(--card);border-radius:10px;padding:1.5rem;text-align:center;border:1px solid var(--border)">
      <p style="color:var(--muted);font-size:.85rem">Generando plan de orquestador...</p>
    </div>`;
  try {
    const r = await fetch('/api/orchestrator-plan', { method: 'POST' });
    const data = await r.json();
    document.getElementById('researchContent').innerHTML = `
      <div style="background:var(--card);border-radius:10px;padding:1.25rem;border:1px solid #f97316">
        <h3 style="font-size:.85rem;font-weight:700;color:#f97316;margin:0 0 .75rem">🗺 Plan del Orquestador</h3>
        <pre style="font-size:.78rem;color:var(--text);white-space:pre-wrap;line-height:1.5;margin:0">${data.plan || data.error || 'Sin respuesta'}</pre>
      </div>`;
  } catch(e) {
    document.getElementById('researchContent').innerHTML = `<div style="color:#ef4444;font-size:.82rem">Error: ${e.message}</div>`;
  }
}

// ── Org Chart ─────────────────────────────────────────────────
const ORG_DATA = {
  commander: {
    key: 'OpenFangOrchestrator',
    name: 'Senku',
    anime: 'Dr. Stone',
    color: '#f97316',
    avatar: '/avatars/senku_v6.png',
    role: 'Orquestador General',
    model: 'Claude Haiku 4.5',
    status: 'active',
    directives: [
      'Controla el ciclo de 60 min (daemon.mjs)',
      'Lee stats de la DB y detecta patrones',
      'Genera plan de acción estratégico por ciclo',
      'Coordina y ordena ejecución de todos los agentes',
      'Reporta al usuario vía dashboard SSE',
    ],
    scripts: ['daemon.mjs', 'senku.mjs'],
  },

  // Intermediario entre Senku y las alas — audita que cada agente completó su tarea
  deputy: {
    key: 'QA-Audit',
    name: 'Nanami',
    anime: 'JJK',
    color: '#d4d4d8',
    avatar: '/avatars/nanami.png',
    role: 'QA & Control de Calidad',
    model: 'Claude Haiku 4.5',
    status: 'active',
    directives: [
      'Intercede entre Senku y cada ala del pipeline',
      'Verifica que cada agente completó su tarea real (no solo "corrió")',
      'Emite veredicto PASS / FAIL / WARNING por tarea',
      'Reporta a Senku para que ajuste el siguiente ciclo',
      'Audita integridad de la DB — detecta duplicados y gaps',
    ],
    scripts: ['nanami.mjs'],
  },

  wings: [
    {
      title: '🔍 Ala de Inteligencia',
      color: '#8b5cf6',
      agents: [
        {
          key: 'OpenFangScout',
          name: 'Fern',
          anime: 'Frieren',
          color: '#8b5cf6',
          avatar: '/avatars/fern.png',
          role: 'Scout & Aplicadora ATS',
          model: 'Groq llama-3.3-70b',
          status: 'active',
          directives: [
            'Consulta APIs: Remotive, RemoteOK, Greenhouse, Lever',
            'Rellena formularios ATS (Ashby, Lever, Greenhouse)',
            'Genera cover letters personalizadas con Groq',
            'Nunca inventa datos — solo info verificada',
          ],
          scripts: ['scout-api.mjs', 'apply-ats.mjs', 'apply-from-db.mjs'],
        },
        {
          key: 'SiftlyAnalyst',
          name: 'Erwin',
          anime: 'AoT',
          color: '#06b6d4',
          avatar: '/avatars/erwin.png',
          role: 'Analista de Tendencias & Research',
          model: 'Groq llama-3.3-70b',
          status: 'active',
          directives: [
            'Googlea tendencias: "best remote react jobs 2025", "top startups hiring"',
            'Monitorea GitHub Trending — descubre proyectos OSS con hiring activo',
            'Rastrea repos con "we\'re hiring" en README o issues',
            'Detecta qué tecnologías y empresas están creciendo en OSS',
            'Genera reporte estratégico de señales de mercado para Senku',
          ],
          scripts: ['agent-siftly-analyst.mjs'],
        },
      ],
    },
    {
      title: '📡 Ala Social',
      color: '#ec4899',
      agents: [
        {
          key: 'XRedditAgent',
          name: 'Kaguya',
          anime: 'Kaguya-sama',
          color: '#ec4899',
          avatar: '/avatars/kaguya.png',
          role: 'Scout Social — X & Reddit',
          model: 'Groq llama-3.1-8b (fast)',
          status: 'active',
          directives: [
            'Busca posts "we\'re hiring" en X.com via auth token real',
            'Monitorea subreddits r/forhire, r/remotejs',
            'Detecta señales de hiring para React/Next.js remote',
            'Max 2 queries en X por run — comportamiento humano',
          ],
          scripts: ['agent-xreddit.mjs'],
        },
        {
          key: 'BookmarksAgent',
          name: 'Rin',
          anime: 'Blue Lock',
          color: '#a78bfa',
          avatar: '/avatars/rin.png',
          role: 'Analista de Bookmarks',
          model: 'Groq llama-3.3-70b',
          status: 'active',
          directives: [
            'Lee los 1043 bookmarks de Siftly (AI&ML, DevTools, Startups)',
            'Filtra los relevantes para job hunting con Groq',
            'Identifica empresas y plataformas objetivo desde links',
            'Envía resultados a la DB para aplicación',
          ],
          scripts: ['agent-bookmarks.mjs'],
        },
      ],
    },
    {
      title: '📤 Ala de Aplicación',
      color: '#f59e0b',
      agents: [
        {
          key: 'apply-batch',
          name: 'Reigen',
          anime: 'Mob Psycho',
          color: '#f59e0b',
          avatar: '/avatars/reigen.png',
          role: 'Apply & Cold Email',
          model: 'Groq llama-3.3-70b',
          status: 'active',
          directives: [
            'Aplica a jobs ATS directos y career pages',
            'Envía cold emails SOLO a contactos verificados',
            'Nunca inventa direcciones de email',
            'Personaliza cada email con Groq (max 160 palabras)',
          ],
          scripts: ['apply-ats.mjs', 'apply-from-db.mjs', 'apply-batch.mjs'],
          // Mob trabaja para Reigen — sin LLM, solo scripts
          subAgents: [
            {
              key: 'MobAgent',
              name: 'Mob',
              anime: 'Mob Psycho',
              color: '#7c3aed',
              avatar: '/avatars/mob_v2.png',
              role: 'Registro & Verificación',
              model: 'Sin LLM — flujos secuenciales',
              status: 'active',
              directives: [
                'Reigen ordena → Mob registra → Reigen aplica',
                'Registra en plataformas: Wellfound, Himalayas, Torre, GetOnBrd',
                'Va a Gmail :9223, encuentra verificación y hace click',
                'Marca jobs MOB_REGISTERED para que Reigen proceda',
              ],
              scripts: ['agent-mob.mjs'],
            },
          ],
        },
      ],
    },
  ],
};

function orgNodeHTML(agent, isCommander = false) {
  const cls = isCommander ? 'org-node commander' : 'org-node';
  const statusColor = agent.status === 'active' ? '#22c55e' : agent.status === 'planned' ? '#3b82f6' : '#6b7280';
  const avatarHtml = agent.avatar
    ? `<img class="org-node-avatar" src="${agent.avatar}" style="border-color:${agent.color}55"
        onerror="this.outerHTML='<div class=\\'org-node-letter\\' style=\\'background:${agent.color}18;border:2px solid ${agent.color}44;color:${agent.color}\\'>${agent.name[0]}</div>'">`
    : `<div class="org-node-letter" style="background:${agent.color}18;border:2px solid ${agent.color}44;color:${agent.color}">${agent.name[0]}</div>`;
  return `
    <div class="${cls}" style="border-color:${agent.color}44;--node-color:${agent.color}"
      onmouseover="this.style.borderColor='${agent.color}'" onmouseout="this.style.borderColor='${agent.color}44'"
      onclick="openOrgDetail('${agent.key}')">
      ${avatarHtml}
      <div class="org-node-info">
        <div class="org-node-name" style="color:${agent.color}">${agent.name}
          <span style="font-size:.65rem;color:var(--muted);font-weight:400"> — ${agent.anime}</span>
        </div>
        <div class="org-node-role">${agent.role}</div>
        <div class="org-node-tags">
          <span class="org-node-model">${agent.model}</span>
          <span class="org-node-tag" style="background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}44">${agent.status}</span>
        </div>
      </div>
      <div class="org-node-status" style="background:${statusColor};box-shadow:0 0 6px ${statusColor}"></div>
    </div>`;
}

function orgSubNodeHTML(agent) {
  const statusColor = agent.status === 'active' ? '#22c55e' : '#3b82f6';
  const avatarHtml = agent.avatar
    ? `<img class="org-node-avatar" src="${agent.avatar}" style="border-color:${agent.color}55"
        onerror="this.outerHTML='<div class=\\'org-node-letter\\' style=\\'background:${agent.color}18;border:2px solid ${agent.color}44;color:${agent.color}\\'>${agent.name[0]}</div>'">`
    : `<div class="org-node-letter" style="background:${agent.color}18;border:2px solid ${agent.color}44;color:${agent.color}">${agent.name[0]}</div>`;
  return `
    <div class="org-sub-node" style="border-color:${agent.color}44"
      onmouseover="this.style.borderColor='${agent.color}'" onmouseout="this.style.borderColor='${agent.color}44'"
      onclick="openOrgDetail('${agent.key}')">
      ${avatarHtml}
      <div class="org-node-info">
        <div class="org-node-name" style="color:${agent.color};font-size:.78rem">${agent.name}
          <span style="font-size:.6rem;color:var(--muted);font-weight:400"> — ${agent.anime}</span>
        </div>
        <div class="org-node-role">${agent.role}</div>
        <div class="org-node-tags">
          <span class="org-node-model">${agent.model}</span>
          <span class="org-node-tag" style="background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}44">${agent.status}</span>
        </div>
      </div>
      <div class="org-node-status" style="background:${statusColor};box-shadow:0 0 6px ${statusColor}"></div>
    </div>`;
}

function renderOrgChart() {
  const el = document.getElementById('orgchartView');
  const c = ORG_DATA.commander;
  const d = ORG_DATA.deputy;
  el.innerHTML = `
    <div class="org-wrap">
      <div class="org-title">🏛 Organigrama — Pipeline de Agentes HuntDesk</div>

      <!-- Commander -->
      <div class="org-commander">
        ${orgNodeHTML(c, true)}
      </div>

      <!-- Connector to deputy -->
      <div class="org-connector-v"></div>

      <!-- Deputy: Nanami — intermediario QA entre Senku y las alas -->
      <div class="org-deputy">
        ${orgNodeHTML(d)}
        <div style="font-size:.55rem;color:var(--muted);text-align:center;margin-top:.3rem;letter-spacing:1px;text-transform:uppercase;opacity:.6">verifica cada ala</div>
      </div>

      <!-- Connector to wings -->
      <div class="org-connector-v"></div>
      <div class="org-connector-h"></div>

      <!-- Wings -->
      <div class="org-wings">
        ${ORG_DATA.wings.map(wing => `
          <div class="org-wing" style="border-color:${wing.color}33">
            <div class="org-wing-title" style="color:${wing.color}">${wing.title}</div>
            <div class="org-wing-nodes">
              ${wing.agents.map(a => `
                <div class="org-agent-block">
                  ${orgNodeHTML(a)}
                  ${a.subAgents?.length ? `
                    <div class="org-sub-connector"></div>
                    <div class="org-sub-agents">
                      ${a.subAgents.map(s => orgSubNodeHTML(s)).join('')}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Legend -->
      <div style="margin-top:1.5rem;display:flex;gap:1rem;flex-wrap:wrap;font-size:.65rem;color:var(--muted)">
        <span>🟢 Activo</span>
        <span>🔵 En desarrollo</span>
        <span>⚫ Pausado</span>
        <span style="margin-left:auto;opacity:.5">Clic en cada nodo para ver directives completas</span>
      </div>
    </div>
  `;
}

// Org detail modal — reutiliza agentProfileOverlay pero con datos de ORG_DATA
function openOrgDetail(key) {
  // Find in commander or wings
  let agent = null;
  if (ORG_DATA.commander.key === key) {
    agent = ORG_DATA.commander;
  } else {
    for (const wing of ORG_DATA.wings) {
      const found = wing.agents.find(a => a.key === key);
      if (found) { agent = found; break; }
    }
  }
  if (!agent) return openAgentProfile(key); // fallback

  const color = agent.color;
  const letter = agent.name[0];

  document.getElementById('apmAvatar').innerHTML = agent.avatar
    ? `<img class="apm-avatar-img" src="${agent.avatar}?v=${Date.now()}"
        style="border-color:${color}66;box-shadow:0 0 20px ${color}33"
        onerror="this.outerHTML='<div class=\\'apm-avatar-letter\\' style=\\'background:${color}18;border-color:${color}55;color:${color}\\'>${letter}</div>'">`
    : `<div class="apm-avatar-letter" style="background:${color}18;border-color:${color}55;color:${color}">${letter}</div>`;

  document.getElementById('apmName').innerHTML = `<span style="color:${color}">${agent.name}</span>`;
  document.getElementById('apmRole').textContent = agent.role;
  document.getElementById('apmAnime').textContent = agent.anime;
  document.getElementById('apmMeta').innerHTML = `
    <span class="apm-meta-chip" style="color:${color};border-color:${color}44;background:${color}11">🤖 ${agent.model}</span>
    <span class="apm-meta-chip" style="color:${agent.status==='active'?'var(--green)':'var(--blue)'};border-color:currentColor">${agent.status}</span>
  `;
  document.getElementById('apmSoul').textContent = '';

  // Directives as skills
  const directivesEl = document.getElementById('apmSkills').parentElement;
  directivesEl.querySelector('.cdm-label').textContent = 'Directivas';
  document.getElementById('apmSkills').innerHTML = agent.directives.map(d =>
    `<span class="apm-skill-tag" style="border-color:${color}33;color:var(--text)">${d}</span>`
  ).join('');

  document.getElementById('apmScripts').innerHTML = (agent.scripts || []).map(s =>
    `<div class="apm-script">${s}</div>`
  ).join('');

  document.getElementById('apmActivity').innerHTML = '<span style="color:var(--muted);font-size:.78rem">Cargando actividad...</span>';
  document.getElementById('apmStats').innerHTML = '';

  // Load live activity
  fetch(`${API}/log?limit=200`).then(r => r.json()).then(logs => {
    const agentKeys = Object.entries(AGENTS).filter(([,v]) => v.name === agent.name).map(([k]) => k);
    const relevant = logs.filter(l => agentKeys.includes(l.agent)).slice(0, 15);
    if (!relevant.length) {
      document.getElementById('apmActivity').innerHTML = '<span style="color:var(--muted);font-size:.78rem">Sin actividad reciente.</span>';
    } else {
      document.getElementById('apmActivity').innerHTML = relevant.map(l => {
        const ts = new Date(l.created_at + 'Z').toLocaleString('es-AR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        return `<div class="apm-activity-row">
          <span class="apm-activity-action" style="color:${l.status==='error'?'var(--red)':color}">${l.action}</span>
          <span class="apm-activity-detail">${(l.detail||'').slice(0,80)}</span>
          <span class="apm-activity-ts">${ts}</span>
        </div>`;
      }).join('');
    }
    const errors = relevant.filter(l => l.status === 'error').length;
    const applies = relevant.filter(l => l.action?.includes('submit') || l.action?.includes('applied')).length;
    document.getElementById('apmStats').innerHTML = `
      <div class="apm-stat"><div class="apm-stat-val" style="color:${color}">${relevant.length}</div><div class="apm-stat-lbl">Registros</div></div>
      <div class="apm-stat"><div class="apm-stat-val" style="color:var(--green)">${applies}</div><div class="apm-stat-lbl">Postulaciones</div></div>
      <div class="apm-stat"><div class="apm-stat-val" style="color:${errors?'var(--red)':'var(--muted)'}">${errors}</div><div class="apm-stat-lbl">Errores</div></div>
    `;
  }).catch(() => {});

  openModal('agentProfileOverlay');
}
