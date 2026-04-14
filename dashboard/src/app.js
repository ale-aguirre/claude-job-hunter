// app.js — Core app: API, globals, SSE, load, render, actions, modals, toast, init

const API = 'http://localhost:4242/api';
const GOAL = 2500;
let allApps = [];
let allIncome = [];
let currentView = 'kanban';
let sse = null;
let _refreshTimer = null;
const debouncedLoadAll = () => { clearTimeout(_refreshTimer); _refreshTimer = setTimeout(loadAll, 5000); };

// ── SSE ───────────────────────────────────────────────────────
function connectSSE() {
  try {
    sse = new EventSource(`${API.replace('/api','')}/events`);
    sse.onopen = () => document.getElementById('liveDot').classList.add('on');
    sse.onerror = () => { document.getElementById('liveDot').classList.remove('on'); setTimeout(connectSSE, 4000); };
    sse.addEventListener('refresh', () => loadAll());
    sse.addEventListener('log', e => prependLog(JSON.parse(e.data), true));
    sse.addEventListener('agent_activity', e => prependLog(JSON.parse(e.data), true));
    sse.addEventListener('stats_update', e => {
      const d = JSON.parse(e.data);
      if (d.stats) {
        const m = {};
        d.stats.forEach(s => m[s.status] = s.n);
        if (m.found     !== undefined) document.getElementById('sFound').textContent     = m.found     || 0;
        if (m.applied   !== undefined) document.getElementById('sApplied').textContent   = m.applied   || 0;
        if (m.interview !== undefined) document.getElementById('sInterview').textContent = m.interview || 0;
        if (m.offer     !== undefined) document.getElementById('sOffer').textContent     = m.offer     || 0;
        if (m.rejected  !== undefined) document.getElementById('sRejected').textContent  = m.rejected  || 0;
        const total = d.stats.reduce((a, s) => a + s.n, 0);
        document.getElementById('tbTotal').textContent = total || 0;
        const applied = m.applied || 0;
        const interviews = (m.interview || 0) + (m.offer || 0);
        const rate = applied ? Math.round((interviews / applied) * 100) : 0;
        document.getElementById('sRate').textContent = applied ? `${rate}% (${interviews}/${applied})` : '—';
        // blocked viene del servidor — no hace falta un loadAll() para actualizarlo
        if (d.blocked !== undefined) document.getElementById('sBlocked').textContent = d.blocked || 0;
      }
    });
  } catch(e) {}
}

// ── Load ──────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [apps, stats, income, logs, config] = await Promise.all([
      fetch(`${API}/applications`).then(r => r.json()),
      fetch(`${API}/stats`).then(r => r.json()),
      fetch(`${API}/income`).then(r => r.json()),
      fetch(`${API}/log`).then(r => r.json()),
      fetch(`${API}/config`).then(r => r.json()),
    ]);
    allApps = apps;
    allIncome = income;
    renderStats(stats);
    renderIncome(income);
    renderView();
    renderLogs(logs);
    // Onboarding: show wizard on first visit if profile not configured
    const banner = document.getElementById('onboardingBanner');
    const needsSetup = !config.firstName || config.firstName === 'Your' || config.firstName === '';
    if (banner) banner.style.display = 'none'; // wizard replaces banner
    if (needsSetup && !sessionStorage.getItem('wizardDismissed')) {
      showWizard();
    }
  } catch(e) { console.warn('Load failed:', e.message); }
}

function renderStats(s) {
  const m = {};
  (s.counts || []).forEach(c => m[c.status] = c.n);
  document.getElementById('sFound').textContent     = m.found     || 0;
  document.getElementById('sApplied').textContent   = m.applied   || 0;
  document.getElementById('sInterview').textContent = m.interview || 0;
  document.getElementById('sOffer').textContent     = m.offer     || 0;
  document.getElementById('sRejected').textContent  = m.rejected  || 0;
  document.getElementById('tbTotal').textContent    = s.total     || 0;
  const blocked = allApps.filter(a => a.status === 'found' && a.notes && a.notes.startsWith('BLOCKED:')).length;
  document.getElementById('sBlocked').textContent = blocked || 0;
  const applied = m.applied || 0;
  const interviews = (m.interview || 0) + (m.offer || 0);
  const rate = applied ? Math.round((interviews / applied) * 100) : 0;
  document.getElementById('sRate').textContent = applied ? `${rate}% (${interviews}/${applied})` : '—';
}

