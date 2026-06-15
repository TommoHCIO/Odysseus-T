#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.ODYSSEUS_WHATSAPP_BRIDGE_PORT || 8788);
const HOST = process.env.ODYSSEUS_WHATSAPP_BRIDGE_HOST || "0.0.0.0";
const TOKEN = process.env.ODYSSEUS_WHATSAPP_BRIDGE_TOKEN || "";
const DATA_ROOT = path.resolve(process.env.ODYSSEUS_WHATSAPP_DATA_ROOT || path.join(process.cwd(), "data", "whatsapp"));
const BACKEND_URL = (process.env.ODYSSEUS_WHATSAPP_BACKEND_URL || "").replace(/\/+$/, "");
const LOG_LEVEL = process.env.ODYSSEUS_WHATSAPP_BRIDGE_LOG_LEVEL || "warn";
const HISTORY_PAGE_SIZE = Math.min(50, Math.max(1, Number(process.env.ODYSSEUS_WHATSAPP_SYNC_PAGE_SIZE || 50)));
const MAX_SYNC_CHATS = Math.max(1, Number(process.env.ODYSSEUS_WHATSAPP_SYNC_MAX_CHATS || 500));
const MAX_SYNC_PAGES_PER_CHAT = Math.max(1, Number(process.env.ODYSSEUS_WHATSAPP_SYNC_MAX_PAGES_PER_CHAT || 100));
const SYNC_REQUEST_DELAY_MS = Math.max(0, Number(process.env.ODYSSEUS_WHATSAPP_SYNC_REQUEST_DELAY_MS || 350));
const SYNC_HISTORY_RESPONSE_TIMEOUT_MS = Math.max(5_000, Number(process.env.ODYSSEUS_WHATSAPP_SYNC_RESPONSE_TIMEOUT_MS || 45_000));
const BROWSER_BACKFILL_ENABLED = false;
const SYNC_FULL_HISTORY_ON_CONNECT = /^(1|true|yes|on)$/i.test(
  String(process.env.ODYSSEUS_WHATSAPP_SYNC_FULL_HISTORY_ON_CONNECT || "")
);

const originalConsoleInfo = console.info.bind(console);
console.info = (...args) => {
  if (args[0] === "Closing session:") {
    originalConsoleInfo("Closing Signal session");
    return;
  }
  originalConsoleInfo(...args);
};

const sessions = new Map();
let baileysModule = null;
let pinoFactory = null;

const JID_PATTERN = /\b[0-9A-Za-z._:-]+@(s\.whatsapp\.net|lid|g\.us|c\.us|broadcast|newsletter)\b/gi;
const REDACTED_JID = "[redacted-jid]";

function safePart(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96) || "default";
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function redactSensitiveText(value) {
  return String(value || "").replace(JID_PATTERN, REDACTED_JID);
}

function redactErrorForLog(error) {
  if (!error) return error;
  return {
    type: redactSensitiveText(error.type || error.name || "Error"),
    message: redactSensitiveText(error.message || String(error)),
    stack: redactSensitiveText(error.stack || "").slice(0, 2000),
    name: redactSensitiveText(error.name || "Error"),
    statusCode: error.statusCode || error.output?.statusCode,
  };
}

function bridgeLoggerOptions() {
  return {
    level: LOG_LEVEL,
    redact: {
      censor: "[redacted]",
      paths: [
        "key.remoteJid",
        "key.participant",
        "remoteJid",
        "jid",
        "id",
        "user.id",
        "payload.remote_jid",
        "payload.participant",
        "payload.provider_message_id",
        "payload.raw",
        "message.key.remoteJid",
        "message.key.participant",
        "message.key.id",
      ],
    },
    serializers: {
      err: redactErrorForLog,
      error: redactErrorForLog,
    },
  };
}

function shouldSyncFullHistoryOnConnect() {
  return SYNC_FULL_HISTORY_ON_CONNECT;
}

function sessionKey(owner, accountId) {
  return `${safePart(owner)}:${safePart(accountId)}`;
}

function sessionPaths(owner, accountId) {
  const base = path.join(DATA_ROOT, "sessions", safePart(owner), safePart(accountId));
  return {
    base,
    auth: path.join(base, "baileys-auth"),
    chromeProfile: path.join(DATA_ROOT, "chrome-profiles", safePart(owner), safePart(accountId)),
  };
}

async function loadBaileys() {
  if (!baileysModule) {
    baileysModule = await import("@whiskeysockets/baileys");
  }
  if (!pinoFactory) {
    const pino = await import("pino");
    pinoFactory = pino.default || pino;
  }
  return baileysModule;
}

async function loadPlaywright() {
  throw new Error("Browser backfill is disabled");
}

function nowIso() {
  return new Date().toISOString();
}

function newSyncJob(force) {
  const now = nowIso();
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    status: "running",
    phase: "waiting_for_linked_device_history",
    force: !!force,
    chats_discovered: 0,
    chats_normalized: 0,
    messages_processed: 0,
    media_queued: 0,
    failures: 0,
    elapsed_ms: 0,
    partial_history_caveat: "Only linked-device/cloud history made available by WhatsApp can be imported.",
    started_at: now,
    updated_at: now,
    last_error: null,
  };
}

function publicSyncJob(session) {
  const job = session?.syncJob || null;
  if (!job) {
    return {
      status: "idle",
      phase: "not_started",
      chats_discovered: 0,
      chats_normalized: 0,
      messages_processed: 0,
      media_queued: 0,
      failures: 0,
      elapsed_ms: 0,
      partial_history_caveat: "Only linked-device/cloud history made available by WhatsApp can be imported.",
      updated_at: null,
    };
  }
  return {
    ...job,
    elapsed_ms: Math.max(0, Date.now() - new Date(job.started_at).getTime()),
  };
}

async function postSyncProgress(session) {
  await postBackendEvent(session, "sync.progress", publicSyncJob(session));
}

function publicSessionState(session) {
  return {
    account_id: session.accountId,
    owner: session.owner,
    state: session.state,
    connected: session.state === "connected",
    qr: session.qr || null,
    qr_expires_at: session.qrExpiresAt || null,
    session_path: session.paths.auth,
    chrome_profile_path: session.paths.chromeProfile,
    user: session.user || null,
    last_error: session.lastError || null,
    last_event_at: session.lastEventAt || null,
    version: session.version || null,
    sync: publicSyncJob(session),
  };
}

function normalizeError(error) {
  if (!error) return "";
  const msg = error.message || String(error);
  return redactSensitiveText(msg).slice(0, 500);
}

function jidForTarget(target) {
  const raw = String(target || "").trim();
  if (!raw) throw new Error("Missing WhatsApp recipient");
  if (raw.includes("@")) return bareJid(raw);
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) throw new Error("WhatsApp recipient must include a phone number or JID");
  return `${digits}@s.whatsapp.net`;
}

