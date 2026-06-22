#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
const publicDocsRoot = path.join(repoRoot, "docs", "content");
const masterSkillDir = path.join(root, "skills", "cadre");
const generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-generated-fixture-"));
const generatedRepoRoot = path.join(generatedRoot, "root");
const generation = spawnSync("bash", ["scripts/generate-skills.sh"], {
  cwd: root,
  env: {
    ...process.env,
    CADRE_GENERATE_OUT: generatedRoot,
    CADRE_SKIP_RUNTIME_BUILD: "1",
  },
  encoding: "utf8",
});
if (generation.status !== 0) {
  fs.rmSync(generatedRoot, { recursive: true, force: true });
  throw new Error(generation.stderr || generation.stdout || "failed to generate plugin fixture");
}
process.once("exit", () => {
  fs.rmSync(generatedRoot, { recursive: true, force: true });
});
const generatedSkillDirs = [
  path.join(generatedRoot, ".agents", "skills", "cadre"),
  path.join(generatedRoot, ".claude", "skills", "cadre"),
  path.join(generatedRoot, "plugins", "cadre", "skills", "cadre"),
  path.join(generatedRoot, "plugins", "cadre-claude", "skills", "cadre"),
];
const protocolDirs = [
  path.join(masterSkillDir, "protocols"),
];
const referenceDirs = [
  path.join(root, "scripts", "agent-refs"),
];
const skillDirs = [
  masterSkillDir,
  ...generatedSkillDirs,
];
const workflowJsonFiles = [
  path.join(root, "templates", "workflow.json"),
];

