import uiModule from './ui.js';
import * as Modals from './modalManager.js';
import { makeWindowDraggable } from './windowDrag.js';

const API_BASE = window.location.origin;
const OBSIDIAN_MODAL_ID = 'obsidian-modal';
const IDEA_LOOP_MODAL_ID = 'idea-loop-modal';

const COLLECTIONS = {
  requests: {
    label: 'Requests',
    singular: 'request',
    empty: 'Capture a user request to start the workspace loop.',
    placeholder: 'What should Odysseus help make real?',
  },
  ideas: {
    label: 'Ideas',
    singular: 'idea',
    empty: 'Promote promising directions into durable idea cards.',
    placeholder: 'Sketch the idea, constraints, and next decision.',
  },
  council: {
    label: 'Council',
    singular: 'council note',
    empty: 'Track Model Council review notes and recommendations.',
    placeholder: 'What did the council compare or recommend?',
  },
  executions: {
    label: 'Execution',
    singular: 'execution run',
    empty: 'Record implementation runs and handoffs.',
    placeholder: 'What changed, where, and what is still open?',
  },
  verifications: {
    label: 'Verification',
    singular: 'verification evidence',
    empty: 'Attach proof before marking work ready for review.',
    placeholder: 'Command output, reviewer verdict, browser proof, or notes.',
  },
};

const OBSIDIAN_NOTES = [
  { title: 'Vault context', body: 'Requests, ideas, council notes, execution runs, and verification evidence stay together as workspace memory.' },
  { title: 'Obsidian handoff', body: 'Use these cards as the visible bridge to vault notes until direct vault sync is configured.' },
  { title: 'Review gate', body: 'Ready for review requires execution context plus verification evidence in the same loop.' },
];

const NEXT_COUNCIL_STEP = {
  requests: {
    stage: 'sketch',
    label: 'Approve -> Sketch',
    toast: 'Sketch request sent to Council',
    intro: 'Create a concrete sketch/prototype from this accepted idea.',
    instructions: [
      'Start with a "Council deliberation" section where the agents compare approaches, challenge weak assumptions, identify tool/data needs, and converge on the chosen sketch.',
      'Before approval, run a screenshot-style UI/UX critique covering visual hierarchy, interaction clarity, responsiveness, accessibility, empty/error/loading states, and product polish.',
      'Include the product roles that materially contributed: strategy, architecture, UX, frontend, backend/services, DevOps, QA, research, and documentation.',
      'Return a prototype-level sketch the user can review.',
      'Include exactly one fenced ```html code block containing a runnable local prototype preview for Idea Loop only. For web or dashboard projects this should be a real interactive screen; for mobile, desktop, API, CLI, agent, game, automation, SaaS, or other full-stack projects it should be a local review harness that demonstrates the workflow, states, data model, API/command contract, and key risks.',
      'Important limitation: the local sandbox is an HTML review harness, not a native runtime for mobile apps, desktop apps, API servers, CLIs, Docker stacks, or full backend services.',
      'Do not flatten the actual deliverable into HTML. Outside the preview, include the intended project type, repository/file tree, primary source files or patch plan, services/modules, APIs or commands, storage model, local run commands, and test commands.',
      'Keep the prototype lightweight but visually credible; no external network assets.',
      'After the code block, list the primary screens, data flow, key interactions, backend/services shape, storage model, research findings, QA checks, documentation needs, and open questions.',
      'Make clear what knowledge should be stored in Obsidian/workspace before Brain memory is updated.',
      'Do not produce final delivery yet; make the sketch clear enough for approval.',
    ],
  },
  ideas: {
    stage: 'final',
    label: 'Approve -> Final',
    toast: 'Final product request sent to Council',
    intro: 'Create the final product from this accepted sketch.',
    instructions: [
      'Start with a "Council deliberation" section where the agents review the sketch, debate build risks, choose the final architecture, and name expected local execution evidence.',
      'Include a UI/UX validation gate: screenshot review, usability critique, accessibility notes, polish improvements applied or deferred, and remaining design risks.',
      'Return a complete final product package the user can review as ready to run or ship for the intended target: website, mobile app, API, desktop software, AI agent, SaaS platform, CLI tool, game, automation system, extension, service, or multi-component system.',
      'Create the real runnable package first. If the package can be started locally, include exact localhost preview/run evidence so Odysseus can launch it from the Council build directory after QA.',
      'If the real target cannot be previewed directly in a browser, include exactly one fenced ```html code block containing a runnable local review harness for Idea Loop only. For web apps this may be the runnable browser product; for non-web/full-stack projects it must demonstrate the workflow, states, API/data/command contracts, persistence assumptions, local run commands, tests, and documentation without pretending the whole deliverable is HTML.',
      'Important limitation: the local HTML sandbox is a review harness, not a native runtime for mobile apps, desktop apps, API servers, CLIs, Docker stacks, or full backend services. The real non-web deliverable must be created and documented outside the preview, and complete local packages can be reviewed through a constrained localhost preview runner.',
      'Outside the preview, create and document the real implementation package: repository/file tree, key source files written, API schemas or CLI commands, service topology, storage/migration notes, environment variables, local run commands, test commands, Docker/deployment path, and operational docs.',
      'Use available build tools in the final synthesis pass to write the real app files into the provided Council build directory, then run at least one local validation command. If an external platform build is impossible locally, still create the source project and mark only that external build step as blocked.',
      'If the request is a fuel price application, the app must run locally in a browser without external dependencies and include working controls for fuel type, location, currency, efficiency, trip distance, sorting/filtering, and total trip cost.',
      'Use realistic sample data for the project domain and include visible documentation/help inside the page.',
      'After the code block, include functional behavior, implementation notes, testing evidence, Docker/log validation, deployment notes, user/developer/operational documentation, risks, acceptance criteria, and local execution commands.',
      'State the Obsidian/workspace knowledge entries that should be retained before Brain memory sync.',
    ],
  },
  council: {
    stage: 'final',
    label: 'QA Review',
    toast: 'Review refinement sent to Council',
    intro: 'Refine this final product review item.',
    instructions: [
      'Start with a "Council deliberation" section that compares the current review item against the requested acceptance criteria.',
      'Re-run the UI/UX validation gate and identify any visual, interaction, accessibility, or responsiveness gaps before marking the review item ready.',
      'Tighten the final product, documentation, missing tests, Docker/browser evidence, Obsidian/workspace knowledge, Brain memory notes, and acceptance criteria.',
      'Call out anything that blocks implementation or user approval.',
    ],
  },
};