function decodeJid(raw) {
  const value = String(raw || "").trim();
  const at = value.indexOf("@");
  if (at < 1) return null;
  const server = value.slice(at + 1).toLowerCase();
  const userPart = value.slice(0, at);
  const [userAgent] = userPart.split(":");
  const user = userAgent.split("_")[0];
  if (!user || !server) return null;
  return { user, server };
}

function bareJid(raw) {
  const decoded = decodeJid(raw);
  if (!decoded) return String(raw || "").trim();
  const server = decoded.server === "c.us" ? "s.whatsapp.net" : decoded.server;
  return `${decoded.user}@${server}`;
}

function phoneJidFrom(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) {
    const jid = bareJid(raw);
    return jid.endsWith("@s.whatsapp.net") ? jid : "";
  }
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

function collectOwnJids(session) {
  const phone = [];
  const lid = [];
  const sources = [
    session?.user,
    session?.sock?.user,
    session?.authState?.creds?.me,
  ].filter(Boolean);

  for (const source of sources) {
    for (const key of ["id", "jid", "wid"]) {
      const jid = bareJid(source[key]);
      if (jid.endsWith("@s.whatsapp.net")) phone.push(jid);
      if (jid.endsWith("@lid")) lid.push(jid);
    }
    for (const key of ["lid", "lidJid"]) {
      const jid = bareJid(source[key]);
      if (jid.endsWith("@lid")) lid.push(jid);
    }
    for (const key of ["phone", "phoneNumber"]) {
      const jid = phoneJidFrom(source[key]);
      if (jid) phone.push(jid);
    }
  }

  return {
    phone: Array.from(new Set(phone)),
    lid: Array.from(new Set(lid)),
  };
}

function resolveSendTarget(session, target) {
  const requested = jidForTarget(target);
  const decoded = decodeJid(requested);
  if (!decoded || decoded.server === "g.us" || decoded.server === "broadcast" || decoded.server === "newsletter") {
    return { jid: requested, requested_jid: requested, self_target: false };
  }

  const own = collectOwnJids(session);
  const ownUsers = new Set(
    [...own.phone, ...own.lid]
      .map((jid) => decodeJid(jid)?.user)
      .filter(Boolean)
  );
  if (ownUsers.has(decoded.user) && own.phone[0]) {
    return {
      jid: own.phone[0],
      requested_jid: requested,
      self_target: true,
      self_target_normalized: requested !== own.phone[0],
    };
  }
  return { jid: requested, requested_jid: requested, self_target: false };
}

function extractText(message) {
  if (!message) return "";
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.buttonsResponseMessage?.selectedDisplayText) return message.buttonsResponseMessage.selectedDisplayText;
  if (message.listResponseMessage?.title) return message.listResponseMessage.title;
  return "";
}