function jsonFiles(dir) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(dir, file));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function collectFiles(dir, relativeDir = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(relativeDir, entry.name).split(path.sep).join("/");
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

const jsonContractFiles = Array.from(new Set([
  ...protocolDirs.flatMap(jsonFiles),
  ...referenceDirs.flatMap(jsonFiles),
  path.join(masterSkillDir, "skill.json"),
  ...workflowJsonFiles,
]));

const forbidden = [
  {
    name: "raw Beads state command",
    pattern: /\bbd\s+(?:note|update|create|dep|label|close|ready|show|mail|formula|compact|dolt|sql|worktree|init|list|admin|rules)\b/i,
  },
  { name: "direct JSON state surgery", pattern: /\bjq\b/i },
  { name: "direct GitHub provider command", pattern: /\bgh\s+\S+/i },
  { name: "direct GitLab provider command", pattern: /\bglab\s+\S+/i },
  {
    name: "raw Cadre git orchestration",
    pattern: /\bgit\s+(?:notes|worktree|-C|push|pull|fetch|diff|log|status|config|rev-parse)\b/i,
  },
  { name: "provider command escape hatch", pattern: /provider CLI|CLI fallback|plain-CLI|fall back|fallback/i },
  {
    name: "direct plan marker edits",
    pattern: /\b(?:edit|write|rewrite|update|mark|change)\s+`?plan\.md`?/i,
  },
  {
    name: "direct track index edits",
    pattern: /\b(?:edit|write|rewrite|update|regenerate|rebuild)\s+`?tracks\.(?:md|json)`?/i,
  },
  { name: "track index as workflow source", pattern: /tracks\.(?:md|json).{0,120}(?:authoritative|source of truth)|(?:authoritative|source of truth).{0,120}tracks\.(?:md|json)/i },
];

test("Cadre JSON contracts stay packet-only", () => {
  const failures = [];
  for (const file of jsonContractFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const rule of forbidden) {
      const match = text.match(rule.pattern);
      if (!match) continue;
      const line = text.slice(0, match.index).split("\n").length;
      failures.push(`${path.relative(root, file)}:${line}: ${rule.name}: ${match[0]}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("Skill shim is minimal and points at MCP contract resources", () => {
  for (const dir of skillDirs) {
    const shim = path.join(dir, "SKILL.md");
    const text = fs.readFileSync(shim, "utf8");
    assert.match(text, /cadre:\/\/skill-contract/);
    assert.match(text, /cadre:\/\/workflow-protocols/);
    assert.match(text, /cadre:\/\/workflow-protocol\?workflow=<name>/);
    assert.doesNotMatch(text, /Load `skill\.json`/);
    assert.ok(text.length < 2200, path.relative(root, shim));
  }
  assert.equal(fs.existsSync(path.join(masterSkillDir, "skill.json")), true);
  for (const dir of generatedSkillDirs) {
    assert.equal(fs.existsSync(path.join(dir, "skill.json")), false, path.relative(root, dir));
  }
});

test("Master skill JSON routes workflows and references through MCP resources", () => {
  const skill = readJson(path.join(masterSkillDir, "skill.json"));
  assert.equal(skill.schema, "cadre.skill.v1");
  assert.equal(skill.markdownUse, "human_projection_only");
  assert.equal(skill.activation.requiredRuntime, "Cadre MCP");
  assert.ok(skill.forbidden.some((rule) => /Markdown as alternate input/.test(rule)));
  for (const [workflowName, workflow] of Object.entries(skill.workflows)) {
    assert.equal(workflow.protocol, `cadre://workflow-protocol?workflow=${workflowName}`);
  }
  for (const reference of Object.values(skill.references)) {
    assert.equal(Object.prototype.hasOwnProperty.call(reference, "path"), false);
    assert.match(reference.uri, /^cadre:\/\/agent-reference\?name=[a-z-]+$/);
  }
});

test("Generated skill and plugin bundles collapse Cadre-owned files", () => {
  for (const dir of generatedSkillDirs) {
    assert.deepEqual(collectFiles(dir).sort(), ["SKILL.md"], path.relative(generatedRoot, dir));
    assert.equal(fs.existsSync(path.join(dir, "references")), false, path.relative(generatedRoot, dir));
    assert.equal(fs.existsSync(path.join(dir, "templates")), false, path.relative(generatedRoot, dir));
  }
  const codexFiles = collectFiles(path.join(generatedRoot, "plugins", "cadre")).sort();
  const claudeFiles = collectFiles(path.join(generatedRoot, "plugins", "cadre-claude")).sort();
  for (const file of [
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "skills/cadre/SKILL.md",
  ]) {
    assert.ok(codexFiles.includes(file), `missing Codex plugin file ${file}`);
  }
  for (const file of [
    ".claude-plugin/plugin.json",
    "mcp-config.json",
    "skills/cadre/SKILL.md",
  ]) {
    assert.ok(claudeFiles.includes(file), `missing Claude plugin file ${file}`);
  }
  for (const file of [
    "references/mcp-contract.json",
    "templates/manifest.json",
    "skills/cadre/skill.json",
    "assets/cadre/skill.json",
    "agents/cadre-worker.md",
    "scripts/mcp/cadre-server.js",
  ]) {
    assert.equal(codexFiles.includes(file), false, `unexpected Codex plugin file ${file}`);
    assert.equal(claudeFiles.includes(file), false, `unexpected Claude plugin file ${file}`);
  }
});

test("Protocol files are structured JSON workflow definitions", () => {
  const failures = [];
  for (const dir of protocolDirs) {
    for (const file of jsonFiles(dir)) {
      const protocol = readJson(file);
      const rel = path.relative(root, file);
      for (const key of [
        "id",
        "description",
        "workflow",
        "preconditions",
        "packetFlow",
        "confirmation",
        "forbiddenActions",
        "responseSummary",
        "references",
      ]) {
        if (!Object.prototype.hasOwnProperty.call(protocol, key)) failures.push(`${rel}: missing ${key}`);
      }
      if (protocol.schema !== "cadre.protocol.v1") failures.push(`${rel}: wrong schema`);
      if (protocol.markdownUse !== "human_projection_only") failures.push(`${rel}: wrong markdownUse`);
      if (!Array.isArray(protocol.packetFlow) || protocol.packetFlow.length < 3) failures.push(`${rel}: short packetFlow`);
      for (const [index, step] of (protocol.packetFlow || []).entries()) {
        if (step.step !== index + 1) failures.push(`${rel}: bad packet step ${index + 1}`);
        if (typeof step.instruction !== "string" || step.instruction.length < 40) failures.push(`${rel}: incomplete packet instruction ${index + 1}`);
      }
      if (protocol.confirmation.executeArgument !== "execute") failures.push(`${rel}: missing execute confirmation argument`);
      if (protocol.confirmation.humanConfirmationArgument !== "humanConfirmed") failures.push(`${rel}: missing human confirmation argument`);
      if (!protocol.forbiddenActions.some((rule) => /Markdown/.test(rule))) failures.push(`${rel}: missing Markdown prohibition`);
      if (!protocol.responseSummary.some((item) => /canonical JSON/.test(item))) failures.push(`${rel}: missing canonical JSON response summary`);
    }
  }
  assert.deepEqual(failures, []);
});

test("Reference files are structured JSON and carry agent dispatch in JSON", () => {
  for (const dir of referenceDirs) {
    for (const file of jsonFiles(dir)) {
      const reference = readJson(file);
      assert.equal(reference.schema, "cadre.reference.v1", path.relative(root, file));
      assert.equal(reference.markdownUse, "human_projection_only", path.relative(root, file));
      assert.ok(Array.isArray(reference.rules), path.relative(root, file));
      assert.ok(Array.isArray(reference.sections), path.relative(root, file));
      if (reference.id === "parallel-execution") {
        assert.equal(reference.platforms.codex.agentIdentifier, "codex");
        assert.equal(reference.platforms.claude.agentIdentifier, "claude");
        assert.equal(typeof reference.platforms.codex.dispatch, "string");
        assert.equal(typeof reference.platforms.claude.dispatch, "string");
      }
    }
  }
});

test("Workflow templates include JSON canonical and task-level commit guidance", () => {
  const failures = [];
  for (const file of workflowJsonFiles) {
    const workflow = readJson(file);
    const sections = new Map(workflow.sections.map((section) => [section.heading, section.body]));
    const principles = sections.get("Guiding Principles") || "";
    const commits = sections.get("Commit Discipline") || "";
    if (!/plan\.json/.test(principles)) failures.push(`${path.relative(root, file)}: missing plan.json guidance`);
    if (!/plan\.md/.test(principles) || !/human review only/.test(principles)) failures.push(`${path.relative(root, file)}: missing projection-only guidance`);
    if (!/one product commit per completed task/.test(commits)) failures.push(`${path.relative(root, file)}: missing task-level commit guidance`);
    if (!/commit SHA/.test(commits)) failures.push(`${path.relative(root, file)}: missing packet-owned commit evidence guidance`);
  }
  assert.deepEqual(failures, []);
});

test("Artifact workflow protocols require token-safe review bundles", () => {
  const required = new Map([
    ["cadre-setup.json", "setup"],
    ["cadre-newtrack.json", "newtrack"],
    ["cadre-revise.json", "revise"],
    ["cadre-refresh.json", "refresh"],
    ["cadre-release.json", "release"],
    ["cadre-handoff.json", "handoff"],
    ["cadre-artifacts.json", "artifacts"],
  ]);
  const failures = [];
  for (const dir of protocolDirs) {
    for (const [fileName, workflow] of required.entries()) {
      const file = path.join(dir, fileName);
      const protocol = readJson(file);
      const flow = protocol.packetFlow.map((step) => step.instruction).join("\n");
      if (!/review_bundle/.test(flow)) failures.push(`${path.relative(root, file)}: missing review_bundle for ${workflow}`);
      if (!/manifest\/path list/.test(flow)) failures.push(`${path.relative(root, file)}: missing manifest/path list guidance for ${workflow}`);
      if (!/model\s+context/.test(flow)) failures.push(`${path.relative(root, file)}: missing model-context avoidance for ${workflow}`);
      if (protocol.confirmation.dryRunFirst !== true) failures.push(`${path.relative(root, file)}: missing dry-run-first confirmation for ${workflow}`);
      if (!/humanConfirmed: true/.test(flow)) failures.push(`${path.relative(root, file)}: missing humanConfirmed:true execute guidance for ${workflow}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("Action workflow protocols require packet dry-run confirmation", () => {
  const required = new Map([
    ["cadre-archive.json", "archive"],
    ["cadre-revert.json", "revert"],
    ["cadre-flag.json", "flag"],
  ]);
  const failures = [];
  for (const dir of protocolDirs) {
    for (const [fileName, workflow] of required.entries()) {
      const file = path.join(dir, fileName);
      const protocol = readJson(file);
      const flow = protocol.packetFlow.map((step) => step.instruction).join("\n");
      if (protocol.confirmation.dryRunFirst !== true) failures.push(`${path.relative(root, file)}: missing dry-run review for ${workflow}`);
      if (!/humanConfirmed: true/.test(flow)) failures.push(`${path.relative(root, file)}: missing humanConfirmed:true execute guidance for ${workflow}`);
      if (!protocol.forbiddenActions.some((rule) => /Markdown/.test(rule))) failures.push(`${path.relative(root, file)}: missing no-manual-mutation guidance for ${workflow}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("Generated Codex and Claude skill bundles are identical JSON contracts", () => {
  const codexSkill = path.join(generatedRoot, "plugins", "cadre", "skills", "cadre");
  const claudeSkill = path.join(generatedRoot, "plugins", "cadre-claude", "skills", "cadre");
  const failures = [];

  function visit(relativeDir = "") {
    const codexDir = path.join(codexSkill, relativeDir);
    for (const entry of fs.readdirSync(codexDir, { withFileTypes: true })) {
      const rel = path.join(relativeDir, entry.name).split(path.sep).join("/");
      if (entry.isDirectory()) {
        visit(rel);
        continue;
      }
      const codexFile = path.join(codexSkill, rel);
      const claudeFile = path.join(claudeSkill, rel);
      if (!fs.existsSync(claudeFile)) {
        failures.push(`missing from Claude bundle: ${rel}`);
        continue;
      }
      const same = fs.readFileSync(codexFile, "utf8") === fs.readFileSync(claudeFile, "utf8");
      if (!same) failures.push(`unexpected platform diff: ${rel}`);
    }
  }

  visit();
  assert.deepEqual(failures, []);
});

test("Generated Codex and Claude plugin bundles only differ in intentional overlays", () => {
  const codexPlugin = path.join(generatedRoot, "plugins", "cadre");
  const claudePlugin = path.join(generatedRoot, "plugins", "cadre-claude");
  const intentionalDifferences = new Set([
    ".mcp.json",
    "mcp-config.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
  ]);

  const codexFiles = new Set(collectFiles(codexPlugin));
  const claudeFiles = new Set(collectFiles(claudePlugin));
  const allFiles = Array.from(new Set([...codexFiles, ...claudeFiles])).sort();
  const failures = [];

  for (const rel of allFiles) {
    if (intentionalDifferences.has(rel)) continue;
    if (!codexFiles.has(rel)) {
      failures.push(`missing from Codex bundle: ${rel}`);
      continue;
    }
    if (!claudeFiles.has(rel)) {
      failures.push(`missing from Claude bundle: ${rel}`);
      continue;
    }
    const codexText = fs.readFileSync(path.join(codexPlugin, rel), "utf8");
    const claudeText = fs.readFileSync(path.join(claudePlugin, rel), "utf8");
    if (codexText !== claudeText) failures.push(`unexpected plugin diff: ${rel}`);
  }

  const codexManifest = readJson(path.join(codexPlugin, ".codex-plugin", "plugin.json"));
  const claudeManifest = readJson(path.join(claudePlugin, ".claude-plugin", "plugin.json"));
  const codexMcp = readJson(path.join(codexPlugin, ".mcp.json"));
  const claudeMcp = readJson(path.join(claudePlugin, "mcp-config.json"));
  assert.equal(codexManifest.mcpServers, "./.mcp.json");
  assert.equal(claudeManifest.mcpServers, "./mcp-config.json");
  assert.equal(Object.prototype.hasOwnProperty.call(claudeManifest, "agents"), false);
  assert.equal(codexMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(codexMcp.mcpServers.cadre.args, []);
  assert.equal(codexMcp.mcpServers.cadre.cwd, ".");
  assert.equal(claudeMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(claudeMcp.mcpServers.cadre.args, []);
  assert.equal(claudeMcp.mcpServers.cadre.cwd, ".");

  assert.deepEqual(failures, []);
});

test("Generated plugin manifests and marketplace shims point at expected paths", () => {
  const codexManifest = readJson(path.join(generatedRoot, "plugins", "cadre", ".codex-plugin", "plugin.json"));
  assert.equal(codexManifest.skills, "./skills/");
  assert.equal(codexManifest.mcpServers, "./.mcp.json");
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", ".mcp.json")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "skills", "cadre", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "skills", "cadre", "skill.json")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "skills", "cadre", "protocols")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "references")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "templates")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "assets")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "agents")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "README.md")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "scripts")), false);

  const claudeManifest = readJson(path.join(generatedRoot, "plugins", "cadre-claude", ".claude-plugin", "plugin.json"));
  assert.equal(claudeManifest.skills, "./skills/");
  assert.equal(Object.prototype.hasOwnProperty.call(claudeManifest, "agents"), false);
  assert.equal(claudeManifest.mcpServers, "./mcp-config.json");
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "mcp-config.json")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "skills", "cadre", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "skills", "cadre", "skill.json")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "skills", "cadre", "protocols")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "references")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "templates")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "assets")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "agents")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "README.md")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "scripts")), false);
  const codexMcp = readJson(path.join(generatedRoot, "plugins", "cadre", ".mcp.json"));
  const claudeMcp = readJson(path.join(generatedRoot, "plugins", "cadre-claude", "mcp-config.json"));
  assert.equal(codexMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(codexMcp.mcpServers.cadre.args, []);
  assert.equal(claudeMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(claudeMcp.mcpServers.cadre.args, []);
  assert.equal(codexMcp.mcpServers.cadre.cwd, ".");
  assert.equal(claudeMcp.mcpServers.cadre.cwd, ".");

  const harnessCodexMarketplace = readJson(path.join(generatedRoot, ".agents", "plugins", "marketplace.json"));
  assert.equal(harnessCodexMarketplace.plugins[0].source.path, "./plugins/cadre");
  const harnessClaudeMarketplace = readJson(path.join(generatedRoot, ".claude-plugin", "marketplace.json"));
  assert.equal(harnessClaudeMarketplace.plugins[0].source, "./plugins/cadre-claude");

  const rootCodexMarketplace = readJson(path.join(generatedRepoRoot, ".agents", "plugins", "marketplace.json"));
  assert.equal(rootCodexMarketplace.plugins[0].source.path, "./harness/plugins/cadre");
  const rootClaudeMarketplace = readJson(path.join(generatedRepoRoot, ".claude-plugin", "marketplace.json"));
  assert.equal(rootClaudeMarketplace.plugins[0].source, "./harness/plugins/cadre-claude");
});

