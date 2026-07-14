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
  path.join(generatedRoot, "plugins", "cadre-copilot", "skills", "cadre"),
  path.join(generatedRoot, "plugins", "cadre-antigravity", "skills", "cadre"),
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

test("Skill shim is a self-contained packet-led bootstrap", () => {
  for (const dir of skillDirs) {
    const shim = path.join(dir, "SKILL.md");
    const text = fs.readFileSync(shim, "utf8");
    assert.match(text, /Call `cadre_workflow` directly/);
    assert.match(text, /`cadre_action`/);
    assert.match(text, /`cadre_read`/);
    assert.doesNotMatch(text, /cadre:\/\/skill-contract/);
    assert.ok(Math.ceil(text.length / 4) <= 1000, path.relative(root, shim));
  }
  assert.equal(fs.existsSync(path.join(masterSkillDir, "skill.json")), true);
  for (const dir of generatedSkillDirs) {
    assert.equal(fs.existsSync(path.join(dir, "skill.json")), false, path.relative(root, dir));
  }
});

test("Master skill JSON is a conditional v1 reference contract", () => {
  const skill = readJson(path.join(masterSkillDir, "skill.json"));
  assert.equal(skill.schema, "cadre.skill.v1");
  assert.equal(skill.activation.tool, "cadre_workflow");
  assert.equal(skill.activation.protocol_reads_required, false);
  assert.ok(skill.invariants.some((rule) => /never truncated/.test(rule)));
  assert.ok(skill.workflows.includes("implement"));
  assert.ok(skill.references.every((reference) => reference.id && reference.when));
});

