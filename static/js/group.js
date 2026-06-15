// static/js/group.js
// Group Chat — multi-model conversations (parallel or round-robin)

import uiModule from './ui.js';
import markdownModule from './markdown.js';
import chatRenderer from './chatRenderer.js';
import spinnerModule from './spinner.js';
import { providerLogo } from './providers.js';
import { PROMPT_TEMPLATES, getAllPresets } from './presets.js';
import { sortModelObjects } from './modelSort.js';

let API_BASE = '';
let _active = false;
let _models = [];          // [{mid, display, url, endpointId}]
let _participantSessions = [];  // session IDs for each model
const _groupParticipants = [];  // module-level participants list
let _abortControllers = [];
let _mode = 'round-robin';    // 'parallel' or 'round-robin'
let _roundRobinIdx = 0;
let _parentSessionId = null;
const GROUP_STATE_KEY = 'odysseus-group-state';
const COUNCIL_ROLES = [
  'Product Strategist',
  'Research Agent',
  'Architect',
  'UX Designer',
  'Frontend Engineer',
  'Backend Engineer',
  'DevOps Engineer',
  'QA Engineer',
  'Documentation Agent',
];
const COUNCIL_CONSENSUS_TARGET = 85;
const COUNCIL_MIN_AGENT_CONSENSUS = 80;
const COUNCIL_MAX_CONSENSUS_ROUNDS = 3;
const COUNCIL_ARTIFACT_QA_MIN_SCORE = 85;
const COUNCIL_ARTIFACT_QA_MAX_REVISIONS = 2;
const ORACLE_COUNCIL_PHASE_LABELS = {
  started: 'Council workflow started.',
  position: 'Council is opening positions.',
  evidence: 'Council is checking evidence.',
  convergence: 'Council is converging.',
  consensus: 'Council is voting on consensus.',
  synthesis: 'Council is preparing synthesis.',
  completed: 'Council workflow completed.',
  blocked: 'Council workflow needs review.',
};

function _requestOracleCouncilNarration(eventType, phaseKey, options = {}) {
  const runtime = window.oracleVoiceRuntime;
  const status = runtime && runtime.status ? runtime.status : null;
  if (!runtime || !status || !status.active || status.state === 'cancelled' || status.state === 'interrupted') return false;
  const message = ORACLE_COUNCIL_PHASE_LABELS[phaseKey] || ORACLE_COUNCIL_PHASE_LABELS.started;
  window.dispatchEvent(new CustomEvent('oraclevoice:narration-request', {
    detail: {
      source: 'council_workflow',
      eventType: eventType,
      message: message,
      councilPhase: phaseKey,
      speak: options.speak === true,
      requireActive: true,
    },
  }));
  return true;
}

export function init(apiBase) {
  API_BASE = apiBase;
  // Initialize Group tab inside Characters modal
  setTimeout(_initGroupTab, 500);
}

function _initGroupTab() {
  const participantsEl = document.getElementById('group-participants');
  const addBtn = document.getElementById('group-add-btn');
  const startBtn = document.getElementById('save-custom-preset'); // main footer "Start" button
  const modeBtn = document.getElementById('group-mode-btn');
  if (!participantsEl || !addBtn) return;

  // _groupParticipants is at module scope
  let _modelsCache = null;

  async function _getModels() {
    if (_modelsCache) return _modelsCache;
    let items = (window.modelsModule && window.modelsModule.getCachedItems) ? window.modelsModule.getCachedItems() : [];
    if (!items || items.length === 0) {
      try {
        const res = await fetch(API_BASE + '/api/models', { credentials: 'same-origin' });
        items = (await res.json()).items || [];
      } catch (e) {}
    }
    const result = [];
    const seen = new Set();
    items.forEach(item => {
      if (item.offline) return;
      (item.models || []).concat(item.models_extra || []).forEach((mid, i) => {
        if (seen.has(mid)) return;
        seen.add(mid);
        const display = ((item.models_display || []).concat(item.models_extra_display || []))[i] || mid;
        result.push({ mid, display: display.split('/').pop(), url: item.url, endpointId: item.endpoint_id });
      });
    });
    _modelsCache = sortModelObjects(result);
    return result;
  }

  function _render() {
    participantsEl.innerHTML = '';
    _groupParticipants.forEach((p, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;background:color-mix(in srgb, var(--fg) 3%, transparent);border-radius:6px;';
      const label = p.character ? p.character.name : (p.model ? p.model.display : '?');
      const sublabel = p.model ? p.model.display : '';
      row.innerHTML = `
        <span style="flex:1;min-width:0;">
          <span style="font-size:12px;font-weight:500;">${uiModule.esc(label)}</span>
          ${sublabel && sublabel !== label ? '<span style="font-size:10px;opacity:0.35;margin-left:4px;">' + uiModule.esc(sublabel) + '</span>' : ''}
        </span>
        <button style="background:none;border:none;color:var(--fg);opacity:0.5;cursor:pointer;font-size:16px;padding:0 4px;line-height:1;position:relative;top:-4px;" data-idx="${idx}" title="Remove">&times;</button>
      `;
      row.querySelector('button').addEventListener('click', () => { _groupParticipants.splice(idx, 1); _render(); });
      participantsEl.appendChild(row);
    });
    // startBtn is shared — don't disable it
  }

  addBtn.addEventListener('click', async () => {
    const [models, characters] = await Promise.all([_getModels(), _getCharacterList()]);

    const picker = document.createElement('div');
    picker.style.cssText = 'display:flex;gap:4px;align-items:center;';

    const charSel = document.createElement('select');
    charSel.className = 'preset-input';
    charSel.style.cssText = 'font-size:11px;flex:1;height:26px;';
    charSel.innerHTML = '<option value="">Empty...</option>' +
      characters.map(c => '<option value="' + c.id + '">' + uiModule.esc(c.name) + '</option>').join('');

    const modelSel = document.createElement('select');
    modelSel.className = 'preset-input';
    modelSel.style.cssText = 'font-size:11px;flex:1;height:26px;';
    modelSel.innerHTML = '<option value="">Model…</option>' +
      models.map(m => '<option value="' + m.mid + '">' + uiModule.esc(m.display) + '</option>').join('');

    // Auto-add when model is selected
    modelSel.addEventListener('change', () => {
      if (!modelSel.value) return;
      if (_groupParticipants.length >= 8) { uiModule.showToast('Max 8'); return; }
      const entry = { character: null, model: null };
      entry.model = models.find(m => m.mid === modelSel.value) || null;
      if (charSel.value) entry.character = characters.find(c => c.id === charSel.value) || null;
      _groupParticipants.push(entry);
      picker.remove();
      _render();
    });

    picker.appendChild(charSel);
    picker.appendChild(modelSel);
    participantsEl.appendChild(picker);
  });

  // Mode toggle — same style as Compare's parallel button
  if (modeBtn) {
    const ICON_PAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
    const ICON_SEQ = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>';
    modeBtn.addEventListener('click', () => {
      _mode = _mode === 'parallel' ? 'round-robin' : 'parallel';
      modeBtn.classList.toggle('active', _mode === 'parallel');
      modeBtn.innerHTML = (_mode === 'parallel' ? ICON_PAR : ICON_SEQ) + '<span class="compare-toggle-label">' + (_mode === 'parallel' ? 'Parallel' : 'Sequential') + '</span>';
    });
  }

  // Hook into the main "Start" button — only act when Group tab is active
  if (startBtn) startBtn.addEventListener('click', async () => {
    const activeTab = document.querySelector('.preset-tab.active');
    if (!activeTab || activeTab.dataset.chartab !== 'group') return;
    // Get default model from current session as fallback
    const _defaultModel = (window.sessionModule && window.sessionModule.getSessions) ?
      (() => {
        const s = window.sessionModule.getSessions().find(x => x.id === window.sessionModule.getCurrentSessionId());
        if (s) return { mid: s.model, display: s.model.split('/').pop(), url: s.endpoint_url, endpointId: '' };
        return null;
      })() : null;

    const picked = _groupParticipants.map(p => {
      let m = p.model ? { ...p.model } : (_defaultModel ? { ..._defaultModel } : null);
      if (!m || !m.url) {
        console.warn('[group] Participant has no valid model:', p);
        return null;
      }
      if (p.character) m.character = { characterId: p.character.id, characterName: p.character.name, characterPrompt: p.character.prompt };
      return m;
    }).filter(Boolean);

    if (picked.length < 2) { uiModule.showToast('Need at least 2 participants — add models or characters'); return; }

    const modal = document.getElementById('custom-preset-modal');
    if (modal) modal.classList.add('hidden');

    setActive(true);
    if (window._syncGroupIndicator) window._syncGroupIndicator(true);
    if (window.sessionModule) window.sessionModule.setCurrentSessionId(null);
    const box = document.getElementById('chat-history');
    if (box) box.innerHTML = '';

    await startGroup(picked, 'group-' + Date.now());

    // Auto-save as preset if 2+ participants
    if (picked.length >= 2) {
      const presetData = {
        id: 'grp-' + Date.now(),
        name: picked.map(p => p._groupName || p.character?.characterName || p.display).join(' & '),
        mode: _mode,
        participants: picked.map(p => ({
          modelId: p.mid,
          modelDisplay: p.display,
          characterId: p.character?.characterId || null,
          characterName: p.character?.characterName || null,
        })),
      };
      try {
        const existing = await fetch(API_BASE + '/api/presets/groups', { credentials: 'same-origin' }).then(r => r.json());
        const groups = existing.groups || [];
        // Don't duplicate if same participants
        const sig = presetData.participants.map(p => p.modelId + ':' + (p.characterId || '')).sort().join(',');
        const exists = groups.some(g => (g.participants || []).map(p => p.modelId + ':' + (p.characterId || '')).sort().join(',') === sig);
        if (!exists) {
          groups.push(presetData);
          await fetch(API_BASE + '/api/presets/groups', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups }),
          });
        }
      } catch (e) {}
    }

    uiModule.showToast('Group chat ready — ' + picked.length + ' participants');
  });

  const groupTab = document.querySelector('.preset-tab[data-chartab="group"]');
  if (groupTab) groupTab.addEventListener('click', () => {
    _modelsCache = null;
    if (startBtn) startBtn.textContent = 'Start Group';
    _loadGroupPresets();
    if (_groupParticipants.length === 0) {
      setTimeout(() => addBtn.click(), 100);
    }
  });

  // Load and render saved group presets
  async function _loadGroupPresets() {
    try {
      const res = await fetch(API_BASE + '/api/presets/groups', { credentials: 'same-origin' });
      const data = await res.json();
      const groups = data.groups || [];
      // Render presets above participant list
      let presetsDiv = document.getElementById('group-presets-list');
      if (!presetsDiv) {
        presetsDiv = document.createElement('div');
        presetsDiv.id = 'group-presets-list';
        presetsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;';
        participantsEl.parentNode.insertBefore(presetsDiv, participantsEl);
      }
      presetsDiv.innerHTML = '';
      if (groups.length === 0) return;
      groups.forEach((g, idx) => {
        const chip = document.createElement('button');
        chip.className = 'preset-save-btn';
        chip.style.cssText = 'padding:3px 10px;font-size:11px;background:color-mix(in srgb, var(--fg) 5%, transparent);border:1px solid var(--border);';
        const chipLabel = document.createElement('span');
        chipLabel.textContent = g.name || 'Group ' + (idx + 1);
        chip.appendChild(chipLabel);
        const chipX = document.createElement('span');
        chipX.textContent = ' \u00d7';
        chipX.style.cssText = 'opacity:0.4;margin-left:4px;cursor:pointer;';
        chipX.addEventListener('click', (ev) => {
          ev.stopPropagation();
          groups.splice(idx, 1);
          fetch(API_BASE + '/api/presets/groups', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups }),
          }).then(() => _loadGroupPresets());
        });
        chip.appendChild(chipX);
        chip.title = (g.participants || []).map(p => p.characterName || p.modelDisplay || '?').join(', ');
        chip.addEventListener('click', async () => {
          // Load preset participants
          const [models, chars] = await Promise.all([_getModels(), _getCharacterList()]);
          _groupParticipants.length = 0;
          (g.participants || []).forEach(p => {
            const model = models.find(m => m.mid === p.modelId) || models[0];
            const entry = { model: model || null, character: null };
            if (p.characterId) {
              entry.character = chars.find(c => c.id === p.characterId) || null;
            }
            if (entry.model) _groupParticipants.push(entry);
          });
          _mode = g.mode || 'parallel';
          _render();
        });
        // Long-press / right-click to delete
        chip.addEventListener('contextmenu', async (e) => {
          e.preventDefault();
          if (await window.styledConfirm('Delete preset "' + (g.name || 'Group') + '"?', { confirmText: 'Delete', danger: true })) {
            groups.splice(idx, 1);
            fetch(API_BASE + '/api/presets/groups', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groups }),
            }).then(() => _loadGroupPresets());
          }
        });
        presetsDiv.appendChild(chip);
      });
    } catch (e) { console.warn('[group] Failed to load presets:', e); }
  }
  // Restore button text when switching away from Group tab
  document.querySelectorAll('.preset-tab[data-chartab]').forEach(tab => {
    if (tab.dataset.chartab !== 'group') {
      tab.addEventListener('click', () => {
        if (startBtn) startBtn.textContent = 'Start';
      });
    }
  });
}

async function _getCharacterList() {
  // Built-in characters from PROMPT_TEMPLATES
  const chars = PROMPT_TEMPLATES.filter(t => t.isCharacter).map(t => ({
    id: t.id, name: t.name, prompt: t.prompt,
  }));
  // User-created characters from presets
  try {
    const allPresets = getAllPresets();
    if (allPresets && allPresets.custom && allPresets.custom.character_name) {
      chars.push({
        id: 'custom',
        name: allPresets.custom.character_name,
        prompt: allPresets.custom.system_prompt || allPresets.custom.prompt || '',
      });
    }
  } catch (e) {}
  // Load user templates and wait for them before returning
  try {
    const r = await fetch(API_BASE + '/api/presets/templates', { credentials: 'same-origin' });
    const data = await r.json();
    (data.templates || []).forEach(t => {
      if (t.isCharacter && !chars.find(c => c.id === t.id)) {
        chars.push({ id: t.id, name: t.name, prompt: t.prompt || '' });
      }
    });
  } catch (e) {}
  return chars;
}

export function isActive() { return _active; }
export function setActive(v) { _active = v; }
export function getMode() { return _mode; }
export function setMode(m) { _mode = m; }

// ── Model Picker ─────────────────────────────────────