test("Generated plugins are thin MCP entrypoints", () => {
  for (const pluginDir of [
    path.join(generatedRoot, "plugins", "cadre"),
    path.join(generatedRoot, "plugins", "cadre-claude"),
  ]) {
    assert.equal(fs.existsSync(path.join(pluginDir, "assets")), false, `${path.relative(root, pluginDir)} should not ship assets`);
    assert.equal(fs.existsSync(path.join(pluginDir, "agents")), false, `${path.relative(root, pluginDir)} should not ship platform worker agents`);
    assert.equal(fs.existsSync(path.join(pluginDir, "scripts")), false, `${path.relative(root, pluginDir)} should not copy MCP runtime`);
  }
  const server = path.join(root, "scripts", "mcp", "cadre-server.js");
  const text = fs.readFileSync(server, "utf8");
  assert.ok(fs.statSync(server).size > 500 * 1024, "global cadre-mcp should embed Cadre assets");
  assert.equal(/__CADRE_EMBEDDED_ASSETS__\s*=\s*\{/.test(text), true, "global cadre-mcp should embed Cadre assets");
});

test("Install docs use the npm-first Cadre AI path", () => {
  for (const file of [path.join(repoRoot, "README.md"), path.join(publicDocsRoot, "getting-started.md")]) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /npm install -g cadre-ai/);
    assert.match(text, /cadre install/);
  }
});