function renderIncome(streams) {
  const total = streams.filter(s => s.status === 'active').reduce((a, s) => a + (s.monthly_usd || 0), 0);
  const pct = Math.min(100, (total / GOAL) * 100);
  document.getElementById('incomeAmt').textContent = `$${total.toLocaleString()}`;
  document.getElementById('incomeFill').style.width = pct + '%';
  document.getElementById('incomePct').textContent = `${Math.round(pct)}${t('goal.funded')}`;
  if (!streams.length) return;
  document.getElementById('incomeStreams').innerHTML = streams.map(s => `
    <span class="s-pill ${s.status}" title="${s.notes || ''}">${s.name}: $${s.monthly_usd}/mo</span>
  `).join('') + `<span class="s-pill target" onclick="openModal('incomeOverlay')" style="cursor:pointer">+ stream</span>`;
}

function renderLogs(logs) {
  renderAgentRoster(new Set()); // render idle state first
  if (!logs.length) return;
  const wrap = document.getElementById('logWrap');
  wrap.innerHTML = '';
  logs.slice(0, 80).forEach(l => prependLog({
    agent: l.agent, action: l.action, detail: l.detail,
    status: l.status, ts: l.created_at
  }));
}

// ── Views ─────────────────────────────────────────────────────
function switchTab(view, el) {
  currentView = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('kanbanView').style.display    = view === 'kanban'    ? 'flex'  : 'none';
  document.getElementById('listView').style.display      = view === 'list'      ? 'flex'  : 'none';
  document.getElementById('priorityView').style.display  = view === 'priority'  ? 'flex'  : 'none';
  document.getElementById('directoryView').style.display = view === 'directory' ? 'block' : 'none';
  document.getElementById('monetizeView').style.display  = view === 'monetize'  ? 'block' : 'none';
  document.getElementById('researchView').style.display  = view === 'research'  ? 'block' : 'none';
  const ov = document.getElementById('orgchartView');
  if (ov) ov.style.display = view === 'orgchart' ? 'block' : 'none';
  renderView();
}

function renderView() {
  if (currentView === 'kanban')         renderKanban();
  else if (currentView === 'list')      renderList();
  else if (currentView === 'priority')  renderPriority();
  else if (currentView === 'directory') renderDirectory();
  else if (currentView === 'monetize')  renderMonetize();
  else if (currentView === 'research')  renderResearch();
  else if (currentView === 'chat')      renderChatView?.();
  else if (currentView === 'orgchart')  renderOrgChart?.();
}

