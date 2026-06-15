import uiModule from './ui.js';
import * as Modals from './modalManager.js';
import { makeWindowDraggable } from './windowDrag.js';

const API_BASE = window.location.origin;
const OBSIDIAN_MODAL_ID = 'obsidian-modal';
const IDEA_LOOP_MODAL_ID = 'idea-loop-modal';
const OBSIDIAN_GRAPH_3D_SCRIPT = '/static/lib/3d-force-graph.min.js';
const ORACLE_WORKSPACE_PREVIEW_MESSAGES = {
  started: 'A local preview is starting.',
  ready: 'The local preview is ready.',
  failed: 'The local preview failed.',
  stopped: 'The local preview stopped.',
};

function _requestOracleWorkspacePreviewNarration(eventType, messageKey, options = {}) {
  const runtime = window.oracleVoiceRuntime;
  const status = runtime && runtime.status ? runtime.status : null;
  if (!runtime || !status || !status.active || status.state === 'cancelled' || status.state === 'interrupted') return false;
  const message = ORACLE_WORKSPACE_PREVIEW_MESSAGES[messageKey] || ORACLE_WORKSPACE_PREVIEW_MESSAGES.ready;
  window.dispatchEvent(new CustomEvent('oraclevoice:narration-request', {
    detail: {
      source: 'workspace_preview',
      eventType: eventType,
      message: message,
      workspacePreviewPhase: messageKey,
      speak: options.speak === true,
      requireActive: true,
    },
  }));
  return true;
}

function _requestOracleWorkspacePreviewStarted() {
  return _requestOracleWorkspacePreviewNarration('workspace.preview.started', 'started', { speak: true });
}

function _requestOracleWorkspacePreviewReady() {
  return _requestOracleWorkspacePreviewNarration('workspace.preview.ready', 'ready', { speak: true });
}

function _requestOracleWorkspacePreviewFailed() {
  return _requestOracleWorkspacePreviewNarration('workspace.preview.failed', 'failed', { speak: true });
}

function _requestOracleWorkspacePreviewStopped() {
  return _requestOracleWorkspacePreviewNarration('workspace.preview.stopped', 'stopped', { speak: true });
}

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
      'Make clear what knowledge should be stored in Obsidian/workspace as the canonical record.',
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
      'State the Obsidian/workspace knowledge entries that should be retained as durable context.',
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
      'Tighten the final product, documentation, missing tests, Docker/browser evidence, Obsidian/workspace knowledge notes, and acceptance criteria.',
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
let _obsidianState = null;
let _activeKind = 'requests';
let _loading = false;
let _obsidianLoading = false;
let _saving = false;
let _bound = false;
let _selectedNotePath = '';
let _noteDraft = null;
let _obsidianNoteDetails = {};
let _obsidianTab = 'vault';
let _obsidianQuery = '';
let _obsidianSearchResults = [];
let _obsidianSearching = false;
let _obsidianSearchError = '';
let _obsidianSearchTimer = null;
let _obsidianDirty = false;
let _obsidianEditorDraft = null;
let _obsidianSkills = [];
let _obsidianSkillsLoading = false;
let _obsidianSkillsError = '';
let _obsidianSkillQuery = '';
let _obsidianSkillImporting = false;
let _obsidianSkillImportError = '';
let _obsidianSkillImportResult = null;
let _obsidianPrefs = {};
let _obsidianPrefsLoaded = false;
let _obsidianPrefsLoading = false;
let _obsidianPrefsError = '';
let _selectedSkillName = '';
let _selectedGraphNodeId = '';
let _obsidianGraphQuery = '';
let _obsidianGraphScope = 'global';
let _obsidianGraphDepth = 2;
let _obsidianGraphArrows = true;
let _obsidianGraphError = '';
let _obsidianGraphScriptPromise = null;
let _obsidianGraphInstance = null;
let _obsidianGraphResizeObserver = null;
let _obsidianGraphMountToken = 0;
let _surfaceResizeTimer = null;

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

