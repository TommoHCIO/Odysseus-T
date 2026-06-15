const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const vm = require("vm");

function loadCouncilWorkflowHelpers() {
  const source = fs.readFileSync(path.join(__dirname, "..", "static", "js", "group.js"), "utf8");
  function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notStrictEqual(start, -1, `missing ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    assert.notStrictEqual(end, -1, `could not extract ${name}`);
    return source.slice(start, end);
  }
  const names = [
    "_hasCouncilStageMarker",
    "_hasCouncilProtocolMarker",
    "_isCouncilWorkflowMessage",
  ];
  const parts = [];
  for (const name of names) {
    if (source.includes(`function ${name}(`)) parts.push(extractFunction(name));
  }
  const sandbox = {
    document: {
      body: {
        classList: {
          contains: (name) => name === "council-mode-active",
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${parts.join("\n")}\nresult = { _isCouncilWorkflowMessage };`, sandbox);
  return sandbox.result;
}

test("plain Council mode messages stay simple group chat messages", () => {
  const { _isCouncilWorkflowMessage } = loadCouncilWorkflowHelpers();
  assert.strictEqual(_isCouncilWorkflowMessage("Reply with OK only."), false);
});

test("workspace stage and explicit protocol messages still use Council workflow", () => {
  const { _isCouncilWorkflowMessage } = loadCouncilWorkflowHelpers();
  assert.strictEqual(_isCouncilWorkflowMessage("[ODYSSEUS_WORKSPACE_STAGE:ideas]\nBuild a thing"), true);
  assert.strictEqual(_isCouncilWorkflowMessage("[ODYSSEUS_COUNCIL_PROTOCOL:deliberative]\nBuild a thing"), true);
});