function mediaInfo(message) {
  if (!message) return null;
  const candidates = [
    ["image", message.imageMessage],
    ["video", message.videoMessage],
    ["audio", message.audioMessage],
    ["document", message.documentMessage],
    ["sticker", message.stickerMessage],
  ];
  const found = candidates.find(([, value]) => !!value);
  if (!found) return null;
  const [mediaType, value] = found;
  return {
    media_type: mediaType,
    mime_type: value.mimetype || "",
    filename: value.fileName || value.title || "",
    file_size: Number(value.fileLength || 0),
    sha256: value.fileSha256 ? Buffer.from(value.fileSha256).toString("hex") : "",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageTimestampNumber(message) {
  const raw = message?.messageTimestamp;
  if (!raw) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw?.toNumber === "function") return raw.toNumber();
  if (typeof raw?.toString === "function") return Number(raw.toString()) || 0;
  return Number(raw) || 0;
}

function cacheChat(session, chat) {
  const id = bareJid(chat?.id || chat?.jid || "");
  if (!id || id === "status@broadcast") return null;
  const existing = session.chats.get(id) || {};
  const merged = { ...existing, ...chat, id };
  const contact = session.contacts?.get(id) || session.contacts?.get(bareJid(chat?.jid || "")) || null;
  if (contact && !merged.name && !merged.subject) {
    merged.name = contact.name || contact.notify || contact.verifiedName || "";
  }
  session.chats.set(id, merged);
  return merged;
}

function cacheContact(session, contact) {
  const id = bareJid(contact?.id || contact?.jid || contact?.lid || "");
  if (!id || id === "status@broadcast") return null;
  const existing = session.contacts.get(id) || {};
  const merged = { ...existing, ...contact, id };
  session.contacts.set(id, merged);
  if (contact?.jid) session.contacts.set(bareJid(contact.jid), merged);
  if (contact?.lid) session.contacts.set(bareJid(contact.lid), merged);
  return merged;
}

function chatName(session, chat) {
  const id = bareJid(chat?.id || chat?.jid || "");
  const contact = session.contacts?.get(id) || null;
  return chat?.name || chat?.subject || chat?.notify || contact?.name || contact?.notify || contact?.verifiedName || "";
}

function cacheMessage(session, message) {
  const remoteJid = bareJid(message?.key?.remoteJid || "");
  if (!remoteJid || remoteJid === "status@broadcast") return null;
  if (!session.messagesByChat.has(remoteJid)) session.messagesByChat.set(remoteJid, new Map());
  const chatMessages = session.messagesByChat.get(remoteJid);
  const providerMessageId = message?.key?.id || `${remoteJid}:${messageTimestampNumber(message)}:${chatMessages.size}`;
  chatMessages.set(providerMessageId, message);
  cacheChat(session, {
    id: remoteJid,
    name: message?.pushName || "",
    conversationTimestamp: messageTimestampNumber(message),
  });
  return { remoteJid, providerMessageId };
}

function applySyncSeeds(session, seeds) {
  const items = Array.isArray(seeds) ? seeds : [];
  for (const seed of items) {
    const jid = bareJid(seed?.jid || seed?.wa_id || seed?.id || "");
    if (!jid || jid === "status@broadcast") continue;
    cacheChat(session, {
      id: jid,
      name: seed.name || seed.profile_name || seed.group_name || "",
      conversationTimestamp: Number(seed.timestamp || 0),
    });
    const oldest = seed.oldest_message || seed.oldestMessage || null;
    const key = oldest?.key || null;
    const messageId = key?.id || oldest?.provider_message_id || oldest?.providerMessageId || "";
    const timestamp = Number(oldest?.messageTimestamp || oldest?.timestamp || 0);
    if (messageId && timestamp > 0) {
      cacheMessage(session, {
        key: {
          remoteJid: bareJid(key?.remoteJid || jid),
          id: messageId,
          fromMe: !!key?.fromMe,
          participant: key?.participant || undefined,
        },
        messageTimestamp: timestamp,
        pushName: seed.name || "",
        message: null,
      });
    }
  }
  if (session.syncJob?.status === "running" && items.length) {
    session.syncJob.chats_discovered = Math.max(session.syncJob.chats_discovered, items.length);
    session.syncJob.chats_normalized = Math.max(session.syncJob.chats_normalized, items.length);
    session.syncJob.updated_at = nowIso();
  }
}

function oldestCachedMessage(session, jid) {
  const messages = Array.from(session.messagesByChat.get(bareJid(jid))?.values() || [])
    .filter((message) => message?.key?.id && messageTimestampNumber(message) > 0)
    .sort((a, b) => messageTimestampNumber(a) - messageTimestampNumber(b));
  return messages[0] || null;
}

async function postChats(session, chats, source, eventType = "chats.upsert") {
  const normalized = (chats || [])
    .map((chat) => cacheChat(session, chat))
    .filter(Boolean);
  if (session.syncJob?.status === "running") {
    session.syncJob.chats_discovered += normalized.length;
    session.syncJob.chats_normalized += normalized.filter((chat) => !!chat.id).length;
    session.syncJob.updated_at = nowIso();
  }
  await postBackendEvent(session, eventType, {
    source: source || "live",
    sync_backfill: source !== "live",
    chats: normalized.map((chat) => ({
      id: chat.id,
      name: chatName(session, chat),
      unread_count: chat.unreadCount || chat.unread_count || 0,
      timestamp: Number(chat.conversationTimestamp || chat.t || 0),
      archived: chat.archived,
      pinned: chat.pinned,
      muted: chat.muteEndTime || chat.mute,
      source,
    })),
  });
}

async function postContacts(session, contacts, source, eventType = "contacts.upsert") {
  const normalized = (contacts || [])
    .map((contact) => cacheContact(session, contact))
    .filter(Boolean);
  if (!normalized.length) return;
  await postBackendEvent(session, eventType, {
    source: source || "contacts",
    contacts: normalized.map((contact) => ({
      id: contact.id,
      jid: bareJid(contact.jid || ""),
      lid: bareJid(contact.lid || ""),
      name: contact.name || "",
      notify: contact.notify || "",
      verified_name: contact.verifiedName || "",
      img_url: contact.imgUrl || "",
    })),
  });
}

async function postMessage(session, message, options = {}) {
  const cached = cacheMessage(session, message);
  if (!cached) return;
  const { remoteJid, providerMessageId } = cached;
  const media = mediaInfo(message.message);
  if (providerMessageId && media) {
    session.mediaMessages.set(providerMessageId, { message, media });
    if (session.mediaMessages.size > 1000) {
      const firstKey = session.mediaMessages.keys().next().value;
      if (firstKey) session.mediaMessages.delete(firstKey);
    }
    if (session.syncJob?.status === "running") {
      session.syncJob.media_queued += 1;
    }
  }
  if (session.syncJob?.status === "running" && options.countProgress !== false) {
    session.syncJob.messages_processed += 1;
    session.syncJob.updated_at = nowIso();
  }
  await postBackendEvent(session, "message.upsert", {
    source: options.source || "live",
    sync_backfill: !!options.syncBackfill,
    provider_message_id: providerMessageId,
    remote_jid: remoteJid,
    from_me: !!message.key?.fromMe,
    participant: message.key?.participant || "",
    push_name: message.pushName || "",
    message_type: messageType(message.message),
    body: extractText(message.message),
    media,
    timestamp: messageTimestampNumber(message),
    raw: message,
  });
}

async function completeSyncIfIdle(session) {
  const job = session.syncJob;
  if (!job || job.status !== "running") return;
  if (
    session.syncLaunchComplete
    && !session.browserBackfillPending
    && !session.browserBackfillRunning
    && Number(session.syncPendingRequests || 0) <= 0
  ) {
    if (job.last_error) {
      job.status = "partial";
      job.phase = "history_request_timeout";
    } else {
      job.status = "completed";
      job.phase = "available_history_imported";
    }
    job.updated_at = nowIso();
    await postSyncProgress(session);
  }
}

async function requestMoreHistory(session, jid, pagesFetched) {
  const job = session.syncJob;
  if (!job || job.status !== "running") return false;
  if (pagesFetched >= MAX_SYNC_PAGES_PER_CHAT) return false;
  const oldest = oldestCachedMessage(session, jid);
  if (!oldest?.key?.id || !oldest?.key?.remoteJid) return false;
  if (typeof session.sock.fetchMessageHistory !== "function") return false;

  const requestId = await session.sock.fetchMessageHistory(
    HISTORY_PAGE_SIZE,
    oldest.key,
    messageTimestampNumber(oldest)
  );
  if (!requestId) return false;
  const requestKey = String(requestId);
  const timer = setTimeout(() => {
    const request = session.onDemandRequests.get(requestKey);
    if (!request) return;
    session.onDemandRequests.delete(requestKey);
    session.syncPendingRequests = Math.max(0, Number(session.syncPendingRequests || 0) - 1);
    if (session.syncJob?.status === "running") {
      session.syncJob.failures += 1;
      session.syncJob.last_error = "WhatsApp did not return on-demand history for one or more chats.";
      session.syncJob.updated_at = nowIso();
      postSyncProgress(session).finally(() => completeSyncIfIdle(session));
    }
  }, SYNC_HISTORY_RESPONSE_TIMEOUT_MS);
  if (typeof timer.unref === "function") timer.unref();
  session.onDemandRequests.set(requestKey, {
    jid: bareJid(jid),
    pagesFetched: pagesFetched + 1,
    timer,
  });
  session.syncPendingRequests = Number(session.syncPendingRequests || 0) + 1;
  job.phase = "requesting_on_demand_history";
  job.updated_at = nowIso();
  await postSyncProgress(session);
  return true;
}

async function runOnDemandBackfill(session) {
  if (session.syncLauncherRunning) return;
  session.syncLauncherRunning = true;
  session.syncLaunchComplete = false;
  try {
    const jids = Array.from(new Set([
      ...Array.from(session.chats.keys()),
      ...Array.from(session.messagesByChat.keys()),
    ]))
      .filter((jid) => jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid") || jid.endsWith("@g.us"))
      .slice(0, MAX_SYNC_CHATS);

    for (const jid of jids) {
      const job = session.syncJob;
      if (!job || job.status !== "running") break;
      try {
        await requestMoreHistory(session, jid, 0);
      } catch (error) {
        job.failures += 1;
        job.last_error = normalizeError(error);
        job.updated_at = nowIso();
        await postSyncProgress(session);
      }
      if (SYNC_REQUEST_DELAY_MS) await sleep(SYNC_REQUEST_DELAY_MS);
    }
  } finally {
    session.syncLaunchComplete = true;
    session.syncLauncherRunning = false;
    await completeSyncIfIdle(session);
  }
}

async function handleHistorySet(session, event) {
  const job = session.syncJob;
  if (job?.status === "running") {
    job.phase = "processing_history_sync";
    if (event.progress !== null && event.progress !== undefined) {
      job.provider_progress = Number(event.progress) || 0;
    }
    job.updated_at = nowIso();
  }

  await postContacts(session, event.contacts || [], "history_sync", "contacts.upsert");
  await postChats(session, event.chats || [], "history_sync");
  const messages = (event.messages || [])
    .slice()
    .sort((a, b) => messageTimestampNumber(a) - messageTimestampNumber(b));
  for (const message of messages) {
    await postMessage(session, message, { source: "history_sync", syncBackfill: true });
  }

  const requestId = String(event.peerDataRequestSessionId || "");
  const request = requestId ? session.onDemandRequests.get(requestId) : null;
  if (request) {
    if (request.timer) clearTimeout(request.timer);
    session.onDemandRequests.delete(requestId);
    session.syncPendingRequests = Math.max(0, Number(session.syncPendingRequests || 0) - 1);
    if (messages.length >= HISTORY_PAGE_SIZE && request.pagesFetched < MAX_SYNC_PAGES_PER_CHAT) {
      await sleep(SYNC_REQUEST_DELAY_MS);
      await requestMoreHistory(session, request.jid, request.pagesFetched);
    }
  }

  if (job?.status === "running") {
    job.updated_at = nowIso();
    await postSyncProgress(session);
  }
  await completeSyncIfIdle(session);
}

function browserBackfillJobDir(session) {
  const dir = path.join(DATA_ROOT, "browser-backfill", safePart(session.owner), safePart(session.accountId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function browserWaId(title) {
  const phone = phoneJidFrom(title);
  if (phone) return phone;
  const digest = sha1(String(title || "unknown").trim().toLowerCase()).slice(0, 24);
  return `browser-${digest}@odysseus.local`;
}

function parseBrowserTimestamp(prePlainText) {
  const raw = String(prePlainText || "");
  const match = raw.match(/\[(\d{1,2}):(\d{2}),\s*([^\]]+)\]/);
  if (!match) return Math.floor(Date.now() / 1000);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const datePart = match[3].trim().replace(/\./g, "/").replace(/-/g, "/");
  const dateMatch = datePart.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!dateMatch) return Math.floor(Date.now() / 1000);
  let first = Number(dateMatch[1]);
  let second = Number(dateMatch[2]);
  let year = Number(dateMatch[3]);
  if (year < 100) year += 2000;
  let day = first;
  let month = second;
  if (second > 12 && first <= 12) {
    day = second;
    month = first;
  }
  const dt = new Date(year, Math.max(0, month - 1), day, hour, minute, 0, 0);
  const seconds = Math.floor(dt.getTime() / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : Math.floor(Date.now() / 1000);
}

function browserMessageType(item) {
  const media = String(item.media_type || "").trim();
  if (media) return media;
  return String(item.body || "").trim() ? "text" : "unknown";
}

async function browserLoginSnapshot(session, page, reason) {
  const dir = browserBackfillJobDir(session);
  const filePath = path.join(dir, `login-required-${Date.now()}.png`);
  try {
    await page.waitForTimeout(3500);
    await page.screenshot({ path: filePath, fullPage: true });
  } catch (_) {}
  return {
    reason,
    screenshot_path: fs.existsSync(filePath) ? filePath : "",
  };
}

async function ensureBrowserPage(session) {
  let context = session.browserContext || null;
  if (!context) {
    const { chromium } = await loadPlaywright();
    if (!fs.existsSync(BROWSER_BACKFILL_EXECUTABLE)) {
      throw new Error(`Chromium executable not found at ${BROWSER_BACKFILL_EXECUTABLE}`);
    }
    fs.mkdirSync(session.paths.chromeProfile, { recursive: true });
    const browserHome = path.join(DATA_ROOT, "browser-runtime");
    const browserConfig = path.join(browserHome, "config");
    const browserCache = path.join(browserHome, "cache");
    fs.mkdirSync(browserConfig, { recursive: true });
    fs.mkdirSync(browserCache, { recursive: true });
    context = await chromium.launchPersistentContext(session.paths.chromeProfile, {
      headless: BROWSER_BACKFILL_HEADLESS,
      executablePath: BROWSER_BACKFILL_EXECUTABLE,
      viewport: { width: 1365, height: 900 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "en-US",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
      ],
      env: {
        ...process.env,
        HOME: browserHome,
        XDG_CONFIG_HOME: browserConfig,
        XDG_CACHE_HOME: browserCache,
      },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    session.browserContext = context;
  }
  const page = context.pages()[0] || await context.newPage();
  session.browserPage = page;
  return { context, page };
}

async function waitForWhatsAppWeb(page, session) {
  await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const pane = document.querySelector("#pane-side");
      const main = document.querySelector("#main");
      const qr = document.querySelector("canvas") || document.querySelector("[data-ref]");
      const body = document.body?.innerText || "";
      return {
        hasChatList: !!pane,
        hasMain: !!main,
        hasQr: !!qr,
        text: body.slice(0, 1000),
      };
    }).catch(() => ({ hasChatList: false, hasMain: false, hasQr: false, text: "" }));
    if (state.hasChatList || state.hasMain) return { ok: true };
    if (state.hasQr || /link a device|use whatsapp on your computer|scan/i.test(state.text)) {
      return { ok: false, ...(await browserLoginSnapshot(session, page, "browser_login_required")) };
    }
    await sleep(1500);
  }
  return { ok: false, ...(await browserLoginSnapshot(session, page, "browser_login_timeout")) };
}

async function requestBrowserPhoneLogin(session, phoneNumber) {
  const phone = String(phoneNumber || "").replace(/[^\d+]/g, "");
  if (!phone || phone.replace(/\D/g, "").length < 8) {
    const error = new Error("A full WhatsApp phone number is required for phone-number login.");
    error.statusCode = 400;
    throw error;
  }
  const { page } = await ensureBrowserPage(session);
  await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);

  const alreadyLinked = await page.evaluate(() => !!document.querySelector("#pane-side") || !!document.querySelector("#main")).catch(() => false);
  if (alreadyLinked) return { ok: true, already_linked: true };

  let clicked = false;
  for (let attempt = 0; attempt < 8 && !clicked; attempt += 1) {
    const box = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button, div[role='button'], a, span"));
      const target = candidates.find((node) => /log in with phone number|link with phone number/i.test((node.textContent || "").trim()));
      if (!target) return null;
      const clickable = target.closest("button, div[role='button'], a") || target;
      const rect = clickable.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: clickable.textContent || "" };
    }).catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      clicked = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (!clicked) {
    return { ok: false, reason: "phone_login_link_not_found", ...(await browserLoginSnapshot(session, page, "phone-login-link-not-found")) };
  }

  await page.waitForTimeout(3000);
  const filled = await page.evaluate((value) => {
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const inputs = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))
      .filter(visible);
    const target = inputs.find((el) => /phone|number/i.test(`${el.getAttribute("aria-label") || ""} ${el.getAttribute("placeholder") || ""}`)) || inputs[inputs.length - 1];
    if (!target) return false;
    target.focus();
    if ("value" in target) {
      target.value = "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.value = value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      target.textContent = value;
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
    return true;
  }, phone);
  if (!filled) {
    return { ok: false, reason: "phone_input_not_found", ...(await browserLoginSnapshot(session, page, "phone-input-not-found")) };
  }

  await page.waitForTimeout(700);
  await page.keyboard.press("Enter").catch(() => null);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
    const next = buttons.find((node) => /next|continue/i.test(node.textContent || ""));
    if (next) next.click();
  }).catch(() => null);

  const deadline = Date.now() + 45_000;
  let last = { text: "" };
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({ text: document.body?.innerText || "" })).catch(() => ({ text: "" }));
    if (/scan the qr code|scan to log in/i.test(last.text) && !/enter phone|phone number/i.test(last.text)) {
      await page.waitForTimeout(1000);
      continue;
    }
    const codeMatch =
      last.text.match(/\b(?=[A-Z0-9 -]*\d)[A-Z0-9]{4}[-\s][A-Z0-9]{4}\b/i)
      || last.text.match(/\b\d{4}[-\s]\d{4}\b/)
      || last.text.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{8}\b/i);
    if (codeMatch) {
      const dir = browserBackfillJobDir(session);
      const screenshotPath = path.join(dir, `phone-login-code-${Date.now()}.png`);
      try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch (_) {}
      return {
        ok: true,
        code: codeMatch[0].trim(),
        screenshot_path: fs.existsSync(screenshotPath) ? screenshotPath : "",
      };
    }
    if (/invalid|try again|couldn't|could not|too many/i.test(last.text)) break;
    await page.waitForTimeout(1000);
  }
  return {
    ok: false,
    reason: "phone_login_code_not_found",
    text: String(last.text || "").slice(0, 1000),
    ...(await browserLoginSnapshot(session, page, "phone-login-code-not-found")),
  };
}