const LOOP_STAGE_GATES = {
  idea: ['Council discussion', 'Research findings', 'Concepts and architecture', 'User approval gate'],
  sketch: ['Executable prototype', 'Screenshot critique', 'QA plan', 'User approval gate'],
  review: ['Final build', 'QA evidence', 'Documentation', 'Deployment and knowledge storage'],
};

let _state = null;
let _activeKind = 'requests';
let _loading = false;
let _saving = false;
let _bound = false;

function _obsidianIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 7v8l7 6 7-6V7z"/><path d="M12 3v18"/><path d="M5 7l7 5 7-5"/></svg>';
}

function _ideaLoopIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M18 3v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M6 21v-5h5"/></svg>';
}

function _escape(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[ch]));
}

function _normalizeState(data) {
  const out = {};
  for (const key of Object.keys(COLLECTIONS)) out[key] = Array.isArray(data?.[key]) ? data[key] : [];
  return out;
}

async function _request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || body.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function _load() {
  _loading = true;
  _renderOpenSurfaces();
  try {
    _state = _normalizeState(await _request('/api/workspace'));
  } catch (err) {
    uiModule.showToast?.(`Workspace load failed: ${err.message}`);
  } finally {
    _loading = false;
    _renderOpenSurfaces();
  }
}

function _modal(id) {
  return document.getElementById(id);
}

function _renderOpenSurfaces() {
  if (_modal(OBSIDIAN_MODAL_ID)) _renderObsidian();
  if (_modal(IDEA_LOOP_MODAL_ID)) _renderIdeaLoop();
}

