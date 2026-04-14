// chat.js — Chat with Senku (Orchestrator) + Settings Tab

// ── Chat state ────────────────────────────────────────────────────────────────
let chatHistory = []; // { role: 'user'|'assistant', text, ts }
let chatBusy = false;

// ── Render Chat Tab ───────────────────────────────────────────────────────────
function renderChatView() {
  const el = document.getElementById('chatView');
  if (!el) return;
  _chatLastRenderedCount = chatHistory.length;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;gap:0">
      <!-- Header -->
      <div style="padding:1rem 1.25rem .75rem;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;gap:.75rem">
        <img src="/avatars/senku_v6.png" onerror="this.style.display='none'" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0"/>
        <div>
          <div style="font-size:.75rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--purple);font-family:'Rajdhani',sans-serif">⚡ SENKU — ORQUESTADOR</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:2px">Preguntá estrategia, análisis de postulaciones, próximos pasos</div>
        </div>
      </div>

      <!-- Messages -->
      <div id="chatMessages" style="flex:1;overflow-y:auto;padding:1rem 1.25rem;display:flex;flex-direction:column;gap:.75rem">
        ${chatHistory.length === 0 ? `
        <div style="display:flex;gap:.75rem;align-items:flex-start">
          <img src="/avatars/senku_v6.png" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='flex')" style="width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0"/>
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:0 12px 12px 12px;padding:.65rem .9rem;font-size:.82rem;line-height:1.6;max-width:80%">
            Hola! Soy Senku, tu orquestador de búsqueda laboral. Tengo acceso a tu base de datos de postulaciones y la actividad de los agentes.<br><br>
            Probá preguntando:<br>
            <span style="color:var(--purple);cursor:pointer" onclick="chatSuggest(this.textContent)">• ¿Qué debería hacer ahora para conseguir trabajo más rápido?</span><br>
            <span style="color:var(--purple);cursor:pointer" onclick="chatSuggest(this.textContent)">• ¿Qué fuentes están trayendo más resultados?</span><br>
            <span style="color:var(--purple);cursor:pointer" onclick="chatSuggest(this.textContent)">• Revisá mi pipeline y decime qué me está bloqueando</span>
          </div>
        </div>` : chatHistory.map((m, i) => renderChatMsg(m, i)).join('')}
      </div>

      <!-- Input -->
      <div style="padding:.75rem 1.25rem;border-top:1px solid var(--border);flex-shrink:0;display:flex;gap:.6rem">
        <input id="chatInput" placeholder="Preguntale a Senku sobre tu búsqueda laboral..."
          style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:.6rem .9rem;color:var(--text);font-size:.82rem;font-family:'Rajdhani',sans-serif;outline:none;transition:border .2s"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage()}"
        />
        <button onclick="sendChatMessage()" id="chatSendBtn"
          style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:.6rem 1rem;font-size:.82rem;font-weight:700;cursor:pointer;font-family:'Rajdhani',sans-serif;white-space:nowrap;transition:opacity .2s">
          Enviar ↵
        </button>
      </div>
    </div>
  `;
}

let _chatLastRenderedCount = 0;

function renderChatMsg(msg, idx) {
  const isUser = msg.role === 'user';
  const isNew = idx >= _chatLastRenderedCount - 1 && chatHistory.length > 1;
  const avatar = isUser
    ? `<div style="width:32px;height:32px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0;color:#fff">${(window._cfg?.firstName||'U')[0].toUpperCase()}</div>`
    : `<img src="/avatars/senku_v6.png" style="width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.outerHTML='<div style=\\'width:32px;height:32px;border-radius:8px;background:#f97316;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0\\'>⚗️</div>'"/>`;
  const bubbleStyle = isUser
    ? 'background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:12px 0 12px 12px;margin-left:auto'
    : 'background:var(--bg3);border:1px solid var(--border);border-radius:0 12px 12px 12px';
  const txt = (msg.text || '').replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
  const newDot = isNew && isUser ? '<span style="display:inline-block;width:6px;height:6px;background:var(--green);border-radius:50%;margin-left:6px;vertical-align:middle"></span>' : '';
  return `
    <div style="display:flex;gap:.75rem;align-items:flex-start;flex-direction:${isUser?'row-reverse':'row'}">
      ${avatar}
      <div style="display:flex;flex-direction:column;gap:3px;max-width:80%;${isUser?'align-items:flex-end':''}">
        <div style="${bubbleStyle};padding:.65rem .9rem;font-size:.82rem;line-height:1.6">${txt}${newDot}</div>
        ${time ? `<div style="font-size:.68rem;color:var(--muted);padding:0 .25rem">${time}</div>` : ''}
      </div>
    </div>`;
}

function chatSuggest(text) {
  const inp = document.getElementById('chatInput');
  if (inp) { inp.value = text; inp.focus(); }
}

async function sendChatMessage() {
  if (chatBusy) return;
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (!msg) return;

  inp.value = '';
  chatBusy = true;
  const btn = document.getElementById('chatSendBtn');
  if (btn) btn.textContent = '...';

  // Add user message
  chatHistory.push({ role: 'user', text: msg, ts: new Date().toISOString() });

  // Add thinking indicator
  const thinkingId = 'thinking_' + Date.now();
  chatHistory.push({ role: 'assistant', text: '...', ts: new Date().toISOString(), id: thinkingId });
  renderChatView();
  scrollChatToBottom();

  try {
    const r = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    });
    const d = await r.json();

    // Replace thinking indicator with real response
    const idx = chatHistory.findIndex(m => m.id === thinkingId);
    if (idx !== -1) chatHistory[idx] = { role: 'assistant', text: d.reply || 'No response.', ts: new Date().toISOString() };
  } catch (e) {
    const idx = chatHistory.findIndex(m => m.id === thinkingId);
    if (idx !== -1) chatHistory[idx] = { role: 'assistant', text: `Error: ${e.message}`, ts: new Date().toISOString() };
  }

  chatBusy = false;
  if (btn) btn.textContent = 'Send ↵';
  renderChatView();
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const el = document.getElementById('chatMessages');
  if (el) setTimeout(() => el.scrollTop = el.scrollHeight, 50);
}

// ── Settings Modal ─────────────────────────────────────────────────────────────
let settingsTab = 'profile';
let settingsCfg = {};

async function openSettings() {
  try {
    settingsCfg = await fetch(`${API}/config`).then(r => r.json());
    window._cfg = settingsCfg;
  } catch {}
  renderSettingsModal();
  openModal('settingsOverlay');
}

function renderSettingsModal() {
  const el = document.getElementById('settingsContent');
  if (!el) return;

  const tabs = [
    { id: 'profile',  label: '👤 Profile' },
    { id: 'search',   label: '🎯 Search' },
    { id: 'apikeys',  label: '🔑 API Keys' },
    { id: 'agents',   label: '🤖 Agents' },
    { id: 'backup',   label: '💾 Backup' },
  ];

  el.innerHTML = `
    <!-- Settings tabs -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin:-1.5rem -1.5rem 1.25rem;padding:0 1.5rem">
      ${tabs.map(t => `
        <button onclick="switchSettingsTab('${t.id}')" id="stab_${t.id}"
          style="background:none;border:none;color:${settingsTab===t.id?'var(--text)':'var(--muted)'};border-bottom:2px solid ${settingsTab===t.id?'var(--accent)':'transparent'};padding:.55rem .75rem;font-size:.78rem;font-weight:700;cursor:pointer;font-family:'Rajdhani',sans-serif;letter-spacing:.5px;transition:all .2s;white-space:nowrap">
          ${t.label}
        </button>`).join('')}
    </div>

    <!-- Tab content -->
    <div id="settingsTabContent">${renderSettingsTabContent()}</div>
  `;
}

function switchSettingsTab(tab) {
  settingsTab = tab;
  // Update active state
  document.querySelectorAll('[id^="stab_"]').forEach(b => {
    const isActive = b.id === `stab_${tab}`;
    b.style.color = isActive ? 'var(--text)' : 'var(--muted)';
    b.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
  });
  const content = document.getElementById('settingsTabContent');
  if (content) content.innerHTML = renderSettingsTabContent();
}

function renderSettingsTabContent() {
  const c = settingsCfg;
  if (settingsTab === 'profile') return `
    <div class="modal-grid">
      <div class="fld"><label>First Name</label><input id="sf_FIRST_NAME" value="${c.firstName||''}" placeholder="Jane"/></div>
      <div class="fld"><label>Last Name</label><input id="sf_LAST_NAME"  value="${c.lastName||''}"  placeholder="Doe"/></div>
      <div class="fld"><label>Email</label><input id="sf_EMAIL" value="${c.email||''}" placeholder="jane@example.com"/></div>
      <div class="fld"><label>Phone</label><input id="sf_PHONE" value="${c.phone||''}" placeholder="+1 555 000 0000"/></div>
      <div class="fld"><label>City, Country</label><input id="sf_CITY" value="${c.city||''}" placeholder="New York, USA"/></div>
      <div class="fld"><label>LinkedIn URL</label><input id="sf_LINKEDIN" value="${c.linkedin||''}" placeholder="https://linkedin.com/in/..."/></div>
      <div class="fld"><label>GitHub URL</label><input id="sf_GITHUB" value="${c.github||''}" placeholder="https://github.com/..."/></div>
      <div class="fld"><label>Portfolio URL</label><input id="sf_PORTFOLIO" value="${c.portfolio||''}" placeholder="https://yoursite.com"/></div>
      <div class="fld" style="grid-column:1/-1"><label>CV / Resume PDF path</label><input id="sf_CV_PATH" value="${c.cvPath||''}" placeholder="/Users/you/Documents/CV.pdf"/></div>
      <div class="fld" style="grid-column:1/-1"><label>Profile bio (used in cover letters, ~50 words)</label><textarea id="sf_PROFILE_TEXT" rows="3" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:.5rem .75rem;color:var(--text);font-family:'Rajdhani',sans-serif;font-size:.85rem;resize:vertical">${c.profileText||''}</textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('settingsOverlay')">Cancel</button>
      <button class="btn btn-accent" onclick="saveSettings('profile')">💾 Save Profile</button>
    </div>`;

  if (settingsTab === 'search') return `
    <div class="modal-grid">
      <div class="fld" style="grid-column:1/-1"><label>Skills to search (comma-separated)</label>
        <input id="sf_SEARCH_TAGS" value="${c.searchTags||''}" placeholder="react,typescript,nextjs,frontend"/></div>
      <div class="fld"><label>Location preference</label>
        <input id="sf_SEARCH_LOCATION" value="${c.location||''}" placeholder="Remote, Americas"/></div>
      <div class="fld"><label>Monthly salary target</label>
        <input id="sf_SALARY_TARGET" value="${c.goal||''}" placeholder="$2,500/mo"/></div>
      <div class="fld" style="grid-column:1/-1"><label>Custom X.com searches (pipe-separated, optional)</label>
        <input id="sf_X_SEARCHES" value="${c.xSearches||''}" placeholder="hiring react remote|typescript fullstack jobs"/></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('settingsOverlay')">Cancel</button>
      <button class="btn btn-accent" onclick="saveSettings('search')">💾 Save Search Prefs</button>
    </div>`;

  if (settingsTab === 'apikeys') return `
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:1rem;background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:.65rem .9rem">
      🔒 Keys are saved to your local <code style="background:rgba(124,58,237,.15);padding:.1rem .3rem;border-radius:4px">.env</code> file — never sent to any server.
    </div>
    <div class="modal-grid">
      <div class="fld" style="grid-column:1/-1">
        <label>Groq API Key <span style="color:var(--green);font-size:.75rem">(FREE — required)</span></label>
        <div style="display:flex;gap:.5rem">
          <input id="sf_GROQ_API_KEY" type="password" value="${c.hasGroq?'••••••••••••••••••••••••••':''})" placeholder="gsk_..." style="flex:1"/>
          <a href="https://console.groq.com" target="_blank" style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:.45rem .75rem;color:var(--purple);font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none">Get free key →</a>
        </div>
      </div>
      <div class="fld" style="grid-column:1/-1">
        <label>OpenRouter API Key <span style="color:var(--muted);font-size:.75rem">(optional — enables Claude/GPT)</span></label>
        <div style="display:flex;gap:.5rem">
          <input id="sf_OPENROUTER_API_KEY" type="password" value="${c.hasOR?'••••••••••••••••••••••••••':''})" placeholder="sk-or-..." style="flex:1"/>
          <a href="https://openrouter.ai/keys" target="_blank" style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:.45rem .75rem;color:var(--purple);font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none">Get key →</a>
        </div>
      </div>
    </div>
    <div style="font-size:.76rem;color:var(--muted);margin-top:.5rem">
      💡 Leave a key field empty to keep the current value.
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('settingsOverlay')">Cancel</button>
      <button class="btn btn-accent" onclick="saveSettings('apikeys')">💾 Save API Keys</button>
    </div>`;

  if (settingsTab === 'agents') return renderAgentsTab();

  if (settingsTab === 'backup') return `
    <div style="display:flex;flex-direction:column;gap:1rem">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:1rem">
        <div style="font-weight:700;margin-bottom:.35rem">📤 Export Backup</div>
        <div style="font-size:.8rem;color:var(--muted);margin-bottom:.75rem">Downloads a JSON file with your profile, all applications, and income streams. API keys are NOT included for security.</div>
        <button class="btn btn-accent" onclick="exportBackup()" style="width:auto;padding:.45rem 1.2rem">Download huntdesk-backup.json</button>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:1rem">
        <div style="font-weight:700;margin-bottom:.35rem">📥 Import Backup</div>
        <div style="font-size:.8rem;color:var(--muted);margin-bottom:.75rem">Restore profile and applications from a previously exported backup. Won't overwrite API keys.</div>
        <input type="file" id="importFile" accept=".json" style="display:none" onchange="importBackup(this)"/>
        <button class="btn btn-accent" onclick="document.getElementById('importFile').click()" style="width:auto;padding:.45rem 1.2rem;background:var(--bg3);border:1px solid var(--accent);color:var(--accent)">Choose backup file...</button>
        <div id="importStatus" style="margin-top:.5rem;font-size:.8rem;color:var(--muted)"></div>
      </div>
    </div>`;

  return '';
}

function renderAgentsTab() {
  const roster = typeof AGENT_ROSTER !== 'undefined' ? AGENT_ROSTER : [];
  return `
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:.75rem">Customize agent display names and avatars. Names are used in the UI only.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem" id="agentsGrid">
      ${roster.map(a => `
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:.75rem;display:flex;flex-direction:column;align-items:center;gap:.5rem">
          <div style="position:relative">
            <img src="${a.avatar||''}" onerror="this.style.display='none'" id="agAvatar_${a.key}"
              style="width:48px;height:48px;border-radius:10px;object-fit:cover;border:2px solid ${a.color||'var(--border)'}"/>
            <button onclick="triggerAvatarUpload('${a.key}')" title="Change avatar"
              style="position:absolute;bottom:-4px;right:-4px;background:var(--accent);border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:.6rem;display:flex;align-items:center;justify-content:center;color:#fff">✏</button>
            <input type="file" id="avatarInput_${a.key}" accept="image/*" style="display:none" onchange="uploadAvatar('${a.key}',this)"/>
          </div>
          <input id="agName_${a.key}" value="${a.name}" style="text-align:center;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-size:.85rem;font-weight:700;width:100%;font-family:'Rajdhani',sans-serif"/>
          <div style="font-size:.7rem;color:var(--muted)">${a.shortRole||''}</div>
        </div>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('settingsOverlay')">Cancel</button>
      <button class="btn btn-accent" onclick="saveAgentNames()">💾 Save Names</button>
    </div>`;
}

// ── Settings Actions ──────────────────────────────────────────────────────────
async function saveSettings(tab) {
  const fields = {};

  if (tab === 'profile') {
    ['FIRST_NAME','LAST_NAME','EMAIL','PHONE','CITY','LINKEDIN','GITHUB','PORTFOLIO','CV_PATH'].forEach(k => {
      const el = document.getElementById(`sf_${k}`);
      if (el && el.value.trim()) fields[k] = el.value.trim();
    });
    const bio = document.getElementById('sf_PROFILE_TEXT');
    if (bio && bio.value.trim()) fields['PROFILE_TEXT'] = bio.value.trim();
  }

  if (tab === 'search') {
    ['SEARCH_TAGS','SEARCH_LOCATION','SALARY_TARGET','X_SEARCHES'].forEach(k => {
      const el = document.getElementById(`sf_${k}`);
      if (el && el.value.trim()) fields[k] = el.value.trim();
    });
  }

  if (tab === 'apikeys') {
    ['GROQ_API_KEY','OPENROUTER_API_KEY'].forEach(k => {
      const el = document.getElementById(`sf_${k}`);
      const val = el?.value?.trim();
      // Only save if it's a real key (not the placeholder dots)
      if (val && !val.startsWith('•')) fields[k] = val;
    });
  }

  if (Object.keys(fields).length === 0) {
    toast('No changes to save', 'warn');
    return;
  }

  try {
    await fetch(`${API}/config/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    // Refresh config
    settingsCfg = await fetch(`${API}/config`).then(r => r.json());
    window._cfg = settingsCfg;
    // Update header
    const sub = document.getElementById('headerSub');
    if (sub) sub.textContent = `${settingsCfg.name} · ${settingsCfg.location} · 🎯 ${settingsCfg.goal}`;
    toast('✓ Saved to .env', 'ok');
    closeModal('settingsOverlay');
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
}

async function saveAgentNames() {
  const roster = typeof AGENT_ROSTER !== 'undefined' ? AGENT_ROSTER : [];
  const config = {};
  for (const a of roster) {
    const el = document.getElementById(`agName_${a.key}`);
    if (el) config[a.key] = { name: el.value };
  }
  try {
    await fetch(`${API}/agents/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    toast('✓ Agent names saved', 'ok');
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
}

function triggerAvatarUpload(agentKey) {
  document.getElementById(`avatarInput_${agentKey}`)?.click();
}

async function uploadAvatar(agentKey, input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      await fetch(`${API}/agents/${agentKey}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: e.target.result }),
      });
      const img = document.getElementById(`agAvatar_${agentKey}`);
      if (img) { img.src = `/avatars/${agentKey}.png?t=${Date.now()}`; img.style.display = 'block'; }
      toast('✓ Avatar updated', 'ok');
    } catch (err) { toast('Upload failed', 'error'); }
  };
  reader.readAsDataURL(file);
}

function exportBackup() {
  window.open(`${API}/export`, '_blank');
}

async function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('importStatus');
  if (statusEl) statusEl.textContent = 'Reading file...';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const r = await fetch(`${API}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await r.json();
    if (result.ok) {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--green)">✓ Imported ${result.imported} applications + profile restored. Reload to see changes.</span>`;
      toast(`✓ Imported ${result.imported} records`, 'ok');
      setTimeout(() => loadAll(), 1500);
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">❌ ${result.error}</span>`;
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">❌ Invalid file: ${e.message}</span>`;
  }
}