async function visibleBrowserChats(page) {
  return page.evaluate(() => {
    const pane = document.querySelector("#pane-side");
    if (!pane) return [];
    const rows = Array.from(pane.querySelectorAll('[role="row"], [role="listitem"]'));
    return rows.map((row, index) => {
      const titleSpan = Array.from(row.querySelectorAll("span[title]"))
        .find((span) => (span.getAttribute("title") || "").trim());
      const lines = (row.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
      const title = (titleSpan?.getAttribute("title") || lines[0] || "").trim();
      const preview = lines.slice(1).join(" ").slice(0, 500);
      return {
        index,
        title,
        preview,
        key: `${title}|${preview}`.slice(0, 600),
      };
    }).filter((item) => item.title && !/^archived$/i.test(item.title));
  });
}

async function clickVisibleBrowserChat(page, index) {
  const rows = await page.$$('#pane-side [role="row"], #pane-side [role="listitem"]');
  const row = rows[index];
  if (!row) return false;
  await row.click();
  await page.waitForTimeout(900);
  return true;
}

async function scrollBrowserRoster(page) {
  return page.evaluate(() => {
    const pane = document.querySelector("#pane-side");
    if (!pane) return { moved: false, scrollTop: 0, scrollHeight: 0 };
    const before = pane.scrollTop;
    pane.scrollTop = Math.min(pane.scrollTop + Math.max(240, Math.floor(pane.clientHeight * 0.85)), pane.scrollHeight);
    return { moved: pane.scrollTop !== before, scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight };
  });
}

async function clickOlderMessagesIfPresent(page) {
  const clicked = await page.evaluate(() => {
    const patterns = [/older messages/i, /get older/i, /from your phone/i];
    const candidates = Array.from(document.querySelectorAll("button, div[role='button'], span"));
    const target = candidates.find((node) => patterns.some((pattern) => pattern.test(node.textContent || "")));
    if (!target) return false;
    const clickable = target.closest("button, div[role='button']") || target;
    clickable.click();
    return true;
  }).catch(() => false);
  if (clicked) await page.waitForTimeout(1500);
  return clicked;
}

async function scrollBrowserMessagesUp(page) {
  return page.evaluate(() => {
    const main = document.querySelector("#main");
    if (!main) return { moved: false };
    const candidates = Array.from(main.querySelectorAll("div"))
      .filter((node) => node.scrollHeight > node.clientHeight + 100);
    const scroller = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!scroller) return { moved: false };
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(400, Math.floor(scroller.clientHeight * 0.9)));
    return { moved: scroller.scrollTop !== before, scrollTop: scroller.scrollTop };
  }).catch(() => ({ moved: false }));
}

