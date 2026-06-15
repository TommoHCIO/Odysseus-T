const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
}

test("first-message materialization preserves sessions hidden from /api/sessions", () => {
  const source = readProjectFile("static", "js", "sessions.js");
  assert.match(source, /export async function loadSessions\(\{\s*preserveUnlistedCurrent = false\s*\} = \{\}\)/);
  assert.match(source, /if \(preserveUnlistedCurrent\)\s*\{\s*\/\/ Newly materialized sessions[\s\S]*?targetId = currentSessionId;/);
  assert.match(source, /loadSessions\(\{\s*preserveUnlistedCurrent: true\s*\}\)/);
});

test("composer Enter submit targets the external send button", () => {
  const source = readProjectFile("static", "app.js");
  assert.match(source, /button\[form="chat-form"\]\[type="submit"\], \.send-btn/);
  assert.doesNotMatch(source, /form\.querySelector\('button\[type="submit"\]'\)/);
});

test("sidebar new chat click handler is defined before binding", () => {
  const source = readProjectFile("static", "app.js");
  const matches = source.match(/async function startNewChatFromSidebar\(/g) || [];
  assert.equal(matches.length, 1, "startNewChatFromSidebar should have one canonical definition");
  const defIndex = source.indexOf("async function startNewChatFromSidebar(");
  const bindIndex = source.indexOf("sidebarNewChatBtn.addEventListener('click', startNewChatFromSidebar)");
  assert.ok(defIndex >= 0, "startNewChatFromSidebar should be defined");
  assert.ok(bindIndex > defIndex, "sidebar new chat should bind after the handler definition");
  assert.match(source, /document\.addEventListener\('click'[\s\S]*#sidebar-new-chat-btn, #rail-new-session[\s\S]*startNewChatFromSidebar\(event\)/);
});

test("app shell cache-busts the new chat handler module", () => {
  const html = readProjectFile("static", "index.html");
  assert.match(html, /\/static\/app\.js\?v=20260614newchat2/);
});
