import { showToast, showError } from './ui.js';

const API_BASE = window.location.origin;

let _initialized = false;
let _onChange = null;
let _accounts = [];
let _conversations = [];
let _messages = [];
let _calls = [];
let _accountCalls = [];
let _syncStatus = null;
let _accountId = '';
let _conversationId = '';
let _filter = 'all';
let _search = '';
let _lastSummary = '';

function _esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function _time(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function _timestampMs(...values) {
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

function _messageTime(m) {
  return _timestampMs(m?.sent_at, m?.received_at, m?.created_at, m?.updated_at);
}

function _conversationPreview(c) {
  if (c?.last_message_preview) return c.last_message_preview;
  const raw = c?.wa_id || '';
  if (raw.endsWith('@s.whatsapp.net')) {
    const phone = `+${raw.split('@', 1)[0]}`;
    return c?.title && c.title !== phone ? phone : '';
  }
  if (raw.endsWith('@g.us')) return c?.title && c.title !== 'WhatsApp group' ? 'Group conversation' : '';
  return '';
}

function _apiUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function _formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function _mediaKind(media) {
  return String(media?.media_type || '').toLowerCase();
}

function _mediaLabel(media) {
  const kind = _mediaKind(media);
  if (kind === 'image') return 'Photo';
  if (kind === 'video') return 'Video';
  if (kind === 'audio') return 'Audio';
  if (kind === 'voice') return 'Voice note';
  if (kind === 'document') return 'Document';
  if (kind === 'sticker') return 'Sticker';
  return 'Attachment';
}

function _isImageMedia(media) {
  return _mediaKind(media) === 'image' || String(media?.mime_type || '').startsWith('image/');
}

function _mediaStatus(media) {
  if (!media) return '';
  if (media.download_status) return media.download_status;
  return media.file_url ? 'downloaded' : 'pending';
}

function _mediaStatusLabel(status, hasFile, hasPreview) {
  const raw = String(status || '').toLowerCase();
  if (hasFile) return 'Downloaded';
  if (/downloading/.test(raw)) return 'Downloading';
  if (/queued/.test(raw)) return 'Queued';
  if (/fail|error/.test(raw)) return 'Failed';
  if (hasPreview) return 'Preview only';
  return raw || 'Pending';
}

function _mediaOpenUrl(media) {
  return _apiUrl(media?.file_url || media?.thumbnail_url || media?.thumbnail_data_url || '');
}

function _mediaPreviewHtml(m) {
  const media = m?.media || null;
  if (!media && !m?.media_id) return '';
  const mediaId = media?.id || m.media_id;
  const status = _mediaStatus(media);
  const label = _mediaLabel(media);
  const fileUrl = _apiUrl(media?.file_url || '');
  const thumbUrl = _apiUrl(media?.thumbnail_url || media?.thumbnail_data_url || media?.file_url || '');
  const isImage = _isImageMedia(media);
  const title = media?.filename || label;
  const size = _formatBytes(media?.file_size);
  const hasFile = !!fileUrl && /downloaded/i.test(status);
  const hasPreview = !!thumbUrl && isImage;
  const statusClass = hasFile || /sent|received/i.test(status) ? 'ready' : /fail|error/i.test(status) ? 'failed' : 'pending';
  const previewOnly = hasPreview && !hasFile;
  const statusLabel = _mediaStatusLabel(status, hasFile, hasPreview);
  const preview = isImage && thumbUrl
    ? `<button type="button" class="whatsapp-media-thumb image ${previewOnly ? 'preview-only' : ''}" data-wa-media-action="open" data-media-id="${_esc(mediaId)}" title="${previewOnly ? 'Preview image' : 'Open image'}">
        <img src="${_esc(thumbUrl)}" alt="${_esc(title)}">
        ${previewOnly ? `<span class="whatsapp-media-preview-badge">${_esc(label)}</span>` : ''}
      </button>`
    : `<div class="whatsapp-media-thumb placeholder ${previewOnly ? 'preview-only' : ''}" aria-hidden="true">
        <span>${_esc(label.slice(0, 3).toUpperCase())}</span>
      </div>`;
  const openUrl = _mediaOpenUrl(media);
  const downloadButton = !fileUrl || !/downloaded/i.test(status)
    ? `<button type="button" class="primary" data-wa-media-action="download" data-media-id="${_esc(mediaId)}">${previewOnly ? 'Download full' : 'Download'}</button>`
    : '';
  const openButton = openUrl
    ? `<button type="button" data-wa-media-action="open" data-media-id="${_esc(mediaId)}">${previewOnly ? 'Preview' : 'Open'}</button>`
    : '';
  const keepLabel = media?.keep_forever || media?.saved ? 'Kept' : 'Keep';
  return `
    <div class="whatsapp-media-card ${isImage ? 'image' : 'file'} ${previewOnly ? 'preview-only' : ''} ${media?.keep_forever || media?.saved ? 'saved' : ''} ${_esc(statusClass)}">
      ${preview}
      <div class="whatsapp-media-info">
        <div class="whatsapp-media-title">${_esc(title)}</div>
        <div class="whatsapp-media-sub">
          <span>${_esc(label)}</span>
          ${size ? `<span>${_esc(size)}</span>` : ''}
          <span class="whatsapp-media-status">${_esc(statusLabel)}</span>
          ${media?.keep_forever || media?.saved ? '<span class="whatsapp-media-keep">kept</span>' : ''}
        </div>
        <div class="whatsapp-media-actions">
          ${openButton}
          ${downloadButton}
          <button type="button" data-wa-media-action="save" data-media-id="${_esc(mediaId)}">${keepLabel}</button>
        </div>
      </div>
    </div>`;
}

function _callTime(c) {
  return _timestampMs(c?.started_at, c?.created_at, c?.ended_at, c?.updated_at);
}

function _chronological(a, b) {
  const diff = a.time - b.time;
  if (diff) return diff;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function _initials(name) {
  const parts = String(name || 'WA').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'WA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function _activeAccount() {
  return _accounts.find(a => a.id === _accountId) || _accounts[0] || null;
}

function _activeConversation() {
  return _conversations.find(c => c.id === _conversationId) || null;
}

function _conversationForCall(call) {
  return _conversations.find(c => c.id === call.conversation_id) || null;
}

function _accountReady(account) {
  return !!account && account.auth_state === 'connected' && account.setup_state === 'connected' && account.enabled !== false;
}

function _sendBlockedReason() {
  const account = _activeAccount();
  const convo = _activeConversation();
  if (!account) return 'Connect a WhatsApp account first.';
  if (!convo) return 'Select a conversation first.';
  if (convo.send_blocked_by_opt_out) return 'This conversation is blocked by opt-out.';
  if (!_accountReady(account)) return 'WhatsApp setup is not connected.';
  return '';
}

function _ensureModal() {
  let modal = document.getElementById('whatsapp-lib-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'whatsapp-lib-modal';
  modal.className = 'modal hidden whatsapp-modal';
  modal.innerHTML = `
    <div class="modal-content whatsapp-modal-content" role="dialog" aria-label="WhatsApp">
      <div class="modal-header whatsapp-modal-header">
        <h4>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.8 8.8 0 0 1-4.1-1l-4.4 1 1.2-4.1a8.3 8.3 0 0 1-1.2-4.4 8.5 8.5 0 0 1 17 0Z"/><path d="M9.2 8.8c.2 2.9 2.1 4.9 5 5.7l1.4-1.3"/></svg>
          WhatsApp
        </h4>
        <div class="whatsapp-header-actions">
          <button type="button" class="memory-toolbar-btn" id="wa-refresh-btn" title="Refresh">Refresh</button>
          <button type="button" class="close-btn" id="wa-close-btn" aria-label="Close">&times;</button>
        </div>
      </div>
      <div class="whatsapp-toolbar">
        <select id="wa-account-select" class="settings-select" aria-label="WhatsApp account"></select>
        <input id="wa-search" class="settings-input" placeholder="Search chats, phone numbers, messages">
        <select id="wa-filter" class="settings-select" aria-label="WhatsApp filter">
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="archived">Archived</option>
          <option value="muted">Muted</option>
          <option value="needs_reply">Needs reply</option>
          <option value="failed">Failed sends</option>
          <option value="blocked">Opt-out blocked</option>
          <option value="calls">Calls</option>
        </select>
        <button type="button" class="admin-btn-sm" id="wa-new-chat-main">New Chat</button>
      </div>
      <div id="wa-account-status" class="whatsapp-account-status"></div>
      <div class="whatsapp-grid">
        <aside class="whatsapp-conversations" id="wa-conversation-list"></aside>
        <main class="whatsapp-thread">
          <div id="wa-thread-header" class="whatsapp-thread-header"></div>
          <div id="wa-thread-body" class="whatsapp-thread-body"></div>
          <div id="wa-thread-summary" class="whatsapp-thread-summary hidden"></div>
          <div id="wa-composer-wrap" class="whatsapp-composer">
            <textarea id="wa-compose-text" class="settings-input" rows="3" placeholder="Write a WhatsApp reply"></textarea>
            <div class="whatsapp-composer-actions">
              <span id="wa-send-blocker" class="whatsapp-send-blocker"></span>
              <button type="button" class="admin-btn-sm" id="wa-ai-draft-btn">AI Draft</button>
              <button type="button" class="admin-btn-sm" id="wa-save-draft-btn">Save Draft</button>
              <button type="button" class="admin-btn-sm primary" id="wa-send-btn">Send</button>
            </div>
          </div>
        </main>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener('mousedown', e => {
    if (e.target === modal) closeWhatsAppLibrary();
  });
  document.getElementById('wa-close-btn')?.addEventListener('click', closeWhatsAppLibrary);
  document.getElementById('wa-refresh-btn')?.addEventListener('click', () => _loadAll({ keepSelection: true }));
  document.getElementById('wa-account-select')?.addEventListener('change', e => {
    _accountId = e.target.value;
    _conversationId = '';
    _loadAll();
  });
  document.getElementById('wa-search')?.addEventListener('input', e => {
    _search = e.target.value.trim();
    _renderConversations();
  });
  document.getElementById('wa-filter')?.addEventListener('change', e => {
    _filter = e.target.value;
    if (_filter === 'calls') {
      _loadAccountCalls().then(() => _renderConversations()).catch(err => showError(err.message || 'Call records failed to load'));
      return;
    }
    _renderConversations();
  });
  document.getElementById('wa-new-chat-main')?.addEventListener('click', () => _newChat());
  document.getElementById('wa-ai-draft-btn')?.addEventListener('click', () => _aiDraft());
  document.getElementById('wa-save-draft-btn')?.addEventListener('click', () => _send(false));
  document.getElementById('wa-send-btn')?.addEventListener('click', () => _send(true));
  return modal;
}

function _ensureMediaViewer() {
  let viewer = document.getElementById('wa-media-viewer');
  if (viewer) return viewer;
  viewer = document.createElement('div');
  viewer.id = 'wa-media-viewer';
  viewer.className = 'whatsapp-media-viewer hidden';
  viewer.innerHTML = `
    <div class="whatsapp-media-viewer-surface" role="dialog" aria-label="WhatsApp media preview">
      <div class="whatsapp-media-viewer-topbar">
        <span id="wa-media-viewer-title"></span>
        <div class="whatsapp-media-viewer-actions">
          <a id="wa-media-viewer-download" href="#" download>Download</a>
          <button type="button" id="wa-media-viewer-close" aria-label="Close">&times;</button>
        </div>
      </div>
      <div class="whatsapp-media-viewer-stage">
        <img id="wa-media-viewer-img" alt="">
      </div>
    </div>`;
  document.body.appendChild(viewer);
  viewer.addEventListener('mousedown', e => {
    if (e.target === viewer) viewer.classList.add('hidden');
  });
  viewer.querySelector('#wa-media-viewer-close')?.addEventListener('click', () => viewer.classList.add('hidden'));
  return viewer;
}

function _openMedia(media) {
  const url = _mediaOpenUrl(media);
  if (!url) {
    showError('Download this media before opening it.');
    return;
  }
  if (!_isImageMedia(media)) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const viewer = _ensureMediaViewer();
  const title = media?.filename || _mediaLabel(media);
  const img = viewer.querySelector('#wa-media-viewer-img');
  const titleEl = viewer.querySelector('#wa-media-viewer-title');
  const download = viewer.querySelector('#wa-media-viewer-download');
  if (img) {
    img.src = url;
    img.alt = title;
  }
  if (titleEl) titleEl.textContent = title;
  if (download) {
    const fileUrl = _apiUrl(media?.file_url || '');
    download.classList.toggle('hidden', !fileUrl);
    download.href = fileUrl || '#';
  }
  viewer.classList.remove('hidden');
}

function _replaceMedia(updated) {
  if (!updated?.id) return;
  _messages = _messages.map(m => {
    if (m.media?.id !== updated.id && m.media_id !== updated.id) return m;
    return { ...m, media_id: updated.id, media: updated };
  });
}

function _renderAccountStatus() {
  const el = document.getElementById('wa-account-status');
  if (!el) return;
  const openQrSetup = () => {
    if (window.settingsModule?.openWhatsAppQrSetup) window.settingsModule.openWhatsAppQrSetup();
    else window.settingsModule?.open?.('integrations');
  };
  const account = _activeAccount();
  if (!account) {
    el.innerHTML = `
      <div class="whatsapp-status-row">
        <span>No WhatsApp account configured.</span>
        <button type="button" class="admin-btn-sm" data-wa-settings>Connect WhatsApp</button>
      </div>`;
    el.querySelector('[data-wa-settings]')?.addEventListener('click', openQrSetup);
    return;
  }
  const ready = _accountReady(account);
  const caps = account.capabilities || {};
  const bridge = caps.host_bridge_available ? 'Bridge online' : 'Bridge required';
  const diagnostics = account.diagnostics || {};
  const sync = _syncStatus || diagnostics.whatsapp_sync || {};
  const syncText = sync.status
    ? `${sync.status} - ${sync.phase || 'available history'}`
    : ready
      ? (/chats\.upsert|message\.upsert/.test(String(diagnostics.last_event || '')) ? 'Chats updated' : 'Sync not started')
      : account.auth_state === 'qr_pending' || account.auth_state === 'connecting'
        ? 'Scan QR to finish linking'
        : 'Setup needed';
  const syncCounts = sync.status
    ? `<span class="whatsapp-sync-counts">${Number(sync.chats_normalized || 0)} chats - ${Number(sync.messages_processed || 0)} messages - ${Number(sync.media_queued || 0)} media</span>`
    : '';
  const syncError = sync.last_error ? `<span class="whatsapp-sync-error">${_esc(sync.last_error)}</span>` : '';
  el.innerHTML = `
    <div class="whatsapp-status-row ${ready ? 'ready' : 'blocked'}">
      <span><strong>${_esc(account.name)}</strong> - ${_esc(account.transport)} - ${_esc(account.auth_state)} / ${_esc(account.setup_state)} - ${_esc(syncText)}${syncCounts}${syncError}</span>
      <span>${_esc(bridge)}</span>
      <button type="button" class="admin-btn-sm" data-wa-sync ${ready ? '' : 'disabled'}>Sync Chats</button>
      <button type="button" class="admin-btn-sm" data-wa-settings>${ready ? 'Settings' : 'Connect WhatsApp'}</button>
    </div>`;
  el.querySelector('[data-wa-settings]')?.addEventListener('click', openQrSetup);
  el.querySelector('[data-wa-sync]')?.addEventListener('click', () => _startSync());
}

function _renderAccounts() {
  const select = document.getElementById('wa-account-select');
  if (!select) return;
  select.innerHTML = _accounts.map(a =>
    `<option value="${_esc(a.id)}">${_esc(a.name)}${a.is_default ? ' (default)' : ''}</option>`
  ).join('');
  if (_accountId && _accounts.some(a => a.id === _accountId)) select.value = _accountId;
}

function _filteredConversations() {
  const term = _search.toLowerCase();
  return _conversations.filter(c => {
    if (_filter === 'calls') return false;
    if (_filter === 'unread' && !(Number(c.unread_count || 0) > 0)) return false;
    if (_filter === 'archived' && !c.is_archived) return false;
    if (_filter === 'muted' && !c.is_muted) return false;
    if (_filter === 'needs_reply' && !c.needs_reply) return false;
    if (_filter === 'failed' && !/fail|error/i.test(c.last_message_status || '')) return false;
    if (_filter === 'blocked' && !c.send_blocked_by_opt_out) return false;
    if (term) {
      const haystack = `${c.title || ''} ${c.wa_id || ''} ${c.last_message_preview || ''}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

function _filteredCalls() {
  const term = _search.toLowerCase();
  return _accountCalls.filter(call => {
    if (!term) return true;
    const convo = _conversationForCall(call);
    const haystack = [
      convo?.title,
      convo?.wa_id,
      call.call_type,
      call.direction,
      call.state,
      call.handled_by,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(term);
  });
}

function _renderCallRecords(list) {
  const rows = _filteredCalls();
  if (!rows.length) {
    list.innerHTML = '<div class="whatsapp-empty">No call records match this view.</div>';
    return;
  }
  list.innerHTML = rows.map(call => {
    const convo = _conversationForCall(call);
    const title = convo?.title || call.conversation_id || 'WhatsApp call';
    const active = call.conversation_id && call.conversation_id === _conversationId ? ' active' : '';
    const badges = [call.direction, call.call_type, call.state].filter(Boolean).map(b => `<span>${_esc(b)}</span>`).join('');
    return `
      <button type="button" class="whatsapp-conversation-row${active}" data-conversation-id="${_esc(call.conversation_id || '')}">
        <span class="whatsapp-avatar">${_esc(_initials(title))}</span>
        <span class="whatsapp-conversation-main">
          <span class="whatsapp-conversation-title">${_esc(title)}</span>
          <span class="whatsapp-conversation-preview">${_esc(call.handled_by || 'Call record')}</span>
          <span class="whatsapp-conversation-badges">${badges}</span>
        </span>
        <span class="whatsapp-conversation-time">${_esc(_time(call.started_at || call.created_at))}</span>
      </button>`;
  }).join('');
  list.querySelectorAll('[data-conversation-id]').forEach(row => {
    row.addEventListener('click', () => {
      if (row.dataset.conversationId) _selectConversation(row.dataset.conversationId);
    });
  });
}

function _renderConversations() {
  const list = document.getElementById('wa-conversation-list');
  if (!list) return;
  if (_filter === 'calls') {
    _renderCallRecords(list);
    return;
  }
  const rows = _filteredConversations();
  if (!rows.length) {
    list.innerHTML = '<div class="whatsapp-empty">No conversations match this view.</div>';
    return;
  }
  list.innerHTML = rows.map(c => {
    const active = c.id === _conversationId ? ' active' : '';
    const badges = [
      c.conversation_type === 'group' ? 'group' : '',
      Number(c.unread_count || 0) > 0 ? `${Number(c.unread_count)} unread` : '',
      c.send_blocked_by_opt_out ? 'blocked' : '',
      /fail|error/i.test(c.last_message_status || '') ? 'failed' : '',
    ].filter(Boolean).map(b => `<span>${_esc(b)}</span>`).join('');
    return `
      <button type="button" class="whatsapp-conversation-row${active}" data-conversation-id="${_esc(c.id)}">
        <span class="whatsapp-avatar">${_esc(_initials(c.title))}</span>
        <span class="whatsapp-conversation-main">
          <span class="whatsapp-conversation-title">${_esc(c.title || c.wa_id)}</span>
          <span class="whatsapp-conversation-preview">${_esc(_conversationPreview(c))}</span>
          <span class="whatsapp-conversation-badges">${badges}</span>
        </span>
        <span class="whatsapp-conversation-time">${_esc(_time(c.last_message_at || c.updated_at || c.created_at))}</span>
      </button>`;
  }).join('');
  list.querySelectorAll('[data-conversation-id]').forEach(row => {
    row.addEventListener('click', () => _selectConversation(row.dataset.conversationId));
  });
}

function _renderThreadHeader() {
  const header = document.getElementById('wa-thread-header');
  if (!header) return;
  const convo = _activeConversation();
  if (!convo) {
    header.innerHTML = '<div class="whatsapp-empty">Select a WhatsApp conversation.</div>';
    return;
  }
  header.innerHTML = `
    <div class="whatsapp-thread-title">
      <span class="whatsapp-avatar">${_esc(_initials(convo.title))}</span>
      <span><strong>${_esc(convo.title || convo.wa_id)}</strong><small>${_esc(convo.wa_id || '')}</small></span>
    </div>
    <div class="whatsapp-thread-actions">
      <button type="button" class="admin-btn-sm" data-action="rename">Rename</button>
      <button type="button" class="admin-btn-sm" data-action="summary">Summarize</button>
      <button type="button" class="admin-btn-sm" data-action="read">Mark Read</button>
      <button type="button" class="admin-btn-sm" data-action="archive">Archive</button>
      <button type="button" class="admin-btn-sm" data-action="voice">Voice</button>
      <button type="button" class="admin-btn-sm" data-action="video">Video</button>
    </div>`;
  header.querySelector('[data-action="rename"]')?.addEventListener('click', () => _renameConversation());
  header.querySelector('[data-action="summary"]')?.addEventListener('click', () => _summarize());
  header.querySelector('[data-action="read"]')?.addEventListener('click', () => _conversationAction('mark-read'));
  header.querySelector('[data-action="archive"]')?.addEventListener('click', () => _conversationAction('archive'));
  header.querySelector('[data-action="voice"]')?.addEventListener('click', () => _startCall('voice'));
  header.querySelector('[data-action="video"]')?.addEventListener('click', () => _startCall('video'));
}

function _messageHtml(m) {
  const deleted = !!m.deleted_at;
  const body = deleted ? 'Message deleted' : (m.body || '');
  const media = deleted ? '' : _mediaPreviewHtml(m);
  const reaction = m.reaction_emoji ? `<span class="whatsapp-message-reaction">${_esc(m.reaction_emoji)}</span>` : '';
  const actions = deleted ? '' : `
    <span class="whatsapp-message-actions">
      <button type="button" data-msg-action="react" data-message-id="${_esc(m.id)}">React</button>
      ${m.direction === 'outbound' ? `<button type="button" data-msg-action="edit" data-message-id="${_esc(m.id)}">Edit</button>` : ''}
      <button type="button" data-msg-action="reply" data-message-id="${_esc(m.id)}">Reply</button>
      <button type="button" data-msg-action="reminder" data-message-id="${_esc(m.id)}">Reminder</button>
      <button type="button" data-msg-action="delete" data-message-id="${_esc(m.id)}">Delete</button>
    </span>`;
  return `
    <div class="whatsapp-message ${m.direction === 'outbound' ? 'outbound' : 'inbound'} ${deleted ? 'deleted' : ''}">
      <div class="whatsapp-message-meta">
        <span>${_esc(m.sender_display_name || (m.direction === 'outbound' ? 'You' : m.sender_wa_id || 'WhatsApp'))}</span>
        <span>${_esc(_time(m.sent_at || m.received_at || m.created_at))}</span>
        <span>${_esc(m.status || '')}</span>
      </div>
      ${media}
      ${body ? `<div class="whatsapp-message-body">${_esc(body)}</div>` : ''}
      ${reaction}${actions}
    </div>`;
}

function _callHtml(c) {
  return `
    <div class="whatsapp-call-row">
      <span>${_esc(c.direction)} ${_esc(c.call_type)}</span>
      <span>${_esc(c.state)}</span>
      <span>${_esc(_time(c.started_at || c.created_at))}</span>
    </div>`;
}

function _renderThread() {
  _renderThreadHeader();
  const body = document.getElementById('wa-thread-body');
  const summary = document.getElementById('wa-thread-summary');
  if (summary) {
    summary.classList.toggle('hidden', !_lastSummary);
    summary.textContent = _lastSummary;
  }
  if (!body) return;
  if (!_conversationId) {
    body.innerHTML = '<div class="whatsapp-empty">Choose a chat to read messages.</div>';
  } else if (!_messages.length && !_calls.length) {
    body.innerHTML = '<div class="whatsapp-empty">No messages stored for this conversation yet.</div>';
  } else {
    const timeline = [
      ..._messages.map(m => ({ type: 'message', id: m.id, time: _messageTime(m), html: _messageHtml(m) })),
      ..._calls.map(c => ({ type: 'call', id: c.id, time: _callTime(c), html: _callHtml(c) })),
    ].sort(_chronological);
    body.innerHTML = timeline.map(item => item.html).join('');
    body.scrollTop = body.scrollHeight;
  }
  _wireMessageActions(body);
  _syncComposer();
}

function _syncComposer() {
  const reason = _sendBlockedReason();
  const blocker = document.getElementById('wa-send-blocker');
  const sendBtn = document.getElementById('wa-send-btn');
  const draftBtn = document.getElementById('wa-save-draft-btn');
  if (blocker) blocker.textContent = reason;
  if (sendBtn) sendBtn.disabled = !!reason;
  if (draftBtn) draftBtn.disabled = !_activeConversation();
}

function _wireMessageActions(root) {
  root?.querySelectorAll?.('[data-msg-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.messageId;
      const action = btn.dataset.msgAction;
      if (action === 'react') {
        const emoji = window.prompt('Reaction emoji', '+1');
        if (!emoji) return;
        await _post(`/api/whatsapp/messages/${encodeURIComponent(id)}/react`, { emoji });
      } else if (action === 'edit') {
        const current = _messages.find(m => m.id === id)?.body || '';
        const text = window.prompt('Edit message', current);
        if (!text) return;
        await _post(`/api/whatsapp/messages/${encodeURIComponent(id)}/edit`, { text });
      } else if (action === 'reply') {
        const text = document.getElementById('wa-compose-text');
        if (text) {
          text.value = `> ${(_messages.find(m => m.id === id)?.body || '').slice(0, 80)}\n`;
          text.focus();
          text.dataset.quotedMessageId = id;
        }
      } else if (action === 'reminder') {
        await _post(`/api/whatsapp/messages/${encodeURIComponent(id)}/create-reminder`, { title: 'WhatsApp follow-up' });
        showToast('Reminder recorded');
      } else if (action === 'delete') {
        if (!window.confirm('Delete this WhatsApp message locally and queue provider delete where supported?')) return;
        await _post(`/api/whatsapp/messages/${encodeURIComponent(id)}/delete`, {});
      }
      await _selectConversation(_conversationId, { keepComposer: true });
      _onChange?.();
    });
  });
  root?.querySelectorAll?.('[data-wa-media-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.mediaId;
      const action = btn.dataset.waMediaAction;
      if (!id) return;
      const media = _messages.map(m => m.media).find(item => item && item.id === id) || null;
      try {
        if (action === 'open') {
          _openMedia(media);
          return;
        }
        if (action === 'download') {
          const res = await _post(`/api/whatsapp/media/${encodeURIComponent(id)}/download`, {});
          _replaceMedia(res.media);
          showToast(res.warning || (res.requires_bridge ? 'WhatsApp media queued for download' : 'WhatsApp media downloaded'));
          await _selectConversation(_conversationId, { keepComposer: true });
          _onChange?.();
          return;
        }
        if (action === 'save') {
          const res = await _post(`/api/whatsapp/media/${encodeURIComponent(id)}/save`, {});
          _replaceMedia(res.media);
          showToast('WhatsApp media marked to keep');
          await _selectConversation(_conversationId, { keepComposer: true });
          _onChange?.();
        }
      } catch (err) {
        showError(err.message || 'WhatsApp media action failed');
      }
    });
  });
}