// ── Card Detail Modal ─────────────────────────────────────────
function openDetail(id) {
  const a = allApps.find(x => x.id === id);
  if (!a) return;

  const isBlocked = a.notes?.startsWith('BLOCKED:');
  const blockReason = isBlocked ? a.notes.replace(/^BLOCKED:\s*/i, '') : '';
  const daysAgo = a.applied_at
    ? Math.floor((Date.now() - new Date(a.applied_at + (a.applied_at.includes('Z') ? '' : 'Z'))) / 86400000)
    : null;
  const dateStr = daysAgo === 0 ? t('detail.today') : daysAgo === 1 ? t('detail.yesterday') : daysAgo != null ? `${daysAgo}d ago` : '—';
  const platformIcon = {'remotive':'🌐','remoteok':'🟠','greenhouse':'🌿','lever':'⚙️','ashby':'🔷','getonbrd':'🧡','wellfound':'🚀','arc.dev':'🔵','upwork':'🟢'}[(a.source||'').toLowerCase()] || '🏢';

  document.getElementById('cdmBadges').innerHTML =
    `<span class="badge badge-${isBlocked ? 'blocked' : a.status}">${isBlocked ? 'blocked' : a.status}</span>` +
    (a.source ? `<span class="badge" style="background:rgba(255,255,255,.07);color:var(--muted);border:1px solid var(--border)">${platformIcon} ${a.source}</span>` : '') +
    (a.easy_apply ? `<span class="badge" style="background:rgba(234,179,8,.1);color:#fde047;border:1px solid rgba(234,179,8,.3)">⚡ Easy Apply</span>` : '') +
    (a.platform ? `<span class="badge" style="background:rgba(6,182,212,.08);color:var(--cyan);border:1px solid rgba(6,182,212,.25)">${a.platform}</span>` : '');

  document.getElementById('cdmTitle').textContent = a.title || '—';
  document.getElementById('cdmCompany').innerHTML =
    `🏢 ${a.company || '—'}` + (a.location ? ` &nbsp;·&nbsp; 📍 ${a.location}` : ` &nbsp;·&nbsp; ${t('detail.remote')}`);

  document.getElementById('cdmMeta').innerHTML = [
    a.salary ? `<div class="cdm-meta-item"><span class="cdm-meta-label">${t('detail.salary')}</span><span class="cdm-meta-value" style="color:var(--green)">${a.salary}</span></div>` : '',
    `<div class="cdm-meta-item"><span class="cdm-meta-label">${t('detail.added')}</span><span class="cdm-meta-value">${dateStr}</span></div>`,
    a.url ? `<div class="cdm-meta-item" style="grid-column:1/-1"><span class="cdm-meta-label">URL</span><span class="cdm-meta-value" style="font-size:.75rem;word-break:break-all"><a href="${a.url}" target="_blank" style="color:var(--blue)">${a.url}</a></span></div>` : '',
  ].filter(Boolean).join('');

  const blockedEl = document.getElementById('cdmBlocked');
  if (isBlocked) { blockedEl.style.display=''; blockedEl.innerHTML=`⚠️ <strong>${t('detail.blocked')}</strong> ${blockReason}`; }
  else blockedEl.style.display='none';

  const notesSection = document.getElementById('cdmNotesSection');
  const cleanNotes = isBlocked ? '' : (a.notes||'').replace(/^DRY_RUN.*/i,'').trim();
  if (cleanNotes) {
    notesSection.style.display='';
    notesSection.querySelector('.cdm-label').textContent = t('detail.notes');
    document.getElementById('cdmNotes').textContent = cleanNotes;
  }
  else notesSection.style.display='none';

  const coverSection = document.getElementById('cdmCoverSection');
  if (a.cover_letter) {
    coverSection.style.display='';
    coverSection.querySelector('.cdm-label').textContent = t('detail.coverLetter');
    document.getElementById('cdmCover').textContent = a.cover_letter;
  }
  else coverSection.style.display='none';

  document.getElementById('cdmActions').innerHTML = [
    a.status!=='applied'   ? `<button class="a-btn a-btn-apply" onclick="markAs(${id},'applied');closeModal('detailOverlay')">${t('actions.markApplied')}</button>` : '',
    a.status!=='interview' ? `<button class="a-btn a-btn-int" onclick="markAs(${id},'interview');closeModal('detailOverlay')">${t('actions.markInterview')}</button>` : '',
    a.status!=='offer'     ? `<button class="a-btn a-btn-apply" onclick="markAs(${id},'offer');closeModal('detailOverlay')" style="background:var(--green)">${t('actions.markOffer')}</button>` : '',
    a.status!=='rejected'  ? `<button class="a-btn a-btn-del" onclick="markAs(${id},'rejected');closeModal('detailOverlay')">${t('actions.reject')}</button>` : '',
    `<button class="a-btn a-btn-del" onclick="delApp(${id});closeModal('detailOverlay')" style="opacity:.6">${t('actions.delete')}</button>`,
  ].join('');

  // Update static modal labels
  const openBtn = document.getElementById('cdmOpenBtn');
  openBtn.textContent = t('modal.open');
  openBtn.style.display = a.url ? '' : 'none';
  openBtn.onclick = () => window.open(a.url, '_blank');

  openModal('detailOverlay');
}