function _ensureSurface({ id, title, icon, closeFn }) {
  let modal = _modal(id);
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = id;
  modal.className = 'modal hidden workspace-modal';
  modal.innerHTML = `
    <div class="modal-content workspace-modal-content doclib-modal-content">
      <div class="modal-header workspace-header">
        <h4>${icon}<span class="workspace-title">${title}</span></h4>
        <button type="button" class="close-btn" title="Close">&times;</button>
      </div>
      <div class="modal-body workspace-body"></div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('.close-btn')?.addEventListener('click', closeFn);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeFn();
  });

  makeWindowDraggable(modal, {
    content: modal.querySelector('.modal-content'),
    header: modal.querySelector('.modal-header'),
    minWidth: 520,
    minHeight: 420,
  });

  return modal;
}

function _positionSurface(modal, offsetX, offsetY) {
  const content = modal.querySelector('.modal-content');
  if (!content) return;
  content.dataset.positioned = '1';
  const rect = content.getBoundingClientRect();
  const width = rect.width || Math.min(1180, window.innerWidth - 32);
  const height = rect.height || Math.min(window.innerHeight - 32, 820);
  const left = Math.min(Math.max(16, (window.innerWidth - width) / 2 + offsetX), Math.max(16, window.innerWidth - width - 16));
  const top = Math.min(Math.max(16, (window.innerHeight - height) / 2 + offsetY), Math.max(16, window.innerHeight - height - 16));
  content.style.left = `${left}px`;
  content.style.top = `${top}px`;
  content.style.right = 'auto';
  content.style.bottom = 'auto';
  content.style.transform = 'none';
}

function _clampSurface(modal) {
  const content = modal?.querySelector?.('.modal-content');
  if (!content || window.innerWidth <= 768) return;
  const rect = content.getBoundingClientRect();
  const width = rect.width || Math.min(1180, window.innerWidth - 32);
  const height = rect.height || Math.min(window.innerHeight - 32, 820);
  const left = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - width - 16));
  const top = Math.min(Math.max(16, rect.top), Math.max(16, window.innerHeight - height - 16));
  content.style.left = `${left}px`;
  content.style.top = `${top}px`;
  content.style.right = 'auto';
  content.style.bottom = 'auto';
  content.style.transform = 'none';
}

function _registerObsidian() {
  if (Modals.isRegistered(OBSIDIAN_MODAL_ID)) return;
  Modals.register(OBSIDIAN_MODAL_ID, {
    railBtnId: 'rail-notes',
    sidebarBtnId: 'tool-notes-btn',
    label: 'Obsidian',
    icon: '<path d="M12 3 5 7v8l7 6 7-6V7z"/><path d="M12 3v18"/><path d="M5 7l7 5 7-5"/>',
    closeFn: () => _teardown(OBSIDIAN_MODAL_ID),
    restoreFn: () => _renderObsidian(),
  });
}

function _registerIdeaLoop() {
  if (Modals.isRegistered(IDEA_LOOP_MODAL_ID)) return;
  Modals.register(IDEA_LOOP_MODAL_ID, {
    railBtnId: 'rail-idea-loop',
    sidebarBtnId: 'tool-idea-loop-btn',
    label: 'Idea Loop',
    icon: '<path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M18 3v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M6 21v-5h5"/>',
    closeFn: () => _teardown(IDEA_LOOP_MODAL_ID),
    restoreFn: () => _renderIdeaLoop(),
  });
}

function _teardown(id) {
  document.getElementById(id)?.remove();
}

function _collectionCount(kind) {
  return (_state?.[kind] || []).length;
}

function _allWorkspaceItems() {
  if (!_state) return [];
  return Object.entries(COLLECTIONS).flatMap(([kind, meta]) => (_state[kind] || []).map((item) => ({
    ...item,
    kind,
    label: meta.label,
    singular: meta.singular,
  })));
}

function _graphData() {
  const items = _allWorkspaceItems();
  const itemIds = new Set(items.map((item) => item.id));
  const nodes = items.map((item, index) => ({
    id: item.id,
    kind: item.kind,
    label: item.title || 'Untitled',
    group: item.label,
    index,
    weight: 1 + (item.tags || []).length + (item.evidence ? 1 : 0),
  }));
  const edges = [];
  for (const item of items) {
    const sourceId = item.links?.source_id;
    if (sourceId && itemIds.has(sourceId)) {
      edges.push({ from: sourceId, to: item.id, type: 'promoted' });
    }
    if (item.links?.session_id) {
      const sessionId = `session:${item.links.session_id}`;
      if (!nodes.some((node) => node.id === sessionId)) {
        nodes.push({ id: sessionId, kind: 'session', label: 'Council session', group: 'Sessions', index: nodes.length, weight: 2 });
      }
      edges.push({ from: sessionId, to: item.id, type: 'session' });
    }
  }
  return { nodes, edges };
}

function _renderObsidianGraph() {
  const { nodes, edges } = _graphData();
  if (!nodes.length) return '<div class="workspace-empty-inline">No graph nodes yet. Run the Council loop to build the vault graph.</div>';
  const width = 760;
  const height = 390;
  const lanes = {
    requests: { x: 110, color: '#7dd3fc' },
    ideas: { x: 280, color: '#a7f3d0' },
    council: { x: 450, color: '#fcd34d' },
    executions: { x: 600, color: '#f0abfc' },
    verifications: { x: 680, color: '#fca5a5' },
    session: { x: 45, color: '#c4b5fd' },
  };
  const counts = {};
  const positioned = nodes.map((node) => {
    counts[node.kind] = (counts[node.kind] || 0) + 1;
    const lane = lanes[node.kind] || lanes.requests;
    const offset = counts[node.kind] - 1;
    const y = 62 + (offset % 8) * 38 + Math.floor(offset / 8) * 12;
    return { ...node, x: lane.x, y: Math.min(height - 38, y), color: lane.color };
  });
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const lines = edges.map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return '';
    return `<path class="obsidian-graph-edge" data-from="${_escape(edge.from)}" data-to="${_escape(edge.to)}" data-type="${_escape(edge.type)}" d="M${from.x},${from.y} C${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y} ${to.x},${to.y}" />`;
  }).join('');
  const circles = positioned.map((node) => {
    const radius = Math.min(15, 7 + node.weight);
    return `<g class="obsidian-graph-node" data-id="${_escape(node.id)}" data-kind="${_escape(node.kind)}" data-title="${_escape(node.label)}" transform="translate(${node.x} ${node.y})">
      <circle r="${radius}" fill="${node.color}" />
      <text x="${radius + 6}" y="4">${_escape(node.label.slice(0, 28))}</text>
    </g>`;
  }).join('');
  const legend = Object.entries(COLLECTIONS).map(([kind, meta]) => `<span><i style="background:${lanes[kind]?.color || '#ddd'}"></i>${meta.label}</span>`).join('');
  return `
    <div class="obsidian-graph-toolbar">
      <input id="obsidian-graph-search" placeholder="Search graph nodes, tags, and decisions" />
      <select id="obsidian-graph-scope" title="Graph scope" aria-label="Graph scope">
        <option value="global">Global graph</option>
        <option value="local">Local graph</option>
      </select>
      <label>Depth <input id="obsidian-graph-depth" type="range" min="1" max="3" value="2" /></label>
      <label><input id="obsidian-graph-arrows" type="checkbox" checked /> Arrows</label>
    </div>
    <div class="obsidian-graph-shell">
      <svg class="obsidian-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Workspace knowledge graph">
        <defs><marker id="obsidian-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" /></marker></defs>
        ${lines}
        ${circles}
      </svg>
      <aside class="obsidian-graph-inspector">
        <h3>Local context</h3>
        <div id="obsidian-graph-selected">Select a node to inspect backlinks and outgoing links.</div>
      </aside>
    </div>
    <div class="obsidian-graph-legend">${legend}</div>`;
}

function _body(id) {
  return document.querySelector(`#${id} .workspace-body`);
}

function _renderLoading(body) {
  if (_loading) {
    body.innerHTML = '<div class="admin-card workspace-empty">Loading workspace...</div>';
    return true;
  }
  if (!_state) {
    body.innerHTML = '<div class="admin-card workspace-empty">Workspace is not loaded yet.</div>';
    return true;
  }
  return false;
}

function _renderObsidian() {
  const body = _body(OBSIDIAN_MODAL_ID);
  if (!body) return;
  if (_renderLoading(body)) return;

  const summary = Object.entries(COLLECTIONS).map(([kind, meta]) => `
    <article class="workspace-stat-card doclib-card" data-kind="${kind}">
      <div class="workspace-stat-header"><span>${meta.label}</span><strong>${_collectionCount(kind)}</strong></div>
      <p>${meta.empty}</p>
    </article>`).join('');
  const notes = OBSIDIAN_NOTES.map((note) => `
    <article class="doclib-card workspace-note-card">
      <div class="doclib-card-header"><strong>${_escape(note.title)}</strong></div>
      <p>${_escape(note.body)}</p>
    </article>`).join('');
  const recent = Object.entries(COLLECTIONS)
    .flatMap(([kind, meta]) => (_state[kind] || []).slice(0, 2).map((item) => ({ ...item, kind, label: meta.label })))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, 8)
    .map((item) => _renderArtifactRow(item))
    .join('') || '<div class="workspace-empty-inline">No workspace artifacts yet.</div>';

  body.innerHTML = `
    <section class="admin-card workspace-panel">
      <div class="doclib-desc">Obsidian replaces Notes as the durable workspace brain: requests, decisions, and proof in one Odysseus-native surface.</div>
      <div class="doclib-grid workspace-stat-grid">${summary}</div>
    </section>
    <section class="admin-card workspace-panel workspace-graph-panel">
      <h2>Knowledge graph</h2>
      ${_renderObsidianGraph()}
    </section>
    <section class="admin-card workspace-panel">
      <h2>Vault handoff</h2>
      <div class="doclib-grid workspace-note-grid">${notes}</div>
    </section>
    <section class="admin-card workspace-panel workspace-panel-fill">
      <h2>Recent context</h2>
      <div class="doclib-grid workspace-list">${recent}</div>
    </section>`;
  _wireObsidian();
}

