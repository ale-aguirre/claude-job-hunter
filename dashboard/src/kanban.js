// kanban.js — Kanban, List, Priority views

const COL_COLOR = {
  found: 'var(--purple)',
  applied: 'var(--blue)',
  interview: 'var(--amber)',
  offer: 'var(--green)',
  rejected: 'var(--red)',
  blocked: 'var(--orange)',
};
const COL_ICON = { found:'🔍', applied:'📤', interview:'💬', offer:'🎉', rejected:'✕', blocked:'🚫' };
const COL_ORDER = ['interview', 'offer', 'applied', 'found', 'blocked', 'rejected'];

// Dynamic column label — reads from i18n
const getColLabel = (s) => t('columns.' + s);

// ── Kanban ────────────────────────────────────────────────────
function renderKanban() {
  const groups = { found:[], applied:[], interview:[], offer:[], rejected:[], blocked:[] };
  allApps.forEach(a => {
    if (a.status === 'found' && a.notes && a.notes.startsWith('BLOCKED:')) {
      groups.blocked.push(a);
    } else if (groups[a.status]) {
      groups[a.status].push(a);
    }
  });
  document.getElementById('kanbanView').innerHTML = COL_ORDER.map(s => {
    const items = groups[s];
    return `
      <div class="k-col">
        <div class="k-col-head">
          <div class="k-dot" style="background:${COL_COLOR[s]}"></div>
          <span class="k-col-title" style="color:${COL_COLOR[s]}">${COL_ICON[s]} ${getColLabel(s)}</span>
          <span class="k-col-count">${items.length}</span>
        </div>
        <div class="k-col-body">
          ${items.length
            ? items.map(a => appCard(a)).join('')
            : `<div class="k-col-empty">—</div>`}
        </div>
      </div>
    `;
  }).join('');
}

function humanBlockReason(notes) {
  const raw = (notes || '').replace(/^BLOCKED:\s*/i, '').trim();
  if (/Target page.*closed|browser has been closed/i.test(raw))     return 'El navegador se cerró durante la operación';
  if (/Timeout/i.test(raw))                                          return 'La página tardó demasiado en cargar';
  if (/login wall|require login|need login/i.test(raw))             return 'Requiere login — aplicar manualmente';
  if (/No Easy Apply/i.test(raw))                                    return 'Sin botón Easy Apply — aplicar manualmente';
  if (/No form.*Apply button|No Apply button/i.test(raw))           return 'No se encontró el formulario de aplicación';
  if (/Form filled.*no submit|no submit button/i.test(raw))         return 'Formulario completado pero sin botón de envío';
  if (/404|closed|not found/i.test(raw))                            return 'Oferta cerrada o página no encontrada';
  if (/Registration form not found/i.test(raw))                     return 'Formulario de registro no encontrado';
  if (/Error —/i.test(raw))                                         return 'Error técnico durante la aplicación';
  if (/DRY RUN/i.test(raw))                                         return 'Dry run completado (no enviado)';
  // Fallback: clean up the raw message, max 60 chars
  return raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Bloqueado';
}

