#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const core = require("./cadre-core");
const baselines = require("./fixtures/token-baselines.json");

const harnessRoot = path.resolve(__dirname, "..");
let cachedMcpTools = null;

function mcpTools() {
  if (cachedMcpTools) return cachedMcpTools;
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "token-test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ];
  const child = spawnSync(process.execPath, [path.join(harnessRoot, "scripts", "mcp", "cadre-server.js")], {
    cwd: harnessRoot,
    encoding: "utf8",
    input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    timeout: 10_000,
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const response = child.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 2);
  assert.ok(response?.result?.tools, `tools/list failed: ${child.stdout}`);
  cachedMcpTools = response.result.tools;
  return cachedMcpTools;
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function estimatedTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

function plan(trackId) {
  return {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: trackId,
    phases: [{
      phase_index: 1,
      title: "Build",
      execution_mode: "sequential",
      tasks: [{ task_index: 1, task_key: "build", title: "Build feature", status: "pending", files: ["src/app.ts"], depends_on: [], commit_shas: [], repo_shas: {} }],
    }],
  };
}

function fixture(skillCount) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-token-budget-"));
  const trackId = "token_budget";
  write(path.join(root, "package.json"), { name: "token-budget", scripts: { test: "node --test" } });
  write(path.join(root, "src", "app.ts"), "export const app = true;\n");
  write(path.join(root, "cadre", "config.json"), { sync_mode: "local", provider_mode: "local" });
  write(path.join(root, "cadre", "tracks.json"), { version: 1, schema: "cadre.tracks_index.v1", tracks: [] });
  write(path.join(root, "cadre", "tracks", trackId, "metadata.json"), { track_id: trackId, status: "new", description: "Token budget", git_branch: "track/token-budget", depends_on: [] });
  write(path.join(root, "cadre", "tracks", trackId, "plan.json"), plan(trackId));
  write(path.join(root, "cadre", "tracks", trackId, "spec.json"), { version: 1, schema: "cadre.spec.v1", track_id: trackId, title: "Token budget" });
  for (let index = 1; index <= skillCount; index += 1) {
    const id = `rules-${index}`;
    write(path.join(root, "cadre", "skills", id, "skill.json"), {
      version: 1,
      schema: "cadre.project-skill.v1",
      id,
      name: id,
      description: `Rules ${index}`,
      selectors: { workflows: ["*"] },
      rules: [{ id: "core", text: `Apply bounded rule ${index}.`, priority: index, required: true }],
      references: [],
    });
  }
  return { root, trackId };
}

function flowArgs(flow, root, trackId) {
  if (flow === "setup") return { root, workflow: flow };
  if (flow === "status") return { root, workflow: flow };
  return { root, workflow: flow, trackId, includeLsp: false, includeMachine: false, includeProvider: false };
}

test("token-efficient v1 activation and MCP schemas stay within hard token budgets", () => {
  const shim = fs.readFileSync(path.join(harnessRoot, "skills", "cadre", "SKILL.md"), "utf8");
  assert.ok(estimatedTokens(mcpTools()) <= 1700);
  assert.ok(estimatedTokens(shim) <= 1000);
});

test("token-efficient v1 workflows reduce estimated tokens by at least 40 percent", () => {
  const shim = fs.readFileSync(path.join(harnessRoot, "skills", "cadre", "SKILL.md"), "utf8");
  const tools = estimatedTokens(mcpTools());
  for (const flow of ["setup", "implement", "status", "review"]) {
    const protocol = fs.readFileSync(path.join(harnessRoot, "skills", "cadre", "protocols", `cadre-${flow}.json`), "utf8");
    for (const skillCount of [0, 1, 3]) {
      const { root, trackId } = fixture(skillCount);
      try {
        const args = flowArgs(flow, root, trackId);
        const packet = core.workflowPacketV1(root, args);
        const call = { tool: "cadre_workflow", arguments: { root, workflow: flow, input: flow === "implement" || flow === "review" ? { trackId } : {} } };
        const actual = tools + estimatedTokens(shim) + estimatedTokens(protocol) + estimatedTokens(call) + estimatedTokens(packet);
        const baseline = baselines.flows[flow][String(skillCount)];
        assert.ok(actual <= baseline * 0.6, `${flow}/${skillCount}: ${actual} must be <= ${Math.floor(baseline * 0.6)}`);
        const selection = packet.data.project_skills;
        if (selection) assert.ok(selection.inline_rule_chars <= 2400);
        assert.ok(Object.prototype.hasOwnProperty.call(packet, "decision"));
        assert.ok(Object.prototype.hasOwnProperty.call(packet, "next"));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});
