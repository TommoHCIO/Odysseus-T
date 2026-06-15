import { openWhatsAppLibrary, initWhatsAppLibrary } from './whatsappLibrary.js';

const API_BASE = window.location.origin;

let _initialized = false;
let _refreshTimer = null;
let _conversations = [];
let _accounts = [];

function _esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function _initials(name) {
  const parts = String(name || 'WA').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'WA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function _time(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  if (dt.toDateString() === now.toDateString()) {
    return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
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

function _ensureList() {
  const section = document.getElementById('whatsapp-section');
  if (!section) return null;
  let list = document.getElementById('whatsapp-sidebar-list');
  if (!list) {
    list = document.createElement('div');
    list.id = 'whatsapp-sidebar-list';
    list.className = 'whatsapp-sidebar-list';
    section.appendChild(list);
  }
  return list;
}

function _setDot(count) {
  const dot = document.getElementById('whatsapp-unread-dot');
  if (!dot) return;
  dot.style.display = count > 0 ? '' : 'none';
}

function _render() {
  const list = _ensureList();
  if (!list) return;

  const unread = _conversations.reduce((sum, c) => sum + Number(c.unread_count || 0), 0);
  _setDot(unread);

  const hasReadyAccount = _accounts.some(a => a.auth_state === 'connected' && a.setup_state === 'connected' && a.enabled !== false);
  if (!_accounts.length || !hasReadyAccount) {
    list.innerHTML = '<button type="button" class="whatsapp-sidebar-empty" data-wa-open-settings>Connect WhatsApp</button>';
    list.querySelector('[data-wa-open-settings]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.settingsModule?.openWhatsAppQrSetup) window.settingsModule.openWhatsAppQrSetup();
      else if (window.settingsModule?.open) window.settingsModule.open('integrations');
    });
    return;
  }

  const rows = _conversations.slice(0, 4);
  if (!rows.length) {
    list.innerHTML = '<button type="button" class="whatsapp-sidebar-empty" data-wa-new-chat>New WhatsApp chat</button>';
    list.querySelector('[data-wa-new-chat]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openWhatsAppLibrary({ compose: true });
    });
    return;
  }

  list.innerHTML = rows.map(c => {
    const blocked = c.send_blocked_by_opt_out ? '<span class="whatsapp-mini-flag danger" title="Opt-out blocked">stop</span>' : '';
    const failed = c.last_message_status && /fail|error/i.test(c.last_message_status)
      ? '<span class="whatsapp-mini-flag danger" title="Failed send">!</span>' : '';
    const unreadBadge = Number(c.unread_count || 0) > 0
      ? `<span class="whatsapp-sidebar-count">${Number(c.unread_count || 0)}</span>` : '';
    return `
      <button type="button" class="whatsapp-sidebar-row" data-conversation-id="${_esc(c.id)}">
        <span class="whatsapp-avatar">${_esc(_initials(c.title))}</span>
        <span class="whatsapp-sidebar-main">
          <span class="whatsapp-sidebar-title">${_esc(c.title || c.wa_id)}</span>
          <span class="whatsapp-sidebar-preview">${_esc(_conversationPreview(c))}</span>
        </span>
        <span class="whatsapp-sidebar-side">
          <span>${_esc(_time(c.last_message_at || c.updated_at || c.created_at))}</span>
          <span>${blocked}${failed}${unreadBadge}</span>
        </span>
      </button>`;
  }).join('');

  list.querySelectorAll('[data-conversation-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      openWhatsAppLibrary({ conversationId: row.dataset.conversationId });
    });
  });
}

async function _refresh() {
  try {
    const [accountsRes, convRes] = await Promise.all([
      fetch(`${API_BASE}/api/whatsapp/accounts`, { credentials: 'same-origin' }),
      fetch(`${API_BASE}/api/whatsapp/conversations`, { credentials: 'same-origin' }),
    ]);
    const accountData = accountsRes.ok ? await accountsRes.json() : { accounts: [] };
    const convData = convRes.ok ? await convRes.json() : { conversations: [] };
    _accounts = accountData.accounts || [];
    _conversations = convData.conversations || [];
    _render();
  } catch (e) {
    console.warn('[whatsapp] sidebar refresh failed', e);
  }
}

export function refreshWhatsAppInbox() {
  return _refresh();
}

export function init() {
  if (_initialized) return;
  _initialized = true;
  initWhatsAppLibrary({ onChange: refreshWhatsAppInbox });

  const section = document.getElementById('whatsapp-section');
  const header = section?.querySelector('.section-header-flex');
  header?.addEventListener('click', (e) => {
    if (e.target.closest('#whatsapp-new-chat-btn')) return;
    openWhatsAppLibrary();
  });
  document.getElementById('whatsapp-new-chat-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openWhatsAppLibrary({ compose: true });
  });

  _refresh();
  _refreshTimer = setInterval(_refresh, 60000);
}

export function destroy() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = null;
  _initialized = false;
}
