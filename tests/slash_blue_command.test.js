const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const slashSource = fs.readFileSync(path.join(__dirname, "..", "static", "js", "slashCommands.js"), "utf8");
const autocompleteSource = fs.readFileSync(path.join(__dirname, "..", "static", "js", "slashAutocomplete.js"), "utf8");
const blueSourcePath = path.join(__dirname, "..", "static", "js", "blue.js");

test("/blue command is registered and dispatches through the BLUE composer", () => {
  assert.match(slashSource, /import\s+\{\s*composeBlueInvocation\s*\}\s+from\s+'\.\/blue\.js'/);
  assert.match(slashSource, /blue:\s*\{\s*[\s\S]*default:\s*'learn'/);
  assert.match(slashSource, /usage:\s*'\/blue \[learn\|path\|map\|methods\|verify\|absorb\|debate\|build\] <topic>'/);
});

test("/blue exposes all v1 subcommands for slash autocomplete", () => {
  for (const sub of ["learn", "path", "map", "methods", "verify", "absorb", "debate", "build"]) {
    assert.match(slashSource, new RegExp(`${sub}:\\s*\\{[\\s\\S]*usage:\\s*'\\/blue ${sub}`));
    assert.match(slashSource, new RegExp(`handler:\\s*\\(args, ctx\\) => _cmdBlue\\(\\['${sub}'`));
  }
  assert.match(autocompleteSource, /subcommandPrompt/);
  assert.match(autocompleteSource, /startsWith\(prefix\)/);
});

test("BLUE frontend helper calls /api/blue/compose and forces the next send into Agent mode", () => {
  const blueSource = fs.readFileSync(blueSourcePath, "utf8");
  assert.match(blueSource, /\/api\/blue\/compose/);
  assert.match(blueSource, /__odysseusNextSendOverrides/);
  assert.match(blueSource, /mode:\s*'agent'/);
  assert.match(blueSource, /allow_web_search/);
});

test("chat send path honors one-shot BLUE send overrides", () => {
  const chatSource = fs.readFileSync(path.join(__dirname, "..", "static", "js", "chat.js"), "utf8");
  assert.match(chatSource, /__odysseusNextSendOverrides/);
  assert.match(chatSource, /fd\.set\('mode',\s*sendOverrides\.mode\)/);
  assert.match(chatSource, /fd\.set\('allow_web_search',\s*'true'\)/);
});

test("BLUE handoff submits through the visible composer send button after debounce", () => {
  assert.match(slashSource, /button\[form="chat-form"\]\[type="submit"\], \.send-btn/);
  assert.match(slashSource, /submitBtn\.click\(\)/);
  assert.match(slashSource, /hideUserBubble:\s*true/);
  assert.match(slashSource, /setHideUserBubble\(\)/);
  assert.match(slashSource, /setTimeout\(\(\)\s*=>\s*\{[\s\S]*submitWhenReady\(\);[\s\S]*\},\s*350\)/);
});
