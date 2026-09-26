import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser/lib/esm/main.js";
import { TEMPLATE_IDS, TEMPLATE_SET_VERSIONS, expectedTemplatePayloadPaths, templateCatalog } from "../src/domain/templates.js";
import { TEMPLATE_SET_VERSION } from "../src/domain/version.js";
import { CADRE_MCP_TOOL_NAMES } from "../src/mcp/tool-names.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cadre-cli.mjs");

function installFakeClient(bin: string, name: "codex" | "claude" | "zed", log: string): void {
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
  assert.equal(version.stdout.trim(), "3.9.0");

  const doctor = runCli(["doctor"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /cadre-ai@3\.9\.0/);
  assert.match(doctor.stdout, new RegExp(`template catalog: ${TEMPLATE_IDS.length}/${TEMPLATE_IDS.length}`));
  assert.match(doctor.stdout, /self-contained runtime: ok/);

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { "cadre-ai": "dist/cadre-cli.mjs" });
  assert.equal(manifest.dependencies, undefined);
});

test("npm package carries every workflow and immutable template payload", () => {
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const reports = JSON.parse(packed.stdout) as Array<{ files?: Array<{ path?: string }> }>;
  const files = new Set(reports[0]?.files?.map((entry) => entry.path) ?? []);

  for (const path of [
    "dist/cadre-cli.mjs", "dist/cadre-mcp.mjs", ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json", ".mcp.codex.json", ".mcp.json",
    "CHANGELOG.md",
    "agents/cadre-phase-worker.md", "agents/cadre-task-worker.md",
    `templates/${TEMPLATE_SET_VERSION}/init/wisps/.gitkeep`
  ]) {
    assert.ok(files.has(path), `npm package is missing ${path}`);
  }
  for (const skill of [
    "create", "track", "implement", "review", "revise",
    "archive", "refresh", "revert", "status", "wisp"
  ]) {
    assert.ok(files.has(`skills/${skill}/SKILL.md`), `npm package is missing the ${skill} workflow`);
  }
  for (const version of TEMPLATE_SET_VERSIONS) {
    for (const relativePath of expectedTemplatePayloadPaths(version)) {
      const path = `templates/${version}/${relativePath}`;
      assert.ok(files.has(path), `npm package is missing immutable template payload ${path}`);
    }
  }
  for (const template of templateCatalog()) {
    const path = `templates/${TEMPLATE_SET_VERSION}/${template.relativePath}`;
    assert.ok(files.has(path), `npm package is missing live template ${template.id} at ${path}`);
  }
});

test("doctor and installer reject incomplete current and legacy immutable template payloads", () => {
  const verifyMissingPayload = (version: string) => {
    const packageRoot = mkdtempSync(join(tmpdir(), `cadre-broken-${version}-package-`));
    for (const entry of ["dist", ".codex-plugin", ".claude-plugin", "skills", "templates"]) {
      cpSync(join(root, entry), join(packageRoot, entry), { recursive: true });
    }
    unlinkSync(join(packageRoot, "templates", version, "init", "gitignore.template"));

    const doctor = spawnSync(process.execPath, [join(packageRoot, "dist", "cadre-cli.mjs"), "doctor"], {
      cwd: packageRoot,
      encoding: "utf8",
      timeout: 10_000
    });
    assert.equal(doctor.status, 1, doctor.stderr || doctor.stdout);
    assert.match(doctor.stderr, new RegExp(`${version} \\(missing init/gitignore\\.template`));

    const marketplace = join(packageRoot, "marketplaces", "cadre");
    const install = spawnSync(process.execPath, [
      join(packageRoot, "dist", "cadre-cli.mjs"), "install", "--target", "all", "--prepare-only",
      "--marketplace-root", marketplace
    ], {
      cwd: packageRoot,
      encoding: "utf8",
      timeout: 10_000
    });
    assert.equal(install.status, 1, install.stderr || install.stdout);
    assert.match(install.stderr, new RegExp(`${version} \\(missing init/gitignore\\.template`));
    assert.equal(existsSync(marketplace), false);
  };

  verifyMissingPayload(TEMPLATE_SET_VERSION);
  verifyMissingPayload("v5");
});