async function _post(url, payload) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}

async function _loadAccounts() {
  const res = await fetch(`${API_BASE}/api/whatsapp/accounts`, { credentials: 'same-origin' });
  const data = res.ok ? await res.json() : { accounts: [] };
  _accounts = data.accounts || [];
  if (!_accountId || !_accounts.some(a => a.id === _accountId)) {
    _accountId = (_accounts.find(a => a.is_default) || _accounts[0] || {}).id || '';
  }
}

async function _loadConversations() {
  const qs = _accountId ? `?account_id=${encodeURIComponent(_accountId)}` : '';
  const res = await fetch(`${API_BASE}/api/whatsapp/conversations${qs}`, { credentials: 'same-origin' });
  const data = res.ok ? await res.json() : { conversations: [] };
  _conversations = data.conversations || [];
  if (_conversationId && !_conversations.some(c => c.id === _conversationId)) _conversationId = '';
}

async function _loadAccountCalls() {
  const qs = _accountId ? `?account_id=${encodeURIComponent(_accountId)}` : '';
  const res = await fetch(`${API_BASE}/api/whatsapp/calls${qs}`, { credentials: 'same-origin' });
  const data = res.ok ? await res.json() : { calls: [] };
  _accountCalls = data.calls || [];
}

async function _loadSyncStatus() {
  _syncStatus = null;
  if (!_accountId) return;
  const res = await fetch(`${API_BASE}/api/whatsapp/accounts/${encodeURIComponent(_accountId)}/sync`, { credentials: 'same-origin' });
  const data = res.ok ? await res.json() : {};
  _syncStatus = data.sync || null;
}

