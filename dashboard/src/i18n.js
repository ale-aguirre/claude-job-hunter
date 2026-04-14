// i18n.js — i18next setup
// Loaded after i18next CDN script

const ES = {
  translation: {
    stats: {
      found: 'Encontrados',
      applied: 'Postulados',
      interview: 'Entrevistas',
      offers: 'Ofertas',
      rejected: 'Rechazados',
      blocked: 'Bloqueados',
      responseRate: 'Tasa de respuesta'
    },
    tabs: {
      kanban: 'Kanban',
      list: 'Lista',
      priority: 'Prioridad',
      directory: 'Directorio',
      monetize: 'Monetizar',
      research: 'Investigación'
    },
    columns: {
      found: 'Encontrado',
      applied: 'Postulado',
      interview: 'Entrevista',
      offer: 'Oferta',
      rejected: 'Rechazado',
      blocked: 'Bloqueado'
    },
    list: {
      role: 'Rol / Empresa',
      salary: 'Salario',
      source: 'Fuente',
      status: 'Estado',
      date: 'Fecha'
    },
    sidebar: {
      liveActivity: '⚡ Actividad en Vivo',
      agentFeed: 'Canal de comunicación',
      deployed: 'Agentes desplegados',
      agentCount: '{{total}} agentes · {{active}} activos'
    },
    agentModal: {
      skills: 'Habilidades',
      scripts: 'Scripts',
      recentActivity: 'Actividad reciente',
      born: 'Creado',
      logEntries: 'Registros',
      applications: 'Postulaciones',
      errors: 'Errores',
      loading: 'Cargando...',
      noActivity: 'Sin actividad reciente.',
      errorActivity: 'Error al cargar actividad'
    },
    logDetail: {
      rawOutput: 'Salida completa',
      close: '✕ Cerrar',
      noDetail: '(sin detalle)'
    },
    modal: {
      addTitle: 'Agregar Oportunidad',
      company: 'Empresa *',
      role: 'Rol *',
      salary: 'Salario / Pago',
      status: 'Estado',
      source: 'Fuente',
      location: 'Ubicación',
      url: 'URL',
      easyApply: 'Easy Apply?',
      notes: 'Notas',
      coverLetter: 'Carta de presentación',
      cancel: 'Cancelar',
      add: 'Agregar →',
      close: 'Cerrar',
      open: '↗ Abrir'
    },
    statusOpts: {
      found: 'Encontrado',
      applied: 'Postulado',
      interview: 'Entrevista',
      offer: 'Oferta'
    },
    incomeModal: {
      title: 'Agregar Fuente de Ingreso',
      name: 'Nombre',
      type: 'Tipo',
      status: 'Estado',
      monthlyUsd: 'USD mensual',
      notes: 'Notas',
      addStream: 'Agregar stream',
      active: 'Activo ✅',
      pending: 'Pendiente ⏳',
      target: 'Objetivo 🎯'
    },
    detail: {
      notes: 'Notas',
      coverLetter: 'Carta de presentación',
      salary: 'Salario',
      added: 'Agregado',
      today: 'Hoy',
      yesterday: 'Ayer',
      blocked: 'Bloqueado:',
      remote: '🌎 Remoto'
    },
    actions: {
      markApplied: '✓ Aplicar',
      markInterview: '💬 Entrevista',
      markOffer: '🎉 Oferta',
      reject: '✕ Rechazar',
      delete: '🗑 Eliminar',
      open: '↗ Abrir'
    },
    priority: {
      actionable: 'accionables · ordenados por puntaje'
    },
    hunt: {
      start: '⚡ Hunt',
      running: '⚡ Buscando…',
      started: 'Búsqueda iniciada — consultando APIs…',
      failed: 'Búsqueda fallida: '
    },
    toast: {
      applied: 'Postulado ✓',
      interview: '¡Entrevista! 💬',
      offer: '¡OFERTA! 🎉',
      rejected: 'Rechazado',
      alreadyTracked: 'Ya registrado',
      companyRequired: 'Empresa + rol requeridos',
      nameRequired: 'Nombre requerido',
      confirmDelete: '¿Eliminar esta oportunidad?'
    },
    diff: {
      easy: 'Fácil',
      medium: 'Medio',
      hard: 'Difícil'
    },
    goal: {
      label: 'Meta mensual',
      funded: '% alcanzado'
    },
    nav: {
      add: '+ Agregar',
      income: '$ Ingreso'
    }
  }
};

