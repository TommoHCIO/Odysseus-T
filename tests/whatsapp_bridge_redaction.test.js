"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const test = require("node:test");
const vm = require("vm");

function loadBridgeForTest() {
  const bridgePath = path.resolve(__dirname, "..", "services", "whatsapp_bridge", "bridge.js");
  const source = fs.readFileSync(bridgePath, "utf8")
    .replace(/server\.listen\(PORT, HOST,[\s\S]*$/m, "")
    + "\nmodule.exports = { bridgeLoggerOptions, handleHistorySet, newSyncJob, normalizeError, shouldSyncFullHistoryOnConnect };\n";
  const sandbox = {
    require,
    module: { exports: {} },
    exports: {},
    process: { ...process, env: { ...process.env } },
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.runInNewContext(source, sandbox, { filename: bridgePath });
  return sandbox.module.exports;
}

test("bridge does not request full history during connection by default", () => {
  const { shouldSyncFullHistoryOnConnect } = loadBridgeForTest();

  assert.strictEqual(shouldSyncFullHistoryOnConnect(), false);
});

test("normalizeError redacts WhatsApp identifiers from bridge-facing errors", () => {
  const { normalizeError } = loadBridgeForTest();
  const message = normalizeError(
    new Error("failed for 15551234567@s.whatsapp.net and 254524174409953@lid")
  );

  assert.match(message, /\[redacted-jid\]/);
  assert.doesNotMatch(message, /15551234567@s\.whatsapp\.net/);
  assert.doesNotMatch(message, /254524174409953@lid/);
});

test("bridge logger options redact WhatsApp identifiers from structured logs", () => {
  const { bridgeLoggerOptions } = loadBridgeForTest();
  let line = "";
  const destination = {
    write(chunk) {
      line += chunk;
    },
  };
  const logger = pino(bridgeLoggerOptions(), destination);

  logger.error(
    {
      key: { remoteJid: "15551234567@s.whatsapp.net", id: "ABC123" },
      err: new Error("failed for 254524174409953@lid"),
    },
    "failed to decrypt message"
  );

  assert.match(line, /\[redacted-jid\]|\[redacted\]/);
  assert.doesNotMatch(line, /15551234567@s\.whatsapp\.net/);
  assert.doesNotMatch(line, /254524174409953@lid/);
});

test("history sync contacts enrich chat display names before posting chats", async () => {
  const { handleHistorySet, newSyncJob } = loadBridgeForTest();
  const session = {
    owner: "alice",
    accountId: "account-1",
    contacts: new Map(),
    chats: new Map(),
    messagesByChat: new Map(),
    mediaMessages: new Map(),
    onDemandRequests: new Map(),
    syncJob: newSyncJob(false),
    syncLaunchComplete: true,
    syncPendingRequests: 0,
  };

  await handleHistorySet(session, {
    contacts: [
      {
        id: "15551234567@s.whatsapp.net",
        notify: "Ada Lovelace",
      },
    ],
    chats: [
      {
        id: "15551234567@s.whatsapp.net",
        unreadCount: 0,
      },
    ],
    messages: [],
  });

  assert.strictEqual(session.chats.get("15551234567@s.whatsapp.net").name, "Ada Lovelace");
});