test("NPM packlist contains only publishable runtime files", () => {
  const result = spawnSync("pnpm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.name, "cadre-ai");
  const files = parsed.files.map((entry) => entry.path).sort();
  for (const file of [
    "LICENSE",
    "README.md",
    "package.json",
    "scripts/cadre-cli.js",
    "scripts/cadre-core.js",
    "scripts/cadre-job-runner.js",
    "scripts/cadre-lsp-daemon.js",
    "scripts/cadre-lsp-review.js",
    "scripts/cadre-lsp-setup.js",
    "scripts/mcp/cadre-server.js",
  ]) {
    assert.ok(files.includes(file), `packlist missing ${file}`);
  }
  for (const prefix of ["src/", "plugins/", ".agents/", ".claude/", "templates/", "skills/", "scripts/mcp/cadre-server.external.js"]) {
    assert.equal(files.some((file) => file === prefix || file.startsWith(prefix)), false, `packlist should exclude ${prefix}`);
  }
});

test("Target-project CI templates do not bundle harness-only checks", () => {
  const targetTemplates = [
    path.join(root, "templates", "ci", "cadre-monorepo-check.github.yml"),
    path.join(root, "templates", "ci", "cadre-monorepo-check.gitlab.yml"),
  ];
  const forbiddenTargetText = /pnpm check|scripts\/generate-skills|templates\/scripts|cadre-regen-index/;
  for (const file of targetTemplates) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), forbiddenTargetText, path.relative(root, file));
  }
});

