// agents.js — Agent definitions, roster, voices, and log rendering

// Agent roster — anime characters with per-agent color theming
// role: what this system-name actually does (shown in chip tooltip)
const _FERN   = { name: 'Fern',    shortRole: 'Researcher',   emoji: '🔍', color: '#8b5cf6', avatar: '/avatars/fern.png',      anime: 'Frieren',     role: 'Researcher · busca plataformas y oportunidades' };
const _SENKU  = { name: 'Senku',   shortRole: 'Orchestrator', emoji: '🧪', color: '#f97316', avatar: '/avatars/senku_v6.png',   anime: 'Dr. Stone',   role: 'Orchestrator · analiza resultados y genera planes' };
const _KAGUYA = { name: 'Kaguya',  shortRole: 'Social Scout', emoji: '📝', color: '#ec4899', avatar: '/avatars/kaguya.png',    anime: 'Kaguya-sama', role: 'Social Scout · busca posts de hiring en X y Reddit' };
const _RIN    = { name: 'Rin',     shortRole: 'Recruiter',    emoji: '⚽', color: '#a78bfa', avatar: '/avatars/rin.png',       anime: 'Blue Lock',   role: 'Recruiter · analiza bookmarks de Siftly' };
const _ERWIN  = { name: 'Erwin',   shortRole: 'Analyst',      emoji: '👁️', color: '#06b6d4', avatar: '/avatars/erwin.png',     anime: 'AoT',         role: 'Analyst · análisis profundo de tendencias de Siftly' };
const _REIGEN = { name: 'Reigen',  shortRole: 'Sales',        emoji: '🎭', color: '#f59e0b', avatar: '/avatars/reigen.png',    anime: 'Mob Psycho',  role: 'Sales · cold emails a contactos VERIFICADOS' };
const _MOB    = { name: 'Mob',     shortRole: 'Registration', emoji: '👻', color: '#7c3aed', avatar: '/avatars/mob_v2.png',       anime: 'Mob Psycho',  role: 'Registration · se registra en plataformas y valida emails' };
const _NANAMI = { name: 'Nanami',  shortRole: 'QA',           emoji: '🗡️', color: '#d4d4d8', avatar: '/avatars/nanami.png',    anime: 'JJK',         role: 'QA · audita postulaciones y pipeline' };

const AGENTS = {
  // Keys reales usados en agent_log (scripts → nombre de agente)
  'OpenFangScout':        { ..._FERN,   shortRole: 'Scout' },
  'ScoutAPI':             { ..._FERN,   shortRole: 'API Scout' },
  'scout-api':            { ..._FERN,   shortRole: 'API Scout' },
  'ATS-Apply':            { ..._FERN,   shortRole: 'ATS Apply' },
  'ApplyFromDB':          { ..._FERN,   shortRole: 'Career Apply' },
  'OpenFangOrchestrator': _SENKU,
  'XRedditAgent':         _KAGUYA,
  'BookmarksAgent':       { ..._RIN,    shortRole: 'Bookmarks' },
  'BookmarkAgent':        { ..._RIN,    shortRole: 'Bookmarks' },  // alias (sin 's')
  'SiftlyAnalyst':        _ERWIN,
  'apply-batch':          _REIGEN,
  'BatchApply':           _REIGEN,    // alias real usado en apply-batch.mjs
  'MobAgent':             _MOB,
  'RegistrationAgent':    _MOB,
  'QA-Audit':             _NANAMI,
  // Daemon → absorbido por Senku (él es el orquestador del ciclo)
  'Daemon':               { ..._SENKU, shortRole: 'Cycle Manager' },
  'HuntDesk':             { name: 'HuntDesk', shortRole: 'Dashboard', emoji: '🖥️', color: '#3b82f6', avatar: null, anime: '', role: 'Dashboard · interfaz web' },
  // OpenFang internal agents (11 agentes del sistema OpenFang)
  'writer':               { ..._KAGUYA, shortRole: 'Writer' },
  'researcher':           { ..._FERN,   shortRole: 'Researcher' },
  'researcher-hand':      { ..._FERN,   shortRole: 'Research Hand' },
  'orchestrator':         { ..._SENKU,  shortRole: 'Orchestrator' },
  'analyst':              { ..._ERWIN,  shortRole: 'Analyst' },
  'recruiter':            { ..._RIN,    shortRole: 'Recruiter' },
  'sales-assistant':      { ..._REIGEN, shortRole: 'Sales' },
  'social-media':         { ..._KAGUYA, shortRole: 'Social Media' },
  'assistant':            { ..._NANAMI, shortRole: 'Assistant' },
  'lead-hand':            { ..._SENKU,  shortRole: 'Lead Hand' },
  'collector-hand':       { ..._RIN,    shortRole: 'Collector' },
};
const AGENT_COLORS = Object.fromEntries(Object.entries(AGENTS).map(([k,v]) => [k, v.color]));