test("Generated Codex and Claude plugins expose explicit workflow command skills", () => {
  const contract = readJson(path.join(masterSkillDir, "skill.json"));
  const expectedCommands = [...contract.workflows].sort();
  const codexSkills = path.join(generatedRoot, "plugins", "cadre", "skills");
  const claudeSkills = path.join(generatedRoot, "plugins", "cadre-claude", "skills");
  for (const [platform, skills] of [["Codex", codexSkills], ["Claude", claudeSkills]]) {
    const actualCommands = fs.readdirSync(skills, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(actualCommands, expectedCommands, `${platform} workflow command set`);
  }
  assert.equal(fs.existsSync(path.join(codexSkills, "cadre")), false);
  assert.equal(fs.existsSync(path.join(claudeSkills, "cadre")), false);

  for (const command of expectedCommands) {
    const workflow = command;
    const codexSkill = fs.readFileSync(path.join(codexSkills, command, "SKILL.md"), "utf8");
    const claudeSkill = fs.readFileSync(path.join(claudeSkills, command, "SKILL.md"), "utf8");
    const metadata = fs.readFileSync(path.join(codexSkills, command, "agents", "openai.yaml"), "utf8");
    for (const [platform, skill] of [["Codex", codexSkill], ["Claude", claudeSkill]]) {
      assert.match(skill, new RegExp(`^---\\nname: "${command}"`, "m"));
      assert.ok(skill.includes(`workflow:"${workflow}"`), `${platform} ${command} has the wrong workflow binding`);
      assert.match(skill, /Call `cadre_workflow`/);
      assert.match(skill, /exactly\s+`next\.tool` with `next\.arguments`/);
      assert.ok(Math.ceil(skill.length / 4) <= 450, `${platform} ${command} exceeds the command-skill budget`);
    }
    assert.doesNotMatch(codexSkill, /disable-model-invocation/);
    assert.match(claudeSkill, /disable-model-invocation: true/);
    assert.equal(fs.existsSync(path.join(claudeSkills, command, "agents")), false);
    assert.match(metadata, /interface:\n  display_name: "Cadre [^"]+"\n  short_description: "[^"]+"/);
    assert.match(metadata, /policy:\n  allow_implicit_invocation: false\n$/);
  }

  for (const plugin of ["cadre-copilot", "cadre-antigravity"]) {
    const skills = path.join(generatedRoot, "plugins", plugin, "skills");
    assert.deepEqual(fs.readdirSync(skills).sort(), ["cadre"], `${plugin} should retain only its generic skill`);
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
  const copilotFiles = collectFiles(path.join(generatedRoot, "plugins", "cadre-copilot")).sort();
  const antigravityFiles = collectFiles(path.join(generatedRoot, "plugins", "cadre-antigravity")).sort();
  for (const file of [
    ".codex-plugin/plugin.json",
    ".mcp.json",
  ]) {
    assert.ok(codexFiles.includes(file), `missing Codex plugin file ${file}`);
  }
  for (const file of [
    ".claude-plugin/plugin.json",
    "mcp-config.json",
  ]) {
    assert.ok(claudeFiles.includes(file), `missing Claude plugin file ${file}`);
  }
  for (const command of readJson(path.join(masterSkillDir, "skill.json")).workflows) {
    assert.ok(claudeFiles.includes(`skills/${command}/SKILL.md`), `missing Claude plugin command ${command}`);
  }
  for (const file of [
    "plugin.json",
    ".mcp.json",
    "skills/cadre/SKILL.md",
  ]) {
    assert.ok(copilotFiles.includes(file), `missing Copilot plugin file ${file}`);
  }
  for (const file of [
    "plugin.json",
    "mcp_config.json",
    "skills/cadre/SKILL.md",
  ]) {
    assert.ok(antigravityFiles.includes(file), `missing Antigravity plugin file ${file}`);
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
    assert.equal(copilotFiles.includes(file), false, `unexpected Copilot plugin file ${file}`);
    assert.equal(antigravityFiles.includes(file), false, `unexpected Antigravity plugin file ${file}`);
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
        "workflow",
        "inputs",
        "transitions",
        "approval",
        "references",
      ]) {
        if (!Object.prototype.hasOwnProperty.call(protocol, key)) failures.push(`${rel}: missing ${key}`);
      }
      if (protocol.schema !== "cadre.protocol.v1" || protocol.version !== 1) failures.push(`${rel}: wrong schema`);
      if (!Array.isArray(protocol.transitions) || protocol.transitions.length < 2) failures.push(`${rel}: short transitions`);
      if (!protocol.references.every((reference) => reference.id && reference.when)) failures.push(`${rel}: unconditional reference`);
      if (JSON.stringify(protocol).length > 1200) failures.push(`${rel}: protocol exceeds compact budget`);
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
        assert.equal(reference.platforms.copilot.agentIdentifier, "copilot");
        assert.equal(reference.platforms.antigravity.agentIdentifier, "antigravity");
        assert.equal(typeof reference.platforms.codex.dispatch, "string");
        assert.equal(typeof reference.platforms.claude.dispatch, "string");
        assert.equal(typeof reference.platforms.copilot.dispatch, "string");
        assert.equal(typeof reference.platforms.antigravity.dispatch, "string");
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

test("Protocol approval matrix distinguishes documents, execution, and read-only commands", () => {
  const required = new Map([
    ["archive", "execute"],
    ["artifacts", "execute"],
    ["debug", "execute"],
    ["flag", "execute"],
    ["formula", "execute_for_mutations"],
    ["handoff", "document_staged"],
    ["implement", "execute"],
    ["land", "execute"],
    ["newtrack", "document_staged"],
    ["refresh", "document_staged_when_patterns_change"],
    ["release", "document_staged"],
    ["revert", "execute"],
    ["review", "none"],
    ["revise", "document_staged"],
    ["setup", "document_staged"],
    ["ship", "execute"],
    ["skill", "document_staged_for_create_update_execute_for_rename_remove"],
    ["status", "none"],
    ["validate", "none"],
  ]);
  const failures = [];
  for (const dir of protocolDirs) {
    for (const [workflow, approval] of required.entries()) {
      const file = path.join(dir, `cadre-${workflow}.json`);
      const protocol = readJson(file);
      if (protocol.approval !== approval) failures.push(`${path.relative(root, file)}: expected ${approval}, received ${protocol.approval}`);
      if (approval.includes("document_staged")) {
        if (!protocol.transitions.some((step) => /review/.test(step))) failures.push(`${path.relative(root, file)}: missing document review transition`);
        if (!protocol.references.some((reference) => reference.id === "approval-and-generation" && reference.when)) failures.push(`${path.relative(root, file)}: missing document approval reference`);
      }
      if (approval.includes("execute") && !protocol.transitions.includes("execute")) failures.push(`${path.relative(root, file)}: missing execute transition`);
    }
  }
  assert.deepEqual(failures, []);
});

test("Workflow contracts teach repository-owned project skills", () => {
  const skill = readJson(path.join(masterSkillDir, "skill.json"));
  assert.ok(skill.invariants.some((rule) => /project-skill rules/.test(rule)));
  const implement = readJson(path.join(masterSkillDir, "protocols", "cadre-implement.json"));
  assert.ok(implement.transitions.includes("apply_project_rules"));
  for (const file of [
    path.join(publicDocsRoot, "getting-started.md"),
    path.join(publicDocsRoot, "workflows.md"),
    path.join(publicDocsRoot, "team-and-polyrepo.md"),
  ]) {
    assert.match(fs.readFileSync(file, "utf8"), /cadre\/skills/);
  }
});

test("Generated Codex and Claude skill bundles are identical JSON contracts", () => {
  const codexSkill = path.join(generatedRoot, ".agents", "skills", "cadre");
  const claudeSkill = path.join(generatedRoot, ".claude", "skills", "cadre");
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
  const workflowSkills = new Set(readJson(path.join(masterSkillDir, "skill.json")).workflows);

  const codexFiles = new Set(collectFiles(codexPlugin));
  const claudeFiles = new Set(collectFiles(claudePlugin));
  const allFiles = Array.from(new Set([...codexFiles, ...claudeFiles])).sort();
  const failures = [];

  for (const rel of allFiles) {
    const [rootDir, skillName] = rel.split("/");
    if (intentionalDifferences.has(rel)) continue;
    if (rootDir === "skills" && workflowSkills.has(skillName)) {
      if (rel === `skills/${skillName}/agents/openai.yaml`) {
        if (!codexFiles.has(rel)) failures.push(`missing Codex command metadata: ${rel}`);
        if (claudeFiles.has(rel)) failures.push(`unexpected Claude command metadata: ${rel}`);
        continue;
      }
      if (rel === `skills/${skillName}/SKILL.md`) {
        if (!codexFiles.has(rel)) failures.push(`missing from Codex bundle: ${rel}`);
        if (!claudeFiles.has(rel)) failures.push(`missing from Claude bundle: ${rel}`);
        if (codexFiles.has(rel) && claudeFiles.has(rel)) {
          const codexText = fs.readFileSync(path.join(codexPlugin, rel), "utf8");
          const claudeText = fs.readFileSync(path.join(claudePlugin, rel), "utf8");
          if (claudeText.replace("disable-model-invocation: true\n", "") !== codexText) {
            failures.push(`unexpected command skill diff: ${rel}`);
          }
        }
        continue;
      }
      failures.push(`unexpected workflow skill file: ${rel}`);
      continue;
    }
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
  const packageVersion = readJson(path.join(root, "package.json")).version;
  assert.equal(codexManifest.version, packageVersion);
  assert.equal(codexManifest.skills, "./skills/");
  assert.equal(codexManifest.mcpServers, "./.mcp.json");
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", ".mcp.json")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "skills", "cadre")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "skills", "cadre", "skill.json")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "skills", "cadre", "protocols")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "references")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "templates")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "assets")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "agents")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "README.md")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre", "scripts")), false);

  const claudeManifest = readJson(path.join(generatedRoot, "plugins", "cadre-claude", ".claude-plugin", "plugin.json"));
  assert.equal(claudeManifest.version, packageVersion);
  assert.equal(claudeManifest.skills, "./skills/");
  assert.equal(Object.prototype.hasOwnProperty.call(claudeManifest, "agents"), false);
  assert.equal(claudeManifest.mcpServers, "./mcp-config.json");
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-claude", "mcp-config.json")), true);
  const claudeSkills = path.join(generatedRoot, "plugins", "cadre-claude", "skills");
  const workflowCommands = [...readJson(path.join(masterSkillDir, "skill.json")).workflows].sort();
  assert.deepEqual(fs.readdirSync(claudeSkills).sort(), workflowCommands);
  assert.equal(fs.existsSync(path.join(claudeSkills, "cadre")), false);
  for (const command of workflowCommands) {
    const skill = fs.readFileSync(path.join(claudeSkills, command, "SKILL.md"), "utf8");
    assert.match(skill, /disable-model-invocation: true/);
    assert.equal(fs.existsSync(path.join(claudeSkills, command, "agents")), false);
  }
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
  const copilotManifest = readJson(path.join(generatedRoot, "plugins", "cadre-copilot", "plugin.json"));
  assert.equal(copilotManifest.version, packageVersion);
  assert.equal(copilotManifest.skills, "./skills/");
  assert.equal(copilotManifest.mcpServers, "./.mcp.json");
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", ".mcp.json")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "skills", "cadre", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "skills", "cadre", "skill.json")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "skills", "cadre", "protocols")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "references")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "templates")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "assets")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "agents")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "README.md")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-copilot", "scripts")), false);
  const copilotMcp = readJson(path.join(generatedRoot, "plugins", "cadre-copilot", ".mcp.json"));
  assert.equal(copilotMcp.mcpServers.cadre.type, "local");
  assert.deepEqual(copilotMcp.mcpServers.cadre.tools, ["*"]);

  const antigravityManifest = readJson(path.join(generatedRoot, "plugins", "cadre-antigravity", "plugin.json"));
  assert.equal(antigravityManifest.version, packageVersion);
  assert.equal(antigravityManifest.$schema, "https://antigravity.google/schemas/v1/plugin.json");
  assert.equal(antigravityManifest.name, "cadre");
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "mcp_config.json")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "skills", "cadre", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "skills", "cadre", "skill.json")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "skills", "cadre", "protocols")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "references")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "templates")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "assets")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "agents")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "README.md")), false);
  assert.equal(fs.existsSync(path.join(generatedRoot, "plugins", "cadre-antigravity", "scripts")), false);
  const antigravityMcp = readJson(path.join(generatedRoot, "plugins", "cadre-antigravity", "mcp_config.json"));
  assert.equal(codexMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(codexMcp.mcpServers.cadre.args, []);
  assert.equal(claudeMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(claudeMcp.mcpServers.cadre.args, []);
  assert.equal(copilotMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(copilotMcp.mcpServers.cadre.args, []);
  assert.equal(antigravityMcp.mcpServers.cadre.command, "cadre-mcp");
  assert.deepEqual(antigravityMcp.mcpServers.cadre.args, []);
  assert.equal(codexMcp.mcpServers.cadre.cwd, ".");
  assert.equal(claudeMcp.mcpServers.cadre.cwd, ".");
  assert.equal(copilotMcp.mcpServers.cadre.cwd, ".");
  assert.equal(antigravityMcp.mcpServers.cadre.cwd, ".");

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
    path.join(generatedRoot, "plugins", "cadre-copilot"),
    path.join(generatedRoot, "plugins", "cadre-antigravity"),
  ]) {
    assert.equal(fs.existsSync(path.join(pluginDir, "assets")), false, `${path.relative(root, pluginDir)} should not ship assets`);
    assert.equal(fs.existsSync(path.join(pluginDir, "agents")), false, `${path.relative(root, pluginDir)} should not ship platform worker agents`);
    assert.equal(fs.existsSync(path.join(pluginDir, "scripts")), false, `${path.relative(root, pluginDir)} should not copy MCP runtime`);
  }
  const server = path.join(root, "scripts", "mcp", "cadre-server.js");
  const text = fs.readFileSync(server, "utf8");
  const embeddedMatch = text.match(/^const __CADRE_EMBEDDED_ASSETS__ = (.+);$/m);
  assert.ok(embeddedMatch, "global cadre-mcp should embed setup templates");
  const embeddedAssets = JSON.parse(embeddedMatch[1]);
  assert.deepEqual(Object.keys(embeddedAssets), ["templates"]);
  assert.equal(typeof embeddedAssets.templates["manifest.json"], "string");
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
    "scripts/cadre-lsp-review.js",
    "scripts/cadre-lsp-setup.js",
    "scripts/mcp/cadre-server.js",
  ]) {
    assert.ok(files.includes(file), `packlist missing ${file}`);
  }
  for (const file of ["scripts/cadre-job-runner.js", "scripts/cadre-lsp-daemon.js"]) {
    assert.equal(files.includes(file), false, `packlist should exclude obsolete standalone runtime ${file}`);
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

test("Monorepo CI templates slurp metadata streams before rebuilding the track index", () => {
  const targetTemplates = [
    path.join(root, "templates", "ci", "cadre-monorepo-check.github.yml"),
    path.join(root, "templates", "ci", "cadre-monorepo-check.gitlab.yml"),
  ];
  for (const file of targetTemplates) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(
      text,
      /jq -sS '\{[\s\S]*?tracks: \(sort_by\(\.track_id\)\)[\s\S]*?\}' "\$entries" > "\$expected"/,
      `${path.relative(root, file)} must slurp the newline-delimited metadata objects into an array`,
    );
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
    { name: "direct provider shell command", pattern: /\b(?:gh|glab)\s+\S+/i },
    { name: "old index command", pattern: /cadre-status\s+--regen-index/i },
    { name: "stale product guidelines file", pattern: /product-guidelines\.md/i },
    { name: "manual plan mutation", pattern: /\b(?:edit|write|rewrite|mark|change)\s+`?plan\.md`?/i },
    { name: "Markdown canonical state", pattern: /Markdown.{0,80}(?:authoritative|canonical)|(?:authoritative|canonical).{0,80}Markdown/i },
  ];
  const allowed = [];
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

test("Retired external task-state integration has no public references", () => {
  const legacy = String.fromCharCode(98, 101, 97, 100, 115);
  const shortCli = String.fromCharCode(98, 100);
  const patterns = [
    new RegExp(legacy, "i"),
    new RegExp(`\\.${legacy}`, "i"),
    new RegExp(`\\b${shortCli}\\s`),
    new RegExp(`cadre_${legacy}`, "i"),
    new RegExp(`${legacy}_`, "i"),
    new RegExp(`create_${legacy}_tree`, "i"),
  ];
  const allowed = new Set(["harness/CHANGELOG.md"]);
  const tracked = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(tracked.status, 0, tracked.stderr || tracked.stdout);
  const failures = [];
  const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".sh", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
  for (const rel of tracked.stdout.split(/\r?\n/).filter(Boolean)) {
    if (allowed.has(rel)) continue;
    const file = path.join(repoRoot, rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
    if (!textExtensions.has(path.extname(rel))) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const line = text.slice(0, match.index).split("\n").length;
      failures.push(`${rel}:${line}: ${match[0]}`);
      break;
    }
  }
  assert.deepEqual(failures, []);
});