// ── Actions ───────────────────────────────────────────────────
async function markAs(id, status) {
  await fetch(`${API}/applications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const labels = {
    applied: t('toast.applied'),
    interview: t('toast.interview'),
    offer: t('toast.offer'),
    rejected: t('toast.rejected'),
  };
  toast(labels[status] || status, status === 'offer' ? 'ok' : '');
  loadAll();
}

async function delApp(id) {
  if (!confirm(t('toast.confirmDelete'))) return;
  await fetch(`${API}/applications/${id}`, { method: 'DELETE' });
  loadAll();
}

// ── Hunt ──────────────────────────────────────────────────────
async function triggerHunt() {
  const btn = document.getElementById('huntBtn');
  btn.classList.add('running');
  btn.textContent = t('hunt.running');
  try {
    await fetch(`${API}/hunt`, { method: 'POST' });
    toast(t('hunt.started'), 'ok');
  } catch(e) { toast(t('hunt.failed') + e.message, 'err'); }
  setTimeout(() => { btn.classList.remove('running'); btn.textContent = t('hunt.start'); }, 4000);
}

// ── Quick add ─────────────────────────────────────────────────
async function quickAdd() {
  const c = document.getElementById('qaC').value.trim();
  const tv = document.getElementById('qaT').value.trim();
  if (!c || !tv) { toast(t('toast.companyRequired'), 'err'); return; }
  const r = await fetch(`${API}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: c, title: tv,
      salary: document.getElementById('qaS').value.trim(),
      source: document.getElementById('qaSrc').value,
      url: document.getElementById('qaU').value.trim(),
      status: 'found',
    }),
  });
  const res = await r.json();
  if (res.duplicate) { toast(t('toast.alreadyTracked'), ''); return; }
  toast(`Added: ${tv} @ ${c}`, 'ok');
  ['qaC','qaT','qaS','qaU'].forEach(id => document.getElementById(id).value = '');
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('show'); }));