export async function showModelPicker() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.id = 'group-model-picker';

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.width = 'min(480px, 92vw)';

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = '<h4>' + (document.body.classList.contains('council-mode-active') ? 'Council — Select Models' : 'Group Chat — Select Models') + '</h4>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '&#x2716;';
    closeBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';

    // Mode toggle
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;align-items:center;font-size:12px;';
    modeRow.innerHTML = `
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="radio" name="group-mode" value="parallel" ${_mode === 'parallel' ? 'checked' : ''}> All respond
      </label>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="radio" name="group-mode" value="round-robin" ${_mode === 'round-robin' ? 'checked' : ''}> Round-robin
      </label>
    `;
    body.appendChild(modeRow);

    // Search
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Filter models…';
    search.className = 'memory-search-input';
    search.style.marginBottom = '8px';
    body.appendChild(search);

    // Model list
    const list = document.createElement('div');
    list.style.cssText = 'max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;';
    body.appendChild(list);

    // Selected count + start button
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:10px;';
    footer.innerHTML = `
      <span id="group-selected-count" style="font-size:11px;opacity:0.5;">0 selected</span>
      <button id="group-start-btn" class="btn-primary" disabled style="padding:6px 16px;font-size:12px;">Start Group Chat</button>
    `;
    body.appendChild(footer);

    content.appendChild(header);
    content.appendChild(body);
    overlay.appendChild(content);
    overlay.style.display = 'flex';
    document.body.appendChild(overlay);

    // Get all available models — try cached first, fetch if empty
    const selected = new Set();
    let _cachedModels = null;
    async function getAllModels() {
      if (_cachedModels) return _cachedModels;
      let items = (window.modelsModule && window.modelsModule.getCachedItems) ? window.modelsModule.getCachedItems() : [];
      // Fallback: fetch from API if cache is empty
      if (!items || items.length === 0) {
        try {
          const res = await fetch(API_BASE + '/api/models', { credentials: 'same-origin' });
          const data = await res.json();
          items = data.items || [];
        } catch (e) { console.warn('[group] Failed to fetch models:', e); }
      }
      const result = [];
      const seen = new Set();
      items.forEach(item => {
        if (item.offline) return;
        (item.models || []).concat(item.models_extra || []).forEach((mid, i) => {
          if (seen.has(mid)) return;
          seen.add(mid);
          const display = ((item.models_display || []).concat(item.models_extra_display || []))[i] || mid;
          result.push({ mid, display: display.split('/').pop(), url: item.url, endpointId: item.endpoint_id, epName: item.endpoint_name || '' });
        });
      });
      _cachedModels = sortModelObjects(result);
      return result;
    }

    async function render(filter) {
      list.innerHTML = '<div style="opacity:0.4;padding:8px;font-size:12px;">Loading models…</div>';
      const all = await getAllModels();
      const q = (filter || '').toLowerCase();
      all.forEach(m => {
        if (q && !m.mid.toLowerCase().includes(q) && !m.display.toLowerCase().includes(q) && !m.epName.toLowerCase().includes(q)) return;
        const row = document.createElement('div');
        row.className = 'memory-item';
        row.style.cssText = 'padding:6px 8px;cursor:pointer;' + (selected.has(m.mid) ? 'background:color-mix(in srgb, var(--accent, var(--red)) 12%, transparent);' : '');
        const logo = providerLogo(m.mid);
        row.innerHTML = `
          <input type="checkbox" ${selected.has(m.mid) ? 'checked' : ''} style="margin-right:6px;">
          ${logo ? '<span style="opacity:0.5;margin-right:4px;">' + logo + '</span>' : ''}
          <span style="flex:1;font-size:12px;">${uiModule.esc(m.display)}</span>
          <span style="font-size:10px;opacity:0.3;">${uiModule.esc(m.epName)}</span>
        `;
        row.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          const cb = row.querySelector('input[type=checkbox]');
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        });
        row.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) {
            if (selected.size >= 8) { e.target.checked = false; uiModule.showToast('Max 8 models'); return; }
            selected.add(m.mid);
          } else {
            selected.delete(m.mid);
          }
          document.getElementById('group-selected-count').textContent = selected.size + ' selected';
          document.getElementById('group-start-btn').disabled = selected.size < 2;
          row.style.background = selected.has(m.mid) ? 'color-mix(in srgb, var(--accent, var(--red)) 12%, transparent)' : '';
        });
        list.appendChild(row);
      });
    }

    search.addEventListener('input', () => render(search.value));
    render();

    // Mode toggle
    modeRow.querySelectorAll('input[name=group-mode]').forEach(r => {
      r.addEventListener('change', () => { _mode = r.value; });
    });

    // Start button
    document.getElementById('group-start-btn').addEventListener('click', async () => {
      const all = await getAllModels();
      const picked = all.filter(m => selected.has(m.mid));

      // Step 2: Character assignment
      body.innerHTML = '';
      const stepTitle = document.createElement('div');
      stepTitle.style.cssText = 'font-size:12px;opacity:0.5;margin-bottom:8px;';
      stepTitle.textContent = 'Assign characters (optional)';
      body.appendChild(stepTitle);

      // Build character options
      const characters = await _getCharacterList();
      const assignments = {}; // mid -> {characterId, characterName, characterPrompt}

      for (const m of picked) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);';
        const logo = providerLogo(m.mid);
        row.innerHTML = `
          ${logo ? '<span style="opacity:0.5;">' + logo + '</span>' : ''}
          <span style="flex:1;font-size:12px;font-weight:500;">${uiModule.esc(m.display)}</span>
        `;
        const sel = document.createElement('select');
        sel.style.cssText = 'font-size:11px;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg);color:var(--fg);max-width:140px;';
        let optsHtml = '<option value="">No character</option>';
        characters.forEach(c => {
          optsHtml += `<option value="${c.id}">${uiModule.esc(c.name)}</option>`;
        });
        sel.innerHTML = optsHtml;
        sel.addEventListener('change', () => {
          if (sel.value) {
            const ch = characters.find(c => c.id === sel.value);
            assignments[m.mid] = { characterId: ch.id, characterName: ch.name, characterPrompt: ch.prompt };
          } else {
            delete assignments[m.mid];
          }
        });
        row.appendChild(sel);
        body.appendChild(row);
      }

      // Go button
      const goBtn = document.createElement('button');
      goBtn.className = 'btn-primary';
      goBtn.style.cssText = 'margin-top:10px;padding:6px 16px;font-size:12px;width:100%;';
      goBtn.textContent = 'Start Group Chat';
      goBtn.addEventListener('click', () => {
        // Attach character info to picked models
        picked.forEach(m => {
          if (assignments[m.mid]) {
            m.character = assignments[m.mid];
          }
        });
        overlay.remove();
        resolve(picked);
      });
      body.appendChild(goBtn);
    });

    // Click outside to close
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
    search.focus();
  });
}

// ── Start / Stop ─────────────────────────────────────

export async function startGroup(models, parentSessionId) {
  _models = models;
  _active = true;
  _roundRobinIdx = 0;
  _participantSessions = [];

  // Create a real parent session for persistence
  const groupName = '[GRP] ' + models.map(m => m._groupName || m.character?.characterName || m.display).join(', ');
  try {
    const pfd = new FormData();
    pfd.append('name', groupName);
    pfd.append('endpoint_url', models[0].url);
    pfd.append('model', models[0].mid);
    pfd.append('skip_validation', 'true');
    if (models[0].endpointId) pfd.append('endpoint_id', models[0].endpointId);
    const pres = await fetch(`${API_BASE}/api/session`, { method: 'POST', body: pfd, credentials: 'same-origin' });
    const pdata = await pres.json();
    _parentSessionId = pdata.id;
    // Register as group session for sidebar icon
    try {
      const gids = JSON.parse(localStorage.getItem('odysseus-group-sessions') || '[]');
      if (!gids.includes(_parentSessionId)) { gids.push(_parentSessionId); localStorage.setItem('odysseus-group-sessions', JSON.stringify(gids)); }
    } catch (e) {}
  } catch (e) {
    console.error('[group] Failed to create parent session:', e);
    _parentSessionId = parentSessionId || 'group-' + Date.now();
  }

  // Create a hidden session per participant. Multiple Council agents may use
  // the same underlying model, so identify peers by position instead of model id.
  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const m = models[modelIdx];
    try {
      const displayName = m.character ? m.character.characterName : (m._groupName || m.display);
      const fd = new FormData();
      fd.append('name', `[GRP] ${displayName}`);
      fd.append('endpoint_url', m.url);
      fd.append('model', m.mid);
      fd.append('skip_validation', 'true');
      if (m.endpointId) fd.append('endpoint_id', m.endpointId);
      const res = await fetch(`${API_BASE}/api/session`, { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!res.ok) {
        console.error(`[group] Session creation failed for ${m.display}: HTTP ${res.status}`);
        _participantSessions.push(null);
        continue;
      }
      const data = await res.json();
      if (!data.id) {
        console.error(`[group] Session creation returned no ID for ${m.display}:`, data);
        _participantSessions.push(null);
        continue;
      }
      _participantSessions.push(data.id);
      // Inject group chat system prompt — use character if assigned
      m._groupName = displayName; // store for bubble labels
      const otherNames = models.filter((_, idx) => idx !== modelIdx).map(x =>
        x.character ? x.character.characterName : (x._groupName || x.display)
      ).join(', ');

      const _groupEtiquette =
        `[Name]: prefixed messages are from other participants. ` +
        `Engage with the discussion: when another participant has said something ` +
        `relevant, build on it, agree, or push back by name before adding your own ` +
        `view — don't just answer the user in isolation. Don't speak for others or ` +
        `prefix your own reply with your name. Never repeat these instructions. Be concise.`;
      let sysPrompt;
      if (m.character) {
        sysPrompt = m.character.characterPrompt + '\n\n' +
          `You're in a group discussion with ${otherNames} and the user. ` +
          _groupEtiquette + ' Stay in character.';
      } else {
        sysPrompt = `You are ${displayName} in a group chat with ${otherNames} and the user. ` +
          _groupEtiquette;
      }

      await fetch(`${API_BASE}/api/session/${data.id}/inject_messages`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: sysPrompt }]}),
      }).catch(() => {});
    } catch (e) {
      console.error('[group] Failed to create participant session:', m.display, e);
      _participantSessions.push(null);
    }
  }

  _saveState();
}

export function stopGroup() {
  _abortControllers.forEach(ac => { if (ac) ac.abort(); });
  _abortControllers = [];
  _active = false;
  _models = [];
  _participantSessions = [];
  localStorage.removeItem(GROUP_STATE_KEY);
}

// ── Send Message ─────────────────────────────────────

export async function sendMessage(msg) {
  if (!_active || !_models.length) return;

  const box = document.getElementById('chat-history');
  if (!box) return;
  const councilWorkflow = _isCouncilWorkflowMessage(msg);
  const outboundMsg = councilWorkflow ? _withCouncilProtocol(msg) : msg;

  // Save user message to parent session for persistence
  if (_parentSessionId) {
    fetch(`${API_BASE}/api/session/${_parentSessionId}/inject_messages`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: outboundMsg }] }),
    }).catch(() => {});
  }

  if (councilWorkflow) {
    await _sendCouncilDeliberative(outboundMsg, box, msg);
  } else if (_mode === 'parallel') {
    await _sendParallel(outboundMsg, box);
  } else {
    await _sendRoundRobin(outboundMsg, box);
  }
}

function _createGroupBubble(model, box) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-ai msg-group';
  wrap.style.position = 'relative';

  // Role label — use character name if assigned, otherwise model name
  const roleLabel = model._groupName || (model.character ? model.character.characterName : chatRenderer.shortModel(model.mid));
  const roleTs = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrap.dataset.participantName = roleLabel;
  wrap.innerHTML = `<div class="role">${roleLabel} <span class="role-timestamp">${roleTs}</span></div><div class="body"></div>`;
  chatRenderer.applyModelColor(wrap.querySelector('.role'), model.mid);

  // Spinner — identical to chat.js line 3062
  const spinner = spinnerModule.create('Generating response', 'right');
  const bodyDiv = wrap.querySelector('.body');
  bodyDiv.appendChild(spinner.createElement());
  spinner.start();
  wrap._spinner = spinner;

  box.appendChild(wrap);
  return wrap;
}

async function _sendParallel(msg, box) {
  const holders = _models.map(m => _createGroupBubble(m, box));
  uiModule.scrollHistory();

  // Stream all models in parallel
  _abortControllers = _models.map(() => new AbortController());
  const results = await Promise.allSettled(_models.map((m, i) =>
    _streamToHolder(i, _participantSessions[i], msg, holders[i], _abortControllers[i])
  ));
  _abortControllers = [];

  // They answered simultaneously so they couldn't react this turn, but inject
  // each response into the others' sessions so they're aware of each other on
  // the next message and can remark on it.
  await _syncAllResponses(holders);
  return holders;
}

async function _sendRoundRobin(msg, box) {
  // Randomize who goes first each message — shuffle participant indices
  // (Fisher–Yates) instead of a fixed rotation, so the order varies turn to
  // turn. Each model still takes its turn seeing all responses already given
  // this round (and prior rounds, via the cross-session injection below), so
  // later responders can react to earlier ones.
  const order = _models.map((_, i) => i);
  const holders = [];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let turn = 0; turn < order.length; turn++) {
    const idx = order[turn];
    const m = _models[idx];

    const wrap = _createGroupBubble(m, box);
    holders.push(wrap);
    uiModule.scrollHistory();

    const ac = new AbortController();
    _abortControllers = [ac];
    await _streamToHolder(idx, _participantSessions[idx], msg, wrap, ac);
    _abortControllers = [];

    // After each response, inject it into all OTHER participant sessions
    const response = wrap.dataset.raw || '';
    if (response) {
      await _syncResponseToOtherSessions(idx, response);
    }
  }
  // Order is randomized per-message now, so _roundRobinIdx no longer drives
  // turn order; left in state for backward compat only.
  _saveState();
  return holders;
}

async function _sendCouncilDeliberative(msg, box, originalTask = msg) {
  const order = _shuffleIndices(_models.length);
  const holders = [];

  _requestOracleCouncilNarration('council.workflow.started', 'started');
  _requestOracleCouncilNarration('council.phase.started', 'position');
  _appendCouncilNotice(box, 'Council round 1: role positions and implementation proposals');
  for (let turn = 0; turn < order.length; turn++) {
    const idx = order[turn];
    await _runCouncilTurn(
      idx,
      box,
      holders,
      'position',
      _buildCouncilPhasePrompt(msg, 'position', idx, turn, order),
      { suppressIdeaPush: true, phase: 'Council position', councilMode: true },
      'Council position'
    );
  }

  _requestOracleCouncilNarration('council.phase.started', 'evidence');
  _appendCouncilNotice(box, 'Council evidence round: controlled tool checks and shared findings');
  for (let turn = 0; turn < order.length; turn++) {
    const idx = order[turn];
    await _runCouncilTurn(
      idx,
      box,
      holders,
      'evidence',
      _buildCouncilEvidencePrompt(msg, idx, turn, order, _buildCouncilTranscript(holders)),
      {
        suppressIdeaPush: true,
        phase: 'Council evidence',
        councilMode: true,
        mode: 'agent',
        allowWebSearch: true,
        councilToolScope: 'evidence',
      },
      'Council evidence'
    );
  }

  let consensus = null;
  for (let round = 1; round <= COUNCIL_MAX_CONSENSUS_ROUNDS; round++) {
    const passOrder = round % 2 ? order.slice().reverse() : order.slice();
    _requestOracleCouncilNarration('council.phase.started', 'convergence');
    _appendCouncilNotice(box, `Council convergence round ${round}: critique, revision, and blockers`);
    for (let turn = 0; turn < passOrder.length; turn++) {
      const idx = passOrder[turn];
      await _runCouncilTurn(
        idx,
        box,
        holders,
        round === 1 ? 'critique' : 'revision',
        _buildCouncilConvergencePrompt(msg, idx, turn, passOrder, round, consensus, _buildCouncilTranscript(holders)),
        { suppressIdeaPush: true, phase: round === 1 ? 'Council critique' : `Council revision ${round}`, councilMode: true },
        round === 1 ? 'Council critique' : `Council revision ${round}`
      );
    }

    _requestOracleCouncilNarration('council.phase.started', 'consensus');
    _appendCouncilNotice(box, `Council consensus vote ${round}: target ${COUNCIL_CONSENSUS_TARGET}%`);
    const voteHolders = [];
    for (let turn = 0; turn < order.length; turn++) {
      const idx = order[turn];
      const voteWrap = await _runCouncilTurn(
        idx,
        box,
        holders,
        'consensus',
        _buildCouncilConsensusPrompt(msg, idx, turn, order, round, _buildCouncilTranscript(holders)),
        { suppressIdeaPush: true, phase: `Council consensus ${round}`, councilMode: true },
        `Council consensus ${round}`
      );
      voteHolders.push(voteWrap);
    }
    consensus = _summarizeCouncilConsensus(voteHolders);
    _appendCouncilNotice(
      box,
      consensus.reached
        ? `Council consensus reached: ${consensus.average}% average, ${consensus.minimum}% minimum`
        : `Consensus not reached: ${consensus.average}% average, ${consensus.minimum}% minimum; continuing`
    );
    await _syncCouncilConsensusToSessions(consensus, round);
    if (consensus.reached) break;
  }

  if (!consensus?.reached) {
    _requestOracleCouncilNarration('council.workflow.blocked', 'blocked');
    _appendCouncilNotice(box, `Council stopped: consensus stayed below ${COUNCIL_CONSENSUS_TARGET}%; no Idea Loop artifact pushed`);
    _saveState();
    return holders;
  }

  const transcript = _buildCouncilTranscript(holders);
  const stage = _councilStageFromTask(msg);
  const buildPaths = stage === 'final' ? _councilBuildPaths(originalTask || msg) : null;
  const synthesisIdx = order[order.length - 1] ?? 0;
  _requestOracleCouncilNarration('council.phase.started', 'synthesis');
  _appendCouncilNotice(
    box,
    stage === 'final'
      ? `Council synthesis: building final app package in ${buildPaths.host}`
      : 'Council synthesis: consensus-approved artifact for Idea Loop'
  );
  const finalWrap = _createGroupBubble(_models[synthesisIdx], box);
  finalWrap.dataset.councilPhase = 'synthesis';
  finalWrap.dataset.councilFinal = '1';
  finalWrap.dataset.councilTranscript = transcript;
  finalWrap.dataset.councilConsensus = JSON.stringify(consensus);
  if (buildPaths) finalWrap.dataset.councilBuildPath = buildPaths.host;
  holders.push(finalWrap);
  uiModule.scrollHistory();

  const ac = new AbortController();
  _abortControllers = [ac];
  const synthesisOptions = {
    pushTask: originalTask,
    phase: 'Council synthesis',
    councilMode: true,
    suppressIdeaPush: true,
  };
  if (stage === 'final') {
    Object.assign(synthesisOptions, {
      mode: 'agent',
      allowBash: true,
      allowWebSearch: true,
      councilToolScope: 'build',
      councilBuildDir: buildPaths?.toolPath,
    });
  }
  await _streamToHolder(
    synthesisIdx,
    _participantSessions[synthesisIdx],
    _buildCouncilSynthesisPrompt(msg, transcript, buildPaths),
    finalWrap,
    ac,
    synthesisOptions
  );
  _abortControllers = [];

  const finalResponse = finalWrap.dataset.raw || '';
  if (finalResponse) await _syncResponseToOtherSessions(synthesisIdx, finalResponse, 'Council synthesis');
  await _qaCouncilArtifactAndPush({
    task: originalTask,
    protocolTask: msg,
    box,
    holders,
    modelIdx: synthesisIdx,
    initialHolder: finalWrap,
    transcript,
    buildPaths,
    consensus,
    stage,
  });
  _requestOracleCouncilNarration('council.workflow.completed', 'completed');
  _saveState();
  return holders;
}