function _normalizeObsidianState(data) {
  return {
    root: data?.root || '',
    notes: Array.isArray(data?.notes) ? data.notes : [],
    graph: {
      nodes: Array.isArray(data?.graph?.nodes) ? data.graph.nodes : [],
      edges: Array.isArray(data?.graph?.edges) ? data.graph.edges : [],
    },
  };
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

async function _loadObsidian() {
  _obsidianLoading = true;
  _renderOpenSurfaces();
  try {
    _obsidianState = _normalizeObsidianState(await _request('/api/obsidian'));
    const paths = new Set((_obsidianState.notes || []).map((note) => note.path));
    _obsidianNoteDetails = Object.fromEntries(Object.entries(_obsidianNoteDetails).filter(([path]) => paths.has(path)));
    _ensureSelectedNote();
    if (_selectedNotePath && !_noteDraft) {
      await _loadSelectedObsidianNote(_selectedNotePath, { render: false });
    }
  } catch (err) {
    uiModule.showToast?.(`Obsidian vault load failed: ${err.message}`);
  } finally {
    _obsidianLoading = false;
    _renderOpenSurfaces();
  }
}

async function _loadObsidianSkills({ render = true } = {}) {
  if (_obsidianSkillsLoading) return;
  _obsidianSkillsLoading = true;
  _obsidianSkillsError = '';
  try {
    const data = await _request('/api/skills');
    _obsidianSkills = Array.isArray(data?.skills) ? data.skills : [];
  } catch (err) {
    _obsidianSkillsError = err.message || 'Could not load skills';
  } finally {
    _obsidianSkillsLoading = false;
  }
  if (render && _modal(OBSIDIAN_MODAL_ID)) _renderObsidian();
}

async function _loadObsidianPrefs({ render = true } = {}) {
  if (_obsidianPrefsLoading) return;
  _obsidianPrefsLoading = true;
  _obsidianPrefsError = '';
  try {
    const data = await _request('/api/prefs');
    _obsidianPrefs = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    _obsidianPrefsLoaded = true;
  } catch (err) {
    _obsidianPrefsError = err.message || 'Could not load preferences';
  } finally {
    _obsidianPrefsLoading = false;
  }
  if (render && _modal(OBSIDIAN_MODAL_ID)) _renderObsidian();
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
  const maxWidth = Math.max(320, window.innerWidth - 32);
  const maxHeight = Math.max(420, window.innerHeight - 32);
  content.style.maxWidth = `${maxWidth}px`;
  content.style.maxHeight = `${maxHeight}px`;
  if (content.offsetWidth > maxWidth) content.style.width = `${maxWidth}px`;
  if (content.offsetHeight > maxHeight) content.style.height = `${maxHeight}px`;
  const rect = content.getBoundingClientRect();
  const width = Math.min(rect.width || Math.min(1180, maxWidth), maxWidth);
  const height = Math.min(rect.height || Math.min(maxHeight, 820), maxHeight);
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

function _noteUrl(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function _noteByPath(path) {
  return (_obsidianState?.notes || []).find((note) => note.path === path) || null;
}

function _ensureSelectedNote() {
  if (_noteDraft) return;
  const notes = _obsidianState?.notes || [];
  if (_selectedNotePath && notes.some((note) => note.path === _selectedNotePath)) return;
  _selectedNotePath = notes[0]?.path || '';
}

function _newNoteTemplate() {
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    path: `Inbox/untitled-${stamp}.md`,
    title: `Untitled ${stamp}`,
    content: `---\ntitle: "Untitled ${stamp}"\ntags: [inbox]\n---\n\n# Untitled ${stamp}\n\n`,
    tags: ['inbox'],
    aliases: [],
    backlinks: [],
    outgoing_paths: [],
    headings: [],
    tasks: [],
  };
}

function _activeNote() {
  const base = _noteDraft || _obsidianNoteDetails[_selectedNotePath] || _noteByPath(_selectedNotePath);
  if (!base) return null;
  if (_obsidianEditorDraft && (_obsidianEditorDraft.originalPath === base.path || _obsidianEditorDraft.path === base.path)) {
    return {
      ...base,
      path: _obsidianEditorDraft.path || base.path,
      content: _obsidianEditorDraft.content ?? base.content,
    };
  }
  return base;
}

function _pendingCurationNotes() {
  return (_obsidianState?.notes || []).filter((note) => String(note.path || '').startsWith('Odysseus/Curation/Pending/'));
}

function _noteKind(note) {
  const path = String(note?.path || '');
  if (path.includes('/Journal/')) return 'journal';
  if (path.includes('/Curation/Pending/')) return 'pending';
  if (path.includes('/Curation/Rejected/')) return 'rejected';
  if (path.includes('/Knowledge/')) return 'knowledge';
  if (path.includes('/Skills/')) return 'skill';
  if (path.startsWith('Inbox/')) return 'inbox';
  return 'note';
}

function _noteStatus(note) {
  const meta = note?.frontmatter || {};
  const tags = new Set((note?.tags || []).map((tag) => String(tag).toLowerCase()));
  if (meta.status) return String(meta.status);
  if (tags.has('approved')) return 'approved';
  if (tags.has('rejected')) return 'rejected';
  if (tags.has('pending') || _noteKind(note) === 'pending') return 'pending';
  if (_noteKind(note) === 'journal') return 'logged';
  return 'stored';
}

function _formatShortDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function _formatLongDate(value) {
  if (!value) return 'No timestamp';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _obsidianHealth() {
  const notes = _obsidianState?.notes || [];
  const pending = _pendingCurationNotes();
  const knowledge = notes.filter((note) => _noteKind(note) === 'knowledge');
  const skills = notes.filter((note) => _noteKind(note) === 'skill');
  const journal = notes.filter((note) => _noteKind(note) === 'journal');
  const links = _obsidianState?.graph?.edges?.length || 0;
  const last = notes.reduce((best, note) => String(note.updated_at || '') > String(best || '') ? note.updated_at : best, '');
  const preferences = _prefEntries();
  return { notes, pending, knowledge, skills, journal, links, last, preferences };
}

function _noteMatchesQuery(note, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const meta = note?.frontmatter || {};
  const haystack = [
    note?.title,
    note?.path,
    _noteKind(note),
    _noteStatus(note),
    meta.genre,
    meta.type,
    meta.category,
    ...(note?.tags || []),
    ...(note?.aliases || []),
    ...(note?.headings || []).map((heading) => heading.text),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function _filteredObsidianNotes() {
  return (_obsidianState?.notes || []).filter((note) => _noteMatchesQuery(note, _obsidianQuery));
}

function _knowledgeNotes() {
  return (_obsidianState?.notes || [])
    .filter((note) => _noteKind(note) === 'knowledge')
    .filter((note) => _noteMatchesQuery(note, _obsidianQuery))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function _recentActivityNotes() {
  return (_obsidianState?.notes || [])
    .filter((note) => ['journal', 'knowledge', 'pending', 'rejected'].includes(_noteKind(note)))
    .slice()
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, 18);
}

function _skillQueryMatches(skill) {
  const q = String(_obsidianSkillQuery || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    skill?.name,
    skill?.description,
    skill?.category,
    skill?.status,
    skill?.source,
    skill?.audit_verdict,
    ...(skill?.tags || []),
    ...(skill?.procedure || []),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function _skillNotePath(skill) {
  const raw = String(skill?.path || '').replace(/\\/g, '/');
  const marker = '/Odysseus/Skills/';
  const idx = raw.indexOf(marker);
  if (idx >= 0) return raw.slice(idx + 1);
  const byName = slugifyLike(skill?.name || '');
  if (!byName) return '';
  const notes = _obsidianState?.notes || [];
  const match = notes.find((note) => {
    const path = String(note.path || '');
    return path.includes('/Skills/') && path.endsWith(`/${byName}/SKILL.md`);
  });
  return match?.path || '';
}

function slugifyLike(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '';
}

function _filteredObsidianSkills() {
  return (_obsidianSkills || []).filter(_skillQueryMatches).sort((a, b) => {
    const statusA = a.status === 'published' ? 0 : 1;
    const statusB = b.status === 'published' ? 0 : 1;
    if (statusA !== statusB) return statusA - statusB;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function _frontmatterRows(note) {
  const meta = note?.frontmatter || {};
  return Object.entries(meta)
    .filter(([key]) => !['title', 'tags'].includes(key))
    .slice(0, 10)
    .map(([key, value]) => `<div><span>${_escape(key)}</span><strong>${_escape(Array.isArray(value) ? value.join(', ') : value)}</strong></div>`)
    .join('');
}

function _prefEntries() {
  return Object.entries(_obsidianPrefs || {})
    .filter(([key]) => key !== '_users')
    .sort(([a], [b]) => a.localeCompare(b));
}

function _isSensitivePrefKey(key) {
  return /(?:token|secret|password|api[_-]?key|credential)/i.test(String(key || ''));
}

function _formatPreferenceValue(key, value) {
  if (_isSensitivePrefKey(key)) return 'redacted';
  if (value === null || value === undefined) return 'unset';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 180)}...` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch {
    return String(value);
  }
}

function _statusChip(label, value, tone = '') {
  return `<span class="obsidian-chip ${tone ? `is-${_escape(tone)}` : ''}"><strong>${_escape(value)}</strong>${_escape(label)}</span>`;
}

function _confirmDiscardObsidianChanges() {
  if (!_obsidianDirty) return true;
  return window.confirm('Discard unsaved Obsidian note changes?');
}

function _clearObsidianDirty() {
  _obsidianDirty = false;
  _obsidianEditorDraft = null;
}

async function _loadSelectedObsidianNote(path, { render = true } = {}) {
  if (!path) return null;
  try {
    const note = await _request(`/api/obsidian/notes/${_noteUrl(path)}`);
    _obsidianNoteDetails[note.path] = note;
    if (render) _renderObsidian();
    return note;
  } catch (err) {
    uiModule.showToast?.(`Obsidian note load failed: ${err.message}`);
    return null;
  }
}

async function _runObsidianSearch(query) {
  const q = String(query || '').trim();
  if (!q) {
    _obsidianSearchResults = [];
    _obsidianSearchError = '';
    _obsidianSearching = false;
    _renderObsidian();
    return;
  }
  _obsidianSearching = true;
  _obsidianSearchError = '';
  try {
    const result = await _request(`/api/obsidian/search?q=${encodeURIComponent(q)}&limit=12`);
    if (_obsidianQuery.trim() !== q) return;
    _obsidianSearchResults = Array.isArray(result?.results) ? result.results : [];
  } catch (err) {
    _obsidianSearchError = err.message || 'Search failed';
  } finally {
    if (_obsidianQuery.trim() === q) {
      _obsidianSearching = false;
      _renderObsidian();
    }
  }
}

function _scheduleObsidianSearch(query) {
  _obsidianQuery = String(query || '');
  window.clearTimeout(_obsidianSearchTimer);
  if (!_obsidianQuery.trim()) {
    _obsidianSearchResults = [];
    _obsidianSearchError = '';
    _obsidianSearching = false;
    _renderObsidian();
    return;
  }
  _obsidianSearching = true;
  _obsidianSearchTimer = window.setTimeout(() => {
    _runObsidianSearch(_obsidianQuery);
  }, 260);
}

function _obsidianGraphData() {
  const nodes = _obsidianState?.graph?.nodes || [];
  const edges = _obsidianState?.graph?.edges || [];
  if (nodes.length) {
    return {
      mode: 'vault',
      nodes: nodes.map((node, index) => ({
        ...node,
        id: node.id || node.path,
        label: node.title || node.path || 'Untitled',
        group: node.kind === 'missing' ? 'Unresolved' : 'Notes',
        kind: node.kind || 'note',
        index,
        weight: 1 + (node.tags || []).length,
      })),
      edges,
    };
  }
  return { mode: 'workspace', ..._graphData() };
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

function _graphEndpointId(value) {
  if (value && typeof value === 'object') return value.id || value.path || value.name || '';
  return String(value || '');
}

function _graphEdgeFrom(edge) {
  return _graphEndpointId(edge?.from ?? edge?.source);
}

function _graphEdgeTo(edge) {
  return _graphEndpointId(edge?.to ?? edge?.target);
}

function _obsidianGraphVisibleData() {
  const graph = _obsidianGraphData();
  const selected = _selectedGraphNodeId;
  const depth = Math.max(1, Math.min(3, Number(_obsidianGraphDepth) || 2));
  if (_obsidianGraphScope !== 'local' || !selected || !graph.nodes.some((node) => node.id === selected)) return graph;

  const adjacency = new Map();
  for (const node of graph.nodes) adjacency.set(node.id, new Set());
  for (const edge of graph.edges) {
    const from = _graphEdgeFrom(edge);
    const to = _graphEdgeTo(edge);
    if (!from || !to) continue;
    adjacency.get(from)?.add(to);
    adjacency.get(to)?.add(from);
  }

  const keep = new Set([selected]);
  const queue = [{ id: selected, level: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.level >= depth) continue;
    for (const next of adjacency.get(current.id) || []) {
      if (keep.has(next)) continue;
      keep.add(next);
      queue.push({ id: next, level: current.level + 1 });
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(_graphEdgeFrom(edge)) && keep.has(_graphEdgeTo(edge))),
  };
}

function _obsidianGraphNodeStatus(node, noteMap, itemMap) {
  const note = noteMap.get(node.id);
  if (note) return _noteStatus(note);
  const item = itemMap.get(node.id);
  if (item?.status) return item.status;
  if (node.kind === 'missing') return 'unresolved';
  return node.status || 'stored';
}

function _obsidianGraphNodeKind(node, noteMap) {
  const note = noteMap.get(node.id);
  if (note) return _noteKind(note);
  return node.kind || 'note';
}

function _obsidianGraphBaseColor(node) {
  const status = String(node.status || '').toLowerCase();
  if (status === 'blocked' || status === 'unresolved' || node.kind === 'missing') return '#fb7185';
  if (status === 'pending' || node.kind === 'pending') return '#fbbf24';
  if (status === 'approved' || node.kind === 'knowledge') return '#34d399';
  if (node.kind === 'journal') return '#60a5fa';
  if (node.kind === 'session') return '#a78bfa';
  if (node.kind === 'requests' || node.kind === 'inbox') return '#38bdf8';
  if (node.kind === 'ideas') return '#4ade80';
  if (node.kind === 'council') return '#f59e0b';
  if (node.kind === 'executions') return '#c084fc';
  if (node.kind === 'verifications') return '#f87171';
  return '#8bd3ff';
}

function _obsidianGraphNodeHaystack(node, noteMap, itemMap) {
  const note = noteMap.get(node.id);
  const item = itemMap.get(node.id);
  return [
    node.label,
    node.id,
    node.kind,
    node.group,
    note?.path,
    note?.title,
    ...(note?.tags || []),
    ...(note?.headings || []).map((heading) => heading.text),
    note?.frontmatter?.genre,
    note?.frontmatter?.type,
    item?.title,
    item?.body,
    item?.evidence,
    ...(item?.tags || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function _obsidianGraph3dData(graph = _obsidianGraphVisibleData()) {
  const noteMap = new Map((_obsidianState?.notes || []).map((note) => [note.path, note]));
  const itemMap = new Map(_allWorkspaceItems().map((item) => [item.id, item]));
  const degree = new Map();
  for (const edge of graph.edges || []) {
    const from = _graphEdgeFrom(edge);
    const to = _graphEdgeTo(edge);
    if (!from || !to) continue;
    degree.set(from, (degree.get(from) || 0) + 1);
    degree.set(to, (degree.get(to) || 0) + 1);
  }

  const sourceNodes = graph.nodes || [];
  const totalNodes = Math.max(1, sourceNodes.length);
  const nodes = sourceNodes.map((node, index) => {
    const note = noteMap.get(node.id);
    const item = itemMap.get(node.id);
    const kind = _obsidianGraphNodeKind(node, noteMap);
    const status = _obsidianGraphNodeStatus(node, noteMap, itemMap);
    const tagCount = (note?.tags || item?.tags || node.tags || []).length;
    const angle = (index / totalNodes) * Math.PI * 2;
    const ring = 58 + (index % 3) * 18;
    const x = Math.cos(angle) * ring;
    const y = Math.sin(angle) * ring;
    const z = ((index % 5) - 2) * 20;
    return {
      id: node.id,
      name: node.label || note?.title || item?.title || node.id,
      label: node.label || note?.title || item?.title || node.id,
      path: note?.path || node.path || '',
      kind,
      status,
      group: node.group || kind,
      tags: note?.tags || item?.tags || node.tags || [],
      degree: degree.get(node.id) || 0,
      val: Math.min(2.8, 0.95 + (degree.get(node.id) || 0) * 0.22 + Math.min(tagCount, 6) * 0.08 + (node.weight || 0) * 0.05),
      haystack: _obsidianGraphNodeHaystack({ ...node, kind }, noteMap, itemMap),
      x,
      y,
      z,
      fx: x,
      fy: y,
      fz: z,
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links = (graph.edges || []).map((edge) => {
    const source = _graphEdgeFrom(edge);
    const target = _graphEdgeTo(edge);
    if (!nodeIds.has(source) || !nodeIds.has(target)) return null;
    return {
      source,
      target,
      type: edge.type || 'link',
    };
  }).filter(Boolean);
  for (const node of nodes) node.neighbors = [];
  for (const link of links) {
    const source = _graphEndpointId(link.source);
    const target = _graphEndpointId(link.target);
    byId.get(source)?.neighbors.push(target);
    byId.get(target)?.neighbors.push(source);
  }
  return { nodes, links, mode: graph.mode };
}

function _obsidianGraphMatchesQuery(node) {
  const query = _obsidianGraphQuery.trim().toLowerCase();
  return !query || String(node.haystack || '').includes(query);
}

function _obsidianGraphNodeMuted(node) {
  if (!_obsidianGraphMatchesQuery(node)) return true;
  if (!_selectedGraphNodeId) return false;
  return node.id !== _selectedGraphNodeId && !(node.neighbors || []).includes(_selectedGraphNodeId);
}

function _obsidianGraphLinkConnectsSelected(link) {
  if (!_selectedGraphNodeId) return false;
  return _graphEndpointId(link.source) === _selectedGraphNodeId || _graphEndpointId(link.target) === _selectedGraphNodeId;
}

function _obsidianGraphLinkMuted(link) {
  const source = typeof link.source === 'object' ? link.source : null;
  const target = typeof link.target === 'object' ? link.target : null;
  if ((_obsidianGraphQuery.trim() && source && target) && (!_obsidianGraphMatchesQuery(source) || !_obsidianGraphMatchesQuery(target))) return true;
  return Boolean(_selectedGraphNodeId && !_obsidianGraphLinkConnectsSelected(link));
}

function _obsidianGraph3dNodeColor(node) {
  if (node.id === _selectedGraphNodeId) return '#ffffff';
  if (_obsidianGraphNodeMuted(node)) return '#26343f';
  return _obsidianGraphBaseColor(node);
}

function _obsidianGraph3dNodeVal(node) {
  if (node.id === _selectedGraphNodeId) return Math.max(2.4, (node.val || 1.2) + 0.8);
  if (_obsidianGraphNodeMuted(node)) return 0.45;
  return node.val || 1.2;
}

function _obsidianGraph3dLinkColor(link) {
  if (_obsidianGraphLinkConnectsSelected(link)) return '#f5b4bd';
  if (_obsidianGraphLinkMuted(link)) return '#22303a';
  if (link.type === 'promoted') return '#34d399';
  if (link.type === 'session') return '#a78bfa';
  return '#7dd3fc';
}

function _obsidianGraph3dLinkWidth(link) {
  if (_obsidianGraphLinkConnectsSelected(link)) return 1.8;
  if (_obsidianGraphLinkMuted(link)) return 0.15;
  return 0.7;
}

function _refreshObsidian3dGraphStyles() {
  if (!_obsidianGraphInstance) return;
  _obsidianGraphInstance
    .nodeColor(_obsidianGraph3dNodeColor)
    .nodeVal(_obsidianGraph3dNodeVal)
    .linkColor(_obsidianGraph3dLinkColor)
    .linkWidth(_obsidianGraph3dLinkWidth)
    .linkDirectionalArrowLength((link) => (_obsidianGraphArrows && !_obsidianGraphLinkMuted(link) ? 3.5 : 0))
    .linkDirectionalParticles((link) => (_obsidianGraphLinkConnectsSelected(link) ? 2 : 0));
}

function _renderObsidianGraphSvgParts(graph = _obsidianGraphVisibleData()) {
  const { nodes, edges, mode } = graph;
  if (!nodes.length) return '<div class="workspace-empty-inline">No vault notes yet. Create a note or sync workspace cards into the Markdown vault.</div>';
  const width = 760;
  const height = 390;
  const lanes = {
    note: { x: 210, color: '#a7f3d0' },
    missing: { x: 620, color: '#fca5a5' },
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
    const lane = lanes[node.kind] || lanes.note;
    const offset = counts[node.kind] - 1;
    const y = 62 + (offset % 8) * 38 + Math.floor(offset / 8) * 12;
    return { ...node, x: lane.x, y: Math.min(height - 38, y), color: lane.color };
  });
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const lines = edges.map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return '';
    const connected = _selectedGraphNodeId && (edge.from === _selectedGraphNodeId || edge.to === _selectedGraphNodeId);
    const muted = _selectedGraphNodeId && !connected;
    return `<path class="obsidian-graph-edge ${connected ? 'is-selected' : ''} ${muted ? 'is-muted' : ''}" data-from="${_escape(edge.from)}" data-to="${_escape(edge.to)}" data-type="${_escape(edge.type)}" d="M${from.x},${from.y} C${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y} ${to.x},${to.y}" />`;
  }).join('');
  const circles = positioned.map((node) => {
    const radius = Math.min(15, 7 + node.weight);
    const selected = _selectedGraphNodeId === node.id;
    const muted = _selectedGraphNodeId && !selected && !edges.some((edge) => (edge.from === _selectedGraphNodeId && edge.to === node.id) || (edge.to === _selectedGraphNodeId && edge.from === node.id));
    return `<g class="obsidian-graph-node ${selected ? 'is-selected' : ''} ${muted ? 'is-muted' : ''}" data-id="${_escape(node.id)}" data-kind="${_escape(node.kind)}" data-title="${_escape(node.label)}" transform="translate(${node.x} ${node.y})">
      <circle r="${radius}" fill="${node.color}" />
      <text x="${radius + 6}" y="4">${_escape(node.label.slice(0, 28))}</text>
    </g>`;
  }).join('');
  const legend = mode === 'vault'
    ? [
        `<span><i style="background:${lanes.note.color}"></i>Markdown notes</span>`,
        `<span><i style="background:${lanes.missing.color}"></i>Unresolved wikilinks</span>`,
      ].join('')
    : Object.entries(COLLECTIONS).map(([kind, meta]) => `<span><i style="background:${lanes[kind]?.color || '#ddd'}"></i>${meta.label}</span>`).join('');
  return {
    svg: `
      <svg class="obsidian-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Workspace knowledge graph">
        <defs><marker id="obsidian-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" /></marker></defs>
        ${lines}
        ${circles}
      </svg>`,
    legend,
  };
}

function _renderObsidianGraphFallback() {
  const parts = _renderObsidianGraphSvgParts();
  if (typeof parts === 'string') return parts;
  return `
    <div class="obsidian-graph-toolbar">
      <input id="obsidian-graph-search" value="${_escape(_obsidianGraphQuery)}" placeholder="Search graph nodes, tags, and decisions" />
      <select id="obsidian-graph-scope" title="Graph scope" aria-label="Graph scope">
        <option value="global" ${_obsidianGraphScope === 'global' ? 'selected' : ''}>Global graph</option>
        <option value="local" ${_obsidianGraphScope === 'local' ? 'selected' : ''}>Local graph</option>
      </select>
      <label>Depth <input id="obsidian-graph-depth" type="range" min="1" max="3" value="${_escape(_obsidianGraphDepth)}" /></label>
      <label><input id="obsidian-graph-arrows" type="checkbox" ${_obsidianGraphArrows ? 'checked' : ''} /> Arrows</label>
    </div>
    <div class="obsidian-graph-shell">
      ${parts.svg}
      <aside class="obsidian-graph-inspector">
        <h3>Local context</h3>
        <div id="obsidian-graph-selected">Select a node to inspect backlinks and outgoing links.</div>
      </aside>
    </div>
    <div class="obsidian-graph-legend">${parts.legend}</div>`;
}

function _renderObsidianGraph() {
  const graph = _obsidianGraphVisibleData();
  if (!graph.nodes.length) return '<div class="workspace-empty-inline">No vault notes yet. Create a note or sync workspace cards into the Markdown vault.</div>';
  const fallback = _renderObsidianGraphSvgParts(graph);
  const fallbackSvg = typeof fallback === 'string' ? fallback : fallback.svg;
  const legend = typeof fallback === 'string' ? '' : fallback.legend;
  return `
    <div class="obsidian-graph-toolbar">
      <input id="obsidian-graph-search" value="${_escape(_obsidianGraphQuery)}" placeholder="Search graph nodes, tags, and decisions" />
      <select id="obsidian-graph-scope" title="Graph scope" aria-label="Graph scope">
        <option value="global" ${_obsidianGraphScope === 'global' ? 'selected' : ''}>Global graph</option>
        <option value="local" ${_obsidianGraphScope === 'local' ? 'selected' : ''}>Local graph</option>
      </select>
      <label>Depth <input id="obsidian-graph-depth" type="range" min="1" max="3" value="${_escape(_obsidianGraphDepth)}" /></label>
      <label><input id="obsidian-graph-arrows" type="checkbox" ${_obsidianGraphArrows ? 'checked' : ''} /> Arrows</label>
      <button type="button" class="doclib-card-action-btn" data-action="obsidian-graph-fit">Fit</button>
    </div>
    <div class="obsidian-graph-error" data-obsidian-graph-error ${_obsidianGraphError ? '' : 'hidden'}>
      <strong>3D graph fallback</strong>
      <span data-obsidian-graph-error-text>${_escape(_obsidianGraphError || 'The 3D graph could not start.')}</span>
      <button type="button" class="doclib-card-action-btn" data-action="obsidian-graph-retry">Retry 3D</button>
    </div>
    <div class="obsidian-graph-shell obsidian-graph-shell-3d">
      <div class="obsidian-graph-stage" data-obsidian-graph-stage>
        <div class="obsidian-graph-loading" data-obsidian-graph-loading>Launching 3D knowledge graph...</div>
        <div class="obsidian-graph-3d" data-obsidian-graph-3d aria-label="3D Obsidian knowledge graph"></div>
        <div class="obsidian-graph-fallback" data-obsidian-graph-fallback hidden>${fallbackSvg}</div>
      </div>
      <aside class="obsidian-graph-inspector">
        <h3>Local context</h3>
        <div id="obsidian-graph-selected">Select a node to inspect backlinks and outgoing links.</div>
      </aside>
    </div>
    <div class="obsidian-graph-legend">${legend}</div>`;
}

function _supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

function _loadObsidianGraph3dLibrary() {
  if (window.ForceGraph3D) return Promise.resolve(window.ForceGraph3D);
  if (_obsidianGraphScriptPromise) return _obsidianGraphScriptPromise;
  _obsidianGraphScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${OBSIDIAN_GRAPH_3D_SCRIPT}"]`);
    const script = existing || document.createElement('script');
    const done = () => {
      if (window.ForceGraph3D) resolve(window.ForceGraph3D);
      else reject(new Error('ForceGraph3D did not attach to the page.'));
    };
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => reject(new Error('3D graph bundle failed to load.')), { once: true });
    if (!existing) {
      script.src = OBSIDIAN_GRAPH_3D_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    } else if (window.ForceGraph3D) {
      done();
    }
  });
  return _obsidianGraphScriptPromise;
}

function _destroyObsidian3dGraph() {
  _obsidianGraphMountToken += 1;
  if (_obsidianGraphResizeObserver) {
    _obsidianGraphResizeObserver.disconnect();
    _obsidianGraphResizeObserver = null;
  }
  if (_obsidianGraphInstance) {
    try {
      _obsidianGraphInstance.pauseAnimation?.();
      _obsidianGraphInstance._destructor?.();
    } catch {}
    _obsidianGraphInstance = null;
  }
}

function _setObsidianGraphFallback(message) {
  const modal = _modal(OBSIDIAN_MODAL_ID);
  const stage = modal?.querySelector('[data-obsidian-graph-stage]');
  const fallback = modal?.querySelector('[data-obsidian-graph-fallback]');
  const graph = modal?.querySelector('[data-obsidian-graph-3d]');
  const loading = modal?.querySelector('[data-obsidian-graph-loading]');
  const error = modal?.querySelector('[data-obsidian-graph-error]');
  const errorText = modal?.querySelector('[data-obsidian-graph-error-text]');
  if (fallback) fallback.hidden = false;
  if (graph) graph.hidden = true;
  if (loading) loading.hidden = true;
  if (stage) stage.classList.add('is-fallback');
  if (error) error.hidden = false;
  if (errorText) errorText.textContent = message;
  _obsidianGraphError = message;
}

function _graphElementSize(element) {
  const rect = element?.getBoundingClientRect?.();
  const parentRect = element?.parentElement?.getBoundingClientRect?.();
  return {
    width: Math.max(320, Math.floor(rect?.width || parentRect?.width || 720)),
    height: Math.max(320, Math.floor(rect?.height || parentRect?.height || 430)),
  };
}

function _focusObsidian3dNode(node) {
  if (!_obsidianGraphInstance || !node) return;
  const distance = 130;
  const length = Math.hypot(node.x || 0, node.y || 0, node.z || 0) || 1;
  const ratio = 1 + distance / length;
  _obsidianGraphInstance.cameraPosition(
    { x: (node.x || 0) * ratio, y: (node.y || 0) * ratio, z: (node.z || 0) * ratio },
    { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
    800,
  );
}

function _resetObsidian3dCamera(transitionMs = 700) {
  _obsidianGraphInstance?.cameraPosition?.(
    { x: 0, y: 0, z: 320 },
    { x: 0, y: 0, z: 0 },
    transitionMs,
  );
}

async function _mountObsidian3dGraph(selectNode) {
  if (_obsidianTab !== 'graph') return;
  const modal = _modal(OBSIDIAN_MODAL_ID);
  const mount = modal?.querySelector('[data-obsidian-graph-3d]');
  if (!mount) return;
  const token = ++_obsidianGraphMountToken;
  const loading = modal.querySelector('[data-obsidian-graph-loading]');
  const fallback = modal.querySelector('[data-obsidian-graph-fallback]');
  const stage = modal.querySelector('[data-obsidian-graph-stage]');
  if (loading) loading.hidden = false;
  if (fallback) fallback.hidden = true;
  if (stage) stage.classList.remove('is-fallback');

  if (!_supportsWebGL()) {
    _setObsidianGraphFallback('WebGL is unavailable in this Chrome session, so the cockpit is showing the SVG fallback.');
    return;
  }

  try {
    const ForceGraph3D = await _loadObsidianGraph3dLibrary();
    if (token !== _obsidianGraphMountToken) return;
    const data = _obsidianGraph3dData();
    const size = _graphElementSize(mount);
    const graph = new ForceGraph3D(mount, {
      controlType: 'orbit',
      rendererConfig: { antialias: true, alpha: true },
    });
    _obsidianGraphInstance = graph;
    graph
      .width(size.width)
      .height(size.height)
      .backgroundColor('#071014')
      .showNavInfo(false)
      .graphData({ nodes: data.nodes, links: data.links })
      .nodeLabel((node) => `${node.name}<br><span>${node.kind} / ${node.status}</span>`)
      .nodeRelSize(5)
      .nodeResolution(18)
      .nodeOpacity(0.88)
      .linkOpacity(0.42)
      .linkDirectionalArrowRelPos(0.72)
      .linkDirectionalParticleWidth(1.6)
      .linkDirectionalParticleSpeed(0.006)
      .onNodeHover((node) => {
        mount.classList.toggle('is-hovering-node', Boolean(node));
      })
      .onNodeClick(async (node) => {
        await selectNode(node.id, { openNote: true, renderNote: false });
        _refreshObsidian3dGraphStyles();
        _focusObsidian3dNode(node);
      })
      .onBackgroundClick(() => {
        _selectedGraphNodeId = '';
        _refreshObsidian3dGraphStyles();
      });
    graph.d3Force?.('charge')?.strength?.(-42);
    graph.d3Force?.('link')?.distance?.(76);
    graph.d3VelocityDecay?.(0.55);
    _resetObsidian3dCamera(0);
    _refreshObsidian3dGraphStyles();
    if (loading) loading.hidden = true;

    _obsidianGraphResizeObserver = new ResizeObserver(() => {
      if (!_obsidianGraphInstance || !mount.isConnected) return;
      const next = _graphElementSize(mount);
      _obsidianGraphInstance.width(next.width).height(next.height);
    });
    _obsidianGraphResizeObserver.observe(mount);
    window.setTimeout(() => {
      if (_obsidianGraphInstance && token === _obsidianGraphMountToken) _resetObsidian3dCamera(500);
    }, 280);
    window.setTimeout(() => {
      if (_obsidianGraphInstance && token === _obsidianGraphMountToken) _resetObsidian3dCamera(700);
    }, 1300);
  } catch (err) {
    if (token !== _obsidianGraphMountToken) return;
    _setObsidianGraphFallback(err?.message || 'The 3D graph could not start, so the cockpit is showing the SVG fallback.');
  }
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

function _highlightText(value, query) {
  const text = String(value || '');
  const q = String(query || '').trim();
  if (!q) return _escape(text);
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return _escape(text);
  return `${_escape(text.slice(0, index))}<mark>${_escape(text.slice(index, index + q.length))}</mark>${_escape(text.slice(index + q.length))}`;
}

function _cleanSearchSnippet(value) {
  return String(value || '')
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _renderObsidianMetrics() {
  const health = _obsidianHealth();
  return `
    <div class="obsidian-health-strip" aria-label="Vault health">
      ${_statusChip('notes', health.notes.length, 'notes')}
      ${_statusChip('pending', health.pending.length, health.pending.length ? 'pending' : '')}
      ${_statusChip('knowledge', health.knowledge.length, 'knowledge')}
      ${_statusChip('skills', health.skills.length || _obsidianSkills.length, 'skills')}
      ${_statusChip('prefs', health.preferences.length, 'prefs')}
      ${_statusChip('journals', health.journal.length, 'journal')}
      ${_statusChip('links', health.links, 'links')}
      <span class="obsidian-chip is-path" title="${_escape(_obsidianState?.root || '')}"><strong>${_escape(_formatShortDate(health.last) || 'never')}</strong>last update</span>
    </div>`;
}

function _renderObsidianTabs() {
  const health = _obsidianHealth();
  const graphCount = _obsidianState?.graph?.nodes?.length || 0;
  const activityCount = _recentActivityNotes().length;
  const tabs = [
    ['vault', 'Vault', health.notes.length],
    ['knowledge', 'Knowledge', health.knowledge.length],
    ['curation', 'Curation', health.pending.length],
    ['skills', 'Skills', _obsidianSkills.length || health.skills.length],
    ['preferences', 'Preferences', health.preferences.length],
    ['graph', 'Graph', graphCount],
    ['activity', 'Activity', activityCount],
  ];
  return `
    <nav class="obsidian-cockpit-tabs" aria-label="Obsidian cockpit tabs">
      ${tabs.map(([id, label, count]) => `
        <button type="button" class="obsidian-cockpit-tab ${_obsidianTab === id ? 'is-active' : ''}" data-action="obsidian-tab" data-tab="${id}" aria-pressed="${_obsidianTab === id ? 'true' : 'false'}">
          ${_escape(label)} <span>${_escape(count)}</span>
        </button>`).join('')}
    </nav>`;
}

function _renderObsidianNoteList({ notes = _filteredObsidianNotes(), compact = false } = {}) {
  if (_obsidianLoading) {
    return '<div class="obsidian-empty">Loading vault notes...</div>';
  }
  if (!notes.length) {
    return '<div class="obsidian-empty">No matching notes.</div>';
  }
  return notes.map((note) => {
    const tags = (note.tags || []).slice(0, compact ? 2 : 4).map((tag) => `<span>${_escape(tag)}</span>`).join('');
    const status = _noteStatus(note);
    const kind = _noteKind(note);
    const meta = note.frontmatter || {};
    const typeLine = [meta.genre || kind, meta.type].filter(Boolean).join(' / ');
    return `
      <button type="button" class="obsidian-note-row is-${_escape(kind)} ${note.path === _selectedNotePath ? 'is-selected' : ''}" data-note-path="${_escape(note.path)}" title="${_escape(note.path)}">
        <span class="obsidian-note-row-head">
          <strong>${_highlightText(note.title || note.path, _obsidianQuery)}</strong>
          <time>${_escape(_formatShortDate(note.updated_at))}</time>
        </span>
        <small>${_highlightText(note.path, _obsidianQuery)}</small>
        <span class="obsidian-note-row-meta"><b>${_escape(status)}</b>${typeLine ? `<i>${_escape(typeLine)}</i>` : ''}</span>
        ${tags ? `<span class="obsidian-note-tags">${tags}</span>` : ''}
      </button>`;
  }).join('');
}

function _renderObsidianNoteEditor() {
  const note = _activeNote();
  if (_obsidianLoading) {
    return '<div class="obsidian-empty">Loading note editor...</div>';
  }
  if (!note) {
    return '<div class="obsidian-empty">Select or create a Markdown note.</div>';
  }
  return `
    <form class="obsidian-note-editor" data-note-editor>
      <div class="obsidian-note-editor-head">
        <label>
          <span>Path</span>
          <input name="path" value="${_escape(note.path || '')}" placeholder="Folder/Note.md" />
        </label>
        <div class="obsidian-vault-actions">
          <span class="obsidian-save-state ${_obsidianDirty ? 'is-dirty' : ''}" data-obsidian-save-state>${_obsidianDirty ? 'Unsaved' : 'Saved'}</span>
          <button type="submit" class="doclib-card-action-btn obsidian-primary-action">Save</button>
          <button type="button" class="doclib-card-action-btn obsidian-danger-action" data-action="obsidian-delete-note">Delete</button>
        </div>
      </div>
      <textarea name="content" spellcheck="false">${_escape(note.content || '')}</textarea>
    </form>`;
}

function _renderNoteLinkList(paths) {
  if (!paths?.length) return '<em>No links yet.</em>';
  const notePaths = new Set((_obsidianState?.notes || []).map((note) => note.path));
  return `<div class="obsidian-link-list">${paths.map((path) => (
    notePaths.has(path)
      ? `<button type="button" data-action="obsidian-open-note-path" data-note-path="${_escape(path)}">${_escape(path)}</button>`
      : `<span>${_escape(path)}</span>`
  )).join('')}</div>`;
}

function _renderObsidianContext(note = _activeNote()) {
  if (!note) {
    return '<aside class="obsidian-context-panel"><div class="obsidian-empty">No note selected.</div></aside>';
  }
  const tags = (note.tags || []).map((tag) => `<span>${_escape(tag)}</span>`).join('');
  const headings = (note.headings || []).slice(0, 8).map((heading) => `<li>${'#'.repeat(heading.level)} ${_escape(heading.text)}</li>`).join('');
  const tasks = (note.tasks || []).slice(0, 8).map((task) => `<li>${task.done ? '[x]' : '[ ]'} ${_escape(task.text)}</li>`).join('');
  const fmRows = _frontmatterRows(note);
  return `
    <aside class="obsidian-context-panel">
      <div class="obsidian-context-head">
        <span>${_escape(_noteKind(note))}</span>
        <strong>${_escape(_noteStatus(note))}</strong>
      </div>
      <section>
        <h3>Tags</h3>
        <div class="obsidian-note-tags">${tags || '<em>No tags</em>'}</div>
      </section>
      <section>
        <h3>YAML</h3>
        <div class="obsidian-yaml-summary">${fmRows || '<em>No frontmatter fields.</em>'}</div>
      </section>
      <section>
        <h3>Backlinks</h3>
        ${_renderNoteLinkList(note.backlinks || [])}
      </section>
      <section>
        <h3>Outgoing</h3>
        ${_renderNoteLinkList(note.outgoing_paths || [])}
      </section>
      <section>
        <h3>Headings</h3>
        ${headings ? `<ul>${headings}</ul>` : '<em>No headings.</em>'}
      </section>
      <section>
        <h3>Tasks</h3>
        ${tasks ? `<ul>${tasks}</ul>` : '<em>No tasks.</em>'}
      </section>
    </aside>`;
}

function _renderPendingKnowledge() {
  const notes = _pendingCurationNotes();
  if (!notes.length) {
    return '<div class="obsidian-empty">No pending curated knowledge.</div>';
  }
  return notes.map((note) => `
    <article class="obsidian-curation-card" data-curation-path="${_escape(note.path)}">
      <div>
        <strong>${_escape(note.title || note.path)}</strong>
        <span>${_escape(note.frontmatter?.genre || 'event')} - ${_escape(note.frontmatter?.type || '')}</span>
        <small>${_escape(note.frontmatter?.source || 'obsidian')} ${note.frontmatter?.confidence ? ` / ${_escape(note.frontmatter.confidence)}` : ''}</small>
      </div>
      <div class="obsidian-vault-actions">
        <button type="button" class="doclib-card-action-btn" data-action="obsidian-open-curation">Open</button>
        <button type="button" class="doclib-card-action-btn" data-action="obsidian-approve-curation">Approve</button>
        <button type="button" class="doclib-card-action-btn obsidian-danger-action" data-action="obsidian-reject-curation">Reject</button>
      </div>
    </article>`).join('');
}

function _renderObsidianSearchResults() {
  const q = _obsidianQuery.trim();
  if (!q) return '';
  if (_obsidianSearching) return '<div class="obsidian-search-panel"><div class="obsidian-empty">Searching knowledge...</div></div>';
  if (_obsidianSearchError) return `<div class="obsidian-search-panel"><div class="obsidian-error">Search failed: ${_escape(_obsidianSearchError)}</div></div>`;
  const results = _obsidianSearchResults || [];
  return `
    <section class="obsidian-search-panel">
      <div class="obsidian-pane-title"><strong>Search results</strong><span>${_escape(results.length)} found</span></div>
      <div class="obsidian-search-results">
        ${results.length ? results.map((result) => `
          <button type="button" class="obsidian-search-result" data-action="obsidian-open-search-result" data-note-path="${_escape(result.path)}">
            <span><strong>${_highlightText(result.title || result.path, q)}</strong><b>${_escape(result.reason || 'match')}</b></span>
            <small>${_highlightText(result.path, q)}</small>
            <p>${_highlightText(_cleanSearchSnippet(result.snippet).slice(0, 220), q)}</p>
          </button>`).join('') : '<div class="obsidian-empty">No matching knowledge found.</div>'}
      </div>
    </section>`;
}

function _renderObsidianActivity() {
  const notes = _recentActivityNotes();
  if (!notes.length) return '<div class="obsidian-empty">No journal or knowledge activity yet.</div>';
  return notes.map((note) => `
    <button type="button" class="obsidian-activity-row is-${_escape(_noteKind(note))}" data-action="obsidian-open-note-path" data-note-path="${_escape(note.path)}">
      <span><strong>${_escape(note.title || note.path)}</strong><b>${_escape(_noteStatus(note))}</b></span>
      <small>${_escape(note.path)}</small>
      <time>${_escape(_formatLongDate(note.updated_at))}</time>
    </button>`).join('');
}

function _renderObsidianSkillList() {
  if (_obsidianSkillsLoading) return '<div class="obsidian-empty">Loading Obsidian skills...</div>';
  if (_obsidianSkillsError) return `<div class="obsidian-error">Skills failed to load: ${_escape(_obsidianSkillsError)}</div>`;
  const skills = _filteredObsidianSkills();
  if (!skills.length) return '<div class="obsidian-empty">No matching skills yet.</div>';
  return skills.map((skill) => {
    const name = skill.name || skill.id || 'unnamed-skill';
    const selected = _selectedSkillName === name;
    const tags = (skill.tags || []).slice(0, 5).map((tag) => `<span>${_escape(tag)}</span>`).join('');
    const notePath = _skillNotePath(skill);
    const confidence = skill.confidence !== undefined && skill.confidence !== null ? Math.round(Number(skill.confidence) * 100) : '';
    const metaChips = [
      skill.category ? `<span class="is-category" title="${_escape(skill.category)}">${_escape(skill.category)}</span>` : '',
      skill.audit_verdict ? `<span>${_escape(skill.audit_verdict)}</span>` : '',
      confidence ? `<span>${_escape(`${confidence}%`)}</span>` : '',
    ].filter(Boolean).join('');
    return `
      <button type="button" class="obsidian-skill-row ${selected ? 'is-selected' : ''}" data-skill-name="${_escape(name)}" data-note-path="${_escape(notePath)}">
        <span class="obsidian-skill-row-title">
          <strong>${_highlightText(name, _obsidianSkillQuery)}</strong>
          <time>${_escape(skill.last_used ? _formatShortDate(Number(skill.last_used) * 1000) : '')}</time>
        </span>
        <span class="obsidian-skill-description">${_highlightText(skill.description || 'Reusable SKILL.md procedure', _obsidianSkillQuery)}</span>
        <span class="obsidian-skill-meta">
          <b>${_escape(skill.status || 'draft')}</b>
          ${metaChips || '<span>general</span>'}
        </span>
        ${tags ? `<span class="obsidian-skill-tags">${tags}</span>` : ''}
      </button>`;
  }).join('');
}

function _activeSkill() {
  return (_obsidianSkills || []).find((skill) => (skill.name || skill.id) === _selectedSkillName) || _filteredObsidianSkills()[0] || null;
}

function _renderObsidianSkillDetail() {
  const skill = _activeSkill();
  if (_obsidianSkillsLoading) return '<div class="obsidian-empty">Loading skill library...</div>';
  if (!skill) return '<div class="obsidian-empty">Select a skill to review its SKILL.md metadata.</div>';
  const name = skill.name || skill.id || 'unnamed-skill';
  const notePath = _skillNotePath(skill);
  const rows = [
    ['Status', skill.status || 'draft'],
    ['Category', skill.category || 'general'],
    ['Confidence', skill.confidence !== undefined && skill.confidence !== null ? `${Math.round(Number(skill.confidence) * 100)}%` : 'unset'],
    ['Uses', skill.uses || 0],
    ['Last used', skill.last_used ? _formatLongDate(Number(skill.last_used) * 1000) : 'never'],
    ['Audit', skill.audit_verdict || 'not audited'],
    ['Source', skill.source || 'skill'],
    ['Path', notePath || 'Not indexed in Obsidian yet'],
  ].map(([key, value]) => `<div><span>${_escape(key)}</span><strong>${_escape(value)}</strong></div>`).join('');
  const procedure = (skill.procedure || []).slice(0, 8).map((step) => `<li>${_escape(step)}</li>`).join('');
  return `
    <section class="obsidian-skill-detail">
      <div class="obsidian-pane-title">
        <strong>${_escape(name)}</strong>
        <span>${_escape(skill.genre || 'runbook')}</span>
      </div>
      <p>${_escape(skill.description || skill.when_to_use || 'Reusable Odysseus procedure.')}</p>
      <div class="obsidian-yaml-summary">${rows}</div>
      <section>
        <h3>When to Use</h3>
        <p>${_escape(skill.when_to_use || 'No trigger guidance yet.')}</p>
      </section>
      <section>
        <h3>Procedure</h3>
        ${procedure ? `<ol>${procedure}</ol>` : '<em>No procedure steps yet.</em>'}
      </section>
      <div class="obsidian-vault-actions">
        ${notePath ? `<button type="button" class="doclib-card-action-btn obsidian-primary-action" data-action="obsidian-open-skill-note" data-note-path="${_escape(notePath)}">Open SKILL.md</button>` : ''}
        <button type="button" class="doclib-card-action-btn" data-action="obsidian-refresh-skills">Refresh skills</button>
      </div>
    </section>`;
}

function _renderMattPocockImportStatus() {
  if (_obsidianSkillImportError) {
    return `<div class="obsidian-error">Matt Pocock import failed: ${_escape(_obsidianSkillImportError)}</div>`;
  }
  if (!_obsidianSkillImportResult) return '';
  const counts = _obsidianSkillImportResult.counts || {};
  const created = counts.created ?? _obsidianSkillImportResult.created ?? 0;
  const updated = counts.updated ?? _obsidianSkillImportResult.updated ?? 0;
  const skipped = counts.skipped ?? _obsidianSkillImportResult.skipped ?? 0;
  return `<div class="obsidian-empty">Matt Pocock skills: ${_escape(created)} created, ${_escape(updated)} updated, ${_escape(skipped)} skipped.</div>`;
}

function _renderObsidianVaultTab() {
  const notes = _filteredObsidianNotes();
  return `
    <div class="obsidian-cockpit-grid">
      <aside class="obsidian-rail">
        <div class="obsidian-pane-title"><strong>Notes</strong><span>${_escape(notes.length)}</span></div>
        <div class="obsidian-note-list">${_renderObsidianNoteList({ notes })}</div>
        <div class="obsidian-rail-queue">
          <div class="obsidian-pane-title"><strong>Pending</strong><span>${_escape(_pendingCurationNotes().length)}</span></div>
          <div class="obsidian-curation-list is-compact">${_renderPendingKnowledge()}</div>
        </div>
      </aside>
      <main class="obsidian-main-panel">
        ${_obsidianQuery.trim() ? _renderObsidianSearchResults() : _renderObsidianNoteEditor()}
      </main>
      ${_renderObsidianContext()}
    </div>`;
}

function _renderObsidianCurationTab() {
  return `
    <div class="obsidian-cockpit-grid">
      <aside class="obsidian-rail">
        <div class="obsidian-pane-title"><strong>Review queue</strong><span>${_escape(_pendingCurationNotes().length)}</span></div>
        <div class="obsidian-curation-list">${_renderPendingKnowledge()}</div>
      </aside>
      <main class="obsidian-main-panel">${_renderObsidianNoteEditor()}</main>
      ${_renderObsidianContext()}
    </div>`;
}

function _renderObsidianKnowledgeTab() {
  const notes = _knowledgeNotes();
  return `
    <div class="obsidian-cockpit-grid">
      <aside class="obsidian-rail">
        <div class="obsidian-pane-title"><strong>Saved Knowledge</strong><span>${_escape(notes.length)}</span></div>
        <div class="obsidian-note-list">${_renderObsidianNoteList({ notes })}</div>
      </aside>
      <main class="obsidian-main-panel">
        ${_obsidianQuery.trim() ? _renderObsidianSearchResults() : _renderObsidianNoteEditor()}
      </main>
      ${_renderObsidianContext()}
    </div>`;
}

function _renderObsidianGraphTab() {
  return `
    <div class="obsidian-graph-workspace">
      ${_renderObsidianGraph()}
    </div>`;
}

function _renderObsidianActivityTab() {
  return `
    <div class="obsidian-cockpit-grid">
      <aside class="obsidian-rail">
        <div class="obsidian-pane-title"><strong>Recent activity</strong><span>${_escape(_recentActivityNotes().length)}</span></div>
        <div class="obsidian-activity-list">${_renderObsidianActivity()}</div>
      </aside>
      <main class="obsidian-main-panel">${_renderObsidianNoteEditor()}</main>
      ${_renderObsidianContext()}
    </div>`;
}

function _renderObsidianSkillsTab() {
  return `
    <div class="obsidian-cockpit-grid obsidian-skills-grid">
      <aside class="obsidian-rail">
        <div class="obsidian-pane-title"><strong>Skills</strong><span>${_escape(_filteredObsidianSkills().length)}</span></div>
        <label class="obsidian-inline-search">
          <span>Filter skills</span>
          <input type="search" data-action="obsidian-skill-search" value="${_escape(_obsidianSkillQuery)}" placeholder="Search SKILL.md procedures" autocomplete="off" />
        </label>
        <div class="obsidian-vault-actions">
          <button type="button" class="doclib-card-action-btn obsidian-primary-action" data-action="obsidian-import-matt-pocock" ${_obsidianSkillImporting ? 'disabled' : ''}>${_escape(_obsidianSkillImporting ? 'Importing...' : 'Import Matt Pocock')}</button>
          <button type="button" class="doclib-card-action-btn" data-action="obsidian-refresh-skills">Refresh</button>
        </div>
        ${_renderMattPocockImportStatus()}
        <div class="obsidian-skill-list">${_renderObsidianSkillList()}</div>
      </aside>
      <main class="obsidian-main-panel">${_renderObsidianSkillDetail()}</main>
      ${_renderObsidianContext(_noteByPath(_skillNotePath(_activeSkill())) || _activeNote())}
    </div>`;
}

function _renderObsidianPreferencesTab() {
  const entries = _prefEntries();
  const rows = entries.map(([key, value]) => `
    <div>
      <span>${_escape(key)}</span>
      <strong>${_escape(_formatPreferenceValue(key, value))}</strong>
    </div>`).join('');
  return `
    <div class="obsidian-cockpit-grid obsidian-preferences-grid">
      <aside class="obsidian-rail">
        <div class="obsidian-pane-title"><strong>Preferences</strong><span>${_escape(entries.length)}</span></div>
        <div class="obsidian-activity-list">
          ${entries.length ? entries.map(([key, value]) => `
            <button type="button" class="obsidian-activity-row" data-action="obsidian-pref-focus" data-pref-key="${_escape(key)}">
              <span><strong>${_escape(key)}</strong><b>${_escape(typeof value)}</b></span>
              <small>${_escape(_formatPreferenceValue(key, value))}</small>
            </button>`).join('') : '<div class="obsidian-empty">No user preferences saved yet.</div>'}
        </div>
      </aside>
      <main class="obsidian-main-panel">
        <section class="obsidian-skill-detail">
          <div class="obsidian-pane-title">
            <strong>User preferences</strong>
            <span>${_escape(_obsidianPrefsLoading ? 'loading' : _obsidianPrefsLoaded ? 'loaded' : 'not loaded')}</span>
          </div>
          ${_obsidianPrefsError ? `<div class="obsidian-error">Preferences failed to load: ${_escape(_obsidianPrefsError)}</div>` : ''}
          <p>Per-user choices that change how Odysseus behaves.</p>
          <div class="obsidian-yaml-summary">${rows || '<em>No preferences stored for this user.</em>'}</div>
          <div class="obsidian-vault-actions">
            <button type="button" class="doclib-card-action-btn" data-action="obsidian-refresh-preferences">Refresh preferences</button>
          </div>
        </section>
      </main>
      ${_renderObsidianContext()}
    </div>`;
}

function _renderObsidianStage() {
  if (_obsidianTab === 'knowledge') return _renderObsidianKnowledgeTab();
  if (_obsidianTab === 'curation') return _renderObsidianCurationTab();
  if (_obsidianTab === 'skills') return _renderObsidianSkillsTab();
  if (_obsidianTab === 'preferences') return _renderObsidianPreferencesTab();
  if (_obsidianTab === 'graph') return _renderObsidianGraphTab();
  if (_obsidianTab === 'activity') return _renderObsidianActivityTab();
  return _renderObsidianVaultTab();
}

function _renderObsidian() {
  const body = _body(OBSIDIAN_MODAL_ID);
  if (!body) return;
  _clampSurface(_modal(OBSIDIAN_MODAL_ID));
  _destroyObsidian3dGraph();
  if (_loading && _obsidianLoading && !_state && !_obsidianState) {
    body.innerHTML = '<div class="admin-card workspace-empty">Loading Obsidian vault...</div>';
    return;
  }

  const health = _obsidianHealth();
  const root = _obsidianState?.root || 'Vault not loaded';
  body.innerHTML = `
    <section class="obsidian-cockpit" aria-label="Obsidian knowledge cockpit">
      <header class="obsidian-cockpit-top">
        <div>
          <span>Canonical knowledge</span>
          <h2>Knowledge cockpit</h2>
          <p title="${_escape(root)}">${_escape(root)}</p>
        </div>
        <div class="obsidian-cockpit-actions">
          <button type="button" class="doclib-card-action-btn" data-action="obsidian-refresh">Refresh</button>
          <button type="button" class="doclib-card-action-btn" data-action="obsidian-new-note">New note</button>
          <button type="button" class="doclib-card-action-btn obsidian-primary-action" data-action="obsidian-sync-workspace">Sync workspace</button>
        </div>
      </header>
      ${_renderObsidianMetrics()}
      <div class="obsidian-command-bar">
        <label>
          <span>Search</span>
          <input type="search" data-action="obsidian-search" value="${_escape(_obsidianQuery)}" placeholder="Search notes, fixes, decisions, events" autocomplete="off" />
        </label>
        ${_obsidianQuery ? '<button type="button" class="doclib-card-action-btn" data-action="obsidian-clear-search">Clear</button>' : ''}
        <div class="obsidian-command-status">
          <span>${_escape(health.pending.length)} pending</span>
          <span>${_escape(health.links)} graph links</span>
          <span>${_obsidianDirty ? 'Unsaved edit' : 'Ready'}</span>
        </div>
      </div>
      ${_renderObsidianTabs()}
      <div class="obsidian-cockpit-stage" data-obsidian-stage="${_escape(_obsidianTab)}">
        ${_renderObsidianStage()}
      </div>
    </section>
  `;
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
  const graph = _obsidianGraphData();
  const itemMap = new Map(_allWorkspaceItems().map((item) => [item.id, item]));
  const noteMap = new Map((_obsidianState?.notes || []).map((note) => [note.path, note]));
  const nodeMap = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const nodes = [...modal.querySelectorAll('.obsidian-graph-node')];
  const edges = [...modal.querySelectorAll('.obsidian-graph-edge')];
  const inspector = modal.querySelector('#obsidian-graph-selected');

  const openNotePath = async (path, { clearSearch = false, render = true } = {}) => {
    if (!path || !_confirmDiscardObsidianChanges()) return;
    _selectedNotePath = path;
    _noteDraft = null;
    _clearObsidianDirty();
    if (clearSearch) {
      _obsidianQuery = '';
      _obsidianSearchResults = [];
      _obsidianSearchError = '';
      _obsidianSearching = false;
    }
    await _loadSelectedObsidianNote(path, { render });
  };

  modal.querySelectorAll('[data-action="obsidian-tab"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _obsidianTab = btn.dataset.tab || 'vault';
      if (_obsidianTab === 'skills' && !_obsidianSkills.length && !_obsidianSkillsLoading) {
        _loadObsidianSkills({ render: true });
      }
      if (_obsidianTab === 'preferences' && !_obsidianPrefsLoaded && !_obsidianPrefsLoading) {
        _loadObsidianPrefs({ render: true });
      }
      _renderObsidian();
    });
  });

  modal.querySelector('[data-action="obsidian-refresh"]')?.addEventListener('click', async () => {
    if (!_confirmDiscardObsidianChanges()) return;
    _clearObsidianDirty();
    await Promise.all([
      _loadObsidian(),
      _loadObsidianSkills({ render: false }),
      _loadObsidianPrefs({ render: false }),
    ]);
    _renderObsidian();
  });

  modal.querySelector('[data-action="obsidian-new-note"]')?.addEventListener('click', () => {
    if (!_confirmDiscardObsidianChanges()) return;
    _clearObsidianDirty();
    _noteDraft = _newNoteTemplate();
    _selectedNotePath = _noteDraft.path;
    _obsidianTab = 'vault';
    _renderObsidian();
  });

  modal.querySelector('[data-action="obsidian-sync-workspace"]')?.addEventListener('click', async () => {
    if (!_confirmDiscardObsidianChanges()) return;
    _clearObsidianDirty();
    await _syncWorkspaceToObsidian();
  });

  const searchInput = modal.querySelector('[data-action="obsidian-search"]');
  searchInput?.addEventListener('input', (event) => {
    _scheduleObsidianSearch(event.target.value || '');
  });
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  modal.querySelector('[data-action="obsidian-clear-search"]')?.addEventListener('click', () => {
    _obsidianQuery = '';
    _obsidianSearchResults = [];
    _obsidianSearchError = '';
    _obsidianSearching = false;
    window.clearTimeout(_obsidianSearchTimer);
    _renderObsidian();
  });

  modal.querySelector('[data-action="obsidian-skill-search"]')?.addEventListener('input', (event) => {
    _obsidianSkillQuery = event.target.value || '';
    _renderObsidian();
  });

  modal.querySelectorAll('.obsidian-skill-row').forEach((row) => {
    row.addEventListener('click', async () => {
      _selectedSkillName = row.dataset.skillName || '';
      const path = row.dataset.notePath || '';
      if (path && _noteByPath(path)) {
        _selectedNotePath = path;
        _noteDraft = null;
        _clearObsidianDirty();
        await _loadSelectedObsidianNote(path, { render: false });
      }
      _renderObsidian();
    });
  });

  modal.querySelector('[data-action="obsidian-open-skill-note"]')?.addEventListener('click', async (event) => {
    const path = event.currentTarget.dataset.notePath || '';
    if (!path) return;
    await openNotePath(path, { clearSearch: true, render: false });
    _obsidianTab = 'vault';
    _renderObsidian();
  });

  modal.querySelector('[data-action="obsidian-import-matt-pocock"]')?.addEventListener('click', async () => {
    if (_obsidianSkillImporting) return;
    _obsidianSkillImporting = true;
    _obsidianSkillImportError = '';
    _renderObsidian();
    try {
      const result = await _request('/api/skills/import/matt-pocock', {
        method: 'POST',
        body: JSON.stringify({
          buckets: ['engineering', 'productivity', 'misc'],
          status: 'published',
          update_existing: true,
        }),
      });
      _obsidianSkillImportResult = result;
      const counts = result.counts || {};
      uiModule.showToast?.(`Matt Pocock import: ${counts.created || 0} created, ${counts.updated || 0} updated, ${counts.skipped || 0} skipped`);
      await _loadObsidianSkills({ render: false });
      await _loadObsidian();
    } catch (err) {
      _obsidianSkillImportError = err.message || 'Could not import Matt Pocock skills';
      uiModule.showToast?.(`Matt Pocock import failed: ${_obsidianSkillImportError}`);
    } finally {
      _obsidianSkillImporting = false;
      _renderObsidian();
    }
  });

  modal.querySelector('[data-action="obsidian-refresh-skills"]')?.addEventListener('click', async () => {
    await _loadObsidianSkills({ render: false });
    await _loadObsidian();
  });

  modal.querySelector('[data-action="obsidian-refresh-preferences"]')?.addEventListener('click', async () => {
    await _loadObsidianPrefs({ render: true });
  });

  modal.querySelectorAll('.obsidian-note-row').forEach((row) => {
    row.addEventListener('click', async () => {
      await openNotePath(row.dataset.notePath || '');
    });
  });

  modal.querySelectorAll('[data-action="obsidian-open-note-path"], [data-action="obsidian-open-search-result"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await openNotePath(btn.dataset.notePath || '', { clearSearch: btn.dataset.action === 'obsidian-open-search-result' });
    });
  });

  const editor = modal.querySelector('[data-note-editor]');
  editor?.addEventListener('input', () => {
    const path = editor.querySelector('[name="path"]')?.value?.trim() || '';
    const content = editor.querySelector('[name="content"]')?.value ?? '';
    _obsidianDirty = true;
    _obsidianEditorDraft = {
      originalPath: _selectedNotePath || _noteDraft?.path || path,
      path,
      content,
    };
    const state = modal.querySelector('[data-obsidian-save-state]');
    if (state) {
      state.textContent = 'Unsaved';
      state.classList.add('is-dirty');
    }
    const status = modal.querySelector('.obsidian-command-status span:last-child');
    if (status) status.textContent = 'Unsaved edit';
  });

  editor?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await _saveObsidianNote(event.currentTarget);
  });

  modal.querySelector('[data-action="obsidian-delete-note"]')?.addEventListener('click', async () => {
    await _deleteObsidianNote();
  });

  modal.querySelectorAll('.obsidian-curation-card').forEach((card) => {
    const path = card.dataset.curationPath || '';
    card.querySelector('[data-action="obsidian-open-curation"]')?.addEventListener('click', async () => {
      await openNotePath(path);
    });
    card.querySelector('[data-action="obsidian-approve-curation"]')?.addEventListener('click', async () => {
      if (!_confirmDiscardObsidianChanges()) return;
      await _changeCurationStatus(path, 'approve');
    });
    card.querySelector('[data-action="obsidian-reject-curation"]')?.addEventListener('click', async () => {
      if (!_confirmDiscardObsidianChanges()) return;
      await _changeCurationStatus(path, 'reject');
    });
  });

  const describeNode = (id) => {
    if (!inspector) return;
    if (graph.mode === 'vault') {
      const note = noteMap.get(id);
      const node = nodeMap.get(id);
      if (!note) {
        inspector.innerHTML = `
          <strong>${_escape(node?.title || id.replace(/^missing:/, ''))}</strong>
          <span>Unresolved wikilink</span>
          <p>Create this note to close the graph edge.</p>`;
        return;
      }
      const outgoing = graph.edges.filter((edge) => edge.from === id).map((edge) => nodeMap.get(edge.to)?.title || edge.to);
      const incoming = graph.edges.filter((edge) => edge.to === id).map((edge) => nodeMap.get(edge.from)?.title || edge.from);
      inspector.innerHTML = `
        <strong>${_escape(note.title || note.path)}</strong>
        <span>${_escape(note.path)}</span>
        <p>${_escape((note.headings || []).map((heading) => heading.text).slice(0, 3).join(' / ') || 'Markdown vault note')}</p>
        <h4>Backlinks</h4>
        ${incoming.length ? `<ul>${incoming.map((name) => `<li>${_escape(name)}</li>`).join('')}</ul>` : '<em>No incoming links yet.</em>'}
        <h4>Outgoing links</h4>
        ${outgoing.length ? `<ul>${outgoing.map((name) => `<li>${_escape(name)}</li>`).join('')}</ul>` : '<em>No outgoing links yet.</em>'}`;
      return;
    }
    const item = itemMap.get(id);
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

  const selectNode = async (id, { openNote = true, renderNote = false } = {}) => {
    _selectedGraphNodeId = id || '';
    if (graph.mode === 'vault' && noteMap.has(id) && openNote) {
      await openNotePath(id, { render: renderNote });
      describeNode(id);
      return;
    }
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

  if (_selectedGraphNodeId && inspector) {
    describeNode(_selectedGraphNodeId);
  }

  const search = modal.querySelector('#obsidian-graph-search');
  search?.addEventListener('input', () => {
    _obsidianGraphQuery = search.value || '';
    const query = _obsidianGraphQuery.trim().toLowerCase();
    nodes.forEach((node) => {
      const item = itemMap.get(node.dataset.id);
      const note = noteMap.get(node.dataset.id);
      const haystack = `${node.dataset.title || ''} ${node.dataset.kind || ''} ${(item?.tags || note?.tags || []).join(' ')} ${item?.body || ''} ${(note?.headings || []).map((heading) => heading.text).join(' ')}`.toLowerCase();
      node.classList.toggle('is-muted', Boolean(query) && !haystack.includes(query));
    });
    _refreshObsidian3dGraphStyles();
  });

  modal.querySelector('#obsidian-graph-scope')?.addEventListener('change', (event) => {
    _obsidianGraphScope = event.target.value === 'local' ? 'local' : 'global';
    _renderObsidian();
  });

  modal.querySelector('#obsidian-graph-depth')?.addEventListener('input', (event) => {
    _obsidianGraphDepth = Math.max(1, Math.min(3, Number(event.target.value) || 2));
    if (_obsidianGraphScope === 'local') _renderObsidian();
  });

  modal.querySelector('#obsidian-graph-arrows')?.addEventListener('change', (event) => {
    _obsidianGraphArrows = Boolean(event.target.checked);
    modal.querySelector('.obsidian-graph-svg')?.classList.toggle('hide-arrows', !event.target.checked);
    _refreshObsidian3dGraphStyles();
  });

  modal.querySelector('[data-action="obsidian-graph-fit"]')?.addEventListener('click', () => {
    _resetObsidian3dCamera(700);
  });

  modal.querySelector('[data-action="obsidian-graph-retry"]')?.addEventListener('click', () => {
    _obsidianGraphError = '';
    _obsidianGraphScriptPromise = null;
    _renderObsidian();
  });

  _mountObsidian3dGraph(selectNode);
}

async function _saveObsidianNote(form) {
  const path = form?.querySelector('[name="path"]')?.value?.trim() || '';
  const content = form?.querySelector('[name="content"]')?.value ?? '';
  if (!path) {
    uiModule.showToast?.('Note path is required');
    return;
  }
  try {
    const note = await _request(`/api/obsidian/notes/${_noteUrl(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    _selectedNotePath = note.path;
    _obsidianNoteDetails[note.path] = note;
    _noteDraft = null;
    _clearObsidianDirty();
    uiModule.showToast?.('Obsidian note saved');
    await _loadObsidian();
  } catch (err) {
    uiModule.showToast?.(`Obsidian save failed: ${err.message}`);
  }
}

async function _deleteObsidianNote() {
  const note = _activeNote();
  if (!note?.path) return;
  if (_noteDraft) {
    _noteDraft = null;
    _clearObsidianDirty();
    _ensureSelectedNote();
    _renderObsidian();
    return;
  }
  if (!window.confirm(`Delete ${note.path}?`)) return;
  try {
    await _request(`/api/obsidian/notes/${_noteUrl(note.path)}`, { method: 'DELETE' });
    delete _obsidianNoteDetails[note.path];
    _selectedNotePath = '';
    _noteDraft = null;
    _clearObsidianDirty();
    uiModule.showToast?.('Obsidian note deleted');
    await _loadObsidian();
  } catch (err) {
    uiModule.showToast?.(`Obsidian delete failed: ${err.message}`);
  }
}

async function _syncWorkspaceToObsidian() {
  try {
    const result = await _request('/api/obsidian/workspace/sync', { method: 'POST' });
    uiModule.showToast?.(`Workspace synced: ${result.created || 0} created, ${result.updated || 0} updated, ${result.skipped || 0} skipped`);
    await _loadObsidian();
  } catch (err) {
    uiModule.showToast?.(`Workspace sync failed: ${err.message}`);
  }
}

async function _changeCurationStatus(path, action) {
  if (!path) return;
  try {
    const result = await _request(`/api/obsidian/curation/${action}`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    uiModule.showToast?.(`Knowledge ${action === 'approve' ? 'approved' : 'rejected'}: ${result.title || path}`);
    _selectedNotePath = result.path || '';
    _noteDraft = null;
    _clearObsidianDirty();
    await _loadObsidian();
  } catch (err) {
    uiModule.showToast?.(`Curation ${action} failed: ${err.message}`);
  }
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
    _requestOracleWorkspacePreviewStarted();
    await _request(`/api/workspace/preview/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/start`, { method: 'POST' });
    _requestOracleWorkspacePreviewReady();
    uiModule.showToast?.('Local preview started');
    await _load();
  } catch (err) {
    _requestOracleWorkspacePreviewFailed();
    uiModule.showToast?.(`Local preview failed: ${err.message}`);
    await _load();
  }
}

async function _stopLocalPreview(kind, id) {
  try {
    await _request(`/api/workspace/preview/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/stop`, { method: 'POST' });
    _requestOracleWorkspacePreviewStopped();
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

export function openObsidian(options = {}) {
  if (options?.tab) _obsidianTab = String(options.tab);
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
  if (!_obsidianState) _loadObsidian();
  if (!_obsidianSkills.length) _loadObsidianSkills({ render: true });
  if (!_obsidianPrefsLoaded) _loadObsidianPrefs({ render: true });
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
  window.addEventListener('resize', () => {
    window.clearTimeout(_surfaceResizeTimer);
    _surfaceResizeTimer = window.setTimeout(() => {
      _clampSurface(_modal(OBSIDIAN_MODAL_ID));
      _clampSurface(_modal(IDEA_LOOP_MODAL_ID));
      _renderOpenSurfaces();
    }, 120);
  });
}

const workspaceModule = { init, open, openObsidian, openIdeaLoop, refreshAndOpenIdeaLoop, close, closeObsidian, closeIdeaLoop };
export default workspaceModule;