test("Hidden local skill discovery dirs contain only Cadre output", () => {
  for (const dir of [path.join(generatedRoot, ".agents", "skills"), path.join(generatedRoot, ".claude", "skills")]) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(entries, ["cadre"], path.relative(generatedRoot, dir));
  }
});

test("User-facing workflow docs stay packet-owned and JSON-first", () => {
  const docs = [
    path.join(repoRoot, "README.md"),
    path.join(publicDocsRoot, "getting-started.md"),
    path.join(publicDocsRoot, "how-cadre-works.md"),
    path.join(publicDocsRoot, "workflows.md"),
    path.join(publicDocsRoot, "troubleshooting.md"),
  ];
  const forbiddenDocs = [
    { name: "direct Beads workflow command", pattern: /\bbd\s+(?:ready|show|note|update|create|dep|label|close|mail|formula|compact|dolt|sql|worktree|init|list|admin|rules)\b/i },
    { name: "direct provider shell command", pattern: /\b(?:gh|glab)\s+\S+/i },
    { name: "old index command", pattern: /cadre-status\s+--regen-index/i },
    { name: "stale product guidelines file", pattern: /product-guidelines\.md/i },
    { name: "manual plan mutation", pattern: /\b(?:edit|write|rewrite|mark|change)\s+`?plan\.md`?/i },
    { name: "Markdown canonical state", pattern: /Markdown.{0,80}(?:authoritative|canonical)|(?:authoritative|canonical).{0,80}Markdown/i },
  ];
  const allowed = [
    /\bbd\s+--version\b/i,
    /\bnpm\s+install\s+-g\s+@beads\/bd\b/i,
  ];
  const failures = [];
  for (const file of docs) {
    const text = fs.readFileSync(file, "utf8");
    for (const rule of forbiddenDocs) {
      const match = text.match(rule.pattern);
      if (!match) continue;
      const line = text.slice(0, match.index).split("\n").length;
      const lineText = text.split(/\r?\n/)[line - 1] || "";
      if (allowed.some((pattern) => pattern.test(lineText))) continue;
      failures.push(`${path.relative(repoRoot, file)}:${line}: ${rule.name}: ${match[0]}`);
    }
  }
  assert.deepEqual(failures, []);
});