test("global CLI installs and uninstalls Codex, Claude, and Zed from packaged assets", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-global-cli-"));
  const bin = join(home, "bin");
  const log = join(home, "client-commands.log");
  mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "codex", log);
  installFakeClient(bin, "claude", log);
  installFakeClient(bin, "zed", log);
  const environment = cliEnv(home, bin);
  const cadreHome = join(home, ".cadre");
  const marketplace = join(cadreHome, "marketplaces", "cadre");
  const zedSettings = join(home, ".config", "zed", "settings.json");
  mkdirSync(dirname(zedSettings), { recursive: true });
  writeFileSync(zedSettings, "// Preserve this comment\n{\n  \"theme\": \"One Dark\"\n}\n");

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
  for (const workflow of [
    "create", "track", "implement", "review", "revise",
    "archive", "refresh", "revert", "status", "wisp"
  ]) {
    const adapter = join(plugin, "zed-skills", `cadre-${workflow}`, "SKILL.md");
    const link = join(home, ".agents", "skills", `cadre-${workflow}`);
    assert.match(readFileSync(adapter, "utf8"), new RegExp(`^name: cadre-${workflow}$`, "m"));
    assert.match(readFileSync(adapter, "utf8"), /contentMode: "text"/);
    assert.ok(existsSync(join(link, "SKILL.md")));
    assert.equal(realpathSync(join(link, "SKILL.md")), realpathSync(adapter));
  }
  // Exercise the actual packaged paths, including Zed's global symlink layout.
  // Reference paths are relative to their owning SKILL.md, not the reference file.
  for (const skillsRoot of [join(plugin, "skills"), join(plugin, "zed-skills"), join(home, ".agents/skills")]) {
    const prefix = skillsRoot === join(plugin, "skills") ? "" : "cadre-";
    for (const workflow of ["implement", "review"]) {
      const packaged = readFileSync(join(skillsRoot, `${prefix}${workflow}`, "SKILL.md"), "utf8");
      // Packaging retains the self-contained workflow; host adaptation only adds its compatibility header.
      const source = readFileSync(join(root, "skills", workflow, "SKILL.md"), "utf8");
      const content = source.slice(source.indexOf("# Cadre"));
      assert.ok(packaged.includes(content));
      assert.equal(existsSync(join(skillsRoot, `${prefix}${workflow}`, "references/autonomous-review.md")), false);
    }
  }
  const zedBody = readFileSync(zedSettings, "utf8");
  assert.match(zedBody, /\/\/ Preserve this comment/);
  assert.match(zedBody, /"theme": "One Dark"/);
  assert.match(zedBody, new RegExp(join(plugin, "dist", "cadre-mcp.mjs").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const tool of CADRE_MCP_TOOL_NAMES) {
    assert.match(zedBody, new RegExp(`"mcp:cadre:${tool}"`));
  }

  const uninstall = runCli(["uninstall", "--target", "all", "--home", cadreHome], environment);
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  assert.equal(existsSync(marketplace), false);
  assert.equal(existsSync(join(home, ".agents", "skills", "cadre-create")), false);
  const retainedZedBody = readFileSync(zedSettings, "utf8");
  const retainedZed = parseJsonc(retainedZedBody) as { context_servers?: { cadre?: unknown } };
  assert.equal(retainedZed.context_servers?.cadre, undefined);
  assert.match(retainedZedBody, /"mcp:cadre:project_status"/);

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

test("global CLI auto-detects Zed as a supported client", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-zed-auto-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "zed", join(home, "commands.log"));
  const cadreHome = join(home, ".cadre");

  const result = runCli(["install", "--dry-run", "--home", cadreHome], cliEnv(home, bin));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would install Cadre skills and MCP server for zed at user scope/);
  assert.equal(existsSync(cadreHome), false);
});

test("Zed-only uninstall retains the shared marketplace and removes only owned integration paths", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-zed-only-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "zed", join(home, "commands.log"));
  const environment = cliEnv(home, bin);
  const cadreHome = join(home, ".cadre");
  const marketplace = join(cadreHome, "marketplaces", "cadre");

  const install = runCli(["install", "--target", "zed", "--home", cadreHome], environment);
  assert.equal(install.status, 0, install.stderr || install.stdout);
  assert.ok(existsSync(join(home, ".agents", "skills", "cadre-status", "SKILL.md")));

  const uninstall = runCli(["uninstall", "--target", "zed", "--home", cadreHome], environment);
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  assert.ok(existsSync(marketplace));
  assert.equal(existsSync(join(home, ".agents", "skills", "cadre-status")), false);
  const settings = parseJsonc(readFileSync(join(home, ".config", "zed", "settings.json"), "utf8")) as {
    context_servers?: { cadre?: unknown };
    agent?: { tool_permissions?: { tools?: Record<string, unknown> } };
  };
  assert.equal(settings.context_servers?.cadre, undefined);
  assert.ok(settings.agent?.tool_permissions?.tools?.["mcp:cadre:project_status"]);
});