function _renderIdeaLoop() {
  const body = _body(IDEA_LOOP_MODAL_ID);
  if (!body) return;
  if (_renderLoading(body)) return;

  const ideaItems = (_state.requests || []).slice(0, 8);
  const sketchItems = (_state.ideas || []).slice(0, 8);
  const reviewItems = [...(_state.council || []), ...(_state.verifications || [])].slice(0, 8);

  body.innerHTML = `
    <div class="idea-loop-board" aria-label="Idea Loop board">
      ${_renderLoopColumn({
        key: 'idea',
        title: 'Idea',
        eyebrow: 'seed',
        body: 'Catch the raw request and the first usable direction.',
        gates: LOOP_STAGE_GATES.idea,
        kind: 'requests',
        items: ideaItems,
        empty: 'No captured ideas yet.',
        placeholder: 'New idea or user request',
      })}
      ${_renderLoopColumn({
        key: 'sketch',
        title: 'Sketch',
        eyebrow: 'shape',
        body: 'Turn the idea into a concrete plan, screen, or execution path.',
        gates: LOOP_STAGE_GATES.sketch,
        kind: 'ideas',
        items: sketchItems,
        empty: 'No sketches yet.',
        placeholder: 'New sketch or approach',
      })}
      ${_renderLoopColumn({
        key: 'review',
        title: 'Review Build',
        eyebrow: 'prove',
        body: 'Capture council notes, verification evidence, and ready-state decisions.',
        gates: LOOP_STAGE_GATES.review,
        kind: 'council',
        items: reviewItems,
        empty: 'Nothing in review yet.',
        placeholder: 'New review note',
      })}
    </div>`;
  _wireIdeaLoop();
}

function _renderLoopColumn({ key, title, eyebrow, body, gates = [], kind, items, empty, placeholder }) {
  const cards = items.map((item) => _renderLoopCard(item, kind)).join('') || `<div class="workspace-empty-inline">${empty}</div>`;
  const gateList = gates.length
    ? `<div class="idea-loop-gates" aria-label="${_escape(title)} stage gates">${gates.map((gate) => `<span>${_escape(gate)}</span>`).join('')}</div>`
    : '';
  return `
    <section class="idea-loop-column idea-loop-${key}" data-kind="${kind}">
      <div class="idea-loop-column-header">
        <div>
          <span>${eyebrow}</span>
          <h2>${title}</h2>
        </div>
        <button type="button" class="idea-loop-add-btn" data-action="open-capture" title="New ${title}" aria-label="New ${title}">+</button>
        <p>${body}</p>
        ${gateList}
      </div>
      <div class="idea-loop-capture-popover" hidden>
        <form class="idea-loop-capture" data-kind="${kind}">
          <input maxlength="160" name="title" placeholder="${placeholder}" />
          <textarea rows="4" name="body" placeholder="Details, constraints, next move"></textarea>
          <div class="idea-loop-popover-actions">
            <button type="button" class="doclib-card-action-btn" data-action="close-capture">Cancel</button>
            <button type="submit" class="memory-toolbar-btn">Capture</button>
          </div>
        </form>
      </div>
      <div class="idea-loop-card-stack">${cards}</div>
    </section>`;
}