async function _loadMessages() {
  if (!_conversationId) {
    _messages = [];
    _calls = [];
    return;
  }
  const [msgRes, callRes] = await Promise.all([
    fetch(`${API_BASE}/api/whatsapp/conversations/${encodeURIComponent(_conversationId)}/messages`, { credentials: 'same-origin' }),
    fetch(`${API_BASE}/api/whatsapp/calls?conversation_id=${encodeURIComponent(_conversationId)}`, { credentials: 'same-origin' }),
  ]);
  const msgData = msgRes.ok ? await msgRes.json() : { messages: [] };
  const callData = callRes.ok ? await callRes.json() : { calls: [] };
  _messages = (msgData.messages || [])
    .slice()
    .sort((a, b) => _messageTime(a) - _messageTime(b) || String(a.id || '').localeCompare(String(b.id || '')));
  _calls = (callData.calls || [])
    .slice()
    .sort((a, b) => _callTime(a) - _callTime(b) || String(a.id || '').localeCompare(String(b.id || '')));
}

async function _loadAll(opts = {}) {
  try {
    await _loadAccounts();
    _renderAccounts();
    await Promise.all([
      _loadConversations(),
      _loadAccountCalls(),
      _loadSyncStatus(),
    ]);
    if (!opts.keepSelection && !_conversationId && _conversations.length) _conversationId = _conversations[0].id;
    await _loadMessages();
    _renderAccountStatus();
    _renderConversations();
    _renderThread();
  } catch (e) {
    console.error('[whatsapp] load failed', e);
    showError(`WhatsApp load failed: ${e.message}`);
  }
}