const EN = {
  translation: {
    stats: {
      found: 'Found',
      applied: 'Applied',
      interview: 'Interview',
      offers: 'Offers',
      rejected: 'Rejected',
      blocked: 'Blocked',
      responseRate: 'Response Rate'
    },
    tabs: {
      kanban: 'Kanban',
      list: 'List',
      priority: 'Priority',
      directory: 'Directory',
      monetize: 'Monetize',
      research: 'Research'
    },
    columns: {
      found: 'Found',
      applied: 'Applied',
      interview: 'Interview',
      offer: 'Offer',
      rejected: 'Rejected',
      blocked: 'Blocked'
    },
    list: {
      role: 'Role / Company',
      salary: 'Salary',
      source: 'Source',
      status: 'Status',
      date: 'Date'
    },
    sidebar: {
      liveActivity: '⚡ Live Activity',
      agentFeed: 'Agent Communication Feed',
      deployed: 'Deployed agents',
      agentCount: '{{total}} agents · {{active}} active'
    },
    agentModal: {
      skills: 'Skills',
      scripts: 'Scripts',
      recentActivity: 'Recent Activity',
      born: 'Born',
      logEntries: 'Log entries',
      applications: 'Applications',
      errors: 'Errors',
      loading: 'Loading...',
      noActivity: 'No recent activity.',
      errorActivity: 'Error loading activity'
    },
    logDetail: {
      rawOutput: 'Raw output',
      close: '✕ Close',
      noDetail: '(no detail)'
    },
    modal: {
      addTitle: 'Add Opportunity',
      company: 'Company *',
      role: 'Role *',
      salary: 'Salary / Pay',
      status: 'Status',
      source: 'Source',
      location: 'Location',
      url: 'URL',
      easyApply: 'Easy Apply?',
      notes: 'Notes',
      coverLetter: 'Cover Letter',
      cancel: 'Cancel',
      add: 'Add →',
      close: 'Close',
      open: '↗ Open'
    },
    statusOpts: {
      found: 'Found',
      applied: 'Applied',
      interview: 'Interview',
      offer: 'Offer'
    },
    incomeModal: {
      title: 'Add Income Stream',
      name: 'Name',
      type: 'Type',
      status: 'Status',
      monthlyUsd: 'Monthly USD',
      notes: 'Notes',
      addStream: 'Add Stream',
      active: 'Active ✅',
      pending: 'Pending ⏳',
      target: 'Target 🎯'
    },
    detail: {
      notes: 'Notes',
      coverLetter: 'Cover Letter',
      salary: 'Salary',
      added: 'Added',
      today: 'Today',
      yesterday: 'Yesterday',
      blocked: 'Blocked:',
      remote: '🌎 Remote'
    },
    actions: {
      markApplied: '✓ Applied',
      markInterview: '💬 Interview',
      markOffer: '🎉 Offer',
      reject: '✕ Reject',
      delete: '🗑 Delete',
      open: '↗ Open'
    },
    priority: {
      actionable: 'actionable · sorted by score'
    },
    hunt: {
      start: '⚡ Hunt',
      running: '⚡ Hunting…',
      started: 'Hunt started — checking APIs…',
      failed: 'Hunt failed: '
    },
    toast: {
      applied: 'Applied ✓',
      interview: 'Interview! 💬',
      offer: 'OFFER! 🎉',
      rejected: 'Rejected',
      alreadyTracked: 'Already tracked',
      companyRequired: 'Company + role required',
      nameRequired: 'Name required',
      confirmDelete: 'Remove this opportunity?'
    },
    diff: {
      easy: 'Easy',
      medium: 'Medium',
      hard: 'Hard'
    },
    goal: {
      label: 'Monthly Goal',
      funded: '% funded'
    },
    nav: {
      add: '+ Add',
      income: '$ Income'
    }
  }
};

i18next.init({
  lng: localStorage.getItem('huntdesk-lang') || 'es',
  fallbackLng: 'en',
  resources: { es: ES, en: EN },
}, function(err) {
  if (err) console.warn('i18n error:', err);
});

window.t = (key, opts) => i18next.t(key, opts);

function switchLanguage() {
  const newLng = i18next.language === 'es' ? 'en' : 'es';
  i18next.changeLanguage(newLng, () => {
    localStorage.setItem('huntdesk-lang', newLng);
    // Re-render static HTML labels
    applyI18n();
    // Re-render dynamic views
    if (typeof renderView === 'function') renderView();
    if (typeof renderAgentRoster === 'function') renderAgentRoster(new Set());
  });
}

function applyI18n() {
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  // Update lang toggle btn
  const btn = document.getElementById('langToggle');
  if (btn) btn.textContent = i18next.language === 'es' ? '🌐 EN' : '🌐 ES';
}