// Canonical roster (unique agents shown in chips strip)
const AGENT_ROSTER = [
  { key: 'OpenFangScout',        ...AGENTS['OpenFangScout'] },
  { key: 'OpenFangOrchestrator', ...AGENTS['OpenFangOrchestrator'] },
  { key: 'XRedditAgent',         ...AGENTS['XRedditAgent'] },
  { key: 'BookmarksAgent',       ...AGENTS['BookmarksAgent'] },
  { key: 'SiftlyAnalyst',        ...AGENTS['SiftlyAnalyst'] },
  { key: 'MobAgent',             ...AGENTS['MobAgent'] },
  { key: 'apply-batch',          ...AGENTS['apply-batch'] },
  { key: 'QA-Audit',             ...AGENTS['QA-Audit'] },
];

// ── Extended agent profiles (shown in profile modal) ──────────
const AGENT_PROFILES = {
  'OpenFangScout': {
    born: 'Mar 1, 2026',
    description: 'Primary researcher and applicator. Scouts job boards via direct APIs — no browser needed — and fills ATS forms (Ashby, Lever, Greenhouse). Fast, systematic, never invents data.',
    soul: '"Efficiency is a form of respect for people\'s time." — Quiet, precise, focused on results over appearances.',
    skills: ['API scraping', 'ATS forms', 'Remotive', 'RemoteOK', 'Greenhouse', 'Lever', 'Cover letters (Groq)', 'CDP Playwright'],
    scripts: ['scout-api.mjs', 'apply-ats.mjs', 'apply-from-db.mjs'],
    status: 'active',
  },
  'OpenFangOrchestrator': {
    born: 'Mar 3, 2026',
    description: 'Orquestador principal del sistema. Controla el ciclo de 60 min (daemon), lee resultados de scouts, analiza patrones con Groq y genera planes de acción estratégicos. Cada script del pipeline reporta ante Senku.',
    soul: '"¡10 billion percent! Science always wins." — Hiper-analítico, piensa en sistemas, obsesionado con la optimización.',
    skills: ['Cycle management', 'Strategy planning', 'Groq LLM', 'DB analysis', 'Pattern recognition', 'Pipeline coordination'],
    scripts: ['daemon.mjs (ciclo)', 'openfang-orchestrator.mjs', 'openfang-scout.mjs'],
    status: 'audit',
  },
  'XRedditAgent': {
    born: 'Mar 4, 2026',
    description: 'Monitors X and Reddit for hiring posts, referrals, and "we\'re hiring" threads. Uses the Chrome mirror with real sessions to avoid bot detection. Runs every 3h max.',
    soul: '"Information is power, and I always know more than I let on." — Strategic, calculated, uses social signals before others notice.',
    skills: ['X/Twitter search', 'Reddit scraping', 'CDP sessions', 'Hiring signal detection', 'Chrome mirror'],
    scripts: ['agent-xreddit.mjs'],
    status: 'active',
  },
  'BookmarksAgent': {
    born: 'Mar 2, 2026',
    description: 'Reads Siftly bookmarks (1043 links in AI&ML, DevTools, Startups categories) and identifies job-hunting tools, platforms, and companies to target.',
    soul: '"The best opportunity is the one nobody else has found yet." — Sharp, hungry, sees value where others see noise.',
    skills: ['Siftly API', 'Bookmark analysis', 'Platform discovery', 'Groq classification'],
    scripts: ['agent-bookmarks.mjs'],
    status: 'active',
  },
  'SiftlyAnalyst': {
    born: 'Mar 5, 2026',
    description: 'Deep analyst that runs every 3h to extract trends, market signals, and strategic insights from the Siftly bookmark collection. Produces action plans for the orchestrator.',
    soul: '"Sacrifice is necessary." — Cold, rational, long-term thinking. Never panics.',
    skills: ['Trend analysis', 'Market intelligence', 'Siftly deep-dive', 'Strategic reports', 'Groq synthesis'],
    scripts: ['agent-siftly-analyst.mjs'],
    status: 'active',
  },
  'MobAgent': {
    born: 'Mar 10, 2026',
    description: 'Hace el trabajo aburrido que nadie más quiere hacer. Se registra en plataformas de trabajo (Wellfound, Himalayas, Torre, GetOnBrd, Contra), maneja el flujo de email verification (va a Gmail, encuentra el link, lo clickea) y marca los jobs como listos para que Reigen aplique.',
    soul: '"I\'m not particularly strong..." — Silencioso, metódico, imperturbable. Opera en secuencias. No improvisa. No falla.',
    skills: ['Platform registration', 'Gmail CDP', 'Email verification', 'Session management', 'Chrome mirror :9223', 'Sequential workflows'],
    scripts: ['agent-mob.mjs'],
    status: 'active',
  },
  'apply-batch': {
    born: 'Mar 6, 2026',
    description: 'Cold email specialist. Sends personalized emails ONLY to verified contacts — never invented addresses. Uses Gmail API with the real account. Zero tolerance for bounce risk.',
    soul: '"Everyone likes Reigen — or they will once I explain why they should hire you." — Charismatic, persuasive, knows when to push.',
    skills: ['Gmail API', 'Cold email', 'Email verification', 'Personalization', 'Groq copywriting'],
    scripts: ['apply-batch.mjs'],
    status: 'active',
  },
  'QA-Audit': {
    born: 'Mar 8, 2026',
    description: 'Quality control agent. Audits all applications in the DB, checks for data integrity, blocked jobs that should be retried, and coverage gaps in the pipeline.',
    soul: '"Overtime is prohibited. But so is sloppiness." — Professional, methodical, no tolerance for ambiguity.',
    skills: ['DB audit', 'Pipeline QA', 'Blocked job triage', 'Integrity checks'],
    scripts: ['(planned)'],
    status: 'planned',
  },
  'Daemon': {
    born: 'Mar 1, 2026',
    description: 'Background orchestrator that runs every 60 min via macOS launchd. Calls all agent scripts in order, manages the headless Chrome mirror, and logs cycle results to DB.',
    soul: 'Silent. Persistent. Never sleeps.',
    skills: ['launchd scheduling', 'Chrome mirror', 'Cycle management', 'Agent coordination'],
    scripts: ['daemon.mjs'],
    status: 'paused',
  },
};