async function extractVisibleBrowserMessages(page) {
  return page.evaluate(() => {
    const main = document.querySelector("#main");
    if (!main) return [];
    const nodes = Array.from(main.querySelectorAll("div[data-id]"));
    return nodes.map((node) => {
      const dataId = node.getAttribute("data-id") || "";
      const copy = node.querySelector("[data-pre-plain-text]");
      const prePlainText = copy?.getAttribute("data-pre-plain-text") || "";
      const textSpans = Array.from(node.querySelectorAll("span.selectable-text, div.copyable-text span"));
      const body = textSpans
        .map((span) => (span.innerText || span.textContent || "").trim())
        .filter(Boolean)
        .join("\n")
        .trim();
      const aria = Array.from(node.querySelectorAll("[aria-label]"))
        .map((item) => item.getAttribute("aria-label") || "")
        .join(" ")
        .toLowerCase();
      let mediaType = "";
      if (/voice|audio/.test(aria)) mediaType = "audio";
      else if (/video/.test(aria)) mediaType = "video";
      else if (/image|photo/.test(aria)) mediaType = "image";
      else if (/document|file/.test(aria)) mediaType = "document";
      const fromMe = dataId.startsWith("true_") || dataId.includes("_true_");
      const senderMatch = prePlainText.match(/\]\s*([^:]+):/);
      return {
        data_id: dataId,
        pre_plain_text: prePlainText,
        body,
        media_type: mediaType,
        from_me: fromMe,
        sender: senderMatch ? senderMatch[1].trim() : "",
      };
    }).filter((item) => item.data_id || item.pre_plain_text || item.body || item.media_type);
  });
}

