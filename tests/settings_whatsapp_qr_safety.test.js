"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const settingsPath = path.resolve(__dirname, "..", "static", "js", "settings.js");

function settingsSource() {
  return fs.readFileSync(settingsPath, "utf8");
}

test("WhatsApp QR fallback never writes the raw QR payload into visible text", () => {
  const source = settingsSource();

  assert.doesNotMatch(source, /fallback\.textContent\s*=\s*payload/);
  assert.match(source, /QR renderer unavailable|Refresh QR|try Connect with QR/i);
});

test("closing Settings stops active WhatsApp QR polling", () => {
  const source = settingsSource();

  assert.match(source, /function\s+stopWhatsAppQrPolling\s*\(/);
  assert.match(source, /export\s+function\s+close\s*\(\)\s*\{[\s\S]*?stopWhatsAppQrPolling\(\)/);
  assert.match(source, /uf-wa-cancel'[\s\S]*?stopWhatsAppQrPolling\(\)/);
});