// Cache de last-run times (se actualiza cada 30s desde la API)
let _agentLastRun = {};
let _daemonLastCycle = null;
let _daemonIntervalMin = 60;

async function fetchAgentLastRun() {
  try {
    const d = await fetch(`${API}/agents/last-run`).then(r => r.json());
    _daemonLastCycle = d.daemonLastCycle;
    _daemonIntervalMin = d.intervalMin || 60;
    _agentLastRun = {};
    (d.agents || []).forEach(row => { _agentLastRun[row.agent] = row.last_run; });
  } catch {}
}

function _fmtAgo(isoStr) {
  if (!isoStr) return null;
  const mins = Math.floor((Date.now() - new Date(isoStr + 'Z')) / 60000);
  if (mins < 1)  return 'ahora';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24)   return `${h}h`;
  return `${Math.floor(h/24)}d`;
}

function _nextRunMin() {
  if (!_daemonLastCycle) return null;
  const elapsedMin = Math.floor((Date.now() - new Date(_daemonLastCycle + 'Z')) / 60000);
  const remaining = _daemonIntervalMin - elapsedMin;
  return remaining > 0 ? remaining : 0;
}

// Guarda las activeKeys actuales para que el countdown no re-render active chips
let _currentActiveKeys = new Set();

function renderAgentRoster(activeKeys = new Set()) {
  _currentActiveKeys = activeKeys;
  const el = document.getElementById('agentChips');
  if (!el) return;

  el.innerHTML = AGENT_ROSTER.map(a => {
    const isActive = activeKeys.has(a.key) || activeKeys.has(a.name);
    const glowColor = a.color + '55';
    const avatarHtml = a.avatar
      ? `<img src="${a.avatar}" onerror="this.outerHTML='<span class=\\'chip-emoji\\'>${a.emoji}</span>'">`
      : `<span class="chip-emoji">${a.emoji}</span>`;

    // Timer: SOLO cuando está idle
    let timerHtml = '';
    if (!isActive) {
      const relatedKeys = Object.entries(AGENTS).filter(([,v]) => v.name === a.name).map(([k]) => k);
      const lastRunTs   = relatedKeys.map(k => _agentLastRun[k]).filter(Boolean).sort().pop();
      const agoStr      = _fmtAgo(lastRunTs);
      const nextMin     = _nextRunMin();
      if (agoStr || nextMin !== null) {
        const nextPart = nextMin !== null ? ` · <span class="chip-next" id="chip-next-${a.key}" data-next="${nextMin}">+${nextMin}m</span>` : '';
        timerHtml = `<span class="chip-timer">${agoStr || ''}${nextPart}</span>`;
      }
    }

    return `<div class="agent-chip ${isActive ? 'active' : 'idle'}"
      style="color:${a.color};border-color:${a.color}44;background:${a.color}11;--chip-glow:${glowColor};cursor:pointer"
      title="${a.role}" onclick="openAgentProfile('${a.key}')">
      ${avatarHtml}
      <div class="chip-label">
        <span>${a.name}</span>
        ${timerHtml}
      </div>
    </div>`;
  }).join('');
}

// Countdown real-time: tick cada 60s actualizando solo los "chip-next" spans de chips idle
function _tickCountdowns() {
  document.querySelectorAll('[id^="chip-next-"]').forEach(el => {
    const cur = parseInt(el.dataset.next);
    if (isNaN(cur)) return;
    const next = Math.max(0, cur - 1);
    el.dataset.next = next;
    el.textContent  = next === 0 ? 'ahora' : `+${next}m`;
  });
}