async function importBrowserChatMessages(session, page, chat) {
  const job = session.syncJob;
  const seen = new Map();
  let staleRounds = 0;
  for (let round = 0; round < BROWSER_BACKFILL_MAX_MESSAGE_SCROLLS; round += 1) {
    await clickOlderMessagesIfPresent(page);
    for (const item of await extractVisibleBrowserMessages(page)) {
      const key = item.data_id || sha1(`${chat.wa_id}|${item.pre_plain_text}|${item.body}|${item.media_type}`);
      if (!key || seen.has(key)) continue;
      seen.set(key, item);
    }
    if (seen.size >= BROWSER_BACKFILL_MAX_MESSAGES_PER_CHAT) break;
    const moved = await scrollBrowserMessagesUp(page);
    if (!moved.moved) staleRounds += 1;
    else staleRounds = 0;
    if (staleRounds >= 3) break;
    await page.waitForTimeout(550);
  }

  const messages = Array.from(seen.values()).slice(-BROWSER_BACKFILL_MAX_MESSAGES_PER_CHAT);
  for (const item of messages) {
    const body = item.body || (item.media_type ? `[${item.media_type}]` : "");
    const rawKey = item.data_id || sha1(`${chat.wa_id}|${item.pre_plain_text}|${body}|${item.media_type}`);
    await postBackendEvent(session, "message.upsert", {
      source: "browser_backfill",
      sync_backfill: true,
      provider_message_id: `browser:${sha1(`${chat.wa_id}:${rawKey}`).slice(0, 32)}`,
      remote_jid: chat.wa_id,
      from_me: !!item.from_me,
      participant: "",
      push_name: item.sender || chat.title,
      message_type: browserMessageType(item),
      body,
      media: item.media_type ? { media_type: item.media_type, mime_type: "", filename: "", file_size: 0, sha256: "" } : null,
      timestamp: parseBrowserTimestamp(item.pre_plain_text),
      raw: {
        source: "browser_backfill",
        chat_title: chat.title,
        data_id: item.data_id,
        pre_plain_text: item.pre_plain_text,
        media_type: item.media_type,
      },
    });
    if (job?.status === "running") {
      job.messages_processed += 1;
      if (item.media_type) job.media_queued += 1;
    }
  }
  if (job?.status === "running") {
    job.updated_at = nowIso();
    await postSyncProgress(session);
  }
  return messages.length;
}

async function runBrowserBackfill(session, options = {}) {
  const job = session.syncJob;
  if (!BROWSER_BACKFILL_ENABLED) return { skipped: true, reason: "disabled" };
  if (session.browserBackfillRunning) return { skipped: true, reason: "already_running" };
  session.browserBackfillRunning = true;
  if (job?.status === "running") {
    job.phase = "browser_backfill_starting";
    job.updated_at = nowIso();
    await postSyncProgress(session);
  }

  let context = null;
  let keepContextOpen = false;
  try {
    const browser = await ensureBrowserPage(session);
    context = browser.context;
    const page = browser.page;
    const ready = await waitForWhatsAppWeb(page, session);
    if (!ready.ok) {
      keepContextOpen = true;
      if (job?.status === "running") {
        job.failures += 1;
        job.last_error = `WhatsApp Web browser backfill needs login: ${ready.screenshot_path || ready.reason}`;
        job.phase = ready.reason || "browser_login_required";
        job.updated_at = nowIso();
        await postSyncProgress(session);
      }
      return { ok: false, ...ready };
    }

    const processed = new Set();
    let unchangedRounds = 0;
    for (let scrollRound = 0; scrollRound < BROWSER_BACKFILL_MAX_ROSTER_SCROLLS; scrollRound += 1) {
      if (job?.status !== "running") break;
      const chats = await visibleBrowserChats(page);
      let newInRound = 0;
      for (let index = 0; index < chats.length; index += 1) {
        if (processed.size >= BROWSER_BACKFILL_MAX_CHATS) break;
        const item = chats[index];
        if (!item.title || processed.has(item.key)) continue;
        processed.add(item.key);
        newInRound += 1;
        const waId = browserWaId(item.title);
        await postBackendEvent(session, "chats.upsert", {
          source: "browser_backfill",
          sync_backfill: true,
          chats: [{
            id: waId,
            name: item.title,
            unread_count: 0,
            timestamp: 0,
            archived: false,
            pinned: null,
            muted: null,
            source: "browser_backfill",
          }],
        });
        if (job?.status === "running") {
          job.chats_discovered += 1;
          job.chats_normalized += 1;
          job.phase = "browser_backfill_importing";
          job.updated_at = nowIso();
          await postSyncProgress(session);
        }
        if (await clickVisibleBrowserChat(page, item.index)) {
          await importBrowserChatMessages(session, page, { title: item.title, wa_id: waId });
        }
      }
      if (processed.size >= BROWSER_BACKFILL_MAX_CHATS) break;
      const moved = await scrollBrowserRoster(page);
      if (!moved.moved && newInRound === 0) unchangedRounds += 1;
      else unchangedRounds = 0;
      if (unchangedRounds >= 4) break;
      await page.waitForTimeout(700);
    }
    return { ok: true, chats_imported: processed.size };
  } catch (error) {
    if (job?.status === "running") {
      job.failures += 1;
      job.last_error = normalizeError(error);
      job.phase = "browser_backfill_failed";
      job.updated_at = nowIso();
      await postSyncProgress(session);
    }
    return { ok: false, error: normalizeError(error) };
  } finally {
    if (!keepContextOpen) {
      try { await context?.close?.(); } catch (_) {}
      if (session.browserContext === context) session.browserContext = null;
      session.browserPage = null;
    }
    session.browserBackfillRunning = false;
  }
}

async function runSyncPipeline(session) {
  if (session.syncPipelineRunning) return;
  session.syncPipelineRunning = true;
  session.browserBackfillPending = BROWSER_BACKFILL_ENABLED;
  try {
    await runOnDemandBackfill(session);
    if (BROWSER_BACKFILL_ENABLED && session.syncJob?.status === "running") {
      await runBrowserBackfill(session);
    }
  } finally {
    session.browserBackfillPending = false;
    session.syncPipelineRunning = false;
    await completeSyncIfIdle(session);
  }
}