function cardDate(a) {
  // Prefer updated_at for blocked, applied_at for others
  const raw = a.updated_at || a.applied_at;
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : raw + 'Z');
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'ayer';
  if (diffDays < 7)  return `${diffDays}d`;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function appCard(a) {
  const isBlocked = a.status === 'found' && a.notes && a.notes.startsWith('BLOCKED:');
  const colClass = isBlocked ? 'c-blocked' : `c-${a.status}`;
  const applyBtn = (a.status === 'found' && !isBlocked)
    ? `<button class="a-btn a-btn-apply" onclick="event.stopPropagation();markAs(${a.id},'applied')">✓</button>`
    : a.status === 'applied'
    ? `<button class="a-btn a-btn-int" onclick="event.stopPropagation();markAs(${a.id},'interview')">💬</button>`
    : '';
  const offerBtn = a.status === 'interview'
    ? `<button class="a-btn a-btn-apply" onclick="event.stopPropagation();markAs(${a.id},'offer')" style="background:var(--green)">🎉</button>`
    : '';
  const srcIcon = {'remotive':'🌐','remoteok':'🟠','greenhouse':'🌿','lever':'⚙️','ashby':'🔷','getonbrd':'🧡','wellfound':'🚀','arc.dev':'🔵','upwork':'🟢'}[
    (a.source||'').toLowerCase()] || '🏢';
  const titleShort = (a.title||'').length > 42 ? a.title.slice(0,42)+'…' : (a.title||'—');
  const companyShort = (a.company||'').length > 28 ? a.company.slice(0,28)+'…' : (a.company||'—');
  const dateStr = cardDate(a);
  return `
    <div class="a-card ${colClass}" onclick="openDetail(${a.id})">
      <div class="a-card-top">
        <span class="a-src">${srcIcon} ${a.source || '—'}</span>
        ${a.easy_apply ? `<span class="a-easy">⚡</span>` : ''}
        <span class="a-date">${dateStr}</span>
      </div>
      <div class="a-title">${titleShort}</div>
      <div class="a-company">${companyShort}</div>
      ${isBlocked ? `<div class="a-block-reason">⛔ ${humanBlockReason(a.notes)}</div>` : ''}
      <div class="a-actions">
        ${a.url ? `<button class="a-btn a-btn-link" onclick="event.stopPropagation();window.open('${a.url}','_blank')">↗</button>` : ''}
        ${applyBtn}${offerBtn}
        <button class="a-btn a-btn-del" onclick="event.stopPropagation();delApp(${a.id})">✕</button>
      </div>
    </div>
  `;
}

// ── List ──────────────────────────────────────────────────────
function renderList() {
  document.getElementById('listBody').innerHTML = allApps.map(a => `
    <div class="l-row" onclick="openDetail(${a.id})">
      <div>
        <div style="font-weight:600">${a.title}</div>
        <div style="font-size:.7rem;color:var(--muted)">${a.company}</div>
      </div>
      <div style="color:var(--green);font-size:.75rem">${a.salary || '—'}</div>
      <div style="font-size:.72rem;color:var(--muted)">${a.source}</div>
      <div><span class="badge badge-${a.status}">${a.status}</span></div>
      <div style="font-size:.68rem;color:var(--muted)">${(a.applied_at || '').slice(5,10)}</div>
    </div>
  `).join('');
}

// ── Priority ──────────────────────────────────────────────────
function renderPriority() {
  const score = a =>
    (a.easy_apply ? 15 : 0) +
    (a.salary ? 10 : 0) +
    (a.status === 'found' ? 5 : 0) +
    (['Mercor','Mindrift','Arc.dev','Lemon.io','Braintrust'].some(p => a.source?.includes(p)) ? 8 : 0);
  const sorted = [...allApps]
    .filter(a => ['found','applied'].includes(a.status))
    .sort((a,b) => score(b) - score(a));
  document.getElementById('priorityView').innerHTML = `
    <div style="font-size:.72rem;color:var(--muted);margin-bottom:.25rem">${sorted.length} ${t('priority.actionable')}</div>
    ${sorted.map((a,i) => `
      <div class="p-card" onclick="openDetail(${a.id})">
        <div class="p-rank">${i+1}</div>
        <div>
          <div style="font-weight:700;font-size:.85rem;margin-bottom:.2rem">${a.title}</div>
          <div style="font-size:.72rem;color:var(--muted);margin-bottom:.4rem">@ ${a.company} · ${a.source}</div>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
            <span class="badge badge-${a.status}">${a.status}</span>
            ${a.easy_apply ? `<span class="a-easy">⚡ Easy</span>` : ''}
            ${a.salary ? `<span style="font-size:.72rem;color:var(--green)">${a.salary}</span>` : ''}
          </div>
        </div>
        <div class="p-actions">
          ${a.url ? `<button class="a-btn a-btn-link" onclick="event.stopPropagation();window.open('${a.url}','_blank')">${t('actions.open')}</button>` : ''}
          ${a.status === 'found' ? `<button class="a-btn a-btn-apply" onclick="event.stopPropagation();markAs(${a.id},'applied')">${t('actions.markApplied')}</button>` : ''}
        </div>
      </div>
    `).join('')}
  `;
}
