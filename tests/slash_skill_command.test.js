const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "static", "js", "slashCommands.js"), "utf8");
const autocompleteSource = fs.readFileSync(path.join(__dirname, "..", "static", "js", "slashAutocomplete.js"), "utf8");

test("/skill command is registered separately from /skills library", () => {
  assert.match(source, /skill:\s*\{\s*[\s\S]*handler:\s*_cmdSkill/);
  assert.match(source, /usage:\s*'\/skill "skill name" \[request\]'/);
  assert.match(source, /skills:\s*\{\s*[\s\S]*Open Obsidian Skills/);
});

test("/skill command resolves through backend invoke endpoint", () => {
  assert.match(source, /function _parseSkillInvocation/);
  assert.match(source, /\/api\/skills\/invoke/);
  assert.match(source, /include_markdown:\s*true/);
});

test("/skill invocation warns that SKILL.md is procedure guidance", () => {
  assert.match(source, /Treat the SKILL\.md as reusable procedure guidance/);
  assert.match(source, /higher-priority system or developer instructions/);
});

test("/skill recommendations can refill the composer", () => {
  assert.match(source, /skill-invoke-suggestion/);
  assert.match(source, /\/skill "\$\{skillName\}"/);
});

test("/skill live autocomplete fetches skill recommendations", () => {
  assert.match(autocompleteSource, /function _skillCommandQuery/);
  assert.match(autocompleteSource, /\/api\/skills\/invoke/);
  assert.match(autocompleteSource, /include_markdown:\s*false/);
  assert.match(autocompleteSource, /token:\s*`\/skill "\$\{name\}"`/);
});