function reviveJsonPayload(value) {
  if (!value || typeof value !== "object") return value;
  if (value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  if (Array.isArray(value)) return value.map((item) => reviveJsonPayload(item));
  for (const key of Object.keys(value)) {
    value[key] = reviveJsonPayload(value[key]);
  }
  return value;
}

function rawMessageFromPayload(raw) {
  const revived = reviveJsonPayload(raw);
  if (!revived || typeof revived !== "object") return null;
  if (revived.key && revived.message) return revived;
  if (revived.raw && typeof revived.raw === "object") return rawMessageFromPayload(revived.raw);
  return null;
}

function messageType(message) {
  if (!message) return "unknown";
  const key = Object.keys(message).find((item) => item !== "messageContextInfo");
  if (!key) return "unknown";
  return key.replace(/Message$/, "") || key;
}

function extensionForMedia(media) {
  const filename = String(media?.filename || "");
  const existing = path.extname(filename).replace(/[^a-zA-Z0-9.]/g, "");
  if (existing && existing.length <= 12) return existing.toLowerCase();
  const mime = String(media?.mime_type || "").toLowerCase();
  if (mime.includes("jpeg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("pdf")) return ".pdf";
  return ".bin";
}

async function postBackendEvent(session, eventType, payload) {
  if (!BACKEND_URL) return;
  const body = JSON.stringify({
    owner: session.owner,
    account_id: session.accountId,
    event_type: eventType,
    payload,
  });
  const url = new URL("/api/whatsapp/bridge/events", BACKEND_URL);
  await new Promise((resolve) => {
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Odysseus-Bridge-Token": TOKEN,
      },
      timeout: 5000,
    }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", resolve);
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });
}

async function startSession(owner, accountId) {
  const key = sessionKey(owner, accountId);
  const existing = sessions.get(key);
  if (existing?.starting) return existing.starting;
  if (existing?.sock && existing.state !== "disconnected" && existing.state !== "failed") return existing;

  const paths = sessionPaths(owner, accountId);
  fs.mkdirSync(paths.auth, { recursive: true });
  fs.mkdirSync(paths.chromeProfile, { recursive: true });

  const session = existing || {
    owner,
    accountId,
    paths,
    state: "starting",
    qr: null,
    qrExpiresAt: null,
    user: null,
    lastError: null,
    lastEventAt: nowIso(),
    sock: null,
    authState: null,
    starting: null,
    version: null,
    syncJob: null,
    syncPipelineRunning: false,
    syncLauncherRunning: false,
    syncLaunchComplete: false,
    syncPendingRequests: 0,
    browserBackfillPending: false,
    browserBackfillRunning: false,
    browserContext: null,
    browserPage: null,
    onDemandRequests: new Map(),
    chats: new Map(),
    contacts: new Map(),
    messagesByChat: new Map(),
    mediaMessages: new Map(),
  };
  session.paths = paths;
  session.owner = owner;
  session.accountId = accountId;
  session.onDemandRequests = session.onDemandRequests || new Map();
  session.chats = session.chats || new Map();
  session.contacts = session.contacts || new Map();
  session.messagesByChat = session.messagesByChat || new Map();
  session.mediaMessages = session.mediaMessages || new Map();
  sessions.set(key, session);

  session.starting = (async () => {
    try {
      const baileys = await loadBaileys();
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;
      const { state, saveCreds } = await useMultiFileAuthState(paths.auth);
      session.authState = state;
      let version = undefined;
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch (_) {
        version = undefined;
      }
      session.version = Array.isArray(version) ? version.join(".") : null;
      const logger = pinoFactory(bridgeLoggerOptions());
      const sock = makeWASocket({
        auth: state,
        browser: ["Mac OS", "Desktop", "Odysseus"],
        logger,
        printQRInTerminal: false,
        version,
        syncFullHistory: shouldSyncFullHistoryOnConnect(),
        markOnlineOnConnect: false,
      });
      session.sock = sock;
      session.state = "connecting";
      session.lastEventAt = nowIso();

      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", async (update) => {
        session.lastEventAt = nowIso();
        if (update.qr) {
          session.qr = update.qr;
          session.qrExpiresAt = new Date(Date.now() + 60_000).toISOString();
          session.state = "qr_pending";
        }
        if (update.connection === "connecting") {
          session.state = session.qr ? "qr_pending" : "connecting";
        }
        if (update.connection === "open") {
          session.state = "connected";
          session.qr = null;
          session.qrExpiresAt = null;
          session.lastError = null;
          session.user = sock.user || null;
          await postBackendEvent(session, "auth.connected", {
            user: session.user,
            session_path: paths.auth,
            chrome_profile_path: paths.chromeProfile,
          });
        }
        if (update.connection === "close") {
          const statusCode = update.lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason?.loggedOut;
          session.state = loggedOut ? "reconnect_required" : "disconnected";
          session.lastError = normalizeError(update.lastDisconnect?.error);
          session.qr = null;
          session.qrExpiresAt = null;
          await postBackendEvent(session, loggedOut ? "auth.revoked" : "auth.disconnected", {
            reason: session.lastError || "connection closed",
          });
          if (!loggedOut) {
            setTimeout(() => startSession(owner, accountId).catch(() => null), 3000);
          }
        }
      });

      sock.ev.on("messages.upsert", async (event) => {
        for (const message of event.messages || []) {
          await postMessage(session, message, { source: event.type || "live" });
        }
        if (session.syncJob?.status === "running") {
          await postSyncProgress(session);
        }
      });

      sock.ev.on("chats.upsert", async (chats) => {
        await postChats(session, chats, "live");
        if (session.syncJob?.status === "running") {
          await postSyncProgress(session);
        }
      });

      sock.ev.on("chats.update", async (updates) => {
        await postChats(session, updates || [], "chat_update", "chats.update");
        if (session.syncJob?.status === "running") {
          await postSyncProgress(session);
        }
      });

      sock.ev.on("contacts.upsert", async (contacts) => {
        await postContacts(session, contacts || [], "contacts_upsert");
      });

      sock.ev.on("contacts.update", async (contacts) => {
        await postContacts(session, contacts || [], "contacts_update", "contacts.update");
      });

      sock.ev.on("messaging-history.set", async (event) => {
        await handleHistorySet(session, event || {});
      });
      return session;
    } catch (error) {
      session.state = "failed";
      session.lastError = normalizeError(error);
      session.lastEventAt = nowIso();
      throw error;
    } finally {
      session.starting = null;
    }
  })();

  return session.starting;
}

async function stopSession(owner, accountId, removeFiles) {
  const key = sessionKey(owner, accountId);
  const session = sessions.get(key);
  if (session?.sock) {
    try {
      await session.sock.logout();
    } catch (_) {
      try { session.sock.end?.(); } catch (_) {}
    }
  }
  try { await session?.browserContext?.close?.(); } catch (_) {}
  sessions.delete(key);
  if (removeFiles) {
    const paths = sessionPaths(owner, accountId);
    fs.rmSync(paths.base, { recursive: true, force: true });
  }
  return { stopped: true, removed: !!removeFiles };
}

