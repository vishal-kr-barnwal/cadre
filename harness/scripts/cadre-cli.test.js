#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "scripts", "cadre-cli.js");
const mcpServer = path.join(root, "scripts", "mcp", "cadre-server.js");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function installFakeClient(binDir, name, logFile) {
  const file = path.join(binDir, name);
  write(file, `#!/bin/sh
printf '%s\\n' "$0 $*" >> "${logFile}"
exit 0
`);
  fs.chmodSync(file, 0o755);
}

function runCli(args, env) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 5000,
  });
}

function installEnv(home, bin, extra = {}) {
  return {
    CADRE_HOME: path.join(home, ".cadre"),
    CODEX_HOME: path.join(home, ".codex"),
    CLAUDE_HOME: path.join(home, ".claude"),
    PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`,
    ...extra,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("cadre install --dry-run plans detected clients without mutating", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-dry-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  installFakeClient(bin, "claude", log);

  const result = runCli(["install", "--dry-run"], installEnv(home, bin));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would run: codex plugin marketplace add/);
  assert.match(result.stdout, /Would run: claude plugin marketplace add/);
  assert.match(result.stdout, /Would configure: Cadre codex MCP tool approvals/);
  assert.match(result.stdout, /Would configure: Cadre claude MCP tool approvals/);
  assert.equal(fs.existsSync(path.join(home, ".cadre")), false);
  assert.equal(fs.existsSync(path.join(home, ".codex")), false);
  assert.equal(fs.existsSync(path.join(home, ".claude")), false);
  assert.equal(fs.existsSync(log), false);
});

test("cadre install writes thin plugins and invokes native installers", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-install-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  const cadreHome = path.join(home, ".cadre");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  installFakeClient(bin, "claude", log);

  const result = runCli(["install", "--target", "all", "--scope", "user", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const codexMarketplace = path.join(cadreHome, "marketplaces", "codex");
  const claudeMarketplace = path.join(cadreHome, "marketplaces", "claude");
  const codexPlugin = path.join(codexMarketplace, "plugins", "cadre");
  const claudePlugin = path.join(claudeMarketplace, "plugins", "cadre");
  for (const plugin of [codexPlugin, claudePlugin]) {
    assert.equal(fs.existsSync(path.join(plugin, "skills", "cadre", "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(plugin, "assets")), false);
    assert.equal(fs.existsSync(path.join(plugin, "agents")), false);
    assert.equal(fs.existsSync(path.join(plugin, "scripts")), false);
  }

  const codexMcp = readJson(path.join(codexPlugin, ".mcp.json"));
  const claudeMcp = readJson(path.join(claudePlugin, "mcp-config.json"));
  for (const config of [codexMcp, claudeMcp]) {
    assert.equal(config.mcpServers.cadre.command, process.execPath);
    assert.equal(config.mcpServers.cadre.args[0], mcpServer);
    assert.equal(config.mcpServers.cadre.cwd, root);
  }
  const claudeManifest = readJson(path.join(claudePlugin, ".claude-plugin", "plugin.json"));
  assert.equal(Object.prototype.hasOwnProperty.call(claudeManifest, "agents"), false);
  const codexMarketplaceManifest = readJson(path.join(codexMarketplace, ".agents", "plugins", "marketplace.json"));
  assert.equal(codexMarketplaceManifest.plugins[0].source.path, "./plugins/cadre");
  const claudeMarketplaceManifest = readJson(path.join(claudeMarketplace, ".claude-plugin", "marketplace.json"));
  assert.equal(claudeMarketplaceManifest.plugins[0].source, "./plugins/cadre");
  const codexConfig = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  for (const tool of [
    "cadre_resource",
    "cadre_workflow",
    "cadre_project",
    "cadre_status",
    "cadre_track",
    "cadre_parallel",
    "cadre_mutate",
    "cadre_complete_task",
    "cadre_job",
    "cadre_review",
    "cadre_intel",
    "cadre_artifact",
  ]) {
    assert.match(codexConfig, new RegExp(`\\[plugins\\."cadre@cadre"\\.mcp_servers\\.cadre\\.tools\\.${tool}\\]\\napproval_mode = "approve"`));
  }
  const claudeSettings = readJson(path.join(home, ".claude", "settings.json"));
  assert.deepEqual(claudeSettings.permissions.allow, ["mcp__plugin_cadre_cadre__*", "mcp__cadre__*"]);

  const commandLog = fs.readFileSync(log, "utf8");
  assert.match(commandLog, /codex plugin marketplace add/);
  assert.match(commandLog, /codex plugin add cadre@cadre/);
  assert.match(commandLog, /claude plugin marketplace add --scope user/);
  assert.match(commandLog, /claude plugin install --scope user cadre@cadre/);
  assert.match(commandLog, /claude plugin update --scope user cadre@cadre/);
});

test("cadre install --check validates existing thin plugin", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-check-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  const cadreHome = path.join(home, ".cadre");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);

  const install = runCli(["install", "--target", "codex", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const check = runCli(["install", "--check", "--target", "codex"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /Cadre codex plugin is installed/);
  assert.match(check.stdout, /Cadre codex MCP tool approvals are configured/);
});
