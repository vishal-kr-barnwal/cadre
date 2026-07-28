import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cadre-cli.mjs");

function installFakeClient(bin: string, name: "codex" | "claude", log: string): void {
  const file = join(bin, name);
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2).join(" ");
fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(name + " ")} + args + "\\n");
if (args === "plugin marketplace list --json") {
  process.stdout.write(${JSON.stringify(name === "codex" ? '{"marketplaces":[]}' : "[]")});
} else if (args === "plugin list --json") {
  process.stdout.write(${JSON.stringify(name === "codex"
    ? '{"installed":[{"pluginId":"cadre@cadre","installed":true,"enabled":true}]}'
    : '[{"id":"cadre@cadre","scope":"user","enabled":true}]')});
}
`;
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

function cliEnv(home: string, bin: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    CADRE_HOME: join(home, ".cadre"),
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_HOME: join(home, ".claude"),
    PATH: `${bin}:${process.env.PATH ?? ""}`
  };
}

function runCli(args: string[], env = process.env) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10_000
  });
}

test("global CLI exposes publish identity and self-contained runtime diagnostics", () => {
  const version = runCli(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "3.0.0");

  const doctor = runCli(["doctor"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /cadre-ai@3\.0\.0/);
  assert.match(doctor.stdout, /self-contained runtime: ok/);

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { "cadre-ai": "dist/cadre-cli.mjs" });
  assert.equal(manifest.dependencies, undefined);
});

test("global CLI installs and uninstalls Codex and Claude from packaged assets", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-global-cli-"));
  const bin = join(home, "bin");
  const log = join(home, "client-commands.log");
  mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  installFakeClient(bin, "claude", log);
  const environment = cliEnv(home, bin);
  const cadreHome = join(home, ".cadre");
  const marketplace = join(cadreHome, "marketplaces", "cadre");

  const install = runCli([
    "install", "--target", "all", "--home", cadreHome, "--cachebuster", "global-test"
  ], environment);
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const plugin = join(marketplace, "plugins", "cadre");
  assert.ok(existsSync(join(plugin, "dist", "cadre-mcp.mjs")));
  assert.equal(existsSync(join(plugin, "dist", "cadre-cli.mjs")), false);
  assert.ok(existsSync(join(plugin, "skills", "create", "SKILL.md")));
  assert.ok(existsSync(join(home, ".codex", "config.toml")));
  assert.ok(existsSync(join(home, ".claude", "settings.json")));

  const uninstall = runCli(["uninstall", "--target", "all", "--home", cadreHome], environment);
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  assert.equal(existsSync(marketplace), false);

  const commands = readFileSync(log, "utf8");
  assert.match(commands, /codex plugin marketplace add/);
  assert.match(commands, /codex plugin add cadre@cadre/);
  assert.match(commands, /claude plugin marketplace add/);
  assert.match(commands, /codex plugin remove cadre@cadre --json/);
  assert.match(commands, /claude plugin uninstall --scope user --yes cadre@cadre/);
});

test("global CLI dry runs do not create marketplace state", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-global-dry-run-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", join(home, "commands.log"));
  const cadreHome = join(home, ".cadre");

  const result = runCli(["install", "--dry-run", "--home", cadreHome], cliEnv(home, bin));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would prepare Cadre marketplace/);
  assert.equal(existsSync(cadreHome), false);
});