async function startSync(owner, accountId, force, seedChats) {
  const session = sessions.get(sessionKey(owner, accountId));
  if (!session?.sock || session.state !== "connected") {
    const error = new Error("WhatsApp session is not connected");
    error.statusCode = 409;
    throw error;
  }
  if (!session.syncJob || force || !["running", "watching"].includes(session.syncJob.status)) {
    for (const request of session.onDemandRequests?.values?.() || []) {
      if (request?.timer) clearTimeout(request.timer);
    }
    session.onDemandRequests = new Map();
    session.syncJob = newSyncJob(force);
    session.syncPendingRequests = 0;
    session.syncLaunchComplete = false;
    session.browserBackfillPending = false;
    session.browserBackfillRunning = false;
  } else {
    session.syncJob.updated_at = nowIso();
  }
  applySyncSeeds(session, seedChats);
  session.lastEventAt = nowIso();
  await postSyncProgress(session);
  runSyncPipeline(session).catch(async (error) => {
    if (session.syncJob) {
      session.syncJob.status = "failed";
      session.syncJob.phase = "sync_pipeline";
      session.syncJob.last_error = normalizeError(error);
      session.syncJob.updated_at = nowIso();
      await postSyncProgress(session);
    }
  });
  return publicSyncJob(session);
}

async function downloadMedia(owner, accountId, providerMessageId, rawMessage) {
  const session = sessions.get(sessionKey(owner, accountId));
  if (!session?.sock || session.state !== "connected") {
    const error = new Error("WhatsApp session is not connected");
    error.statusCode = 409;
    throw error;
  }
  let entry = session.mediaMessages?.get(String(providerMessageId || ""));
  if (!entry?.message && rawMessage) {
    const message = rawMessageFromPayload(rawMessage);
    const media = mediaInfo(message?.message);
    if (message && media) {
      entry = { message, media };
      if (providerMessageId) session.mediaMessages?.set(String(providerMessageId), entry);
    }
  }
  if (!entry?.message) {
    const error = new Error("Media is not available in the live bridge cache. Re-sync or wait for the message event again.");
    error.statusCode = 404;
    throw error;
  }
  const baileys = await loadBaileys();
  const downloadMediaMessage = baileys.downloadMediaMessage;
  if (typeof downloadMediaMessage !== "function") {
    throw new Error("Bridge media downloader is unavailable");
  }
  const logger = pinoFactory(bridgeLoggerOptions());
  const buffer = await downloadMediaMessage(
    entry.message,
    "buffer",
    {},
    { logger, reuploadRequest: session.sock.updateMediaMessage }
  );
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Bridge did not return media bytes");
  }
  const mediaDir = path.join(DATA_ROOT, "media", safePart(owner), safePart(accountId));
  fs.mkdirSync(mediaDir, { recursive: true });
  const ext = extensionForMedia(entry.media);
  const fileName = `${safePart(providerMessageId)}${ext}`;
  const filePath = path.join(mediaDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return {
    provider_message_id: providerMessageId,
    media_type: entry.media.media_type,
    mime_type: entry.media.mime_type,
    filename: entry.media.filename || fileName,
    file_size: buffer.length,
    local_path: filePath,
    download_status: "downloaded",
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function authorize(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === `Bearer ${TOKEN}` || req.headers["x-odysseus-bridge-token"] === TOKEN;
}

function routeParts(urlPath) {
  return urlPath.split("/").filter(Boolean).map(decodeURIComponent);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authorize(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const parts = routeParts(url.pathname);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        status: "ok",
        service: "odysseus-whatsapp-bridge",
        version: "0.1.0",
        sessions: sessions.size,
        data_root: DATA_ROOT,
      });
    }

    if (parts[0] === "sessions" && parts.length >= 3) {
      const owner = parts[1];
      const accountId = parts[2];
      const action = parts[3] || "status";

      if (req.method === "POST" && action === "start") {
        const session = await startSession(owner, accountId);
        return sendJson(res, 200, { ok: true, session: publicSessionState(session) });
      }
      if (req.method === "GET" && action === "status") {
        const session = sessions.get(sessionKey(owner, accountId));
        if (!session) {
          return sendJson(res, 200, {
            ok: true,
            session: {
              owner,
              account_id: accountId,
              state: "not_started",
              connected: false,
              qr: null,
              session_path: sessionPaths(owner, accountId).auth,
              chrome_profile_path: sessionPaths(owner, accountId).chromeProfile,
            },
          });
        }
        return sendJson(res, 200, { ok: true, session: publicSessionState(session) });
      }
      if (req.method === "POST" && action === "send") {
        const body = await readBody(req);
        const session = sessions.get(sessionKey(owner, accountId));
        if (!session?.sock || session.state !== "connected") {
          return sendJson(res, 409, { ok: false, error: "WhatsApp session is not connected" });
        }
        const target = resolveSendTarget(session, body.to);
        const result = await session.sock.sendMessage(target.jid, { text: String(body.text || "") });
        return sendJson(res, 200, {
          ok: true,
          provider_message_id: result?.key?.id || "",
          remote_jid: result?.key?.remoteJid || target.jid,
          requested_jid: target.requested_jid,
          resolved_jid: target.jid,
          self_target: !!target.self_target,
          self_target_normalized: !!target.self_target_normalized,
          status: "sent",
        });
      }
      if (req.method === "POST" && action === "sync") {
        const body = await readBody(req);
        const job = await startSync(owner, accountId, !!body.force, body.seed_chats || body.seedChats || []);
        return sendJson(res, 200, { ok: true, job });
      }
      if (req.method === "GET" && action === "sync") {
        const session = sessions.get(sessionKey(owner, accountId));
        return sendJson(res, 200, { ok: true, job: publicSyncJob(session) });
      }
      if (req.method === "POST" && action === "download-media") {
        const body = await readBody(req);
        const media = await downloadMedia(owner, accountId, body.provider_message_id || body.media_id || "", body.raw_message || null);
        return sendJson(res, 200, { ok: true, media });
      }
      if (req.method === "POST" && action === "browser-backfill") {
        return sendJson(res, 410, { ok: false, error: "Browser backfill is disabled. Use linked-device history sync or explicit export import." });
      }
      if (req.method === "POST" && action === "browser-phone-login") {
        return sendJson(res, 410, { ok: false, error: "Browser login is disabled. Use linked-device QR auth for the bridge." });
      }
      if (req.method === "POST" && action === "stop") {
        const body = await readBody(req);
        const result = await stopSession(owner, accountId, !!body.remove_files);
        return sendJson(res, 200, { ok: true, ...result });
      }
    }

    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { ok: false, error: normalizeError(error) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Odysseus WhatsApp bridge listening on ${HOST}:${PORT}\n`);
});