// Fetch last-run al cargar y luego cada 60s
fetchAgentLastRun().then(() => renderAgentRoster(new Set()));
setInterval(() => fetchAgentLastRun().then(() => renderAgentRoster(_currentActiveKeys)), 60000);
// Tick de countdown cada 60s (1 minuto = 1 tick)
setInterval(_tickCountdowns, 60000);

async function openAgentProfile(key) {
  const a = AGENT_ROSTER.find(r => r.key === key);
  const prof = AGENT_PROFILES[key];
  if (!a) return;
  const color = a.color;
  const letter = a.name.charAt(0).toUpperCase();

  // Avatar
  document.getElementById('apmAvatar').innerHTML = a.avatar
    ? `<img class="apm-avatar-img" src="${a.avatar}?v=${Date.now()}" style="border-color:${color}66;box-shadow:0 0 20px ${color}33" onerror="this.outerHTML='<div class=\\'apm-avatar-letter\\' style=\\'background:${color}18;border-color:${color}55;color:${color}\\'>${letter}</div>'">`
    : `<div class="apm-avatar-letter" style="background:${color}18;border-color:${color}55;color:${color}">${letter}</div>`;

  document.getElementById('apmName').innerHTML = `<span style="color:${color}">${a.name}</span>`;
  document.getElementById('apmRole').textContent = a.shortRole || a.role;
  document.getElementById('apmAnime').textContent = a.anime ? `${a.anime}` : '';
  document.getElementById('apmMeta').innerHTML = [
    prof?.born ? `<span class="apm-meta-chip" style="color:${color};border-color:${color}44;background:${color}11">${t('agentModal.born')} ${prof.born}</span>` : '',
    prof?.status ? `<span class="apm-meta-chip" style="color:${
      prof.status==='active'?'var(--green)':prof.status==='audit'?'var(--amber)':prof.status==='planned'?'var(--blue)':'var(--muted)'
    };border-color:currentColor;background:currentColor/10">${prof.status}</span>` : '',
  ].join('');

  document.getElementById('apmSoul').textContent = prof?.soul || a.role;
  document.getElementById('apmSkills').innerHTML = (prof?.skills||[]).map(s => `<span class="apm-skill-tag">${s}</span>`).join('');
  document.getElementById('apmScripts').innerHTML = (prof?.scripts||[]).map(s => `<div class="apm-script">${s}</div>`).join('');

  // Load recent activity from API
  document.getElementById('apmActivity').innerHTML = `<span style="color:var(--muted);font-size:.78rem">${t('agentModal.loading')}</span>`;
  try {
    const res = await fetch(`${API}/log?limit=200`);
    const logs = await res.json();
    // Find logs for this agent (by key or by name mapping)
    const agentKeys = Object.entries(AGENTS).filter(([,v]) => v.name === a.name).map(([k]) => k);
    const relevant = logs.filter(l => agentKeys.includes(l.agent)).slice(0, 20);
    if (relevant.length === 0) {
      document.getElementById('apmActivity').innerHTML = `<span style="color:var(--muted);font-size:.78rem">${t('agentModal.noActivity')}</span>`;
    } else {
      document.getElementById('apmActivity').innerHTML = relevant.map(l => {
        const ts = new Date(l.created_at + 'Z').toLocaleString('es-AR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        const isErr = l.status === 'error';
        return `<div class="apm-activity-row">
          <span class="apm-activity-action" style="color:${isErr?'var(--red)':color}">${l.action}</span>
          <span class="apm-activity-detail">${(l.detail||'').slice(0,80)}</span>
          <span class="apm-activity-ts">${ts}</span>
        </div>`;
      }).join('');
    }
    // Stats
    const total = relevant.length;
    const errors = relevant.filter(l => l.status==='error').length;
    const applies = relevant.filter(l => l.action?.includes('submit') || l.action?.includes('applied')).length;
    document.getElementById('apmStats').innerHTML = `
      <div class="apm-stat"><div class="apm-stat-val" style="color:${color}">${total}</div><div class="apm-stat-lbl">${t('agentModal.logEntries')}</div></div>
      <div class="apm-stat"><div class="apm-stat-val" style="color:var(--green)">${applies}</div><div class="apm-stat-lbl">${t('agentModal.applications')}</div></div>
      <div class="apm-stat"><div class="apm-stat-val" style="color:${errors>0?'var(--red)':'var(--muted)'}">${errors}</div><div class="apm-stat-lbl">${t('agentModal.errors')}</div></div>
    `;
  } catch { document.getElementById('apmActivity').innerHTML = `<span style="color:var(--red);font-size:.78rem">${t('agentModal.errorActivity')}</span>`; }

  openModal('agentProfileOverlay');
}

// ── Agent character voices ─────────────────────────────────────
function agentVoice(agentInfo, action, detail, isError, isApply) {
  const d = String(detail).slice(0, 120);
  const name = agentInfo?.name || '';
  const act = action || '';

  // Per-character voice tables
  const V = {
    Fern: {
      error:   [`Hay un obstáculo aquí. Déjame registrarlo.`, `Esto no salió bien. Lo registro y sigo.`, `Algo falló. Tomo nota.`],
      apply:   [`Listo. Solicitud enviada. Verificado.`, `Mandé la postulación. A esperar.`, `Enviado. Sin errores.`],
      found:   [`Encontré algo que vale la pena ver: `, `Posibilidad catalogada: `, `Agregado al registro: `],
      skip:    [`Ya lo vi antes. Continúo.`, `Esto ya está en la lista. Paso al siguiente.`],
      scout:   [`Escaneando el mercado...`, `Revisando plataformas disponibles.`, `Buscando oportunidades.`],
      nav:     [`Accediendo a `, `Entrando a `],
      block:   [`Esta ruta está cerrada. Lo anoto y busco otra.`, `No se puede pasar por acá.`],
      email:   [`Contacto verificado. Enviando mensaje.`, `Credenciales confirmadas. Procediendo.`],
      default: [``, ``, ``],
    },
    Senku: {
      error:   [`Esto es un 0% en mi sistema. A recalcular la fórmula.`, `Fallo detectado. La ciencia no acepta excusas — a corregir.`, `Error. No importa, tengo 10 billones de planes alternativos.`],
      apply:   [`¡10 billones por ciento enviado! La ciencia conquista otro campo.`, `Postulación lanzada. Probabilidad de éxito: calculándose.`, `¡Impacto directo! Que comiencen las negociaciones.`],
      found:   [`¡Nueva data en el laboratorio! Esto es prometedor: `, `Detectado. Analizando variables: `, `¡Un hallazgo científicamente interesante! `],
      skip:    [`Duplicado. La ciencia no repite experimentos fallidos.`, `Ya procesado. Siguiente variable.`],
      scout:   [`Iniciando análisis sistemático del ecosistema laboral.`, `¡El laboratorio está en marcha! Escaneando todo.`, `Exploración científica en curso. Datos fluyendo.`],
      nav:     [`¡Rumbo al objetivo! `, `Desplegando hacia `],
      plan:    [`Plan de ataque científico activado. `, `¡10 billones de probabilidades calculadas! `],
      block:   [`El muro existe. Bien — la ciencia encuentra la grieta.`, `Sistema bloqueado. Interesante problema. A resolverlo.`],
      default: [`Procesando datos...`, `El laboratorio opera sin descanso.`, `¡La ciencia avanza!`],
    },
    Kaguya: {
      error:   [`Qué molesto. Pero ya lo tenía contemplado como posibilidad.`, `Un contratiempo menor. Ya sé cómo evitarlo la próxima vez.`, `Esto no debería haberme sorprendido. Ajusto la estrategia.`],
      apply:   [`Enviado. Sabía que iba a pasar esto. Solo estaba esperando el momento correcto.`, `Postulación perfectamente ejecutada. Obviamente.`, `Mandé la solicitud. Ellos no lo saben todavía, pero me van a responder.`],
      found:   [`Esto podría ser útil. Lo guardo sin que nadie note que me interesó: `, `Interesante. Lo catalogo estratégicamente: `, `Hmm. Esto merece atención: `],
      skip:    [`Ya lo sabía. Sigo adelante.`, `No hay nada nuevo aquí para mí.`],
      scout:   [`Recopilando inteligencia del mercado. Como siempre, voy un paso adelante.`, `Analizando el campo. Discreta y completamente.`],
      nav:     [`Accediendo. Nada me escapa: `, `Entrando a `],
      block:   [`Una barrera. Perfecto — me da tiempo de encontrar la entrada real.`, `Bloqueado. Como si eso fuera a detenerme.`],
      email:   [`Redacté el mensaje exacto que necesitaban leer. No pueden no responder.`],
      default: [`Según mi análisis, esto está bajo control.`, `Todo sigue según lo planeado.`, `Operando en modo sigiloso.`],
    },
    Rin: {
      error:   [`Falló. Siguiente.`, `Error. Corrijo y sigo.`, `No funcionó. Adelante.`],
      apply:   [`Enviado.`, `Listo.`, `Hecho.`],
      found:   [`Candidato detectado.`, `Posible objetivo: `, `En la lista.`],
      skip:    [`Ya visto.`, `Siguiente.`],
      scout:   [`Escaneando.`, `En campo.`, `Buscando.`],
      nav:     [`Entrando a `, `En ruta a `],
      block:   [`Bloqueado. Inaceptable.`, `Muro encontrado. Rodeo.`],
      default: [`Procesando.`, `Ejecutando.`, `Sin novedades.`],
    },
    Erwin: {
      error:   [`Hubo bajas en esta operación. Reajustamos la táctica.`, `El frente cedió aquí. Reorganizamos y avanzamos.`, `Pérdida táctica. No estratégica. Seguimos.`],
      apply:   [`Misión cumplida en este sector. Ahora esperamos la respuesta del objetivo.`, `Postulación ejecutada. La pelota está del otro lado.`, `La solicitud fue lanzada. El sacrificio tiene sentido si hay resultado.`],
      found:   [`Inteligencia recibida del frente: `, `Reporte del campo: `, `Nuevo objetivo identificado: `],
      skip:    [`Ya fue analizado. Sin nuevo valor táctico. Avanzamos.`, `Este sector ya fue cubierto. Siguiente frente.`],
      scout:   [`Reconocimiento del territorio en marcha.`, `Desplegando exploración del campo laboral.`, `Las tropas avanzan hacia nuevas posiciones.`],
      nav:     [`Avanzando hacia `, `Entrando al territorio: `],
      plan:    [`Briefing del frente: `, `Plan de campaña actualizado. `],
      block:   [`Este camino está cerrado. Flanqueamos.`, `Obstáculo encontrado. El sacrificio no fue en vano si encontramos otro ángulo.`],
      default: [`El regimiento opera según lo planeado.`, `Sin novedades significativas del frente.`, `Avanzamos.`],
    },
    Reigen: {
      error:   [`Oye, pasa. No todos los clientes son para nosotros.`, `¿Error? Esto es parte de la estrategia. Confía.`, `Pequeño tropiezo. Lo que importa es cómo lo manejás — y yo lo manejo.`],
      apply:   [`¡Enviado con toda la energía de Reigen Arataka! Que respondan o que se arrepientan.`, `Mandé esa postulación con mi mejor cara de negocios. No pueden decir que no.`, `¡Hecho! Tu CV + mi redacción = oferta garantizada.`],
      found:   [`¡Mirá esto! Tiene potencial escrito en todos lados: `, `Yo tenía un presentimiento de esta empresa. Te la guardo: `, `Este cliente— digo, esta empresa— nos viene bien: `],
      skip:    [`Ese ya lo trabajé, no te preocupes.`, `Ya lo tengo en mis notas. Paso al siguiente.`],
      scout:   [`Buscando en mis mejores contactos...`, `¡Reigen Arataka en modo networking activado!`, `Rastreando las mejores oportunidades del mercado, como siempre.`],
      nav:     [`¡Vamos a ver de qué se trata esto! `, `Entrando con confianza a `],
      block:   [`¿Me cerraron la puerta? A nadie le conviene cerrármela a mí.`, `Bloqueado. Temporalmente. Tengo otro ángulo, siempre lo tengo.`],
      email:   [`Este email tiene el toque especial de Reigen. Van a querer responder.`, `Redactado con encanto profesional. El tuyo es el mejor CV que van a ver hoy.`],
      default: [`Operando con la eficiencia que me caracteriza.`, `Todo bajo control, como siempre.`, `¡Reigen Arataka nunca duerme!`],
    },
    Nanami: {
      error:   [`Irregularidad detectada. Requiere atención antes de continuar.`, `Esto no está bien. Documentado.`, `Error registrado. Prioridad media.`],
      apply:   [`Solicitud procesada correctamente. Paso siguiente: esperar respuesta.`, `Enviado. Integridad del formulario verificada.`, `Aplicación completada. Sin anomalías.`],
      found:   [`Entrada nueva. Validando datos: `, `Registrado correctamente: `, `Catalogado: `],
      skip:    [`Duplicado. Descartado.`, `Ya procesado previamente. Continúo.`],
      scout:   [`Análisis del mercado en ejecución.`, `Revisión sistemática iniciada.`],
      nav:     [`Accediendo a `, `Navegando a `],
      block:   [`Acceso denegado. Lo registro como obstáculo para revisión.`, `Bloqueado. Dejo constancia.`],
      default: [`Procesamiento normal.`, `Sin incidentes.`, `Operando dentro de parámetros.`],
    },
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const voice = V[name];
  if (!voice) return d || act;

  let prefix = '';
  if (isError)                                      prefix = pick(voice.error);
  else if (isApply)                                 prefix = pick(voice.apply);
  else if (act.includes('found') || act.includes('insert') || act.includes('job')) prefix = pick(voice.found);
  else if (act.includes('skip') || act.includes('already') || act.includes('duplicate')) prefix = pick(voice.skip);
  else if (act.includes('scout') || act.includes('scrape') || act.includes('search'))    prefix = pick(voice.scout);
  else if (act.includes('navigate') || act.includes('goto'))  prefix = pick(voice.nav);
  else if (act.includes('plan') || act.includes('cycle') || act.includes('orchestrat'))  prefix = pick(voice.plan || voice.default);
  else if (act.includes('block') || act.includes('BLOCKED'))  prefix = pick(voice.block);
  else if (act.includes('email') || act.includes('cold'))     prefix = pick(voice.email || voice.default);
  else                                              prefix = pick(voice.default);

  // For "found/nav" prefixes that end in ": " or space, append detail
  const needsDetail = prefix.endsWith(': ') || prefix.endsWith(': ') || prefix === '';
  return needsDetail ? `${prefix}${d}` : `${prefix}${d ? ' — ' + d : ''}`;
}

// Fallback: assign a character to any unknown agent based on name patterns
function resolveUnknownAgent(agentName) {
  const n = (agentName || '').toLowerCase();
  if (/scout|search|scrape|hunt|find/.test(n))      return { ..._FERN,   name: agentName, shortRole: 'Scout' };
  if (/orchestrat|daemon|cycle|manager|plan/.test(n)) return { ..._SENKU,  name: agentName, shortRole: 'Orchestrator' };
  if (/social|twitter|reddit|x-/.test(n))            return { ..._KAGUYA, name: agentName, shortRole: 'Social' };
  if (/bookmark|recruit|siftly/.test(n))             return { ..._RIN,    name: agentName, shortRole: 'Recruiter' };
  if (/analys|insight|report|trend/.test(n))         return { ..._ERWIN,  name: agentName, shortRole: 'Analyst' };
  if (/email|sales|cold|batch|apply/.test(n))        return { ..._REIGEN, name: agentName, shortRole: 'Sales' };
  if (/qa|audit|check|verify/.test(n))               return { ..._NANAMI, name: agentName, shortRole: 'QA' };
  // Generic fallback with a unique color derived from name
  const hue = [...agentName].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return { name: agentName, shortRole: 'Agent', emoji: '🤖', color: `hsl(${hue},60%,65%)`, avatar: null, anime: '', role: agentName };
}

// ── Group window: entries from same agent within 3min get collapsed ──────────
const LOG_GROUP_MS = 3 * 60 * 1000;

function _logPulse(isError, isApply) {
  const pulse = document.getElementById('activityPulse');
  if (!pulse) return;
  pulse.style.background = isError ? '#ef4444' : isApply ? '#22c55e' : '#a78bfa';
  setTimeout(() => { if (pulse) pulse.style.background = '#6b7280'; }, 1500);
}

function _logUpdateRoster(wrap) {
  const seenNames = new Set([...wrap.querySelectorAll('.log-ag')].map(el => el.textContent));
  const recentLogs = [...wrap.children].slice(0, 15);
  const recentAgentKeys = new Set(recentLogs.map(r => {
    const name = r.querySelector('.log-ag')?.textContent;
    const found = Object.entries(AGENTS).find(([,v]) => v.name === name);
    return found ? found[0] : name;
  }));
  renderAgentRoster(recentAgentKeys);
  const countEl = document.getElementById('agentCountLabel');
  if (countEl) countEl.textContent = t('sidebar.agentCount', { total: AGENT_ROSTER.length, active: seenNames.size });
}

function prependLog(d, isLive = false) {
  const wrap = document.getElementById('logWrap');
  const now = Date.now();
  const ts = new Date(d.ts || now).toLocaleTimeString('es-AR', { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const agentInfo = AGENTS[d.agent] || resolveUnknownAgent(d.agent);
  const color = agentInfo.color;
  const isError = d.status === 'error';
  const isApply = d.action?.includes('submit') || d.action?.includes('applied') || d.action?.includes('cv_upload');
  const voicedMsg = agentVoice(agentInfo, d.action, d.detail || '', isError, isApply);

  // ── Try to append to an existing group row from the same agent ──
  const firstRow = wrap.firstChild;
  if (
    firstRow &&
    firstRow.dataset.agentKey === d.agent &&
    (now - parseInt(firstRow.dataset.groupStart || 0)) < LOG_GROUP_MS
  ) {
    // Increment count badge
    const count = parseInt(firstRow.dataset.count || 1) + 1;
    firstRow.dataset.count = count;
    const badge = firstRow.querySelector('.log-group-badge');
    if (badge) badge.textContent = `${count} acciones`;
    // Mark group as having error if any entry has one
    if (isError) firstRow.classList.add('is-error');
    if (isApply) firstRow.classList.add('is-apply');
    // Append line to collapsed detail list
    const detList = firstRow.querySelector('.log-group-list');
    if (detList) {
      const errCls = isError ? ' style="color:var(--red)"' : isApply ? ' style="color:var(--green)"' : '';
      const item = document.createElement('div');
      item.className = 'log-gi';
      item.innerHTML = `<span class="log-ts">${ts}</span><span class="log-ac"${errCls}>${d.action}</span><span class="log-det">${voicedMsg}</span>`;
      detList.appendChild(item);
    }
    _logPulse(isError, isApply);
    _logUpdateRoster(wrap);
    return;
  }

  // ── New group row ──
  const letter = agentInfo.name.charAt(0).toUpperCase();
  const avatarHtml = agentInfo.avatar
    ? `<img class="log-avatar" src="${agentInfo.avatar}"
        style="--avatar-border:${color}66;--avatar-glow:${color}44"
        onerror="this.outerHTML='<div class=\\'log-avatar-emoji\\' style=\\'background:${color}18;border:2px solid ${color}55;color:${color};font-size:1.4rem;font-weight:700;font-family:Rajdhani,sans-serif\\'>${letter}</div>'">`
    : `<div class="log-avatar-emoji" style="background:${color}18;border:2px solid ${color}55;color:${color};font-size:1.4rem;font-weight:700;font-family:'Rajdhani',sans-serif">${letter}</div>`;

  const animeTag = agentInfo.anime ? `<span class="log-anime">${agentInfo.anime}</span>` : '';
  const roleTag = agentInfo.shortRole ? `<span class="log-role">— ${agentInfo.shortRole}</span>` : '';
  const baseClass = isApply ? 'log-row is-apply' : isError ? 'log-row is-error' : 'log-row';
  const rowClass = isLive ? `${baseClass} new-entry` : baseClass;

  const row = document.createElement('div');
  row.className = rowClass;
  row.dataset.agentKey = d.agent;
  row.dataset.groupStart = String(now);
  row.dataset.count = '1';
  row.innerHTML = `
    ${avatarHtml}
    <div class="log-body">
      <div class="log-header">
        <span class="log-ag" style="color:${color}">${agentInfo.name}</span>
        ${roleTag}${animeTag}
        <span class="log-group-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">1 acción</span>
        <span class="log-ts">${ts}</span>
      </div>
      <div class="log-group-toggle" onclick="this.closest('.log-row').querySelector('.log-group-list').classList.toggle('open');this.textContent=this.textContent.includes('▼')?'▲ ocultar':'▼ ver todo'">▼ ver todo</div>
      <div class="log-group-list">
        <div class="log-gi">
          <span class="log-ts">${ts}</span>
          <span class="log-ac">${d.action}</span>
          <span class="log-det ${isError?'err':isApply?'ok-apply':''}">${voicedMsg}</span>
        </div>
      </div>
    </div>`;

  // Click header → open detail for first entry
  row.querySelector('.log-header').addEventListener('click', () => openLogDetail({
    agentInfo, color, voicedMsg,
    action: d.action, detail: d.detail || '',
    ts, isError, isApply,
  }));

  wrap.insertBefore(row, wrap.firstChild);
  while (wrap.children.length > 60) wrap.lastChild.remove();
  _logPulse(isError, isApply);
  _logUpdateRoster(wrap);
}

// ── Log Detail Modal ──────────────────────────────────────────
function openLogDetail({ agentInfo, color, voicedMsg, action, detail, ts, isError, isApply }) {
  const modal = document.getElementById('logDetailModal');
  // Avatar
  const letter = agentInfo.name.charAt(0).toUpperCase();
  const avatarEl = document.getElementById('ldbAvatar');
  if (agentInfo.avatar) {
    avatarEl.innerHTML = `<img class="ldb-avatar" src="${agentInfo.avatar}"
      style="border-color:${color}66;box-shadow:0 0 20px ${color}44"
      onerror="this.outerHTML='<div class=\\'ldb-avatar-letter\\' style=\\'background:${color}18;border-color:${color}66;color:${color}\\'>${letter}</div>'">`;
  } else {
    avatarEl.innerHTML = `<div class="ldb-avatar-letter" style="background:${color}18;border-color:${color}66;color:${color}">${letter}</div>`;
  }
  document.getElementById('ldbName').textContent = agentInfo.name;
  document.getElementById('ldbName').style.color = color;
  document.getElementById('ldbAnime').textContent = agentInfo.anime ? `— ${agentInfo.anime}` : '';
  document.getElementById('ldbRole').textContent = agentInfo.role || '';
  document.getElementById('ldbAction').textContent = action;
  document.getElementById('ldbTs').textContent = ts;
  const msgEl = document.getElementById('ldbMessage');
  msgEl.textContent = voicedMsg;
  msgEl.style.color = isError ? 'var(--red)' : isApply ? 'var(--green)' : 'var(--text)';
  document.getElementById('ldbDetailRaw').textContent = detail || t('logDetail.noDetail');
  // Update log detail modal labels
  const rawLabel = document.getElementById('ldbRawLabel');
  if (rawLabel) rawLabel.textContent = t('logDetail.rawOutput');
  const closeBtn = document.getElementById('ldbCloseBtn');
  if (closeBtn) closeBtn.textContent = t('logDetail.close');
  modal.classList.remove('hidden');
}

function closeLogDetail() {
  document.getElementById('logDetailModal').classList.add('hidden');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLogDetail(); });
