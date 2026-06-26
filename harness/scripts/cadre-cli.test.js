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
    COPILOT_HOME: path.join(home, ".copilot"),
    GEMINI_HOME: path.join(home, ".gemini"),
    ANTIGRAVITY_CLI_HOME: path.join(home, ".gemini", "antigravity-cli"),
    ANTIGRAVITY_IDE_HOME: path.join(home, ".gemini", "config"),
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
  installFakeClient(bin, "copilot", log);
  installFakeClient(bin, "agy", log);

  const result = runCli(["install", "--dry-run"], installEnv(home, bin));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would run: codex plugin marketplace add/);
  assert.match(result.stdout, /Would run: claude plugin marketplace add/);
  assert.match(result.stdout, /Would run: copilot plugin install/);
  assert.match(result.stdout, /Would run: agy plugin install/);
  assert.match(result.stdout, /Would configure: Cadre codex MCP tool approvals/);
  assert.match(result.stdout, /Would configure: Cadre claude MCP tool approvals/);
  assert.match(result.stdout, /Would configure: Cadre copilot MCP tools may prompt/);
  assert.match(result.stdout, /Would configure: Cadre antigravity CLI MCP allow rule/);
  assert.equal(fs.existsSync(path.join(home, ".cadre")), false);
  assert.equal(fs.existsSync(path.join(home, ".codex")), false);
  assert.equal(fs.existsSync(path.join(home, ".claude")), false);
  assert.equal(fs.existsSync(path.join(home, ".copilot")), false);
  assert.equal(fs.existsSync(path.join(home, ".gemini")), false);
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
  installFakeClient(bin, "copilot", log);
  installFakeClient(bin, "agy", log);

  const result = runCli(["install", "--target", "all", "--scope", "user", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const codexMarketplace = path.join(cadreHome, "marketplaces", "codex");
  const claudeMarketplace = path.join(cadreHome, "marketplaces", "claude");
  const copilotMarketplace = path.join(cadreHome, "marketplaces", "copilot");
  const codexPlugin = path.join(codexMarketplace, "plugins", "cadre");
  const claudePlugin = path.join(claudeMarketplace, "plugins", "cadre");
  const copilotPlugin = path.join(copilotMarketplace, "plugins", "cadre");
  const antigravityCliPlugin = path.join(home, ".gemini", "antigravity-cli", "plugins", "cadre");
  const antigravityIdePlugin = path.join(home, ".gemini", "config", "plugins", "cadre");
  for (const plugin of [codexPlugin, claudePlugin, copilotPlugin, antigravityCliPlugin, antigravityIdePlugin]) {
    assert.equal(fs.existsSync(path.join(plugin, "skills", "cadre", "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(plugin, "assets")), false);
    assert.equal(fs.existsSync(path.join(plugin, "agents")), false);
    assert.equal(fs.existsSync(path.join(plugin, "scripts")), false);
    assert.equal(fs.existsSync(path.join(plugin, "references")), false);
    assert.equal(fs.existsSync(path.join(plugin, "templates")), false);
  }

  const codexMcp = readJson(path.join(codexPlugin, ".mcp.json"));
  const claudeMcp = readJson(path.join(claudePlugin, "mcp-config.json"));
  const copilotMcp = readJson(path.join(copilotPlugin, ".mcp.json"));
  const antigravityCliMcp = readJson(path.join(antigravityCliPlugin, "mcp_config.json"));
  const antigravityIdeMcp = readJson(path.join(antigravityIdePlugin, "mcp_config.json"));
  for (const config of [codexMcp, claudeMcp, copilotMcp, antigravityCliMcp, antigravityIdeMcp]) {
    assert.equal(config.mcpServers.cadre.command, process.execPath);
    assert.equal(config.mcpServers.cadre.args[0], mcpServer);
    assert.equal(config.mcpServers.cadre.cwd, root);
  }
  assert.equal(copilotMcp.mcpServers.cadre.type, "local");
  assert.deepEqual(copilotMcp.mcpServers.cadre.tools, ["*"]);
  const claudeManifest = readJson(path.join(claudePlugin, ".claude-plugin", "plugin.json"));
  assert.equal(Object.prototype.hasOwnProperty.call(claudeManifest, "agents"), false);
  const copilotManifest = readJson(path.join(copilotPlugin, "plugin.json"));
  assert.equal(copilotManifest.mcpServers, "./.mcp.json");
  const antigravityManifest = readJson(path.join(antigravityCliPlugin, "plugin.json"));
  assert.equal(antigravityManifest.$schema, "https://antigravity.google/schemas/v1/plugin.json");
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
  const antigravitySettings = readJson(path.join(home, ".gemini", "antigravity-cli", "settings.json"));
  assert.deepEqual(antigravitySettings.permissions.allow, ["mcp(cadre/*)"]);

  const commandLog = fs.readFileSync(log, "utf8");
  assert.match(commandLog, /codex plugin marketplace add/);
  assert.match(commandLog, /codex plugin add cadre@cadre/);
  assert.match(commandLog, /claude plugin marketplace add --scope user/);
  assert.match(commandLog, /claude plugin install --scope user cadre@cadre/);
  assert.match(commandLog, /claude plugin update --scope user cadre@cadre/);
  assert.match(commandLog, /copilot plugin install/);
  assert.match(commandLog, /agy plugin install/);
});

test("cadre install --target all tolerates missing optional client command", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-install-missing-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  const cadreHome = path.join(home, ".cadre");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  installFakeClient(bin, "claude", log);
  installFakeClient(bin, "agy", log);

  const result = runCli(["install", "--target", "all", "--scope", "user", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /copilot command not found; plugin files were written but native registration was skipped/);
  assert.equal(fs.existsSync(path.join(cadreHome, "marketplaces", "copilot", "plugins", "cadre", "skills", "cadre", "SKILL.md")), true);
  const commandLog = fs.readFileSync(log, "utf8");
  assert.match(commandLog, /codex plugin add cadre@cadre/);
  assert.match(commandLog, /claude plugin install --scope user cadre@cadre/);
  assert.match(commandLog, /agy plugin install/);
  assert.doesNotMatch(commandLog, /copilot plugin install/);
});

test("cadre uninstall --dry-run plans native and file cleanup", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-uninstall-dry-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  const cadreHome = path.join(home, ".cadre");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  const pluginRoot = path.join(cadreHome, "marketplaces", "codex", "plugins", "cadre");
  write(path.join(pluginRoot, "skills", "cadre", "SKILL.md"), "# Cadre\n");

  const result = runCli(["uninstall", "--target", "codex", "--dry-run"], installEnv(home, bin, { CADRE_HOME: cadreHome }));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would remove: .*marketplaces\/codex/);
  assert.match(result.stdout, /Would run: codex plugin remove cadre@cadre/);
  assert.match(result.stdout, /Would run: codex plugin marketplace remove cadre/);
  assert.equal(fs.existsSync(pluginRoot), true);
  assert.equal(fs.existsSync(log), false);
});

test("cadre uninstall removes thin plugins and invokes native uninstallers", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-uninstall-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  const cadreHome = path.join(home, ".cadre");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  installFakeClient(bin, "claude", log);
  installFakeClient(bin, "copilot", log);
  installFakeClient(bin, "agy", log);

  const install = runCli(["install", "--target", "all", "--scope", "user", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const uninstall = runCli(["uninstall", "--target", "all", "--scope", "user", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);

  assert.equal(fs.existsSync(path.join(cadreHome, "marketplaces", "codex")), false);
  assert.equal(fs.existsSync(path.join(cadreHome, "marketplaces", "claude")), false);
  assert.equal(fs.existsSync(path.join(cadreHome, "marketplaces", "copilot")), false);
  assert.equal(fs.existsSync(path.join(home, ".gemini", "antigravity-cli", "plugins", "cadre")), false);
  assert.equal(fs.existsSync(path.join(home, ".gemini", "config", "plugins", "cadre")), false);

  const commandLog = fs.readFileSync(log, "utf8");
  assert.match(commandLog, /codex plugin remove cadre@cadre/);
  assert.match(commandLog, /codex plugin marketplace remove cadre/);
  assert.match(commandLog, /claude plugin uninstall --scope user --yes cadre@cadre/);
  assert.match(commandLog, /claude plugin marketplace remove --scope user cadre/);
  assert.match(commandLog, /copilot plugin uninstall/);
  assert.match(commandLog, /agy plugin uninstall cadre/);
});

test("cadre install --check validates existing thin plugin", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-check-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  const cadreHome = path.join(home, ".cadre");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  installFakeClient(bin, "copilot", log);
  installFakeClient(bin, "agy", log);

  const install = runCli(["install", "--target", "codex", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const check = runCli(["install", "--check", "--target", "codex"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /Cadre codex plugin is installed/);
  assert.match(check.stdout, /Cadre codex MCP tool approvals are configured/);

  const copilotInstall = runCli(["install", "--target", "copilot", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(copilotInstall.status, 0, copilotInstall.stderr || copilotInstall.stdout);
  const copilotCheck = runCli(["install", "--check", "--target", "copilot"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(copilotCheck.status, 0, copilotCheck.stderr || copilotCheck.stdout);
  assert.match(copilotCheck.stdout, /Cadre copilot plugin is installed/);
  assert.match(copilotCheck.stdout, /may prompt on first use/);

  const antigravityInstall = runCli(["install", "--target", "antigravity", "--yes"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(antigravityInstall.status, 0, antigravityInstall.stderr || antigravityInstall.stdout);
  const antigravityCheck = runCli(["install", "--check", "--target", "antigravity"], installEnv(home, bin, { CADRE_HOME: cadreHome }));
  assert.equal(antigravityCheck.status, 0, antigravityCheck.stderr || antigravityCheck.stdout);
  assert.match(antigravityCheck.stdout, /Cadre antigravity plugin is installed/);
  assert.match(antigravityCheck.stdout, /MCP tool approvals are configured/);
});

test("cadre install writes project-scoped Copilot skill and Antigravity plugin", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-project-"));
  const bin = path.join(home, "bin");
  const project = path.join(home, "project");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(project, { recursive: true });

  const copilot = spawnSync(process.execPath, [cli, "install", "--target", "copilot", "--scope", "project"], {
    cwd: project,
    env: { ...process.env, ...installEnv(home, bin) },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(copilot.status, 0, copilot.stderr || copilot.stdout);
  assert.equal(fs.existsSync(path.join(project, ".github", "skills", "cadre", "SKILL.md")), true);

  const antigravity = spawnSync(process.execPath, [cli, "install", "--target", "antigravity", "--scope", "project"], {
    cwd: project,
    env: { ...process.env, ...installEnv(home, bin) },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(antigravity.status, 0, antigravity.stderr || antigravity.stdout);
  assert.equal(fs.existsSync(path.join(project, ".agents", "plugins", "cadre", "mcp_config.json")), true);
});