test("Zed install fails before packaging when a skill destination is not Cadre-owned", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-zed-conflict-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  installFakeClient(bin, "zed", join(home, "commands.log"));
  const conflictingSkill = join(home, ".agents", "skills", "cadre-create");
  mkdirSync(conflictingSkill, { recursive: true });
  writeFileSync(join(conflictingSkill, "SKILL.md"), "user owned\n");
  const cadreHome = join(home, ".cadre");

  const install = runCli(
    ["install", "--target", "zed", "--home", cadreHome],
    cliEnv(home, bin)
  );
  assert.equal(install.status, 1, install.stderr || install.stdout);
  assert.match(install.stderr, /is not owned by Cadre/);
  assert.equal(existsSync(cadreHome), false);
  assert.equal(readFileSync(join(conflictingSkill, "SKILL.md"), "utf8"), "user owned\n");
});

function runSourceCli(args: string[], env = process.env) {
  return spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts", "cli.ts"), ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10_000
  });
}

function doctorEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    CADRE_HOME: join(home, ".cadre"),
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_HOME: join(home, ".claude"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: "/usr/bin:/bin"
  };
}

function installQuietFakeClient(bin: string, name: "codex" | "claude" | "zed"): void {
  const file = join(bin, name);
  const source = `#!${process.execPath}
const args = process.argv.slice(2).join(" ");
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

test("capability adapters register only the current install targets", async () => {
  const { CAPABILITY_TIERS, CLIENT_ADAPTERS, CLIENTS } = await import("../scripts/client-adapters.js");
  assert.deepEqual(CAPABILITY_TIERS, ["full", "managed", "guide-only", "unverified"]);
  assert.deepEqual(
    CLIENT_ADAPTERS.map(({ id, tier, installTarget }) => ({ id, tier, installTarget })),
    [
      { id: "codex", tier: "full", installTarget: true },
      { id: "claude", tier: "full", installTarget: true },
      { id: "zed", tier: "managed", installTarget: true }
    ]
  );
  assert.deepEqual(CLIENTS, ["codex", "claude", "zed"]);
});

test("doctor keeps package health stable and reports absent adapters as advisory JSON evidence", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-doctor-uninstalled-"));
  const environment = doctorEnv(home);
  const human = runSourceCli(["doctor"], environment);
  assert.equal(human.status, 0, human.stderr || human.stdout);
  assert.match(human.stdout, /cadre-ai@3\.9\.0/);
  assert.match(human.stdout, new RegExp(`template catalog: ${TEMPLATE_IDS.length}/${TEMPLATE_IDS.length}`));
  assert.match(human.stdout, /self-contained runtime: ok/);
  assert.match(human.stdout, /capability report:/);
  assert.match(human.stdout, /codex \[full\]: uninstalled/);
  assert.match(human.stdout, /claude \[full\]: uninstalled/);
  assert.match(human.stdout, /zed \[managed\]: uninstalled/);

  const json = runSourceCli(["doctor", "--json"], environment);
  assert.equal(json.status, 0, json.stderr || json.stdout);
  const report = JSON.parse(json.stdout) as {
    package: { state: string; templates: { found: number; required: number } | null };
    clients: Array<{ id: string; tier: string; state: string; evidence: string[]; remediation: string[] }>;
  };
  assert.equal(report.package.state, "healthy");
  assert.deepEqual(report.package.templates, { found: TEMPLATE_IDS.length, required: TEMPLATE_IDS.length });
  assert.deepEqual(
    report.clients.map(({ id, tier, state }) => ({ id, tier, state })),
    [
      { id: "codex", tier: "full", state: "uninstalled" },
      { id: "claude", tier: "full", state: "uninstalled" },
      { id: "zed", tier: "managed", state: "uninstalled" }
    ]
  );
  assert.ok(report.clients.every((client) => client.evidence.length > 0 && client.remediation.length > 0));
  assert.equal(existsSync(join(home, ".cadre")), false);
  assert.equal(existsSync(join(home, ".codex")), false);
  assert.equal(existsSync(join(home, ".claude")), false);
  assert.equal(existsSync(join(home, ".config", "zed")), false);
});

test("doctor reports healthy full and managed adapters after the known installations without rewrites", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-doctor-installed-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  installQuietFakeClient(bin, "codex");
  installQuietFakeClient(bin, "claude");
  installQuietFakeClient(bin, "zed");
  const environment = { ...doctorEnv(home), PATH: `${bin}:/usr/bin:/bin` };
  const cadreHome = join(home, ".cadre");

  const install = runSourceCli(["install", "--target", "all", "--home", cadreHome], environment);
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const codexPath = join(home, ".codex", "config.toml");
  const claudePath = join(home, ".claude", "settings.json");
  const zedPath = join(home, ".config", "zed", "settings.json");
  const before = [readFileSync(codexPath, "utf8"), readFileSync(claudePath, "utf8"), readFileSync(zedPath, "utf8")];

  const result = runSourceCli(["doctor", "--json"], environment);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as {
    clients: Array<{ id: string; tier: string; state: string; remediation: string[] }>;
  };
  assert.deepEqual(
    report.clients.map(({ id, tier, state }) => ({ id, tier, state })),
    [
      { id: "codex", tier: "full", state: "healthy" },
      { id: "claude", tier: "full", state: "healthy" },
      { id: "zed", tier: "managed", state: "healthy" }
    ]
  );
  assert.ok(report.clients.every((client) => client.remediation.length === 0));
  assert.deepEqual(
    [readFileSync(codexPath, "utf8"), readFileSync(claudePath, "utf8"), readFileSync(zedPath, "utf8")],
    before
  );
});

test("doctor reports malformed and conflicting local configuration without repairing either", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-doctor-conflicts-"));
  const claudePath = join(home, ".claude", "settings.json");
  const zedPath = join(home, ".config", "zed", "settings.json");
  mkdirSync(dirname(claudePath), { recursive: true });
  mkdirSync(dirname(zedPath), { recursive: true });
  writeFileSync(claudePath, "{ invalid\n");
  writeFileSync(zedPath, '{"context_servers":{"cadre":{"command":"other","args":[]}}}\n');
  const beforeClaude = readFileSync(claudePath, "utf8");
  const beforeZed = readFileSync(zedPath, "utf8");

  const result = runSourceCli(["doctor", "--json"], doctorEnv(home));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as {
    clients: Array<{ id: string; state: string; evidence: string[] }>;
  };
  const clients = new Map(report.clients.map((client) => [client.id, client]));
  assert.equal(clients.get("claude")?.state, "malformed");
  assert.match(clients.get("claude")?.evidence.join("\n") ?? "", /valid JSONC object/);
  assert.equal(clients.get("zed")?.state, "conflicting");
  assert.match(clients.get("zed")?.evidence.join("\n") ?? "", /does not target the managed Cadre MCP runtime/);
  assert.equal(readFileSync(claudePath, "utf8"), beforeClaude);
  assert.equal(readFileSync(zedPath, "utf8"), beforeZed);
  assert.equal(existsSync(join(home, ".cadre")), false);
  assert.equal(existsSync(join(home, ".agents")), false);
});

test("doctor reports a custom-root Zed installation as healthy without rewrites", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-doctor-custom-root-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  installQuietFakeClient(bin, "zed");
  const environment = { ...doctorEnv(home), PATH: `${bin}:/usr/bin:/bin` };
  const customHome = join(home, "custom-cadre-home");
  const customRoot = join(customHome, "marketplaces", "cadre");

  const install = runSourceCli([
    "install", "--target", "zed", "--marketplace-root", customRoot
  ], environment);
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const zedPath = join(home, ".config", "zed", "settings.json");
  const before = readFileSync(zedPath, "utf8");

  const direct = runSourceCli(["doctor", "--json", "--marketplace-root", customRoot], environment);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const directReport = JSON.parse(direct.stdout) as { clients: Array<{ id: string; state: string }> };
  assert.equal(directReport.clients.find((client) => client.id === "zed")?.state, "healthy");
  assert.equal(readFileSync(zedPath, "utf8"), before);

  const viaHome = runSourceCli(["doctor", "--json", "--home", customHome], environment);
  assert.equal(viaHome.status, 0, viaHome.stderr || viaHome.stdout);
  const homeReport = JSON.parse(viaHome.stdout) as { clients: Array<{ id: string; state: string }> };
  assert.equal(homeReport.clients.find((client) => client.id === "zed")?.state, "healthy");
  assert.equal(readFileSync(zedPath, "utf8"), before);
});

test("doctor rejects invalid option combinations before inspection", () => {
  const home = mkdtempSync(join(tmpdir(), "cadre-doctor-options-"));
  const environment = doctorEnv(home);
  for (const [args, expected] of [
    [["doctor", "--unknown"], /Unknown doctor option: --unknown/],
    [["doctor", "unexpected"], /Unknown doctor option: unexpected/],
    [["doctor", "--home"], /--home requires a value/],
    [["doctor", "--marketplace-root", "--json"], /--marketplace-root requires a value/],
    [["doctor", "--home", join(home, "one"), "--marketplace-root", join(home, "two", "cadre")], /only one of --home or --marketplace-root/],
    [["doctor", "--json", "--json"], /--json may be provided only once/]
  ] as const) {
    const result = runSourceCli([...args], environment);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, expected);
  }
});