async function _selectConversation(id, opts = {}) {
  _conversationId = id || '';
  _lastSummary = '';
  if (!opts.keepComposer) {
    const text = document.getElementById('wa-compose-text');
    if (text) {
      text.value = '';
      delete text.dataset.quotedMessageId;
    }
  }
  await _loadMessages();
  _renderConversations();
  _renderThread();
}

async function _newChat() {
  const account = _activeAccount();
  if (!account) {
    window.settingsModule?.open?.('integrations');
    return;
  }
  const waId = window.prompt('Phone number or WhatsApp ID (for example +15551234567)');
  if (!waId) return;
  const name = window.prompt('Display name', waId) || waId;
  const res = await _post('/api/whatsapp/conversations', {
    account_id: account.id,
    wa_id: waId.trim(),
    conversation_type: 'direct',
    profile_name: name.trim(),
  });
  _conversationId = res.conversation.id;
  await _loadAll({ keepSelection: true });
  _onChange?.();
}

async function _send(confirmed) {
  const convo = _activeConversation();
  if (!convo) return;
  const textEl = document.getElementById('wa-compose-text');
  const text = textEl?.value.trim() || '';
  if (!text) return;
  if (confirmed) {
    const reason = _sendBlockedReason();
    if (reason) {
      showError(reason);
      return;
    }
  }
  try {
    await _post(`/api/whatsapp/conversations/${encodeURIComponent(convo.id)}/send`, {
      text,
      confirmed: !!confirmed,
      actor: confirmed ? 'user' : 'ai',
      capability: confirmed ? 'send_whatsapp' : 'draft_whatsapp',
      quoted_message_id: textEl?.dataset.quotedMessageId || null,
    });
    if (textEl) {
      textEl.value = '';
      delete textEl.dataset.quotedMessageId;
    }
    showToast(confirmed ? 'WhatsApp send recorded' : 'WhatsApp draft saved');
    await _loadAll({ keepSelection: true });
    _onChange?.();
  } catch (e) {
    showError(e.message || 'WhatsApp send failed');
  }
}