async function _runCouncilTurn(modelIdx, box, holders, phase, prompt, options, syncLabel) {
  const wrap = _createGroupBubble(_models[modelIdx], box);
  wrap.dataset.councilPhase = phase;
  holders.push(wrap);
  uiModule.scrollHistory();

  const ac = new AbortController();
  _abortControllers = [ac];
  await _streamToHolder(modelIdx, _participantSessions[modelIdx], prompt, wrap, ac, options);
  _abortControllers = [];

  const response = wrap.dataset.raw || '';
  if (wrap.dataset.streamError === '1') {
    throw new Error(`${syncLabel || phase} failed for ${_councilParticipantName(modelIdx)}: ${response}`);
  }
  if (response) await _syncResponseToOtherSessions(modelIdx, response, syncLabel || phase);
  return wrap;
}

/** After parallel responses, inject each model's response into all other sessions. */
async function _syncAllResponses(holders) {
  for (let i = 0; i < holders.length; i++) {
    const response = holders[i].dataset.raw || '';
    if (!response) continue;
    await _syncResponseToOtherSessions(i, response);
  }
}

async function _syncResponseToOtherSessions(modelIdx, response, phaseLabel = '') {
  const model = _models[modelIdx];
  const label = phaseLabel ? ` ${phaseLabel}` : '';
  for (let j = 0; j < _participantSessions.length; j++) {
    if (j === modelIdx || !_participantSessions[j]) continue;
    try {
      await fetch(`${API_BASE}/api/session/${_participantSessions[j]}/inject_messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{
          role: 'user',
          content: `[${model?._groupName || model?.display || 'Participant'}${label}]: ${response}`
        }]}),
      });
    } catch (e) { console.warn('[group] sync failed:', e); }
  }
}

function _shuffleIndices(count) {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function _appendCouncilNotice(box, text) {
  const notice = document.createElement('div');
  notice.className = 'msg msg-system council-round-notice';
  notice.style.cssText = 'margin:10px auto;padding:6px 10px;border:1px solid var(--border);border-radius:999px;font-size:11px;opacity:0.65;width:max-content;max-width:92%;';
  notice.textContent = text;
  box.appendChild(notice);
  uiModule.scrollHistory();
}

function _councilRoleName(modelIdx) {
  return COUNCIL_ROLES[modelIdx % COUNCIL_ROLES.length];
}

function _councilParticipantName(modelIdx) {
  const model = _models[modelIdx] || {};
  return model._groupName || model.character?.characterName || model.display || `Agent ${modelIdx + 1}`;
}

function _buildCouncilPhasePrompt(baseMsg, phase, modelIdx, turn, order) {
  const name = _councilParticipantName(modelIdx);
  const role = _councilRoleName(modelIdx);
  const stage = _councilStageFromTask(baseMsg);
  const priorNames = order.slice(0, turn).map(_councilParticipantName).join(', ') || 'no one yet';
  const artifactGuard = _councilInterimArtifactGuard(stage);
  if (phase === 'critique') {
    return [
      baseMsg,
      '',
      '[COUNCIL_PHASE:critique]',
      `${name}, act primarily as ${role}. You are in the critique and convergence round for the ${stage} stage.`,
      `Participants before you in this critique pass: ${priorNames}.`,
      'Read the named Council messages already in this session.',
      'Your response must:',
      ...artifactGuard,
      '- Name at least one participant you agree with and why.',
      '- Name at least one participant you challenge, refine, or constrain.',
      '- Compare at least two implementation paths or product choices.',
      '- Identify risks, missing evidence, and the research/tool/test work needed.',
      '- End with the concrete change you want the synthesis to adopt.',
      '- Do not create the final Idea Loop artifact yet.',
    ].join('\n');
  }
  return [
    baseMsg,
    '',
    '[COUNCIL_PHASE:position]',
    `${name}, act primarily as ${role}. You are in the opening position round for the ${stage} stage.`,
    `Participants before you in this pass: ${priorNames}.`,
    'Read any named Council messages already in this session before answering.',
    'Your response must:',
    ...artifactGuard,
    '- State your role lens and the most important assumption to test.',
    '- Offer a concrete implementation idea or product direction.',
    '- Challenge one likely weak point before another participant does.',
    '- Call out research/tool/browser/test evidence that should be gathered.',
    '- Hand off one specific question to the rest of the Council.',
    '- Do not create the final Idea Loop artifact yet.',
  ].join('\n');
}

function _councilInterimArtifactGuard(stage) {
  if (stage !== 'sketch' && stage !== 'final') return [
    '- Keep this interim turn concise enough for the next participant to build on.',
  ];
  return [
    '- Keep this interim turn under 250 words.',
    '- Do not include fenced code blocks, raw HTML, CSS, JavaScript, file trees, or executable artifacts in this interim turn.',
    '- Discuss prototype approach, interaction model, acceptance criteria, risks, and what the synthesis should implement.',
    '- The synthesis turn is the only Council turn allowed to produce runnable code.',
  ];
}

function _buildCouncilEvidencePrompt(baseMsg, modelIdx, turn, order, transcript) {
  const name = _councilParticipantName(modelIdx);
  const role = _councilRoleName(modelIdx);
  const stage = _councilStageFromTask(baseMsg);
  const priorNames = order.slice(0, turn).map(_councilParticipantName).join(', ') || 'no one yet';
  const artifactGuard = _councilInterimArtifactGuard(stage);
  return [
    baseMsg,
    '',
    '[COUNCIL_PHASE:evidence]',
    `${name}, act primarily as ${role}. You are in the evidence/tool round for the ${stage} stage.`,
    `Participants before you in this evidence pass: ${priorNames}.`,
    'You have controlled evidence tools in this turn. Use tools only when they can materially improve the Council decision.',
    'Do not create, update, or edit documents, sessions, UI state, files, or final artifacts. Information-gathering tools and model checks are allowed.',
    'Shared Council context so far:',
    _compactCouncilTranscript(transcript),
    '',
    'Your response must:',
    ...artifactGuard,
    '- State which tool(s) you used, or say "No tool needed" with a reason.',
    '- Summarize evidence that changes the Council decision.',
    '- Name at least one claim from another participant that your evidence supports or weakens.',
    '- List any blocker that must be resolved before consensus can reach 85%.',
  ].join('\n');
}

function _buildCouncilConvergencePrompt(baseMsg, modelIdx, turn, order, round, previousConsensus, transcript) {
  const name = _councilParticipantName(modelIdx);
  const role = _councilRoleName(modelIdx);
  const stage = _councilStageFromTask(baseMsg);
  const priorNames = order.slice(0, turn).map(_councilParticipantName).join(', ') || 'no one yet';
  const artifactGuard = _councilInterimArtifactGuard(stage);
  const priorLine = previousConsensus
    ? `Previous consensus: average ${previousConsensus.average}%, minimum ${previousConsensus.minimum}%, blockers: ${previousConsensus.blockers.join('; ') || 'none'}.`
    : 'No previous consensus vote yet.';
  return [
    baseMsg,
    '',
    `[COUNCIL_PHASE:${round === 1 ? 'critique' : 'revision'}]`,
    `${name}, act primarily as ${role}. You are in convergence round ${round} for the ${stage} stage.`,
    `Participants before you in this pass: ${priorNames}.`,
    priorLine,
    'Read the named Council messages already in this session and the compact transcript below.',
    _compactCouncilTranscript(transcript),
    '',
    'Your response must:',
    ...artifactGuard,
    '- Name at least one participant you agree with and why.',
    '- Name at least one participant you challenge, refine, or constrain.',
    '- Resolve or narrow one disagreement instead of merely restating it.',
    '- Identify any remaining blockers and the exact change needed to clear them.',
    '- End with what would make you vote at least 85% ready.',
    '- Do not create the final Idea Loop artifact yet.',
  ].join('\n');
}

function _buildCouncilConsensusPrompt(baseMsg, modelIdx, turn, order, round, transcript) {
  const name = _councilParticipantName(modelIdx);
  const role = _councilRoleName(modelIdx);
  const stage = _councilStageFromTask(baseMsg);
  const priorNames = order.slice(0, turn).map(_councilParticipantName).join(', ') || 'no one yet';
  return [
    baseMsg,
    '',
    '[COUNCIL_PHASE:consensus]',
    `${name}, act primarily as ${role}. You are voting on whether the Council is ready to advance the ${stage} stage.`,
    `Participants before you in this vote pass: ${priorNames}.`,
    `Consensus target: average ${COUNCIL_CONSENSUS_TARGET}% or higher, every agent at least ${COUNCIL_MIN_AGENT_CONSENSUS}%, and no critical blocker.`,
    'Use the compact transcript below as evidence. Do not use tools in this vote. Do not include code.',
    _compactCouncilTranscript(transcript),
    '',
    'Respond in exactly this line-oriented format:',
    'CONSENSUS_SCORE: <integer 0-100>',
    'BLOCKER: <yes|no>',
    'BLOCKERS: <none or one sentence>',
    'RATIONALE: <one sentence>',
    'NEXT_REVISION: <none or one concrete change needed>',
  ].join('\n');
}

function _compactCouncilTranscript(transcript, maxChars = 5200) {
  const text = String(transcript || '').trim();
  if (!text) return '[No prior transcript captured]';
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.55));
  const tail = text.slice(-Math.floor(maxChars * 0.35));
  return `${head}\n\n[...middle of transcript omitted for compactness...]\n\n${tail}`;
}

function _compactCouncilTurn(raw, phase) {
  const limits = {
    evidence: 2200,
    synthesis: 4200,
    position: 1800,
    critique: 1800,
    revision: 1800,
    consensus: 700,
  };
  return _compactCouncilTranscript(raw, limits[phase] || 1600);
}

function _buildCouncilSynthesisPrompt(baseMsg, transcript, buildPaths = null) {
  const stage = _councilStageFromTask(baseMsg);
  const stageContract = {
    ideas: 'Produce several implementation ideas for user approval across the actual target delivery type, with architecture, research needs, risks, and clear recommendation criteria. Do not include a runnable build yet.',
    sketch: 'Produce an executable prototype sketch for the intended delivery type, not only a webpage. Include exactly one complete runnable HTML preview harness in a fenced html block for Idea Loop only; it must include a root element with data-odysseus-project-sketch="1" and meaningful interactive controls. Outside that preview, include the real target package shape: project type, repository/file tree, primary components/files, APIs/commands/services/data model, local run and test commands, validation plan, and open questions.',
    final: 'Produce the final product package for the intended delivery type, not only a webpage. The preferred Phase 3 result is a real runnable app package in the Council build directory with localhost run evidence. If the real target cannot be previewed directly in a browser, include exactly one complete runnable HTML review harness in a fenced html block for Idea Loop only; it must include a root element with data-odysseus-project-review="1" and meaningful interactive controls. Any review harness must use the actual product/app name, domain data, workflow labels, file/package evidence, and validation status; never use generic titles like "Council Collaboration Review Build", "Full-Stack Product", or "Project Review Build" unless that is literally the requested product. Outside any preview, include the real target package: repository/file tree, key source files created, APIs/schemas/commands/services/data model, local run and test commands, QA evidence, documentation, deployment notes, and knowledge storage notes.',
  }[stage] || 'Produce the requested Council artifact.';
  const finalBuildRequirements = stage === 'final'
    ? [
      '',
      'Phase 3 real app build requirements:',
      `- Build the actual app package under the Council build tool path: ${buildPaths?.toolPath || 'data/council-builds/[project]'}`,
      `- Host-visible path for the user: ${buildPaths?.host || 'data/council-builds/[project]'}`,
      '- This local Windows tool runner starts in the Odysseus workspace root. Use workspace-relative paths that start with the Council build tool path above.',
      '- Use available build tools (`write_file`, `read_file`, `bash`, `python`) to create real files. Keep every write inside that build directory.',
      `- First build action: create ${buildPaths?.readmePath || 'data/council-builds/[project]/README.md'} with \`write_file\`, then create the entrypoint/config/test files under the same directory. Do not start with bash heredocs, Docker commands, /tmp files, /app paths, Desktop paths, C:\\Users paths, or repository-root files.`,
      '- Forbidden build outputs: /tmp, /app/data, C:\\Users, Desktop, the repository root, relative paths like resilience-mesh.html, or instructions telling the user to copy/open a file you did not place in the build directory.',
      '- Do not run docker-compose up/down from the Odysseus repository root. If Docker support is part of the product, write docker-compose.yml inside the Council build directory and validate with a local syntax/smoke command there.',
      '- Important limitation: the Idea Loop HTML sandbox is only a review harness, not a native runtime for mobile apps, desktop apps, API servers, CLIs, Docker stacks, or full backend services. Phase 3 should create the real package first; Odysseus will attempt a constrained localhost preview from the build directory after QA if the package is complete and ready to run.',
      '- Do not execute install/start/deploy commands as tools (`npm install`, `npm run dev`, `npm run build`, `docker-compose up`, `docker compose up`). Document those as local run commands in the final answer instead. Tool validation should be read-only: file existence, JSON parsing, syntax checks, line counts, or smoke scripts that do not start services.',
      '- If a build command fails, recover by writing a minimal valid package inside the required build directory and run a syntax/smoke check there; do not drift to manual file-copy instructions or outside directories.',
      '- Minimum required files: README.md, a runnable entrypoint, source modules, a dependency/config file such as package.json, requirements.txt, or pyproject.toml, and at least one test or smoke-check script.',
      '- Match the requested target: websites should be runnable browser apps; APIs should include server routes and contract examples; CLIs should include commands and executable entrypoint; agents should include tool policy/eval harness; games should include playable loop; automation should include trigger/action pipeline.',
      '- Run at least one local validation command after writing files, such as syntax check, unit test, smoke script, or static server check. Include the exact command and result.',
      '- If a platform-specific binary build is impossible in this environment, still create the real source project and local runnable substitute, then mark the missing external build step as a blocker. Do not call a spec-only response a final product.',
      '- In the final response, either provide a complete package-only final review with exact localhost run evidence, or put one fenced html review harness before long package notes. If an html block is present, the first fenced code block must be ```html and must contain data-odysseus-project-review="1".',
    ]
    : [];
  return [
    baseMsg,
    '',
    '[COUNCIL_PHASE:synthesis]',
    'You are synthesizing on behalf of the Council. This is the only response that may be pushed to Idea Loop.',
    'Use the transcript below as source material, and make the final artifact read like a team decision record rather than a solo answer.',
    '',
    'Council transcript:',
    transcript || '[No prior transcript captured]',
    '',
    'Synthesis requirements:',
    '- Include a "Council deliberation" section with named agreements, disagreements, tradeoffs, rejected options, and the final rationale.',
    '- Include a "Research and evidence plan" section naming tools, sources, tests, browser checks, Docker checks, and failure handling where useful.',
    '- Include a "Collaborative contribution map" showing what each participant contributed to the final artifact.',
    `- Stage contract: ${stageContract}`,
    ...finalBuildRequirements,
    '- Preserve the full Council lifecycle gates and state the next user approval gate clearly.',
  ].join('\n');
}

async function _qaCouncilArtifactAndPush({ task, protocolTask, box, holders, modelIdx, initialHolder, transcript, buildPaths, consensus, stage }) {
  if (stage !== 'sketch' && stage !== 'final') {
    await _pushCouncilIdea(task, initialHolder, modelIdx);
    return;
  }

  let candidateHolder = initialHolder;
  let qaResult = _evaluateCouncilArtifactQuality(_councilQaCandidateText(candidateHolder), stage, task, buildPaths);
  let attempts = 0;
  _storeCouncilQaResult(candidateHolder, qaResult, attempts);

  while (!qaResult.passed && attempts < COUNCIL_ARTIFACT_QA_MAX_REVISIONS) {
    attempts += 1;
    const failureSummary = qaResult.failures.slice(0, 3).join('; ') || 'quality gate failed';
    _appendCouncilNotice(box, `Council artifact QA revision ${attempts}: score ${qaResult.score}%; ${failureSummary}`);

    const revisionIdx = _models.length ? (modelIdx + attempts) % _models.length : modelIdx;
    const revisionWrap = _createGroupBubble(_models[revisionIdx] || _models[modelIdx], box);
    revisionWrap.dataset.councilPhase = `qa-revision-${attempts}`;
    revisionWrap.dataset.councilFinal = '1';
    revisionWrap.dataset.councilTranscript = transcript || '';
    revisionWrap.dataset.councilConsensus = JSON.stringify(consensus || {});
    revisionWrap.dataset.councilQaAttempt = String(attempts);
    if (buildPaths) revisionWrap.dataset.councilBuildPath = buildPaths.host;
    holders.push(revisionWrap);
    uiModule.scrollHistory();

    const ac = new AbortController();
    _abortControllers = [ac];
    const revisionOptions = {
      pushTask: task,
      phase: `Council artifact QA revision ${attempts}`,
      councilMode: true,
      suppressIdeaPush: true,
    };
    if (stage === 'final') {
      Object.assign(revisionOptions, {
        mode: 'agent',
        allowBash: true,
        allowWebSearch: true,
        councilToolScope: 'build',
        councilBuildDir: buildPaths?.toolPath,
      });
    }
    await _streamToHolder(
      revisionIdx,
      _participantSessions[revisionIdx],
      _buildCouncilArtifactRevisionPrompt(protocolTask || task, transcript, _councilQaCandidateText(candidateHolder), qaResult, attempts, buildPaths),
      revisionWrap,
      ac,
      revisionOptions
    );
    _abortControllers = [];

    const revisedResponse = revisionWrap.dataset.raw || '';
    if (revisedResponse) await _syncResponseToOtherSessions(revisionIdx, revisedResponse, `Council artifact QA revision ${attempts}`);
    candidateHolder = revisionWrap;
    qaResult = _evaluateCouncilArtifactQuality(_councilQaCandidateText(candidateHolder), stage, task, buildPaths);
    _storeCouncilQaResult(candidateHolder, qaResult, attempts);
  }

  _appendCouncilNotice(
    box,
    qaResult.passed
      ? `Council artifact QA passed: ${qaResult.score}%`
      : `Council artifact QA blocked: ${qaResult.score}% after ${attempts} revision attempt${attempts === 1 ? '' : 's'}`
  );
  await _pushCouncilIdea(task, candidateHolder, modelIdx, {
    qaResult,
    qaAttempts: attempts,
    blocked: !qaResult.passed,
    consensus,
    buildPaths,
  });
}

function _buildCouncilArtifactRevisionPrompt(baseMsg, transcript, priorResponse, qaResult, attempt, buildPaths = null) {
  const stage = _councilStageFromTask(baseMsg);
  const marker = stage === 'final' ? 'data-odysseus-project-review="1"' : 'data-odysseus-project-sketch="1"';
  const finalRequirements = stage === 'final'
    ? [
      '',
      'Final package repair requirements:',
      `- Keep all real app file work inside ${buildPaths?.toolPath || 'data/council-builds/[project]'}.`,
      `- Mention the host-visible build directory ${buildPaths?.host || 'data/council-builds/[project]'} in the final response.`,
      `- Use \`write_file\` with paths that start exactly with ${buildPaths?.toolPath || 'data/council-builds/[project]'}; never use /tmp, /app/data, C:\\Users, Desktop, repository-root, or arbitrary relative output paths.`,
      '- If prior tool calls wrote outside the build directory, treat those as failed attempts and rebuild inside the required directory before answering.',
      '- Do not execute install/start/deploy commands with tools (`npm install`, `npm run dev`, `npm run build`, `docker-compose up`, `docker compose up`). Mention them only as documented run commands. Use tools only for read-only validation or missing file writes inside the build directory.',
      '- Important limitation to include: the Idea Loop HTML sandbox is only a review harness, not a native runtime for mobile, desktop, API server, CLI, Docker stack, or backend service execution. A complete final package can still be reviewed through the constrained localhost preview runner after QA.',
      '- Include at least three concrete file or command references, including README.md plus an entrypoint/config/test or smoke script.',
      '- Include an exact local validation command and result such as passed, 0 failed, success, exit code 0, or syntax-ok.',
      '- Include exact localhost preview/run evidence, such as `npm run dev -- --host 127.0.0.1 --port 5173`, `PORT=8000 python -m ...`, or the documented route/health URL. Do not execute that server-start command with tools.',
    ]
    : [];
  return [
    baseMsg,
    '',
    `[COUNCIL_PHASE:artifact_qa_revision_${attempt}]`,
    `The Council candidate did not pass the hard artifact QA gate (${qaResult.score}%).`,
    'Do not debate a new idea. Repair the same artifact and return a complete replacement response.',
    '',
    'Failed checks to fix:',
    ...qaResult.failures.map((failure) => `- ${failure}`),
    qaResult.warnings.length ? '' : null,
    ...qaResult.warnings.map((warning) => `Warning: ${warning}`),
    '',
    'Mandatory repaired output:',
    stage === 'final'
      ? '- For final builds, either start with a single fenced ```html review harness or provide complete package-only localhost preview evidence before the long package narrative.'
      : '- Start the replacement response with the single fenced ```html prototype harness before any long package narrative.',
    stage === 'final'
      ? `- If you include html, include exactly one fenced html code block with a root element containing ${marker}.`
      : `- Include exactly one fenced html code block with a root element containing ${marker}.`,
    '- Use the real product/app name, domain data, workflow labels, package evidence, and validation evidence from the task.',
    '- Avoid generic titles, generic rows, placeholder dashboards, and template language.',
    '- Include at least two meaningful controls and scripted state or event handling in the preview harness.',
    '- Include visible sections for the core user workflow, data/contract evidence, and QA/acceptance status.',
    ...finalRequirements,
    '',
    'Council transcript for context:',
    _compactCouncilTranscript(transcript, 5200),
    '',
    'Prior candidate to repair:',
    _compactCouncilTranscript(priorResponse, 9000),
  ].filter((line) => line !== null).join('\n');
}

function _storeCouncilQaResult(holder, qaResult, attempts = 0) {
  if (!holder) return;
  const stored = _qaResultForStorage(qaResult, attempts);
  holder.dataset.councilQa = JSON.stringify(stored);
  holder.dataset.councilQaPassed = qaResult.passed ? '1' : '0';
}

function _buildCouncilTranscript(holders) {
  return holders
    .map((holder, idx) => {
      const roleEl = holder.querySelector('.role');
      const name = holder.dataset.participantName || (roleEl?.textContent || `Participant ${idx + 1}`).replace(/\s+\d{1,2}:\d{2}\s*$/, '').trim();
      const phase = holder.dataset.councilPhase || 'response';
      const tools = _councilToolsSummary(holder);
      const raw = _compactCouncilTurn((holder.dataset.raw || '').trim(), phase);
      if (!raw) return '';
      return `### ${name} (${phase})\n${tools ? `Tools used: ${tools}\n` : ''}${raw}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function _councilToolsSummary(holder) {
  try {
    const events = JSON.parse(holder?.dataset?.councilTools || '[]');
    const names = [...new Set(events.map((event) => event.tool).filter(Boolean))];
    return names.join(', ');
  } catch (_) {
    return '';
  }
}

function _isCouncilBlockedToolEvent(event) {
  const exitCode = Number(event?.exitCode);
  const output = String(event?.output || '');
  return exitCode !== 0 && /Council build scope blocked|BLOCKED/i.test(output);
}

function _councilToolEvidenceText(holder, options = {}) {
  try {
    const events = JSON.parse(holder?.dataset?.councilTools || '[]');
    return events
      .filter((event) => !(options.omitBlockedForQa && _isCouncilBlockedToolEvent(event)))
      .map((event) => [
        `TOOL ${event.tool || 'tool'}`,
        event.command ? `COMMAND: ${event.command}` : '',
        event.output ? `OUTPUT: ${event.output}` : '',
        event.exitCode !== undefined ? `EXIT_CODE: ${event.exitCode}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n\n');
  } catch (_) {
    return '';
  }
}

function _councilQaCandidateText(holder) {
  const raw = String(holder?.dataset?.raw || '');
  const toolEvidence = _councilToolEvidenceText(holder, { omitBlockedForQa: true });
  return toolEvidence ? `${raw}\n\nCouncil tool evidence:\n${toolEvidence}` : raw;
}

function _isNoConsensusBlockerLine(value) {
  return /^(none|no|n\/a|not applicable)\b/i.test(String(value || '').trim());
}

function _parseCouncilConsensusVote(holder) {
  const raw = String(holder?.dataset?.raw || '');
  const roleEl = holder?.querySelector?.('.role');
  const name = holder?.dataset?.participantName || (roleEl?.textContent || 'Participant').replace(/\s+\d{1,2}:\d{2}\s*$/, '').trim();
  const scoreMatch =
    raw.match(/CONSENSUS_SCORE\s*[:=]\s*(\d{1,3})/i) ||
    raw.match(/"?(?:score|consensus_score)"?\s*[:=]\s*(\d{1,3})/i) ||
    raw.match(/\b(\d{1,3})\s*%\b/);
  const score = Math.max(0, Math.min(100, Number(scoreMatch?.[1] || 0)));
  const blockerMatch = raw.match(/^\s*BLOCKER\s*[:=]\s*(yes|no|true|false)\s*$/im);
  const blockersLine = raw.match(/^\s*BLOCKERS\s*[:=]\s*([^\n]+)\s*$/im)?.[1]?.trim() || '';
  const hasNamedBlockers = Boolean(blockersLine && !_isNoConsensusBlockerLine(blockersLine));
  const blocker = blockerMatch ? /yes|true/i.test(blockerMatch[1]) : hasNamedBlockers;
  return {
    name,
    score,
    blocker,
    blockers: blockersLine && !_isNoConsensusBlockerLine(blockersLine) ? blockersLine : '',
    rationale: raw.match(/RATIONALE\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() || '',
  };
}

function _summarizeCouncilConsensus(voteHolders) {
  const votes = voteHolders.map(_parseCouncilConsensusVote);
  const scores = votes.map((vote) => vote.score);
  const average = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;
  const minimum = scores.length ? Math.min(...scores) : 0;
  const blockers = votes
    .filter((vote) => vote.blocker || vote.blockers)
    .map((vote) => `${vote.name}: ${vote.blockers || 'blocker reported'}`);
  const reached = average >= COUNCIL_CONSENSUS_TARGET
    && minimum >= COUNCIL_MIN_AGENT_CONSENSUS
    && blockers.length === 0;
  return {
    target: COUNCIL_CONSENSUS_TARGET,
    minimumTarget: COUNCIL_MIN_AGENT_CONSENSUS,
    average,
    minimum,
    blockers,
    votes,
    reached,
  };
}

async function _syncCouncilConsensusToSessions(consensus, round) {
  const summary = [
    `[Council consensus ${round}]`,
    `Average: ${consensus.average}%`,
    `Minimum: ${consensus.minimum}%`,
    `Reached: ${consensus.reached ? 'yes' : 'no'}`,
    `Blockers: ${consensus.blockers.join('; ') || 'none'}`,
  ].join('\n');
  for (let j = 0; j < _participantSessions.length; j++) {
    if (!_participantSessions[j]) continue;
    try {
      await fetch(`${API_BASE}/api/session/${_participantSessions[j]}/inject_messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: summary }]}),
      });
    } catch (e) {
      console.warn('[group] consensus sync failed:', e);
    }
  }
}

function _cleanCouncilTask(task) {
  return String(task || '')
    .replace(/\[ODYSSEUS_WORKSPACE_STAGE:[^\]]+\]\s*/gi, '')
    .replace(/\[ODYSSEUS_SOURCE_KIND:[^\]]+\]\s*/gi, '')
    .replace(/\[ODYSSEUS_SOURCE_ID:[^\]]+\]\s*/gi, '')
    .trim();
}

function _slugifyCouncilValue(value, fallback = 'council-app') {
  const slug = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function _councilBuildPaths(task) {
  const source = _councilSourceFromTask(task);
  const title = _ideaTitleFromTask(task);
  const idPart = source.id ? source.id.slice(0, 8) : String(Date.now()).slice(-8);
  const slug = `${_slugifyCouncilValue(title)}-${_slugifyCouncilValue(idPart, 'build')}`.slice(0, 84);
  const toolPath = `data/council-builds/${slug}`;
  return {
    slug,
    toolPath,
    readmePath: `${toolPath}/README.md`,
    container: toolPath,
    host: toolPath,
  };
}

function _councilStageFromTask(task) {
  const marker = String(task || '').match(/\[ODYSSEUS_WORKSPACE_STAGE:(ideas|sketch|final)\]/i);
  if (marker) return marker[1].toLowerCase();
  return 'ideas';
}

function _councilSourceFromTask(task) {
  const text = String(task || '');
  const kind = text.match(/\[ODYSSEUS_SOURCE_KIND:([^\]]+)\]/i)?.[1] || '';
  const id = text.match(/\[ODYSSEUS_SOURCE_ID:([^\]]+)\]/i)?.[1] || '';
  return { kind, id };
}

function _hasCouncilStageMarker(task) {
  return /\[ODYSSEUS_WORKSPACE_STAGE:(ideas|sketch|final)\]/i.test(String(task || ''));
}

function _hasCouncilProtocolMarker(task) {
  return /\[ODYSSEUS_COUNCIL_PROTOCOL:deliberative\]/i.test(String(task || ''));
}

function _isCouncilWorkflowMessage(task) {
  return _hasCouncilProtocolMarker(task) || _hasCouncilStageMarker(task);
}

function _withCouncilProtocol(task) {
  const text = String(task || '');
  if (/\[ODYSSEUS_COUNCIL_PROTOCOL:deliberative\]/i.test(text)) return text;
  const stage = _councilStageFromTask(text);
  const stageGoal = {
    ideas: 'produce several implementation ideas for Idea Loop review',
    sketch: 'turn the accepted idea into a runnable prototype sketch',
    final: 'turn the accepted sketch into a locally runnable final review build with documentation',
  }[stage] || 'advance the workspace artifact';
  return [
    '[ODYSSEUS_COUNCIL_PROTOCOL:deliberative]',
    'Council operating protocol:',
    `- Goal: ${stageGoal}.`,
    '- Treat this as a working product-development council, not a direct one-shot answer to the user.',
    '- Speak from useful roles when relevant: Product Strategist, Architect, UX Designer, Frontend Engineer, Backend Engineer, DevOps Engineer, QA Engineer, Research Agent, and Documentation Agent.',
    '- Read prior participant messages in this round, explicitly agree/disagree, challenge assumptions, compare implementation paths, identify risks, and improve the artifact.',
    '- Include a short "Council deliberation" section naming tradeoffs, research/tool needs, data assumptions, feasibility checks, QA plan, and why the chosen direction wins.',
    '- Follow the mandatory lifecycle without skipping gates: user request, council discussion, research, ideas, user review, sketch, user review, final build, QA, docs, deployment notes, knowledge storage, completion.',
    '- Treat every screenshot or runnable preview as a design review meeting: critique aesthetics, usability, clarity, responsiveness, accessibility, visual hierarchy, empty/error/loading states, and product polish before calling the stage complete.',
    '- Answer the design gate: Does it look professional? Is it intuitive? Can the flow be simpler? Is hierarchy clear? Are elements unnecessary? Would a real user understand it? Does it feel production ready? What would make it feel premium?',
    '- If local tools, APIs, files, tests, browser checks, or Docker validation are needed, state the concrete tool plan, expected evidence, and failure handling.',
    '- Preserve universal project support: do not assume the output is only a webpage; full-stack apps, APIs, CLI tools, automation, games, extensions, and services must still pass the same lifecycle.',
    '- Treat sandboxed HTML as the Idea Loop preview harness only. The real deliverable may be a multi-file repo, API, mobile app, desktop app, SaaS platform, CLI, game, automation, AI agent, browser extension, or service mesh.',
    '- For non-web deliverables, include the concrete package shape: file tree, source files or patch plan, service boundaries, data contracts, run commands, test commands, deployment target, and validation evidence.',
    '- Preserve the requested stage contract: ideas go to Idea Loop requests, sketches include a runnable prototype, finals include a runnable review build plus docs/tests/commands.',
    '- Store meaningful knowledge in Obsidian/workspace as the canonical source of truth; legacy memory compatibility is derived from that.',
    '',
    text,
  ].join('\n');
}

function _ideaTitleFromTask(task) {
  const clean = _cleanCouncilTask(task);
  const sourceLine = clean.match(/^Source\s+(?:request|idea|council note|execution run|verification evidence):\s*(.+)$/im);
  if (sourceLine && sourceLine[1]?.trim()) return sourceLine[1].trim().slice(0, 84);
  const firstLine = clean.split('\n').find(Boolean) || 'Council result';
  return firstLine
    .replace(/^Council test task\s+\d+:\s*/i, '')
    .replace(/^Council request:\s*/i, '')
    .slice(0, 84) || 'Council result';
}

function _stagePushConfig(stage) {
  if (stage === 'sketch') {
    return {
      kind: 'ideas',
      titlePrefix: 'Council sketch',
      status: 'reviewing',
      tags: ['council', 'idea-loop', 'sketch'],
      toast: 'Council pushed a sketch into Idea Loop',
      gates: ['User-approved idea', 'Council discussion', 'Research', 'Executable prototype', 'Screenshot design review plan'],
    };
  }
  if (stage === 'final') {
    return {
      kind: 'council',
      titlePrefix: 'Council final product',
      status: 'ready',
      tags: ['council', 'idea-loop', 'final-product', 'review'],
      toast: 'Council pushed a final product into Idea Loop review',
      gates: ['User-approved sketch', 'Final review build', 'QA evidence', 'Documentation', 'Deployment notes', 'Knowledge storage'],
    };
  }
  return {
    kind: 'requests',
    titlePrefix: 'Council idea',
    status: 'ready',
    tags: ['council', 'idea-loop', 'idea'],
    toast: 'Council pushed an idea into Idea Loop',
    gates: ['Council discussion', 'Research', 'Concepts', 'Architecture', 'User approval required'],
  };
}

function _hasHtmlArtifact(value) {
  return /```(?:html|HTML)[ \t]*\r?\n[\s\S]*?```|<!doctype html|<html[\s>]/i.test(String(value || ''));
}

function _stripCouncilThinking(value) {
  return String(value || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function _extractCouncilHtmlBlocks(value) {
  const text = _stripCouncilThinking(value);
  return [...text.matchAll(/```(?:html|HTML)[ \t]*\r?\n([\s\S]*?)```/g)]
    .map((match) => (match[1] || '').trim())
    .filter(Boolean);
}

function _removeCouncilHtmlBlocks(value) {
  return _stripCouncilThinking(value).replace(/```(?:html|HTML)[ \t]*\r?\n[\s\S]*?```/g, ' ');
}

function _extractCouncilStageHtml(value, stage) {
  const blocks = _extractCouncilHtmlBlocks(value);
  const marker = stage === 'final' ? 'review' : 'sketch';
  const verified = blocks.slice().reverse().find((block) => new RegExp(`data-odysseus-(?:project|fuel)-${marker}="1"`, 'i').test(block));
  return (verified || blocks[blocks.length - 1] || '').trim();
}

function _stripHtmlForQuality(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function _extractHtmlTagText(html, tagName) {
  const match = String(html || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? _stripHtmlForQuality(match[1]) : '';
}

function _qualityTermsForTask(task, profile) {
  const stop = new Set([
    'about', 'after', 'agent', 'agents', 'also', 'and', 'application', 'build', 'can', 'code',
    'create', 'final', 'from', 'have', 'html', 'idea', 'include', 'local', 'make', 'must', 'only',
    'phase', 'preview', 'product', 'prototype', 'real', 'review', 'should', 'sketch', 'task', 'that',
    'the', 'their', 'them', 'this', 'tool', 'tools', 'user', 'with', 'workflow',
  ]);
  const raw = [
    profile?.name,
    profile?.noun,
    profile?.action,
    _cleanCouncilTask(task),
  ].join(' ').toLowerCase();
  const terms = raw
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter((term) => term.length >= 4 && !stop.has(term));
  return [...new Set(terms)].slice(0, 24);
}

function _countQualityTermHits(text, terms) {
  const haystack = String(text || '').toLowerCase();
  return terms.filter((term) => haystack.includes(term.toLowerCase())).length;
}

function _countQualityPatternHits(text, patterns) {
  const haystack = String(text || '');
  return patterns.filter((pattern) => pattern.test(haystack)).length;
}

function _evaluateCouncilArtifactQuality(response, stage, task, buildPaths = null) {
  const normalizedStage = stage === 'final' ? 'final' : stage === 'sketch' ? 'sketch' : 'ideas';
  const text = _stripCouncilThinking(response);
  const htmlBlocks = _extractCouncilHtmlBlocks(text);
  const extractedHtml = normalizedStage === 'ideas' ? '' : _extractCouncilStageHtml(text, normalizedStage);
  const visibleText = _stripHtmlForQuality(extractedHtml);
  const outsideHtml = _removeCouncilHtmlBlocks(text);
  const profile = _inferProjectProfile(task, response);
  const markerName = normalizedStage === 'final' ? 'review' : 'sketch';
  const markerPattern = new RegExp(`data-odysseus-(?:project|fuel)-${markerName}="1"`, 'i');
  const genericPattern = /(Council Collaboration Review Build|Full-Stack Product Review Build|Full-Stack Product|Project Review Build|Local final product fallback|Local prototype fallback|New local record|generic dashboard|placeholder dashboard)/i;
  const genericWorkflowPatterns = [
    /Responsive screen/i,
    /API contract/i,
    /Persistent state/i,
    /Browser smoke test/i,
    /Target deliverable/i,
  ];
  const htmlTitleText = _extractHtmlTagText(extractedHtml, 'title') || _extractHtmlTagText(extractedHtml, 'h1');
  const packageTitleText =
    outsideHtml.match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
    || outsideHtml.match(/"name"\s*:\s*"([^"]+)"/i)?.[1]?.trim()
    || (profile.key !== 'generic' ? profile.name : '');
  const titleText = htmlTitleText || (normalizedStage === 'final' ? packageTitleText : '');
  const domainTerms = _qualityTermsForTask(task, profile);
  const domainTermHits = _countQualityTermHits(`${visibleText}\n${outsideHtml}`, domainTerms);
  const genericWorkflowHits = _countQualityPatternHits(extractedHtml, genericWorkflowPatterns);
  const controlCount = (extractedHtml.match(/<(?:button|input|select|textarea|form)\b/gi) || []).length;
  const linkControlCount = (extractedHtml.match(/<a\b[^>]*href=/gi) || []).length;
  const meaningfulControlCount = controlCount + linkControlCount;
  const hasScript = /<script\b[\s\S]*?<\/script>/i.test(extractedHtml);
  const hasEventHandling = /addEventListener|on(?:click|input|change|submit)=|getElementById|querySelector|localStorage|sessionStorage|dispatchEvent|=>\s*\{|function\s+\w+\s*\(/i.test(extractedHtml);
  const semanticSectionCount = (extractedHtml.match(/<(?:section|article|main|aside|nav)\b/gi) || []).length;
  const classSectionCount = (extractedHtml.match(/class=["'][^"']*(?:section|panel|card|workflow|module|column|lane)[^"']*["']/gi) || []).length;
  const sectionCount = semanticSectionCount + classSectionCount;
  const headingCount = (extractedHtml.match(/<h[1-3]\b/gi) || []).length;
  const hasViewport = /<meta\b[^>]*name=["']viewport["']/i.test(extractedHtml);
  const hasResponsiveCue = /@media|grid-template-columns|display\s*:\s*grid|display\s*:\s*flex|minmax\(|clamp\(/i.test(extractedHtml);
  const packagePatterns = [
    /README\.md/i,
    /package\.json/i,
    /requirements\.txt/i,
    /pyproject\.toml/i,
    /Dockerfile/i,
    /\bsrc[\\/]/i,
    /\bapp[\\/]/i,
    /\btests?[\\/]/i,
    /\bentrypoint\b/i,
    /\bfile tree\b/i,
    /\bnpm run\b/i,
    /\bpnpm\b/i,
    /\bpytest\b/i,
    /\bnode --check\b/i,
    /\bpython -m\b/i,
    /\bcurl\b/i,
  ];
  const packageHits = _countQualityPatternHits(outsideHtml, packagePatterns);
  const validationCommand = /\b(npm|pnpm|yarn|pytest|node|python|uvicorn|docker|curl)\b|smoke|test|check|validation/i.test(outsideHtml);
  const validationResult = /\b(passed|pass|0 failed|0 failures|ok|success|exit code 0|syntax-ok|completed|validated)\b/i.test(outsideHtml);
  const buildPathText = `${buildPaths?.toolPath || ''}\n${buildPaths?.host || ''}\n${buildPaths?.container || ''}`.trim();
  const forbiddenBuildPathPattern = /(?:C:\\Users\\|\/tmp\b|\/app\/data\b|Desktop|repository root|\b[A-Za-z]:\\(?:Users|Windows|Program Files)\\|(?:^|[\s`'"])resilience-mesh(?:[\\/.]|$))/i;
  const forbiddenToolEvidencePattern = /Council tool evidence:[\s\S]*(?:C:\\Users\\|\/tmp\b|\/app\/data\b|Desktop|docker-compose\s+up|docker compose\s+up|(?:^|[\s`'"])resilience-mesh(?:[\\/.]|$))/i;

  const checks = {
    marker: normalizedStage === 'ideas' || markerPattern.test(extractedHtml),
    singleHtmlBlock: normalizedStage === 'ideas' || htmlBlocks.length === 1,
    productName: Boolean(titleText && !genericPattern.test(titleText) && titleText.length >= 4),
    domainTerms: domainTermHits >= 3,
    genericShell: genericPattern.test(`${titleText}\n${visibleText}\n${extractedHtml}`)
      || (profile.key !== 'generic' && genericWorkflowHits >= 2),
    interaction: meaningfulControlCount >= 2 && hasScript && hasEventHandling,
    visualStructure: Boolean(titleText) && headingCount >= 1 && sectionCount >= 2 && hasViewport && hasResponsiveCue,
    packageEvidence: normalizedStage === 'final' ? packageHits >= 3 : packageHits >= 2 || /file tree|run commands|test commands|storage model|api|schema|command/i.test(outsideHtml),
    validationEvidence: normalizedStage === 'final'
      ? validationCommand && validationResult
      : /validation plan|qa checks?|test commands?|browser checks?|smoke/i.test(outsideHtml),
    buildPath: normalizedStage !== 'final' || Boolean(buildPathText && (text.includes(buildPaths?.toolPath || '\u0000') || text.includes(buildPaths?.host || '\u0000'))),
    buildPathSafety: normalizedStage !== 'final' || (!forbiddenBuildPathPattern.test(text) && !forbiddenToolEvidencePattern.test(text)),
  };
  const packageReviewOnly = normalizedStage === 'final'
    && !extractedHtml
    && htmlBlocks.length === 0
    && checks.productName
    && checks.domainTerms
    && !checks.genericShell
    && checks.packageEvidence
    && checks.validationEvidence
    && checks.buildPath
    && checks.buildPathSafety
    && /(?:localhost|127\.0\.0\.1|PORT=|--port|\bport\b|npm run|pnpm|yarn|python -m|uvicorn|flask|cargo run|dotnet run|go run)/i.test(outsideHtml);
  if (packageReviewOnly) {
    checks.marker = true;
    checks.singleHtmlBlock = true;
    checks.interaction = true;
    checks.visualStructure = true;
  }
  checks.packageReviewOnly = packageReviewOnly;
  checks.productSpecificity = checks.productName && checks.domainTerms && !checks.genericShell;

  const failures = [];
  const warnings = [];
  const requiresHtmlPreview = normalizedStage !== 'ideas' && !checks.packageReviewOnly;
  if (requiresHtmlPreview && !extractedHtml) failures.push('Missing fenced HTML artifact for this stage, or missing package-only localhost preview evidence for a final build.');
  if (requiresHtmlPreview && !checks.marker) failures.push(`HTML preview is missing the required data-odysseus-${normalizedStage === 'final' ? 'project-review' : 'project-sketch'} marker.`);
  if (requiresHtmlPreview && !checks.singleHtmlBlock) failures.push(`Expected exactly one fenced html block, found ${htmlBlocks.length}.`);
  if (!checks.productName) failures.push('Preview title or H1 is missing a real, non-generic product name.');
  if (!checks.domainTerms) failures.push(`Preview/body uses too little task-specific language (${domainTermHits}/3 domain terms found).`);
  if (checks.genericShell) failures.push('Preview appears to be a generic shell or fallback template.');
  if (requiresHtmlPreview && !checks.interaction) failures.push(`Preview must include at least two meaningful controls with scripted state or event handling (found ${meaningfulControlCount}).`);
  if (requiresHtmlPreview && !checks.visualStructure) failures.push('Preview needs responsive viewport, clear title/heading, and at least two structured workflow sections.');
  if (!checks.packageEvidence) failures.push(normalizedStage === 'final'
    ? `Final response needs at least three concrete file/package/command references (found ${packageHits}).`
    : 'Sketch response needs concrete package shape, run/test commands, or service/data contract evidence.');
  if (!checks.validationEvidence) failures.push(normalizedStage === 'final'
    ? 'Final response needs an exact local validation command and result.'
    : 'Sketch response needs an explicit validation or QA plan.');
  if (!checks.buildPath) failures.push(`Final response must mention the Council build directory ${buildPaths?.host || 'data/council-builds/[project]'}.`);
  if (!checks.buildPathSafety) failures.push('Final build evidence includes forbidden outside-directory writes or repository-root Docker commands.');
  if (domainTerms.length < 3) warnings.push('Task supplied few distinctive domain terms; QA used the inferred project profile as fallback.');
  if (checks.packageReviewOnly) warnings.push('No HTML sandbox artifact was provided; Idea Loop will use the real package localhost preview path instead.');

  const scoreItems = [
    ['marker', 15],
    ['singleHtmlBlock', 10],
    ['productSpecificity', 25],
    ['interaction', 20],
    ['visualStructure', 15],
    ['packageEvidence', 10],
    ['validationEvidence', normalizedStage === 'final' ? 10 : 5],
  ];
  if (normalizedStage === 'final') scoreItems.push(['buildPath', 5]);
  if (normalizedStage === 'final') scoreItems.push(['buildPathSafety', 10]);
  const possible = scoreItems.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  const earned = scoreItems.reduce((sum, [key, weight]) => sum + (checks[key] ? weight : 0), 0);
  const score = Math.max(0, Math.min(100, Math.round((earned / possible) * 100)));

  return {
    passed: score >= COUNCIL_ARTIFACT_QA_MIN_SCORE && failures.length === 0,
    score,
    failures,
    warnings,
    extractedHtml,
    profile: {
      key: profile.key,
      name: profile.name,
      noun: profile.noun,
      action: profile.action,
    },
    checks: {
      ...checks,
      htmlBlockCount: htmlBlocks.length,
      domainTermHits,
      meaningfulControlCount,
      packageHits,
      titleText,
    },
  };
}

function _qaResultForStorage(qaResult, attempts = 0) {
  return {
    passed: Boolean(qaResult?.passed),
    score: Number(qaResult?.score || 0),
    failures: Array.isArray(qaResult?.failures) ? qaResult.failures.slice(0, 12) : [],
    warnings: Array.isArray(qaResult?.warnings) ? qaResult.warnings.slice(0, 8) : [],
    attempts,
    checks: qaResult?.checks || {},
    profile: qaResult?.profile || {},
  };
}

function _hasVerifiedReviewArtifact(value, task = '') {
  return _evaluateCouncilArtifactQuality(value, 'final', task, _councilBuildPaths(task)).passed;
}

function _hasVerifiedSketchArtifact(value, task = '') {
  return _evaluateCouncilArtifactQuality(value, 'sketch', task, null).passed;
}

function _htmlText(value) {
  return String(value || '').replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[ch]));
}

function _inferProjectProfile(task, response) {
  const text = String(task || response || '').toLowerCase().slice(0, 5000);
  if (/(consensus garden|seed idea|seed ideas|confidence meter|readiness gauge|plant to prototype|promoted ideas)/.test(text)) {
    return { key: 'consensus', name: 'Consensus Garden', noun: 'seed ideas', action: 'Grow decisions' };
  }
  if (/(fuel|gas price|petrol|diesel|ev charging|charging price)/.test(text)) {
    return { key: 'fuel', name: 'Fuel Prices', noun: 'stations', action: 'Compare prices' };
  }
  if (/(resilience mesh|incident command|emergency operations|cascading emergenc|ics-?209|ics-?214|ics-?210|ics-?213rr|dispatcher|logistics lead|field team|commander|resource request|offline-first incident)/.test(text)) {
    return { key: 'incident-command', name: 'Resilience Mesh', noun: 'incidents', action: 'Coordinate response' };
  }
  if (/(booking|reservation|appointment|calendar|clinic|restaurant|hotel)/.test(text)) {
    return { key: 'booking', name: 'Booking Operations', noun: 'bookings', action: 'Schedule capacity' };
  }
  if (/(inventory|stock|warehouse|sku|fulfillment|supply)/.test(text)) {
    return { key: 'inventory', name: 'Inventory Control', noun: 'items', action: 'Manage stock' };
  }
  if (/(task|kanban|todo|project management|sprint|ticket)/.test(text)) {
    return { key: 'tasks', name: 'Project Tracker', noun: 'tasks', action: 'Prioritize work' };
  }
  if (/(council collaboration|agent debate|agent council|deliberation engine|debate workflow|stance map|idea loop council)/.test(text)) {
    return { key: 'council', name: 'Council Collaboration', noun: 'signals', action: 'Tune team debate' };
  }
  return { key: 'generic', name: 'Full-Stack Product', noun: 'records', action: 'Operate workflow' };
}

function _inferDeliveryProfile(task, response) {
  const text = String(`${task || ''}\n${response || ''}`).toLowerCase().slice(0, 7000);
  const common = {
    web: {
      label: 'Web app',
      rowsCode: 'const rows=[{name:"Responsive screen",status:"Ready",priority:1,owner:"Frontend"},{name:"API contract",status:"Ready",priority:1,owner:"Backend"},{name:"Persistent state",status:"Open",priority:2,owner:"Data"},{name:"Browser smoke test",status:"Open",priority:2,owner:"QA"}];',
      steps: [
        ['1. Browser client', 'Build routed screens, forms, validation, loading states, and accessible responsive layouts.'],
        ['2. API service', 'Expose application endpoints, validation, auth boundaries, and error contracts.'],
        ['3. Data layer', 'Persist records, audit events, settings, and migrations.'],
      ],
      commands: 'npm install\nnpm run dev\nnpm test\ndocker compose up --build',
      docs: 'Document screens, API endpoints, environment variables, persistence, browser QA, and deployment.',
    },
    mobile: {
      label: 'Mobile app',
      rowsCode: 'const rows=[{name:"Navigation map",status:"Ready",priority:1,owner:"Mobile"},{name:"Offline/cache model",status:"Open",priority:2,owner:"Data"},{name:"API adapter",status:"Ready",priority:1,owner:"Backend"},{name:"Device QA matrix",status:"Open",priority:2,owner:"QA"}];',
      steps: [
        ['1. Mobile shell', 'Define screens, navigation, gestures, permissions, and native capability boundaries.'],
        ['2. Sync/API layer', 'Connect local state, cache invalidation, authentication, and backend contracts.'],
        ['3. Device validation', 'Run simulator/device smoke tests, accessibility checks, and release build verification.'],
      ],
      commands: 'npm install\nnpx expo start\nnpm test\nnpx expo run:android',
      docs: 'Document target platforms, screen map, permissions, offline behavior, API contracts, and app-store release notes.',
    },
    api: {
      label: 'API service',
      rowsCode: 'const rows=[{name:"OpenAPI schema",status:"Ready",priority:1,owner:"Backend"},{name:"Auth policy",status:"Open",priority:2,owner:"Security"},{name:"Persistence adapter",status:"Ready",priority:1,owner:"Data"},{name:"Contract tests",status:"Open",priority:2,owner:"QA"}];',
      steps: [
        ['1. API contract', 'Define routes, schemas, status codes, auth scopes, pagination, and error bodies.'],
        ['2. Service logic', 'Implement handlers, validation, domain rules, storage adapters, and observability.'],
        ['3. Contract testing', 'Run unit, integration, schema, and failure-mode tests before deployment.'],
      ],
      commands: 'python -m venv .venv\npip install -r requirements.txt\nuvicorn app.main:app --reload\npytest',
      docs: 'Document OpenAPI schema, auth model, data model, rate limits, local curl examples, and deployment.',
    },
    desktop: {
      label: 'Desktop app',
      rowsCode: 'const rows=[{name:"Window shell",status:"Ready",priority:1,owner:"Desktop"},{name:"Local storage",status:"Open",priority:2,owner:"Data"},{name:"Native integrations",status:"Open",priority:2,owner:"Platform"},{name:"Installer smoke test",status:"Blocked",priority:3,owner:"QA"}];',
      steps: [
        ['1. App shell', 'Define windows, menus, shortcuts, file handling, and platform-specific behavior.'],
        ['2. Core runtime', 'Connect UI state, local persistence, background jobs, and native bridges.'],
        ['3. Packaging', 'Build signed installers, update flow, and OS-level smoke tests.'],
      ],
      commands: 'npm install\nnpm run dev\nnpm test\nnpm run package',
      docs: 'Document supported OS targets, local storage, shortcuts, packaging, signing, and update behavior.',
    },
    agent: {
      label: 'AI agent',
      rowsCode: 'const rows=[{name:"Agent loop",status:"Ready",priority:1,owner:"Agent"},{name:"Tool policy",status:"Ready",priority:1,owner:"Safety"},{name:"Memory contract",status:"Open",priority:2,owner:"Data"},{name:"Eval harness",status:"Open",priority:2,owner:"QA"}];',
      steps: [
        ['1. Agent loop', 'Define goals, planning, tool selection, memory reads/writes, and stop conditions.'],
        ['2. Tool boundaries', 'Whitelist tools, permissions, schemas, retries, and audit events.'],
        ['3. Evaluation', 'Run task suites, safety checks, regression prompts, and trace review.'],
      ],
      commands: 'python -m venv .venv\npip install -r requirements.txt\npython -m agent.run --task demo\npytest tests/evals',
      docs: 'Document model/provider choices, tool schemas, memory policy, safety boundaries, evals, and runbooks.',
    },
    saas: {
      label: 'SaaS platform',
      rowsCode: 'const rows=[{name:"Tenant model",status:"Ready",priority:1,owner:"Backend"},{name:"Billing/auth",status:"Open",priority:2,owner:"Platform"},{name:"Admin dashboard",status:"Ready",priority:1,owner:"Frontend"},{name:"SLO/runbook",status:"Open",priority:2,owner:"Ops"}];',
      steps: [
        ['1. Product surface', 'Build tenant-aware user flows, admin controls, billing states, and onboarding.'],
        ['2. Platform services', 'Implement auth, subscriptions, background jobs, data isolation, and audit logs.'],
        ['3. Operations', 'Add observability, migrations, backups, SLOs, and deployment automation.'],
      ],
      commands: 'pnpm install\npnpm dev\npnpm test\ndocker compose up --build',
      docs: 'Document tenant boundaries, billing/auth, service topology, migrations, monitoring, and deployment.',
    },
    cli: {
      label: 'CLI tool',
      rowsCode: 'const rows=[{name:"Command grammar",status:"Ready",priority:1,owner:"CLI"},{name:"Config file",status:"Open",priority:2,owner:"DX"},{name:"Exit codes",status:"Ready",priority:1,owner:"QA"},{name:"Install package",status:"Open",priority:2,owner:"Release"}];',
      steps: [
        ['1. Command interface', 'Define commands, flags, prompts, stdin/stdout behavior, and exit codes.'],
        ['2. Runtime modules', 'Implement parsers, config, filesystem/network adapters, and dry-run behavior.'],
        ['3. Distribution', 'Package binaries, shell completions, docs, and regression tests.'],
      ],
      commands: 'python -m pip install -e .\nmytool --help\npytest\npython -m build',
      docs: 'Document commands, flags, config, examples, exit codes, packaging, and troubleshooting.',
    },
    game: {
      label: 'Game',
      rowsCode: 'const rows=[{name:"Core loop",status:"Ready",priority:1,owner:"Game Design"},{name:"Input system",status:"Ready",priority:1,owner:"Frontend"},{name:"Level/state model",status:"Open",priority:2,owner:"Engineering"},{name:"Playtest checklist",status:"Open",priority:2,owner:"QA"}];',
      steps: [
        ['1. Game loop', 'Define controls, rules, win/loss states, progression, and feedback.'],
        ['2. Runtime systems', 'Implement rendering, physics/state, audio hooks, persistence, and accessibility options.'],
        ['3. Playtesting', 'Run browser/device smoke tests, balance checks, and performance profiling.'],
      ],
      commands: 'npm install\nnpm run dev\nnpm test\nnpm run build',
      docs: 'Document controls, rules, asset pipeline, accessibility, performance targets, and playtest results.',
    },
    automation: {
      label: 'Automation system',
      rowsCode: 'const rows=[{name:"Trigger map",status:"Ready",priority:1,owner:"Ops"},{name:"Action adapter",status:"Ready",priority:1,owner:"Integration"},{name:"Retry policy",status:"Open",priority:2,owner:"Reliability"},{name:"Audit log",status:"Open",priority:2,owner:"QA"}];',
      steps: [
        ['1. Trigger contract', 'Define schedules, webhooks, file watchers, events, and manual overrides.'],
        ['2. Action pipeline', 'Implement adapters, idempotency, retries, secrets handling, and audit logs.'],
        ['3. Operations', 'Add dry-run mode, monitoring, alerting, rollback, and failure drills.'],
      ],
      commands: 'python -m venv .venv\npip install -r requirements.txt\npython -m automation.run --dry-run\npytest',
      docs: 'Document triggers, integrations, secrets, retry policy, audit trail, monitoring, and recovery.',
    },
    extension: {
      label: 'Browser extension',
      rowsCode: 'const rows=[{name:"Manifest",status:"Ready",priority:1,owner:"Extension"},{name:"Content script",status:"Ready",priority:1,owner:"Frontend"},{name:"Background worker",status:"Open",priority:2,owner:"Platform"},{name:"Store QA",status:"Open",priority:2,owner:"Release"}];',
      steps: [
        ['1. Extension shell', 'Define manifest permissions, content scripts, popup UI, and background worker scope.'],
        ['2. Browser integration', 'Implement message passing, storage, host permissions, and safe DOM access.'],
        ['3. Release checks', 'Run browser compatibility, permission review, and packaged extension tests.'],
      ],
      commands: 'npm install\nnpm run dev\nnpm test\nnpm run package:extension',
      docs: 'Document manifest permissions, message contracts, storage, security review, and store submission.',
    },
  };
  if (/(mobile|ios|android|react native|flutter|expo|swiftui|kotlin)/.test(text)) return common.mobile;
  if (/(game|playable|level|score|sprite|three\.js|phaser|godot|unity)/.test(text)) return common.game;
  if (/(cli|command line|terminal|shell command|argv|flags|subcommand)/.test(text)) return common.cli;
  if (/(api|openapi|rest|graphql|endpoint|webhook|sdk|microservice)/.test(text)) return common.api;
  if (/(desktop|electron|tauri|native app|windows app|macos app|linux app)/.test(text)) return common.desktop;
  if (/(ai agent|agentic|agent loop|tool policy|memory policy|eval harness|multi-agent)/.test(text)) return common.agent;
  if (/(saas|tenant|billing|subscription|admin dashboard|multi-tenant)/.test(text)) return common.saas;
  if (/(automation|automate|workflow|cron|scheduler|zapier|n8n|rpa|pipeline)/.test(text)) return common.automation;
  if (/(browser extension|chrome extension|firefox extension|manifest\.json|content script)/.test(text)) return common.extension;
  return common.web;
}

function _fallbackConsensusArtifact(stage) {
  const isFinal = stage === 'final';
  const marker = `data-odysseus-project-${isFinal ? 'review' : 'sketch'}="1"`;
  const title = isFinal ? 'Consensus Garden Review Build' : 'Consensus Garden Prototype';
  const subtitle = isFinal
    ? 'A local review build for turning rated seed ideas into a prototype candidate.'
    : 'A local prototype sketch for rating seed ideas and finding the strongest direction.';
  const docs = isFinal
    ? '<section class="notes"><h2>Review Notes</h2><ul><li>Acceptance: add a seed, adjust confidence, promote the strongest idea, and undo promotion without refreshing.</li><li>Data: seed title, confidence, evidence note, status, and promoted timestamp are persisted when localStorage is available.</li><li>Service shape: production can map this to /seeds, /seeds/:id/confidence, /prototype-candidate, and /audit-events.</li><li>QA: test empty input, confidence extremes, multiple promoted seeds, keyboard Enter on add, mobile layout, and sandbox preview rendering.</li></ul></section>'
    : '<section class="notes"><h2>Open Questions</h2><ul><li>Should readiness be based only on confidence, or include evidence and effort?</li><li>Can more than one seed be promoted, or should promotion create a single build candidate?</li><li>Should the meter be called consensus, conviction, or readiness in the final UI?</li></ul></section>';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + title + '</title>',
    '<style>',
    ':root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17211d;background:#edf4ef}',
    'body{margin:0;padding:22px;background:linear-gradient(135deg,#edf4ef,#f7f2e8 54%,#eef5fb)}',
    '.garden{max-width:1120px;margin:auto;border:1px solid #cddbd1;background:#fbfdf9;border-radius:18px;overflow:hidden;box-shadow:0 18px 54px #253b2f24}',
    'header{display:grid;grid-template-columns:1.4fr .8fr;gap:18px;padding:24px;background:#153322;color:#fff}',
    'h1{margin:0 0 7px;font-size:30px;line-height:1.08}.sub{margin:0;color:#d8eadb;line-height:1.5}.meter{align-self:center;background:#0b2115;border:1px solid #315d41;border-radius:16px;padding:14px}.meter strong{display:block;margin-bottom:10px}.track{height:14px;border-radius:999px;background:#dfe7dc22;overflow:hidden}.bar{height:100%;width:0;background:linear-gradient(90deg,#86b76d,#e0bc5f,#6aa4bf);transition:width .24s ease}.meter span{display:block;margin-top:8px;color:#d8eadb;font-size:13px}',
    '.composer{display:grid;grid-template-columns:minmax(160px,1.7fr) minmax(120px,.7fr) minmax(160px,1fr) auto;gap:12px;padding:16px;background:#f4f8f2;border-bottom:1px solid #dde8dd}',
    'label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#45564a}input,select,button{font:inherit;border:1px solid #bfcec2;border-radius:10px;padding:10px;background:#fff}button{background:#255c3b;color:#fff;border-color:#255c3b;font-weight:800;cursor:pointer}button.secondary{background:#fff;color:#255c3b}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px}.stat{border:1px solid #dde8dd;border-radius:14px;background:#fff;padding:14px}.stat span{display:block;color:#6a786d;font-size:12px;font-weight:800;text-transform:uppercase}.stat strong{display:block;margin-top:5px;font-size:24px;color:#255c3b}',
    '.board{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;padding:0 16px 16px}.panel{border:1px solid #dde8dd;border-radius:14px;background:#fff;overflow:hidden}.panel h2{margin:0;padding:14px 15px;background:#f8faf6;border-bottom:1px solid #dde8dd;font-size:16px}.list{display:grid;gap:10px;padding:14px}.seed{display:grid;gap:9px;border:1px solid #e2e8de;border-radius:12px;padding:12px;background:#fff}.seed-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.seed h3{margin:0;font-size:15px}.badge{display:inline-flex;border-radius:999px;padding:4px 8px;background:#eef6ea;color:#255c3b;font-size:12px;font-weight:900}.seed p{margin:0;color:#5d6c61;font-size:13px;line-height:1.45}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{padding:8px 9px;font-size:13px}.prototype{display:grid;gap:12px;padding:14px}.candidate{border:1px solid #d8c58b;background:#fff9e8;border-radius:14px;padding:14px}.candidate h3{margin:0 0 6px}.empty{color:#6a786d;border:1px dashed #bfcec2;border-radius:12px;padding:16px;text-align:center}',
    '.notes{margin:0 16px 16px;padding:16px;border:1px solid #d7e1dd;border-radius:14px;background:#f6f8fb}.notes h2{margin:0 0 8px;font-size:16px}.notes li{color:#53645b;line-height:1.5}',
    '@media(max-width:880px){header,.composer,.stats,.board{grid-template-columns:1fr}.composer{gap:10px}h1{font-size:25px}}',
    '</style>',
    '</head>',
    '<body>',
    `<main class="garden" ${marker}>`,
    '<header><div><h1>' + title + '</h1><p class="sub">' + subtitle + '</p></div><div class="meter"><strong>Garden readiness</strong><div class="track"><div id="readinessBar" class="bar"></div></div><span id="readinessText">0% ready</span></div></header>',
    '<section class="composer">',
    '<label>Seed idea<input id="seedText" value="Make agent debate visible"></label>',
    '<label>Confidence<input id="confidence" type="range" min="1" max="10" value="7"></label>',
    '<label>Evidence note<select id="evidence"><option value="Needs evidence">Needs evidence</option><option value="User pain is clear">User pain is clear</option><option value="Prototype is cheap">Prototype is cheap</option><option value="Risk is known">Risk is known</option></select></label>',
    '<button id="addSeed" type="button">Add seed</button>',
    '</section>',
    '<section class="stats"><div class="stat"><span>Active seeds</span><strong id="activeCount">0</strong></div><div class="stat"><span>Promoted</span><strong id="promotedCount">0</strong></div><div class="stat"><span>Strongest</span><strong id="strongestScore">0</strong></div><div class="stat"><span>Average</span><strong id="averageScore">0</strong></div></section>',
    '<section class="board"><div class="panel"><h2>Seed Bed</h2><div id="seeds" class="list"></div></div><div class="panel"><h2>Prototype Candidate</h2><div id="prototype" class="prototype"></div></div></section>',
    docs,
    '</main>',
    '<script>',
    'const storeKey="consensusGardenState";',
    'function loadSeeds(){try{return JSON.parse(localStorage.getItem(storeKey)||"null")}catch(e){return null}}',
    'function saveSeeds(){try{localStorage.setItem(storeKey,JSON.stringify(seeds))}catch(e){}}',
    'let seeds=loadSeeds()||[{id:1,title:"Make agent debate visible",confidence:8,evidence:"User pain is clear",promoted:false},{id:2,title:"Add readiness gauge",confidence:7,evidence:"Prototype is cheap",promoted:false},{id:3,title:"Keep artifact scope tiny",confidence:6,evidence:"Risk is known",promoted:false}];',
    'function readiness(seed){return Math.min(100,Math.round(seed.confidence*9+(seed.evidence==="Needs evidence"?0:10)+(seed.promoted?5:0)))}',
    'function strongestSeed(){return seeds.slice().sort((a,b)=>readiness(b)-readiness(a))[0]}',
    'function render(){const active=seeds.filter(s=>!s.promoted),promoted=seeds.filter(s=>s.promoted),best=strongestSeed(),avg=seeds.length?Math.round(seeds.reduce((n,s)=>n+readiness(s),0)/seeds.length):0;document.getElementById("readinessBar").style.width=avg+"%";document.getElementById("readinessText").textContent=avg+"% garden readiness";document.getElementById("activeCount").textContent=active.length;document.getElementById("promotedCount").textContent=promoted.length;document.getElementById("strongestScore").textContent=best?readiness(best)+"%":"0";document.getElementById("averageScore").textContent=avg+"%";document.getElementById("seeds").innerHTML=active.length?active.map(card).join(""):"<div class=\\"empty\\">Add a seed idea to start the garden.</div>";document.getElementById("prototype").innerHTML=promoted.length?promoted.map(candidate).join(""):"<div class=\\"empty\\">Promote a high-confidence seed when it is ready.</div>";saveSeeds()}',
    'function card(seed){return `<article class="seed"><div class="seed-top"><h3>${escapeHtml(seed.title)}</h3><span class="badge">${readiness(seed)}%</span></div><p>${escapeHtml(seed.evidence)}</p><input data-action="confidence" data-id="${seed.id}" type="range" min="1" max="10" value="${seed.confidence}"><div class="actions"><button data-action="promote" data-id="${seed.id}" type="button">Promote</button><button class="secondary" data-action="boost" data-id="${seed.id}" type="button">Boost</button><button class="secondary" data-action="remove" data-id="${seed.id}" type="button">Remove</button></div></article>`}',
    'function candidate(seed){return `<article class="candidate"><h3>${escapeHtml(seed.title)}</h3><p>${escapeHtml(seed.evidence)}</p><p><strong>${readiness(seed)}%</strong> ready for prototype review.</p><button class="secondary" data-action="undo" data-id="${seed.id}" type="button">Return to seed bed</button></article>`}',
    'function escapeHtml(value){return String(value).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[ch]))}',
    'document.getElementById("addSeed").addEventListener("click",()=>{const input=document.getElementById("seedText");const title=input.value.trim();if(!title){input.focus();return}seeds.push({id:Date.now(),title,confidence:+document.getElementById("confidence").value,evidence:document.getElementById("evidence").value,promoted:false});input.value="";render()});',
    'document.getElementById("seedText").addEventListener("keydown",event=>{if(event.key==="Enter")document.getElementById("addSeed").click()});',
    'document.addEventListener("input",event=>{if(event.target.dataset.action==="confidence"){const seed=seeds.find(s=>s.id===+event.target.dataset.id);if(seed){seed.confidence=+event.target.value;render()}}});',
    'document.addEventListener("click",event=>{const action=event.target.dataset.action,id=+event.target.dataset.id;if(!action)return;const seed=seeds.find(s=>s.id===id);if(action==="promote"&&seed)seed.promoted=true;if(action==="undo"&&seed)seed.promoted=false;if(action==="boost"&&seed)seed.confidence=Math.min(10,seed.confidence+1);if(action==="remove")seeds=seeds.filter(s=>s.id!==id);render()});',
    'render();',
    '</script>',
    '</body></html>',
  ].join('\n');
}

function _fallbackFuelArtifact(stage) {
  const isFinal = stage === 'final';
  const title = isFinal ? 'Odysseus Fuel Prices' : 'Fuel Prices Prototype';
  const subtitle = isFinal
    ? 'A local, single-file review build with sorting, filters, cost estimates, and documentation.'
    : 'A local sketch showing the proposed fuel price comparison experience.';
  const docs = isFinal
    ? '<section class="docs"><h2>Documentation</h2><p>Use the controls to compare petrol, diesel, and EV charging options. Prices are sample data for local review; production should replace this array with trusted provider APIs and timestamped refresh metadata.</p><ul><li>Inputs: location, currency, fuel type, efficiency, trip distance, and sort order.</li><li>Calculation: estimated trip cost = distance / efficiency * unit price, with EV efficiency treated as km per kWh.</li><li>Persistence: the current filter state is saved in localStorage.</li><li>Tests: change fuel type, currency, distance, efficiency, and sort order; verify table rows and trip totals update.</li></ul></section>'
    : '<section class="docs"><h2>Open Questions</h2><ul><li>Which regional fuel price API should be authoritative?</li><li>Should EV charging include idle fees and charging speed?</li><li>Should location be geolocation, manual search, or both?</li></ul></section>';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + title + '</title>',
    '<style>',
    ':root{font-family:Inter,system-ui,sans-serif;color:#18202a;background:#eef3f8}',
    'body{margin:0;padding:24px;background:linear-gradient(135deg,#eef3f8,#f8fbf2)}',
    '.app{max-width:1080px;margin:auto;background:#fff;border:1px solid #d7e0ea;border-radius:18px;box-shadow:0 18px 60px #1b36551f;overflow:hidden}',
    'header{padding:24px;background:#15212f;color:#fff}h1{margin:0 0 6px;font-size:30px}.sub{opacity:.78;margin:0}',
    '.controls{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:12px;padding:16px;border-bottom:1px solid #e5ebf2;background:#f8fafc}',
    'label{display:grid;gap:5px;font-size:12px;font-weight:700;color:#465362}input,select{border:1px solid #cbd6e2;border-radius:10px;padding:10px;font:inherit;background:#fff}',
    '.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px}.metric{border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fbfdff}.metric strong{display:block;font-size:22px;color:#0d7c66}',
    'table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 16px;border-top:1px solid #edf1f5}th{font-size:12px;text-transform:uppercase;color:#667387;background:#fbfdff}td.cost{font-weight:800;color:#0d7c66}',
    '.badge{display:inline-flex;border-radius:999px;padding:4px 9px;background:#e8f6f2;color:#0d7c66;font-weight:800;font-size:12px}',
    '.docs{margin:16px;padding:16px;border-radius:14px;background:#f6f8fb;border:1px solid #e2e8f0}.docs h2{margin:0 0 8px;font-size:16px}.docs p,.docs li{color:#536171;line-height:1.5}',
    '@media(max-width:860px){.controls,.summary{grid-template-columns:1fr 1fr}table{font-size:13px}}',
    '</style>',
    '</head>',
    '<body>',
    `<main class="app" data-odysseus-fuel-${isFinal ? 'review' : 'sketch'}="1">`,
    '<header><h1>' + title + '</h1><p class="sub">' + subtitle + '</p></header>',
    '<section class="controls">',
    '<label>Location<input id="loc" value="Manchester"></label>',
    '<label>Fuel<select id="fuel"><option>All</option><option>Petrol</option><option>Diesel</option><option>EV</option></select></label>',
    '<label>Currency<select id="currency"><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="USD">USD</option></select></label>',
    '<label>Trip km<input id="distance" type="number" min="1" value="120"></label>',
    '<label>Efficiency<input id="efficiency" type="number" min="1" value="16"></label>',
    '<label>Sort<select id="sort"><option value="cost">Trip cost</option><option value="price">Unit price</option><option value="distance">Distance</option></select></label>',
    '</section>',
    '<section class="summary"><div class="metric">Best option<strong id="best">-</strong></div><div class="metric">Average unit price<strong id="avg">-</strong></div><div class="metric">Rows shown<strong id="shown">-</strong></div></section>',
    '<table><thead><tr><th>Provider</th><th>Type</th><th>Unit price</th><th>Distance</th><th>Trip estimate</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table>',
    docs,
    '</main>',
    '<script>',
    'const data=[{name:"Northgate Energy",type:"Petrol",price:1.47,km:2.4,status:"live"},{name:"River Road Fuels",type:"Diesel",price:1.56,km:4.2,status:"live"},{name:"VoltHub Central",type:"EV",price:.42,km:1.8,status:"rapid"},{name:"Market Street Pumps",type:"Petrol",price:1.44,km:6.1,status:"stale 12m"},{name:"GreenCharge Park",type:"EV",price:.36,km:7.5,status:"standard"}];',
    'const rates={GBP:1,EUR:1.17,USD:1.27};const sym={GBP:"GBP ",EUR:"EUR ",USD:"$"};',
    'const els=["loc","fuel","currency","distance","efficiency","sort"].reduce((a,id)=>(a[id]=document.getElementById(id),a),{});',
    'function calc(row){const d=+els.distance.value||1,e=+els.efficiency.value||1;return row.type==="EV"?(d/e)*row.price:(d/e)*row.price;}',
    'function render(){try{localStorage.fuelPriceState=JSON.stringify(Object.fromEntries(Object.entries(els).map(([k,e])=>[k,e.value])))}catch(e){}let rows=data.filter(r=>els.fuel.value==="All"||r.type===els.fuel.value);rows.sort((a,b)=>els.sort.value==="price"?a.price-b.price:els.sort.value==="distance"?a.km-b.km:calc(a)-calc(b));const rate=rates[els.currency.value],s=sym[els.currency.value];document.getElementById("rows").innerHTML=rows.map(r=>`<tr><td>${r.name}</td><td><span class="badge">${r.type}</span></td><td>${s}${(r.price*rate).toFixed(2)}</td><td>${r.km.toFixed(1)} km</td><td class="cost">${s}${(calc(r)*rate).toFixed(2)}</td><td>${r.status}</td></tr>`).join("");document.getElementById("best").textContent=rows[0]?rows[0].name:"-";document.getElementById("avg").textContent=rows.length?s+(rows.reduce((n,r)=>n+r.price,0)/rows.length*rate).toFixed(2):"-";document.getElementById("shown").textContent=rows.length;}',
    'try{const saved=JSON.parse(localStorage.fuelPriceState||"{}");Object.entries(saved).forEach(([k,v])=>{if(els[k])els[k].value=v})}catch(e){}Object.values(els).forEach(e=>e.addEventListener("input",render));Object.values(els).forEach(e=>e.addEventListener("change",render));render();',
    '</script>',
    '</body></html>',
  ].join('\n');
}

function _fallbackProjectArtifact(stage, task, response) {
  const profile = _inferProjectProfile(task, response);
  if (profile.key === 'consensus') return _fallbackConsensusArtifact(stage);
  if (profile.key === 'fuel') return _fallbackFuelArtifact(stage);
  const delivery = _inferDeliveryProfile(task, response);
  const isFinal = stage === 'final';
  const marker = isFinal ? 'data-odysseus-project-review="1"' : 'data-odysseus-project-sketch="1"';
  const title = isFinal ? `${profile.name} Review Build` : `${profile.name} Prototype`;
  const subtitle = isFinal
    ? `A local ${delivery.label.toLowerCase()} review harness with package shape, contracts, docs, and acceptance checks.`
    : `A local ${delivery.label.toLowerCase()} sketch that previews workflow, state, contracts, and implementation path.`;
  const request = _htmlText(_cleanCouncilTask(task).slice(0, 520) || title);
  const addLabel = profile.key === 'consensus' ? 'Add seed' : (profile.key === 'council' ? 'Add stance' : 'Add sample');
  const sampleRows = profile.key === 'consensus'
    ? 'const rows=[{name:"Sample seed: tighten onboarding",status:"Ready",priority:1,owner:"Strategy"},{name:"Add confidence slider",status:"Ready",priority:1,owner:"UX"},{name:"Promoted idea undo timer",status:"Open",priority:2,owner:"Frontend"},{name:"Evidence summary notes",status:"Blocked",priority:3,owner:"Research"}];'
    : (profile.key === 'incident-command'
      ? 'const rows=[{name:"Canyon Fire active incident",status:"Ready",priority:1,owner:"Commander"},{name:"Shelter generator request",status:"Open",priority:1,owner:"Logistics"},{name:"Engine 71 out of service",status:"Blocked",priority:2,owner:"Dispatcher"},{name:"North bridge field report",status:"Ready",priority:2,owner:"Field Team"}];'
    : (profile.key === 'council'
      ? 'const rows=[{name:"Agent stance map",status:"Ready",priority:1,owner:"Agent 1"},{name:"Challenge quote links",status:"Open",priority:2,owner:"Agent 2"},{name:"Consensus meter",status:"Ready",priority:1,owner:"Synthesis"},{name:"Evidence gaps",status:"Blocked",priority:3,owner:"Research"}];'
      : delivery.rowsCode));
  const newRecordPrefix = profile.key === 'consensus' ? 'New seed idea ' : (profile.key === 'council' ? 'New Council signal ' : (profile.key === 'incident-command' ? 'New incident signal ' : 'New local record '));
  const flowSteps = delivery.steps
    .map(([name, detail]) => `<div class="step"><strong>${_htmlText(name)}</strong><span>${_htmlText(detail)}</span></div>`)
    .join('');
  const docs = isFinal
    ? '<section class="docs"><h2>Documentation</h2><ul><li>Target deliverable: ' + _htmlText(delivery.label) + '. The HTML here is only the Idea Loop review harness.</li><li>' + _htmlText(delivery.docs) + '</li><li>Package output: include repository/file tree, key source files or patches, contracts, storage/migration notes, environment variables, tests, and run commands in the Council response.</li><li>Tests: validate the preview controls plus the real project commands, service contracts, failure handling, and deployment path.</li></ul></section>'
    : '<section class="docs"><h2>Open Questions</h2><ul><li>Which target runtime, framework, or platform should be authoritative?</li><li>Which files, services, APIs, commands, or integrations are required for the real deliverable?</li><li>Which events, logs, permissions, or data migrations must be audited before release?</li></ul></section>';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + _htmlText(title) + '</title>',
    '<style>',
    ':root{font-family:Inter,system-ui,sans-serif;color:#18202a;background:#eef3f8}',
    'body{margin:0;padding:24px;background:#eef3f8}',
    '.app{max-width:1120px;margin:auto;background:#fff;border:1px solid #d7e0ea;border-radius:16px;box-shadow:0 18px 60px #1b36551f;overflow:hidden}',
    'header{padding:24px;background:#15212f;color:#fff}h1{margin:0 0 6px;font-size:28px}.sub{opacity:.82;margin:0}.request{margin-top:12px;padding:10px;border-radius:10px;background:#ffffff1a;font-size:13px;line-height:1.45}',
    '.toolbar{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:12px;padding:16px;border-bottom:1px solid #e5ebf2;background:#f8fafc}',
    'input,select,button{border:1px solid #cbd6e2;border-radius:10px;padding:10px;font:inherit;background:#fff}button{background:#0d7c66;color:#fff;border-color:#0d7c66;font-weight:800;cursor:pointer}',
    '.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px}.metric{border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fbfdff}.metric strong{display:block;font-size:22px;color:#0d7c66}',
    '.layout{display:grid;grid-template-columns:1.1fr .9fr;gap:16px;padding:0 16px 16px}.panel{border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}.panel h2{margin:0;padding:13px 15px;border-bottom:1px solid #e2e8f0;font-size:16px;background:#fbfdff}',
    'table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px 14px;border-top:1px solid #edf1f5}th{font-size:12px;text-transform:uppercase;color:#667387;background:#fbfdff}.status{display:inline-flex;border-radius:999px;padding:4px 8px;background:#e8f6f2;color:#0d7c66;font-weight:800;font-size:12px}',
    '.flow{display:grid;gap:10px;padding:14px}.step{border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff}.step strong{display:block;margin-bottom:4px}.code{font-family:ui-monospace,Consolas,monospace;background:#111827;color:#d7f9ee;border-radius:12px;padding:12px;overflow:auto;font-size:12px}',
    '.docs{margin:0 16px 16px;padding:16px;border-radius:14px;background:#f6f8fb;border:1px solid #e2e8f0}.docs h2{margin:0 0 8px;font-size:16px}.docs li{color:#536171;line-height:1.5}',
    '@media(max-width:880px){.toolbar,.summary,.layout{grid-template-columns:1fr}.summary{gap:8px}}',
    '</style>',
    '</head>',
    '<body>',
    `<main class="app" ${marker}>`,
    '<header><h1>' + _htmlText(title) + '</h1><p class="sub">' + _htmlText(subtitle) + '</p><div class="request">' + request + '</div></header>',
    '<section class="toolbar"><input id="search" placeholder="Search ' + _htmlText(profile.noun) + '"><select id="status"><option>All</option><option>Open</option><option>Ready</option><option>Blocked</option></select><select id="sort"><option value="priority">Priority</option><option value="updated">Updated</option></select><button id="add">' + _htmlText(addLabel) + '</button></section>',
    '<section class="summary"><div class="metric">Visible<strong id="visible">-</strong></div><div class="metric">Ready<strong id="ready">-</strong></div><div class="metric">Blocked<strong id="blocked">-</strong></div><div class="metric">API status<strong id="api">local</strong></div></section>',
    '<section class="layout"><div class="panel"><h2>' + _htmlText(profile.action) + '</h2><table><thead><tr><th>Name</th><th>Status</th><th>Priority</th><th>Owner</th></tr></thead><tbody id="rows"></tbody></table></div><div class="panel"><h2>' + _htmlText(delivery.label) + ' package flow</h2><div class="flow">' + flowSteps + '<pre class="code">' + _htmlText(delivery.commands) + '</pre></div></div></section>',
    docs,
    '<script>',
    sampleRows,
    'const els={search:document.getElementById("search"),status:document.getElementById("status"),sort:document.getElementById("sort"),rows:document.getElementById("rows")};',
    'function render(){let out=rows.filter(r=>(els.status.value==="All"||r.status===els.status.value)&&r.name.toLowerCase().includes(els.search.value.toLowerCase()));out.sort((a,b)=>els.sort.value==="priority"?a.priority-b.priority:a.name.localeCompare(b.name));els.rows.innerHTML=out.map(r=>`<tr><td>${r.name}</td><td><span class="status">${r.status}</span></td><td>P${r.priority}</td><td>${r.owner}</td></tr>`).join("");document.getElementById("visible").textContent=out.length;document.getElementById("ready").textContent=out.filter(r=>r.status==="Ready").length;document.getElementById("blocked").textContent=out.filter(r=>r.status==="Blocked").length;}',
    'document.getElementById("add").addEventListener("click",()=>{rows.push({name:"' + _htmlText(newRecordPrefix) + '"+(rows.length+1),status:"Open",priority:2,owner:"User"});render()});Object.values(els).forEach(e=>e.addEventListener("input",render));Object.values(els).forEach(e=>e.addEventListener("change",render));render();',
    '</script>',
    '</body></html>',
  ].join('\n');
}

function _ensureStageArtifact(response, stage, task = '') {
  if (stage !== 'sketch' && stage !== 'final') return response;
  const buildPaths = stage === 'final' ? _councilBuildPaths(task) : null;
  return _evaluateCouncilArtifactQuality(response, stage, task, buildPaths).passed ? response : '';
}

function _buildCouncilQaBlockedBody(task, stage, qaResult, attempts, consensus = null) {
  return [
    '## Council artifact QA blocked',
    '',
    `Stage: ${stage}`,
    `Score: ${qaResult.score}% (required ${COUNCIL_ARTIFACT_QA_MIN_SCORE}%)`,
    `Revision attempts: ${attempts}/${COUNCIL_ARTIFACT_QA_MAX_REVISIONS}`,
    consensus ? `Consensus before QA: ${consensus.average || 0}% average, ${consensus.minimum || 0}% minimum` : '',
    '',
    'No sandbox preview was published because the Council artifact did not pass the hard quality gate.',
    '',
    'Failures:',
    ...(qaResult.failures.length ? qaResult.failures.map((failure) => `- ${failure}`) : ['- Unknown QA failure.']),
    qaResult.warnings.length ? '' : null,
    ...qaResult.warnings.map((warning) => `Warning: ${warning}`),
    '',
    'Repair target:',
    '- Produce a complete replacement artifact for the same task.',
    '- Use one fenced HTML preview with the required stage marker.',
    '- Use the real product name, domain language, workflow data, controls, package evidence, and validation evidence.',
    '- Do not use fallback templates, generic dashboard rows, or placeholder product names.',
    '',
    'Council task:',
    _cleanCouncilTask(task),
  ].filter((line) => line !== null).join('\n');
}

async function _rememberCouncilArtifact(config, title, stage, item) {
  const memoryText = [
    `Idea Loop ${stage} artifact created: ${config.titlePrefix}: ${title}`,
    `Workspace item: ${item?.id || 'unknown'}`,
    `Tags: ${config.tags.join(', ')}`,
  ].join('\n');
  try {
    await fetch(`${API_BASE}/api/memory/add`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: memoryText,
        category: 'workspace',
        source: 'council',
        session_id: _parentSessionId || undefined,
      }),
    });
  } catch (e) {
    console.warn('[group] Council artifact memory sync failed:', e);
  }
}

async function _startWorkspaceLocalPreview(kind, itemId) {
  const res = await fetch(`${API_BASE}/api/workspace/preview/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}/start`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || body.error || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

async function _pushCouncilIdea(task, holder, modelIdx, publishOptions = {}) {
  if (!_isCouncilWorkflowMessage(task)) return;
  if (holder?.dataset?.ideaLoopPushed === '1') return;

  const stage = _councilStageFromTask(task);
  const source = _councilSourceFromTask(task);
  const config = _stagePushConfig(stage);
  const buildPaths = publishOptions.buildPaths || (stage === 'final' ? _councilBuildPaths(task) : null);
  const rawResponse = (publishOptions.response || holder?.dataset?.raw || '').trim();
  const qaResult = (stage === 'sketch' || stage === 'final')
    ? (publishOptions.qaResult || _evaluateCouncilArtifactQuality(rawResponse, stage, task, buildPaths))
    : null;
  const qaAttempts = Number(publishOptions.qaAttempts || 0);
  const blocked = Boolean(publishOptions.blocked || (qaResult && !qaResult.passed));
  const response = blocked
    ? _buildCouncilQaBlockedBody(task, stage, qaResult, qaAttempts, publishOptions.consensus)
    : (stage === 'sketch' || stage === 'final' ? (qaResult?.passed ? rawResponse : '') : rawResponse);
  if (!response) return;
  holder.dataset.ideaLoopPushed = '1';

  const modelName = _models[modelIdx]?._groupName || _models[modelIdx]?.display || `Agent ${modelIdx + 1}`;
  const title = _ideaTitleFromTask(task);
  const transcript = (holder?.dataset?.councilTranscript || '').trim();
  const transcriptBlock = transcript
    ? ['Council collaboration transcript:', transcript, ''].join('\n')
    : '';
  try {
    const res = await fetch(`${API_BASE}/api/workspace/${config.kind}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${config.titlePrefix}: ${title}`,
        body: [
          `Council task: ${_cleanCouncilTask(task)}`,
          '',
          transcriptBlock,
          `${modelName} consensus synthesis:`,
          response,
        ].join('\n').trim(),
        status: blocked ? 'blocked' : config.status,
        source: 'council',
        tags: blocked ? [...new Set([...config.tags, 'qa-blocked'])] : config.tags,
        evidence: [
          `Lifecycle stage: ${stage}.`,
          `Required gates: ${(config.gates || []).join(', ')}.`,
          buildPaths ? `Final app package path: ${buildPaths.host} (container: ${buildPaths.container}).` : '',
          qaResult ? `Artifact QA: ${qaResult.score}% ${qaResult.passed ? 'passed' : 'blocked'} after ${qaAttempts} revision attempt${qaAttempts === 1 ? '' : 's'}.` : '',
          qaResult?.failures?.length ? `QA failures: ${qaResult.failures.join('; ')}` : '',
          transcript ? 'Collaboration evidence: position round, critique round, and final synthesis transcript captured in this artifact.' : '',
          'Knowledge sync: Obsidian/workspace artifact created as the source of truth.',
        ].filter(Boolean).join('\n'),
        links: {
          session_id: _parentSessionId,
          model: _models[modelIdx]?.mid,
          stage,
          build_dir: buildPaths?.host,
          build_dir_container: buildPaths?.container,
          source_kind: source.kind,
          source_id: source.id,
          qa_result: qaResult ? _qaResultForStorage(qaResult, qaAttempts) : undefined,
        },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const item = await res.json().catch(() => null);
    if (!blocked && stage === 'final' && item?.id && buildPaths) {
      try {
        await _startWorkspaceLocalPreview(config.kind, item.id);
      } catch (previewErr) {
        console.warn('[group] Council local preview start failed:', previewErr);
      }
    }
    _rememberCouncilArtifact(config, title, stage, item);
    if (window.workspaceModule?.refreshAndOpenIdeaLoop) await window.workspaceModule.refreshAndOpenIdeaLoop();
    else if (window.workspaceModule?.openIdeaLoop && !document.getElementById('idea-loop-modal')) window.workspaceModule.openIdeaLoop();
    uiModule.showToast?.(blocked ? 'Council artifact QA blocked; failures are in Idea Loop' : config.toast);
  } catch (e) {
    holder.dataset.ideaLoopPushed = '0';
    console.warn('[group] Failed to push Council idea:', e);
    uiModule.showError?.('Council finished, but Idea Loop push failed');
  }
}

async function _streamToHolder(modelIdx, sessionId, msg, holderEl, abortCtrl, options = {}) {
  if (!sessionId) {
    holderEl.querySelector('.body').innerHTML = '<i style="opacity:0.5;">[Session creation failed]</i>';
    return;
  }

  const fd = new FormData();
  fd.append('message', msg);
  fd.append('session', sessionId);
  fd.append('mode', options.mode || 'chat');
  if (options.councilMode) fd.append('council_mode', 'true');
  if (options.allowWebSearch) fd.append('allow_web_search', 'true');
  if (options.allowBash) fd.append('allow_bash', 'true');
  if (options.councilToolScope) fd.append('council_tool_scope', options.councilToolScope);
  if (options.councilBuildDir) fd.append('council_build_dir', options.councilBuildDir);

  let accumulated = '';
  let _buffer = '';
  let _firstToken = true;
  const toolEvents = [];
  const bodyEl = holderEl.querySelector('.body');
  const phaseLabel = String(options.phase || '');
  const deferLiveRender = Boolean(options.deferRender || (options.councilMode && /Council (?:synthesis|artifact QA revision)/i.test(phaseLabel)));
  let lastDeferredRender = 0;
  const beginTextStream = () => {
    if (!_firstToken) return;
    _firstToken = false;
    if (holderEl._spinner) { holderEl._spinner.destroy(); delete holderEl._spinner; }
    bodyEl.innerHTML = '';
  };
  const renderDeferredProgress = () => {
    const now = Date.now();
    if (now - lastDeferredRender < 1200) return;
    lastDeferredRender = now;
    let status = bodyEl.querySelector('.council-deferred-stream-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'council-deferred-stream-status';
      status.style.cssText = 'font-size:12px;opacity:0.68;padding:6px 0;font-style:italic;';
      bodyEl.prepend(status);
    }
    status.textContent = `${phaseLabel || 'Council build'} in progress - ${accumulated.length.toLocaleString()} chars captured`;
  };
  const renderAccumulated = () => {
    if (deferLiveRender) {
      renderDeferredProgress();
      return;
    }
    bodyEl.innerHTML = markdownModule.processWithThinking(
      markdownModule.squashOutsideCode(accumulated)
    );
    uiModule.scrollHistory();
  };

  try {
    const res = await fetch(`${API_BASE}/api/chat_stream`, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      signal: abortCtrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${errText ? `: ${errText.slice(0, 240)}` : ''}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      _buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = _buffer.split('\n');
      _buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        if (line === 'data: [DONE]') continue;

        try {
          const json = JSON.parse(line.slice(6));

          // Text delta (OpenAI format)
          if (json.choices?.[0]?.delta?.content) {
            beginTextStream();
            accumulated += json.choices[0].delta.content;
            renderAccumulated();
          }
          // Text delta (Odysseus format)
          else if (json.delta !== undefined) {
            beginTextStream();
            // Handle thinking tags from vLLM
            let _d = json.delta;
            if (json.thinking) {
              if (!accumulated.includes('<think>')) _d = '<think>' + _d;
            } else if (accumulated.includes('<think>') && !accumulated.includes('</think>')) {
              _d = '</think>' + _d;
            }
            accumulated += _d;
            renderAccumulated();
          }
          // Agent tool events
          else if (json.type === 'tool_start') {
            toolEvents.push({ tool: json.tool || 'tool', command: json.command || '' });
            holderEl.dataset.councilTools = JSON.stringify(toolEvents);
            const toolDiv = document.createElement('div');
            toolDiv.className = 'agent-tool-event';
            toolDiv.style.cssText = 'font-size:11px;opacity:0.5;padding:2px 0;font-family:monospace;';
            toolDiv.textContent = `[tool] ${json.tool || 'tool'}${json.command ? ': ' + json.command.substring(0, 60) : ''}`;
            bodyEl.appendChild(toolDiv);
          }
          else if (json.type === 'tool_output') {
            const last = toolEvents[toolEvents.length - 1];
            if (last) {
              last.output = String(json.output || '').substring(0, 200);
              if (json.exit_code !== undefined) last.exitCode = json.exit_code;
              holderEl.dataset.councilTools = JSON.stringify(toolEvents);
            }
            const outDiv = document.createElement('div');
            outDiv.className = 'agent-tool-output';
            outDiv.style.cssText = 'font-size:10px;opacity:0.4;padding:2px 0;font-family:monospace;max-height:60px;overflow:hidden;';
            outDiv.textContent = (json.output || '').substring(0, 200);
            bodyEl.appendChild(outDiv);
          }
          // Generated image
          else if (json.type === 'generated_image' && json.url) {
            const img = document.createElement('img');
            img.src = json.url;
            img.style.cssText = 'max-width:100%;border-radius:8px;margin:8px 0;';
            img.loading = 'lazy';
            bodyEl.appendChild(img);
          }
          // Error
          else if (json.error) {
            const errDiv = document.createElement('div');
            errDiv.style.cssText = 'color:var(--color-error);font-style:italic;padding:4px 0;';
            errDiv.textContent = `[Error: ${json.error}]`;
            bodyEl.appendChild(errDiv);
          }
        } catch (e) { /* skip unparseable */ }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('[group] Stream error:', e);
    accumulated = `[Stream error: ${e.message || e}]`;
    holderEl.dataset.streamError = '1';
    bodyEl.innerHTML = `<div style="color:var(--color-error);font-style:italic;">${uiModule.esc(accumulated)}</div>`;
  }

  if (!accumulated && options.councilMode && options.pushTask && /synthesis/i.test(String(options.phase || ''))) {
    const stage = _councilStageFromTask(options.pushTask || msg);
    if (stage === 'sketch' || stage === 'final') {
      accumulated = [
        '## Council synthesis missing',
        'The upstream synthesis stream returned no visible artifact candidate.',
        'Artifact QA will request a Council repair pass or block this stage without publishing a fallback preview.',
      ].join('\n');
    }
  }

  // Final render with footer
  if (accumulated) {
    const renderedAccumulated = deferLiveRender && accumulated.length > 9000
      ? [
        accumulated.slice(0, 6000),
        '',
        `[...Council ${phaseLabel || 'build'} output captured; full ${accumulated.length.toLocaleString()} characters retained for QA and Idea Loop artifact storage...]`,
        '',
        accumulated.slice(-1800),
      ].join('\n')
      : accumulated;
    bodyEl.innerHTML = markdownModule.processWithThinking(
      markdownModule.squashOutsideCode(renderedAccumulated)
    );
    if (window.hljs) holderEl.querySelectorAll('pre code').forEach(b => window.hljs.highlightElement(b));
    if (markdownModule.renderMermaid) markdownModule.renderMermaid(holderEl);
    holderEl.appendChild(chatRenderer.createMsgFooter(holderEl));
  } else if (!bodyEl.querySelector('.agent-tool-event') && !bodyEl.querySelector('img')) {
    bodyEl.innerHTML = '<i style="opacity:0.5;">[No response]</i>';
  }

  holderEl.dataset.raw = accumulated;
  holderEl.dataset.groupModel = _models[modelIdx].mid;
  if (!options.suppressIdeaPush) {
    await _pushCouncilIdea(options.pushTask || msg, holderEl, modelIdx);
  }

  // Save response to parent session for persistence
  if (accumulated && _parentSessionId) {
    const gName = _models[modelIdx]._groupName || _models[modelIdx].display;
    fetch(`${API_BASE}/api/session/${_parentSessionId}/inject_messages`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{
        role: 'assistant', content: accumulated,
        metadata: { group_model: gName, model: _models[modelIdx].mid, group_phase: options.phase || undefined }
      }]}),
    }).catch(() => {});
  }
}

// ── State Persistence ────────────────────────────────

function _saveState() {
  try {
    localStorage.setItem(GROUP_STATE_KEY, JSON.stringify({
      active: _active,
      mode: _mode,
      models: _models,
      participantSessions: _participantSessions,
      parentSessionId: _parentSessionId,
      roundRobinIdx: _roundRobinIdx,
    }));
  } catch (e) {}
}

export function restoreState(sessionId) {
  try {
    const s = JSON.parse(localStorage.getItem(GROUP_STATE_KEY) || 'null');
    if (s && s.active && s.parentSessionId === sessionId) {
      _active = true;
      _mode = s.mode || 'parallel';
      _models = s.models || [];
      _participantSessions = s.participantSessions || [];
      _parentSessionId = s.parentSessionId;
      _roundRobinIdx = s.roundRobinIdx || 0;
      return true;
    }
  } catch (e) {}
  return false;
}

export function getModels() { return _models; }
export function getModelCount() { return _models.length; }

const groupModule = {
  init, isActive, setActive, getMode, setMode, showModelPicker,
  startGroup, stopGroup, sendMessage, restoreState,
  getModels, getModelCount,
};

export default groupModule;
window.groupModule = groupModule;
