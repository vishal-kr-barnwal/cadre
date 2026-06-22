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

  const result = runCli(["install", "--dry-run"], {
    CADRE_HOME: path.join(home, ".cadre"),
    PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would run: codex plugin marketplace add/);
  assert.match(result.stdout, /Would run: claude plugin marketplace add/);
  assert.equal(fs.existsSync(path.join(home, ".cadre")), false);
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

  const result = runCli(["install", "--target", "all", "--scope", "user", "--yes"], {
    CADRE_HOME: cadreHome,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const codexPlugin = path.join(cadreHome, "plugins", "codex", "cadre");
  const claudePlugin = path.join(cadreHome, "plugins", "claude", "cadre");
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

  const commandLog = fs.readFileSync(log, "utf8");
  assert.match(commandLog, /codex plugin marketplace add/);
  assert.match(commandLog, /codex plugin add cadre@cadre/);
  assert.match(commandLog, /claude plugin marketplace add --scope user/);
  assert.match(commandLog, /claude plugin install --scope user cadre@cadre/);
});

test("cadre install --check validates existing thin plugin", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-cli-check-"));
  const bin = path.join(home, "bin");
  const log = path.join(home, "commands.log");
  const cadreHome = path.join(home, ".cadre");
  fs.mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);

  const install = runCli(["install", "--target", "codex", "--yes"], {
    CADRE_HOME: cadreHome,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`,
  });
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const check = runCli(["install", "--check", "--target", "codex"], {
    CADRE_HOME: cadreHome,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`,
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /Cadre codex plugin is installed/);
});