async function submitAdd() {
  const data = {
    company: document.getElementById('mC').value.trim(),
    title:   document.getElementById('mT').value.trim(),
    salary:  document.getElementById('mS').value.trim(),
    status:  document.getElementById('mSt').value,
    source:  document.getElementById('mSrc').value,
    location: document.getElementById('mL').value.trim(),
    url:     document.getElementById('mU').value.trim(),
    easy_apply: parseInt(document.getElementById('mE').value),
    notes:   document.getElementById('mN').value.trim(),
    cover_letter: document.getElementById('mCL').value.trim(),
  };
  if (!data.company || !data.title) { toast(t('toast.companyRequired'), 'err'); return; }
  await fetch(`${API}/applications`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  toast(`Added: ${data.title}`, 'ok');
  closeModal('addOverlay');
}

async function submitIncome() {
  const data = {
    name: document.getElementById('iN').value.trim(),
    type: document.getElementById('iT').value,
    status: document.getElementById('iSt').value,
    monthly_usd: parseFloat(document.getElementById('iA').value) || 0,
    notes: document.getElementById('iNotes').value.trim(),
  };
  if (!data.name) { toast(t('toast.nameRequired'), 'err'); return; }
  await fetch(`${API}/income`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
  toast(`Stream: ${data.name} +$${data.monthly_usd}/mo`, 'ok');
  closeModal('incomeOverlay');
  loadAll();
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Locked tabs ────────────────────────────────────────────────────────────────
function tabLocked() {
  toast('🔒 Próximamente — esta sección está en desarrollo', '');
}

// ── Export / Import ───────────────────────────────────────────
async function exportData() {
  try {
    const r = await fetch(`${API}/export`);
    if (!r.ok) { toast('Export failed', 'err'); return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `huntdesk-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    toast('Backup descargado', 'ok');
  } catch(e) { toast('Export error: ' + e.message, 'err'); }
}

async function importData(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const r = await fetch(`${API}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const res = await r.json();
    if (res.error) { toast('Import error: ' + res.error, 'err'); return; }
    toast(`Importado: ${res.imported || 0} aplicaciones`, 'ok');
    loadAll();
  } catch(e) { toast('Import error: ' + e.message, 'err'); }
  input.value = '';
}

// ── Activity SSE stream ────────────────────────────────────────
function connectActivityStream() {
  try {
    const es = new EventSource('http://localhost:4242/api/activity/stream');
    es.onerror = () => { es.close(); setTimeout(connectActivityStream, 5000); };
    es.onmessage = e => {
      if (e.data === 'connected') return;
      try {
        const logs = JSON.parse(e.data);
        if (!Array.isArray(logs)) return;
        const wrap = document.getElementById('logWrap');
        if (!wrap) return;
        wrap.innerHTML = '';
        logs.forEach(l => prependLog({ agent: l.agent, action: l.action, detail: l.detail, status: l.status, ts: l.created_at }));
        // Pulse indicator
        const pulse = document.getElementById('activityPulse');
        if (pulse) {
          const recent = logs[0] && (Date.now() - new Date(logs[0].created_at + 'Z').getTime()) < 30000;
          pulse.style.background = recent ? 'var(--green)' : '#6b7280';
        }
      } catch { /* skip */ }
    };
  } catch(e) {}
}

// ── Welcome Wizard ─────────────────────────────────────────────
let _wizStep = 1;
let _wizData = {};
let _wizCvB64 = null;
let _wizCvName = null;

function showWizard() {
  const overlay = document.getElementById('wizardOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _renderWizStep();
}

function hideWizard() {
  const overlay = document.getElementById('wizardOverlay');
  if (overlay) overlay.style.display = 'none';
  sessionStorage.setItem('wizardDismissed', '1');
}

function _renderWizStep() {
  const el = document.getElementById('wizardContent');
  if (!el) return;

  const stepLabels = ['Tu Perfil', 'Tu CV', 'Preferencias'];
  const dots = stepLabels.map((s, i) => {
    const n = i + 1;
    const active = n === _wizStep;
    const done = n < _wizStep;
    const col = done ? 'var(--green)' : active ? 'var(--accent)' : 'var(--border)';
    const bg = done ? 'rgba(34,197,94,.1)' : active ? 'rgba(124,58,237,.15)' : 'transparent';
    const txt = done ? 'var(--green)' : active ? 'var(--accent)' : 'var(--muted)';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:.3rem">
      <div style="width:28px;height:28px;border-radius:50%;border:2px solid ${col};background:${bg};display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:${txt}">${done?'✓':n}</div>
      <div style="font-size:.62rem;color:${active?'var(--text)':'var(--muted)'};white-space:nowrap">${s}</div>
    </div>`;
  }).join('<div style="flex:1;height:2px;background:var(--border);margin-bottom:1.15rem"></div>');

  let content = '';

  if (_wizStep === 1) {
    content = `
      <h2 style="margin:0 0 .3rem;font-size:1.35rem">👋 Bienvenido a HuntDesk</h2>
      <p style="color:var(--muted);font-size:.83rem;margin:0 0 1.5rem;line-height:1.5">Completá tu perfil para que los agentes puedan postularse en tu nombre de forma automática.</p>
      <div class="modal-grid">
        <div class="fld"><label>Nombre *</label><input id="w_fn" value="${_wizData.fn||''}" placeholder="Alexis"/></div>
        <div class="fld"><label>Apellido *</label><input id="w_ln" value="${_wizData.ln||''}" placeholder="Aguirre"/></div>
        <div class="fld"><label>Email *</label><input id="w_em" type="email" value="${_wizData.em||''}" placeholder="vos@gmail.com"/></div>
        <div class="fld"><label>Teléfono</label><input id="w_ph" value="${_wizData.ph||''}" placeholder="+54 9 351 000 0000"/></div>
        <div class="fld" style="grid-column:1/-1"><label>Ciudad, País</label><input id="w_ci" value="${_wizData.ci||''}" placeholder="Córdoba, Argentina"/></div>
      </div>`;
  } else if (_wizStep === 2) {
    content = `
      <h2 style="margin:0 0 .3rem;font-size:1.35rem">📄 Tu CV</h2>
      <p style="color:var(--muted);font-size:.83rem;margin:0 0 1.25rem;line-height:1.5">Los agentes adjuntan tu CV automáticamente en cada postulación.</p>
      <div id="cvDrop" onclick="document.getElementById('w_cv').click()" ondragover="event.preventDefault();this.style.borderColor='var(--accent)'" ondragleave="this.style.borderColor='var(--border)'" ondrop="_wizCvDrop(event)"
        style="border:2px dashed var(--border);border-radius:12px;padding:1.75rem;text-align:center;cursor:pointer;transition:border-color .2s;margin-bottom:1rem">
        ${_wizCvName
          ? `<div style="color:var(--green);font-weight:700">✓ ${_wizCvName}</div><div style="font-size:.73rem;color:var(--muted);margin-top:.25rem">Click para cambiar</div>`
          : `<div style="font-size:2rem;margin-bottom:.4rem">📄</div><div style="font-weight:700">Subí tu CV en PDF</div><div style="font-size:.73rem;color:var(--muted);margin-top:.2rem">Click o arrastrar · máx 5MB</div>`}
        <input type="file" id="w_cv" accept=".pdf" style="display:none" onchange="_wizCvFile(this)"/>
      </div>
      <div class="fld">
        <label>Bio profesional <span style="color:var(--muted);font-weight:400;font-size:.78rem">(~50 palabras, se usa en cover letters)</span></label>
        <textarea id="w_bio" rows="3" placeholder="Soy desarrollador React/Next.js con 4 años de experiencia. Especializado en frontend moderno, TypeScript y Supabase. Busco trabajo 100% remoto." style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:.5rem .75rem;color:var(--text);font-size:.85rem;resize:vertical;box-sizing:border-box;font-family:inherit">${_wizData.bio||''}</textarea>
      </div>`;
  } else if (_wizStep === 3) {
    content = `
      <h2 style="margin:0 0 .3rem;font-size:1.35rem">🎯 Preferencias de búsqueda</h2>
      <p style="color:var(--muted);font-size:.83rem;margin:0 0 1.5rem;line-height:1.5">¿Qué rol buscás y cuánto querés ganar?</p>
      <div class="modal-grid">
        <div class="fld" style="grid-column:1/-1">
          <label>Skills a buscar <span style="color:var(--muted);font-weight:400;font-size:.78rem">(coma-separados)</span></label>
          <input id="w_tags" value="${_wizData.tags||'react,typescript,nextjs,frontend'}" placeholder="react,typescript,nextjs,frontend"/>
        </div>
        <div class="fld">
          <label>Tipo de trabajo</label>
          <select id="w_jtype" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:.45rem .75rem;color:var(--text);font-family:inherit;font-size:.85rem">
            <option value="any">Cualquiera</option>
            <option value="full-time">Full-time</option>
            <option value="contract">Contract</option>
            <option value="freelance">Freelance</option>
          </select>
        </div>
        <div class="fld"><label>Meta salarial mensual</label><input id="w_sal" value="${_wizData.sal||'$2,500/mo'}" placeholder="$2,500/mo"/></div>
        <div class="fld"><label>LinkedIn URL</label><input id="w_li" value="${_wizData.li||''}" placeholder="https://linkedin.com/in/..."/></div>
        <div class="fld"><label>GitHub URL</label><input id="w_gh" value="${_wizData.gh||''}" placeholder="https://github.com/..."/></div>
        <div class="fld" style="grid-column:1/-1"><label>Portfolio URL</label><input id="w_po" value="${_wizData.po||''}" placeholder="https://tusite.com"/></div>
      </div>`;
  }

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:2rem">${dots}</div>
    ${content}
    <div style="display:flex;gap:.75rem;margin-top:1.5rem">
      ${_wizStep > 1 ? `<button class="btn btn-ghost" onclick="_wizBack()" style="flex:1">← Atrás</button>` : '<div style="flex:1"></div>'}
      ${_wizStep < 3
        ? `<button class="btn btn-accent" onclick="_wizNext()" style="flex:2">Siguiente →</button>`
        : `<button class="btn btn-accent" id="wizFinBtn" onclick="_wizFinish()" style="flex:2">🚀 Empezar a cazar trabajos</button>`}
    </div>
    ${_wizStep === 1 ? '<div style="text-align:center;margin-top:.75rem"><button onclick="hideWizard()" style="background:none;border:none;color:var(--muted);font-size:.75rem;cursor:pointer;text-decoration:underline">Saltar por ahora →</button></div>' : ''}
  `;
}

function _wizNext() {
  if (_wizStep === 1) {
    const fn = document.getElementById('w_fn')?.value.trim();
    const ln = document.getElementById('w_ln')?.value.trim();
    const em = document.getElementById('w_em')?.value.trim();
    if (!fn || !ln || !em) { toast('Nombre, apellido y email son obligatorios', 'err'); return; }
    _wizData = { ..._wizData, fn, ln, em, ph: document.getElementById('w_ph')?.value.trim()||'', ci: document.getElementById('w_ci')?.value.trim()||'' };
  } else if (_wizStep === 2) {
    _wizData.bio = document.getElementById('w_bio')?.value.trim() || '';
  }
  _wizStep++;
  _renderWizStep();
}

function _wizBack() { _wizStep--; _renderWizStep(); }

function _wizCvFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('CV demasiado grande (máx 5MB)', 'err'); return; }
  const reader = new FileReader();
  reader.onload = e => { _wizCvB64 = e.target.result.split(',')[1]; _wizCvName = file.name; _renderWizStep(); };
  reader.readAsDataURL(file);
}

function _wizCvDrop(event) {
  event.preventDefault();
  document.getElementById('cvDrop').style.borderColor = 'var(--border)';
  const file = event.dataTransfer.files[0];
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) { toast('Solo se aceptan archivos PDF', 'err'); return; }
  const inp = document.getElementById('w_cv');
  const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files;
  _wizCvFile(inp);
}

async function _wizFinish() {
  _wizData.tags = document.getElementById('w_tags')?.value.trim() || 'react,typescript,nextjs,frontend';
  _wizData.sal  = document.getElementById('w_sal')?.value.trim()  || '$2,500/mo';
  _wizData.li   = document.getElementById('w_li')?.value.trim()   || '';
  _wizData.gh   = document.getElementById('w_gh')?.value.trim()   || '';
  _wizData.po   = document.getElementById('w_po')?.value.trim()   || '';
  _wizData.jtype = document.getElementById('w_jtype')?.value || 'any';

  const btn = document.getElementById('wizFinBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  // Upload CV if provided
  let cvPath = '';
  if (_wizCvB64) {
    try {
      const r = await fetch(`${API}/cv/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataBase64: _wizCvB64, fileName: _wizCvName }),
      });
      const d = await r.json();
      if (d.path) cvPath = d.path;
    } catch (e) { toast('Aviso: no se pudo subir el CV (' + e.message + ')', 'warn'); }
  }

  const fields = {
    FIRST_NAME: _wizData.fn, LAST_NAME: _wizData.ln, EMAIL: _wizData.em,
    ...(_wizData.ph && { PHONE: _wizData.ph }),
    ...(_wizData.ci && { CITY: _wizData.ci }),
    ...(_wizData.bio && { PROFILE_TEXT: _wizData.bio }),
    ...(cvPath && { CV_PATH: cvPath }),
    SEARCH_TAGS: _wizData.tags, JOB_TYPE: _wizData.jtype, SALARY_TARGET: _wizData.sal,
    ...(_wizData.li && { LINKEDIN: _wizData.li }),
    ...(_wizData.gh && { GITHUB: _wizData.gh }),
    ...(_wizData.po && { PORTFOLIO: _wizData.po }),
  };

  try {
    await fetch(`${API}/config/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
    });
    toast('✓ ¡Perfil guardado! Los agentes están listos para trabajar.', 'ok');
    hideWizard();
    await loadAll();
  } catch (e) {
    toast('Error guardando: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Empezar a cazar trabajos'; }
  }
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  connectSSE();
  connectActivityStream();
  loadAll();
  setInterval(loadAll, 30000);
});