async function _aiDraft() {
  const convo = _activeConversation();
  if (!convo) return;
  try {
    const res = await _post(`/api/whatsapp/conversations/${encodeURIComponent(convo.id)}/ai-reply`, {});
    const text = document.getElementById('wa-compose-text');
    if (text) {
      text.value = res.draft || '';
      text.focus();
    }
  } catch (e) {
    showError(e.message || 'AI draft failed');
  }
}

async function _summarize() {
  const convo = _activeConversation();
  if (!convo) return;
  try {
    const res = await _post(`/api/whatsapp/conversations/${encodeURIComponent(convo.id)}/summarize`, {});
    _lastSummary = res.summary || '';
    _renderThread();
  } catch (e) {
    showError(e.message || 'Summary failed');
  }
}

async function _conversationAction(action) {
  const convo = _activeConversation();
  if (!convo) return;
  try {
    await _post(`/api/whatsapp/conversations/${encodeURIComponent(convo.id)}/${action}`, {});
    await _loadAll({ keepSelection: true });
    _onChange?.();
  } catch (e) {
    showError(e.message || 'Conversation action failed');
  }
}

async function _renameConversation() {
  const convo = _activeConversation();
  if (!convo) return;
  const current = convo.profile_name || convo.group_name || (/^\+/.test(convo.title || '') ? '' : convo.title || '');
  const next = window.prompt('Conversation name', current);
  if (next === null) return;
  const name = next.trim();
  if (!name) return;
  try {
    const res = await fetch(`${API_BASE}/api/whatsapp/conversations/${encodeURIComponent(convo.id)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || 'Rename failed');
    showToast('WhatsApp conversation renamed');
    await _loadAll({ keepSelection: true });
    _onChange?.();
  } catch (e) {
    showError(e.message || 'Rename failed');
  }
}

async function _startSync() {
  const account = _activeAccount();
  if (!account) return;
  try {
    const res = await _post(`/api/whatsapp/accounts/${encodeURIComponent(account.id)}/sync`, { force: false });
    _syncStatus = res.sync || null;
    showToast('WhatsApp sync started');
    await _loadAll({ keepSelection: true });
    _onChange?.();
  } catch (e) {
    showError(e.message || 'WhatsApp sync failed');
    await _loadSyncStatus().catch(() => {});
    _renderAccountStatus();
  }
}

async function _startCall(callType) {
  const convo = _activeConversation();
  if (!convo) return;
  try {
    const res = await _post(`/api/whatsapp/conversations/${encodeURIComponent(convo.id)}/start-call`, { call_type: callType });
    if (res.call?.state === 'blocked_needs_bridge') {
      showError('Host WhatsApp bridge is required for calls.');
    } else {
      showToast('WhatsApp call launch recorded');
    }
    await _selectConversation(convo.id, { keepComposer: true });
  } catch (e) {
    showError(e.message || 'Call launch failed');
  }
}

export function initWhatsAppLibrary(config = {}) {
  if (_initialized) return;
  _initialized = true;
  _onChange = config.onChange || null;
  _ensureModal();
}

export async function openWhatsAppLibrary(opts = {}) {
  initWhatsAppLibrary();
  const modal = _ensureModal();
  modal.classList.remove('hidden');
  if (opts.conversationId) _conversationId = opts.conversationId;
  await _loadAll({ keepSelection: true });
  if (opts.compose) {
    await _newChat();
  }
}

export function closeWhatsAppLibrary() {
  document.getElementById('whatsapp-lib-modal')?.classList.add('hidden');
}

export function isOpen() {
  const modal = document.getElementById('whatsapp-lib-modal');
  return !!modal && !modal.classList.contains('hidden');
}