function _stripThinking(value) {
  return String(value || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function _cardSummary(value) {
  const clean = _stripThinking(value)
    .replace(/```(?:html|HTML)[ \t]*\r?\n[\s\S]*?```/g, '[Runnable artifact attached]')
    .replace(/\n{3,}/g, '\n\n');
  if (!clean) return 'No details yet.';
  return clean.length > 520 ? `${clean.slice(0, 520).trim()}...` : clean;
}

function _extractHtmlArtifact(value, kind) {
  const text = _stripThinking(value || '');
  const matches = [...text.matchAll(/```(?:html|HTML)[ \t]*\r?\n([\s\S]*?)```/g)];
  const reversed = matches.reverse();
  if (kind === 'council') {
    const verified = reversed.find((match) => /data-odysseus-(?:project|fuel)-review="1"/.test(match[1] || ''));
    if (verified) return verified[1].trim();
  } else if (kind === 'ideas') {
    const verified = reversed.find((match) => /data-odysseus-(?:project|fuel)-sketch="1"/.test(match[1] || ''));
    if (verified) return verified[1].trim();
  }
  const fenced = reversed.find((match) => match[1]?.trim());
  if (fenced) return fenced[1].trim();
  const docStart = text.search(/<!doctype html|<html[\s>]/i);
  if (docStart >= 0) return text.slice(docStart).trim();
  return '';
}

function _normalizeHtmlArtifact(html) {
  if (!html || !/data-odysseus-(?:project|fuel)-(?:review|sketch)="1"/.test(html)) return html;
  return html.replace(
    'function render(){localStorage.fuelPriceState=JSON.stringify(Object.fromEntries(Object.entries(els).map(([k,e])=>[k,e.value])));',
    'function render(){try{localStorage.fuelPriceState=JSON.stringify(Object.fromEntries(Object.entries(els).map(([k,e])=>[k,e.value])))}catch(e){}'
  );
}

function _renderHtmlArtifact(html, kind, item) {
  if (!html) return '';
  const label = kind === 'council' ? 'Final product preview' : 'Prototype preview';
  const safeHtml = _normalizeHtmlArtifact(html);
  const itemId = item?.id ? encodeURIComponent(item.id) : '';
  const routeKind = encodeURIComponent(kind);
  const stamp = encodeURIComponent(item?.updated_at || item?.created_at || '');
  const src = itemId ? `${API_BASE}/api/workspace/artifact/${routeKind}/${itemId}?v=${stamp}` : '';
  return `
    <section class="idea-loop-artifact-preview">
      <div class="idea-loop-artifact-head">
        <strong>${label}</strong>
        <span>local sandbox</span>
      </div>
      <iframe title="${label}" sandbox="allow-scripts allow-forms" ${src ? `src="${_escape(src)}"` : `srcdoc="${_escape(safeHtml)}"`}></iframe>
      <button type="button" class="idea-loop-artifact-open" aria-label="Open ${label} fullscreen" title="Open fullscreen"></button>
    </section>`;
}

function _previewFromItem(item) {
  const preview = item?.links?.preview;
  return preview && typeof preview === 'object' ? preview : null;
}

function _renderLivePreview(preview) {
  if (!preview || preview.status !== 'running' || !preview.url) return '';
  return `
    <section class="idea-loop-artifact-preview idea-loop-live-preview">
      <div class="idea-loop-artifact-head">
        <strong>Live localhost preview</strong>
        <span>${_escape(preview.runtime || 'local app')}</span>
      </div>
      <iframe title="Live localhost preview" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" src="${_escape(preview.url)}"></iframe>
      <button type="button" class="idea-loop-artifact-open" aria-label="Open live localhost preview fullscreen" title="Open fullscreen"></button>
    </section>`;
}

function _qaResultFromItem(item) {
  const qa = item?.links?.qa_result;
  return qa && typeof qa === 'object' ? qa : null;
}

function _renderQaBlocked(qa) {
  if (!qa) return '';
  const failures = Array.isArray(qa.failures) && qa.failures.length
    ? qa.failures.slice(0, 6).map((failure) => `<li>${_escape(failure)}</li>`).join('')
    : '<li>Artifact failed the Council quality gate.</li>';
  const warnings = Array.isArray(qa.warnings) && qa.warnings.length
    ? `<div class="idea-loop-qa-warnings">${qa.warnings.slice(0, 3).map((warning) => `<span>${_escape(warning)}</span>`).join('')}</div>`
    : '';
  return `
    <section class="idea-loop-qa-blocked" aria-label="Council artifact QA failures">
      <div class="idea-loop-qa-blocked-head">
        <strong>QA blocked</strong>
        <span>${_escape(qa.score ?? 0)}% after ${_escape(qa.attempts ?? 0)} revision${Number(qa.attempts || 0) === 1 ? '' : 's'}</span>
      </div>
      <ul>${failures}</ul>
      ${warnings}
    </section>`;
}

function _renderPackageReview(qa, item, preview) {
  const buildDir = item?.links?.build_dir || item?.links?.build_dir_container || '';
  const isPackageOnly = Boolean(qa?.checks?.packageReviewOnly);
  if (!isPackageOnly && !buildDir && !preview) return '';
  const failed = preview?.status === 'failed';
  const running = preview?.status === 'running' && preview?.url;
  const displayUrl = preview?.internal_url || preview?.url || '';
  const score = qa?.score != null ? `${qa.score}% QA` : 'package review';
  const details = [
    buildDir ? `Build: ${buildDir}` : '',
    preview?.command ? `Run: ${preview.command}` : '',
    failed && preview?.error ? `Preview failed: ${preview.error}` : '',
  ].filter(Boolean);
  const startButton = !running && buildDir
    ? `<button type="button" class="doclib-card-action-btn" data-action="start-preview">Start localhost preview</button>`
    : '';
  const stopButton = running
    ? `<button type="button" class="doclib-card-action-btn" data-action="stop-preview">Stop preview</button>`
    : '';
  return `
    <section class="idea-loop-package-review ${failed ? 'is-failed' : ''}">
      <div class="idea-loop-package-review-head">
        <strong>${running ? 'Local app running' : 'Package review'}</strong>
        <span>${_escape(score)}</span>
      </div>
      <p>${running ? `Preview URL: ${_escape(displayUrl)}` : 'This final build is reviewed as a real project package. The HTML sandbox is optional when the app can run locally.'}</p>
      ${details.length ? `<ul>${details.slice(0, 4).map((line) => `<li>${_escape(line)}</li>`).join('')}</ul>` : ''}
      ${startButton || stopButton ? `<div class="idea-loop-package-actions">${startButton}${stopButton}</div>` : ''}
    </section>`;
}

function _closeArtifactFullscreen() {
  const overlay = document.getElementById('idea-loop-artifact-fullscreen');
  if (!overlay) return;
  const onKey = overlay._onArtifactEsc;
  const onFs = overlay._onArtifactFullscreenChange;
  if (onKey) window.removeEventListener('keydown', onKey, true);
  if (onFs) document.removeEventListener('fullscreenchange', onFs);
  if (document.fullscreenElement === overlay) {
    document.exitFullscreen?.().catch(() => {});
  }
  overlay.remove();
}

function _openArtifactFullscreen(preview) {
  const sourceFrame = preview?.querySelector?.('iframe');
  if (!sourceFrame) return;
  _closeArtifactFullscreen();

  const title = sourceFrame.getAttribute('title') || 'Sandbox preview';
  const overlay = document.createElement('div');
  overlay.id = 'idea-loop-artifact-fullscreen';
  overlay.className = 'idea-loop-artifact-fullscreen';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="idea-loop-artifact-fullscreen-shell">
      <div class="idea-loop-artifact-fullscreen-head">
        <strong>${_escape(title)}</strong>
        <button type="button" class="idea-loop-artifact-fullscreen-close" aria-label="Close fullscreen preview">&times;</button>
      </div>
      <iframe title="${_escape(title)}" sandbox="allow-scripts allow-forms"></iframe>
    </div>`;

  const frame = overlay.querySelector('iframe');
  const src = sourceFrame.getAttribute('src');
  const srcdoc = sourceFrame.getAttribute('srcdoc');
  if (src) frame.setAttribute('src', src);
  else if (srcdoc) frame.setAttribute('srcdoc', srcdoc);

  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    _closeArtifactFullscreen();
  };
  const onFs = () => {
    if (!document.fullscreenElement && document.getElementById('idea-loop-artifact-fullscreen') === overlay) {
      _closeArtifactFullscreen();
    }
  };
  overlay._onArtifactEsc = onKey;
  overlay._onArtifactFullscreenChange = onFs;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) _closeArtifactFullscreen();
  });
  overlay.querySelector('.idea-loop-artifact-fullscreen-close')?.addEventListener('click', _closeArtifactFullscreen);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFs);

  document.body.appendChild(overlay);
  overlay.querySelector('.idea-loop-artifact-fullscreen-close')?.focus({ preventScroll: true });
  const fullscreenRequest = overlay.requestFullscreen?.();
  if (fullscreenRequest?.catch) fullscreenRequest.catch(() => {});
}

function _renderLoopCard(item, fallbackKind) {
  const tags = (item.tags || []).slice(0, 4).map((tag) => `<span>${_escape(tag)}</span>`).join('');
  const kind = item.kind || fallbackKind;
  const nextStep = NEXT_COUNCIL_STEP[kind] || NEXT_COUNCIL_STEP.council;
  const fullBody = _stripThinking(item.body || item.evidence || 'No details yet.');
  const summary = _cardSummary(item.body || item.evidence || 'No details yet.');
  const hasMore = fullBody.length > summary.length;
  const qaResult = _qaResultFromItem(item);
  const qaBlocked = Boolean(qaResult && ((item.tags || []).includes('qa-blocked') || item.status === 'blocked'));
  const preview = _previewFromItem(item);
  const livePreview = !qaBlocked ? _renderLivePreview(preview) : '';
  const htmlArtifact = kind === 'requests' || qaBlocked || livePreview ? '' : _extractHtmlArtifact(fullBody, kind);
  return `
    <article class="doclib-card workspace-card idea-loop-card" data-id="${_escape(item.id)}" data-kind="${_escape(kind)}">
      <div class="workspace-card-head idea-loop-card-head">
        <strong>${_escape(item.title)}</strong>
        <span class="idea-loop-status-pill">${_escape(item.status || 'open')}</span>
      </div>
      <div class="idea-loop-card-body">${_escape(summary)}</div>
      ${qaBlocked ? _renderQaBlocked(qaResult) : ''}
      ${!qaBlocked ? _renderPackageReview(qaResult, item, preview) : ''}
      ${livePreview}
      ${_renderHtmlArtifact(htmlArtifact, kind, item)}
      ${hasMore ? `<details class="idea-loop-card-full"><summary>Read full council output</summary><pre>${_escape(fullBody)}</pre></details>` : ''}
      <div class="idea-loop-card-meta">
        <select data-action="status" title="Status" aria-label="Status">
          ${['open', 'ready', 'running', 'verified', 'blocked', 'archived'].map((s) => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <div class="doclib-lang-chips workspace-tags">${tags}</div>
      </div>
      <div class="workspace-card-actions idea-loop-card-actions">
        <button type="button" class="doclib-card-action-btn" data-action="send-council">${_escape(nextStep.label)}</button>
        <button type="button" class="doclib-card-action-btn" data-action="evidence">Evidence</button>
        <button type="button" class="doclib-card-action-btn" data-action="delete">Delete</button>
      </div>
    </article>`;
}

function _renderArtifactRow(item) {
  return `
    <article class="doclib-card workspace-artifact-row" data-id="${_escape(item.id)}">
      <div class="doclib-card-header">
        <span class="workspace-kind-chip">${_escape(item.label)}</span>
        <span class="doclib-card-time">${_escape((item.updated_at || item.created_at || '').slice(0, 10))}</span>
      </div>
      <strong>${_escape(item.title)}</strong>
      <p>${_escape(item.body || item.evidence || 'No details yet.')}</p>
    </article>`;
}

function _renderCard(item) {
  const tags = (item.tags || []).map((tag) => `<span>${_escape(tag)}</span>`).join('');
  const evidence = item.evidence ? `<pre class="workspace-evidence">${_escape(item.evidence)}</pre>` : '';
  return `
    <article class="doclib-card workspace-card" data-id="${_escape(item.id)}">
      <div class="doclib-card-header workspace-card-head">
        <strong>${_escape(item.title)}</strong>
        <select data-action="status" title="Status">
          ${['open', 'ready', 'running', 'verified', 'blocked', 'archived'].map((s) => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <p>${_escape(item.body || 'No details yet.')}</p>
      ${evidence}
      <div class="doclib-lang-chips workspace-tags">${tags}</div>
      <div class="doclib-card-expanded-actions workspace-card-actions">
        <button type="button" class="doclib-card-action-btn" data-action="evidence">Add evidence</button>
        <button type="button" class="doclib-card-action-btn" data-action="delete">Delete</button>
      </div>
    </article>`;
}

function _wireObsidian() {
  const modal = _modal(OBSIDIAN_MODAL_ID);
  if (!modal) return;
  const graph = _graphData();
  const itemMap = new Map(_allWorkspaceItems().map((item) => [item.id, item]));
  const nodes = [...modal.querySelectorAll('.obsidian-graph-node')];
  const edges = [...modal.querySelectorAll('.obsidian-graph-edge')];
  const inspector = modal.querySelector('#obsidian-graph-selected');

  const describeNode = (id) => {
    const item = itemMap.get(id);
    if (!inspector) return;
    if (!item) {
      inspector.innerHTML = '<strong>Council session</strong><p>Connects artifacts produced by the same group run.</p>';
      return;
    }
    const outgoing = graph.edges.filter((edge) => edge.from === id).map((edge) => itemMap.get(edge.to)?.title || edge.to);
    const incoming = graph.edges.filter((edge) => edge.to === id).map((edge) => itemMap.get(edge.from)?.title || 'Council session');
    inspector.innerHTML = `
      <strong>${_escape(item.title)}</strong>
      <span>${_escape(item.label)} - ${_escape(item.status || 'open')}</span>
      <p>${_escape((item.body || item.evidence || 'No details yet.').slice(0, 220))}</p>
      <h4>Backlinks</h4>
      ${incoming.length ? `<ul>${incoming.map((name) => `<li>${_escape(name)}</li>`).join('')}</ul>` : '<em>No incoming links yet.</em>'}
      <h4>Outgoing links</h4>
      ${outgoing.length ? `<ul>${outgoing.map((name) => `<li>${_escape(name)}</li>`).join('')}</ul>` : '<em>No outgoing links yet.</em>'}`;
  };

  const selectNode = (id) => {
    nodes.forEach((node) => node.classList.toggle('is-selected', node.dataset.id === id));
    edges.forEach((edge) => {
      const connected = edge.dataset.from === id || edge.dataset.to === id;
      edge.classList.toggle('is-selected', connected);
      edge.classList.toggle('is-muted', !connected);
    });
    describeNode(id);
  };

  nodes.forEach((node) => {
    node.addEventListener('click', () => selectNode(node.dataset.id));
  });

  const search = modal.querySelector('#obsidian-graph-search');
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    nodes.forEach((node) => {
      const item = itemMap.get(node.dataset.id);
      const haystack = `${node.dataset.title || ''} ${node.dataset.kind || ''} ${(item?.tags || []).join(' ')} ${item?.body || ''}`.toLowerCase();
      node.classList.toggle('is-muted', Boolean(query) && !haystack.includes(query));
    });
  });

  modal.querySelector('#obsidian-graph-arrows')?.addEventListener('change', (event) => {
    modal.querySelector('.obsidian-graph-svg')?.classList.toggle('hide-arrows', !event.target.checked);
  });
}

function _wireIdeaLoop() {
  const modal = _modal(IDEA_LOOP_MODAL_ID);
  if (!modal) return;

  modal.querySelectorAll('[data-action="open-capture"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const column = btn.closest('.idea-loop-column');
      const popover = column?.querySelector('.idea-loop-capture-popover');
      const isOpen = popover && !popover.hidden;
      modal.querySelectorAll('.idea-loop-capture-popover').forEach((el) => { el.hidden = true; });
      if (popover) {
        popover.hidden = Boolean(isOpen);
        if (!popover.hidden) popover.querySelector('[name="title"]')?.focus();
      }
    });
  });

  modal.querySelectorAll('[data-action="close-capture"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const popover = btn.closest('.idea-loop-capture-popover');
      if (popover) popover.hidden = true;
    });
  });

  modal.querySelectorAll('.idea-loop-capture').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await _createItem(form.dataset.kind, form);
    });
  });

  modal.querySelectorAll('.idea-loop-artifact-preview').forEach((preview) => {
    preview.querySelector('.idea-loop-artifact-open')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _openArtifactFullscreen(preview);
    });
  });

  modal.querySelectorAll('.idea-loop-card').forEach((card) => {
    const id = card.dataset.id;
    const kind = card.dataset.kind || 'requests';
    card.querySelector('[data-action="status"]')?.addEventListener('change', async (e) => {
      await _updateItem(kind, id, { status: e.target.value });
    });
    card.querySelector('[data-action="send-council"]')?.addEventListener('click', async () => {
      await _sendCardToCouncil(kind, id);
    });
    card.querySelector('[data-action="start-preview"]')?.addEventListener('click', async () => {
      await _startLocalPreview(kind, id);
    });
    card.querySelector('[data-action="stop-preview"]')?.addEventListener('click', async () => {
      await _stopLocalPreview(kind, id);
    });
    card.querySelector('[data-action="evidence"]')?.addEventListener('click', async () => {
      const text = window.prompt('Verification or execution evidence');
      if (text == null) return;
      await _updateItem(kind, id, { evidence: text, status: kind === 'verifications' ? 'verified' : undefined });
    });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      if (!window.confirm('Delete this workspace item?')) return;
      await _deleteItem(kind, id);
    });
  });
}

async function _sendCardToCouncil(kind, id) {
  const source = (_state[kind] || []).find((item) => item.id === id);
  if (!source) return;
  const step = NEXT_COUNCIL_STEP[kind] || NEXT_COUNCIL_STEP.council;
  const group = window.groupModule;
  if (!group?.isActive?.() || !group?.getModelCount?.()) {
    uiModule.showToast?.('Start Council mode with at least two agents first');
    return;
  }

  const prompt = [
    `[ODYSSEUS_WORKSPACE_STAGE:${step.stage}]`,
    `[ODYSSEUS_SOURCE_KIND:${kind}]`,
    `[ODYSSEUS_SOURCE_ID:${id}]`,
    `Council request: ${step.intro}`,
    '',
    `Source ${COLLECTIONS[kind]?.singular || kind}: ${source.title}`,
    '',
    _compactCouncilHandoffText(source.body || source.evidence || 'No source details yet.', step.stage),
    '',
    'Instructions:',
    ...step.instructions.map((line) => `- ${line}`),
  ].join('\n');

  try {
    await _updateItem(kind, id, { status: 'running' });
    window.chatModule?.addMessage?.('user', `${step.intro}\n\n${source.title}`);
    await group.sendMessage(prompt);
    uiModule.showToast?.(step.toast);
    _renderOpenSurfaces();
  } catch (err) {
    uiModule.showToast?.(`Council handoff failed: ${err.message}`);
  }
}

async function _startLocalPreview(kind, id) {
  try {
    await _request(`/api/workspace/preview/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/start`, { method: 'POST' });
    uiModule.showToast?.('Local preview started');
    await _load();
  } catch (err) {
    uiModule.showToast?.(`Local preview failed: ${err.message}`);
    await _load();
  }
}

async function _stopLocalPreview(kind, id) {
  try {
    await _request(`/api/workspace/preview/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/stop`, { method: 'POST' });
    uiModule.showToast?.('Local preview stopped');
    await _load();
  } catch (err) {
    uiModule.showToast?.(`Local preview stop failed: ${err.message}`);
  }
}

function _compactCouncilHandoffText(text, stage) {
  const value = String(text || '').trim();
  if (!value) return 'No source details yet.';
  const limit = stage === 'final' ? 18000 : 14000;
  if (value.length <= limit) return value;
  const headSize = Math.floor(limit * 0.62);
  const tailSize = Math.floor(limit * 0.28);
  return [
    value.slice(0, headSize),
    '',
    `[...source compacted for Council handoff; original length ${value.length} chars...]`,
    '',
    value.slice(-tailSize),
  ].join('\n');
}

async function _createItem(kind, form) {
  const title = form?.querySelector('[name="title"]')?.value || '';
  const body = form?.querySelector('[name="body"]')?.value || '';
  if (!title.trim() && !body.trim()) return;

  _saving = true;
  try {
    const item = await _request(`/api/workspace/${kind}`, {
      method: 'POST',
      body: JSON.stringify({ title, body, tags: ['idea-loop'], source: 'idea-loop' }),
    });
    _state[kind] = [item, ...(_state[kind] || [])];
    form?.reset();
    const popover = form?.closest('.idea-loop-capture-popover');
    if (popover) popover.hidden = true;
    uiModule.showToast?.('Idea Loop card captured');
  } catch (err) {
    uiModule.showToast?.(`Idea Loop save failed: ${err.message}`);
  } finally {
    _saving = false;
    _renderOpenSurfaces();
  }
}

async function _updateItem(kind, id, patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  try {
    const item = await _request(`/api/workspace/${kind}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(clean),
    });
    _state[kind] = (_state[kind] || []).map((existing) => existing.id === id ? item : existing);
    _renderOpenSurfaces();
  } catch (err) {
    uiModule.showToast?.(`Workspace update failed: ${err.message}`);
  }
}

async function _deleteItem(kind, id) {
  try {
    await _request(`/api/workspace/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    _state[kind] = (_state[kind] || []).filter((item) => item.id !== id);
    _renderOpenSurfaces();
  } catch (err) {
    uiModule.showToast?.(`Workspace delete failed: ${err.message}`);
  }
}

export function openObsidian() {
  if (window.innerWidth <= 768) closeIdeaLoop();
  if (Modals.toggle(OBSIDIAN_MODAL_ID)) return;
  const modal = _ensureSurface({
    id: OBSIDIAN_MODAL_ID,
    title: 'Obsidian',
    icon: _obsidianIcon(),
    closeFn: closeObsidian,
  });
  modal.classList.remove('hidden', 'modal-minimized');
  modal.style.display = '';
  _positionSurface(modal, -120, -24);
  _clampSurface(modal);
  _registerObsidian();
  _renderObsidian();
  if (!_state) _load();
}

export function openIdeaLoop() {
  if (Modals.toggle(IDEA_LOOP_MODAL_ID)) return;
  _showIdeaLoopSurface();
  if (!_state) _load();
}

function _showIdeaLoopSurface() {
  if (window.innerWidth <= 768) closeObsidian();
  const modal = _ensureSurface({
    id: IDEA_LOOP_MODAL_ID,
    title: 'Idea Loop',
    icon: _ideaLoopIcon(),
    closeFn: closeIdeaLoop,
  });
  modal.classList.remove('hidden', 'modal-minimized');
  modal.style.display = '';
  _positionSurface(modal, 0, 0);
  _clampSurface(modal);
  _registerIdeaLoop();
  _renderIdeaLoop();
  return modal;
}

export async function refreshAndOpenIdeaLoop() {
  const modal = _modal(IDEA_LOOP_MODAL_ID);
  if (!modal || modal.classList.contains('hidden') || modal.classList.contains('modal-minimized')) {
    _showIdeaLoopSurface();
  }
  await _load();
}

export function open(surface = 'idea-loop') {
  if (surface === 'obsidian') openObsidian();
  else openIdeaLoop();
}

export function closeObsidian() {
  if (Modals.isRegistered(OBSIDIAN_MODAL_ID)) {
    Modals.close(OBSIDIAN_MODAL_ID);
  } else {
    _teardown(OBSIDIAN_MODAL_ID);
  }
}

export function closeIdeaLoop() {
  if (Modals.isRegistered(IDEA_LOOP_MODAL_ID)) {
    Modals.close(IDEA_LOOP_MODAL_ID);
  } else {
    _teardown(IDEA_LOOP_MODAL_ID);
  }
}

export function close() {
  closeObsidian();
  closeIdeaLoop();
}

export function init() {
  if (_bound) return;
  _bound = true;
  window.workspaceModule = workspaceModule;
}

const workspaceModule = { init, open, openObsidian, openIdeaLoop, refreshAndOpenIdeaLoop, close, closeObsidian, closeIdeaLoop };
export default workspaceModule;
