#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
const publicDocsRoot = path.join(repoRoot, "docs");
const protocolDirs = [
  path.join(root, "skills", "cadre", "protocols"),
  path.join(root, ".agents", "skills", "cadre", "protocols"),
  path.join(root, ".claude", "skills", "cadre", "protocols"),
  path.join(root, "plugins", "cadre", "skills", "cadre", "protocols"),
  path.join(root, "plugins", "cadre-claude", "skills", "cadre", "protocols"),
];
const referenceDirs = [
  path.join(root, "scripts", "agent-refs"),
  path.join(root, ".agents", "skills", "cadre", "references"),
  path.join(root, ".claude", "skills", "cadre", "references"),
  path.join(root, "plugins", "cadre", "skills", "cadre", "references"),
  path.join(root, "plugins", "cadre-claude", "skills", "cadre", "references"),
];

function markdownFiles(dir) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join(dir, file));
}

const files = Array.from(new Set([
  ...protocolDirs.flatMap(markdownFiles),
  ...referenceDirs.flatMap(markdownFiles),
  path.join(root, "skills", "cadre", "SKILL.md"),
  path.join(root, ".agents", "skills", "cadre", "SKILL.md"),
  path.join(root, ".claude", "skills", "cadre", "SKILL.md"),
  path.join(root, "plugins", "cadre", "skills", "cadre", "SKILL.md"),
  path.join(root, "plugins", "cadre-claude", "skills", "cadre", "SKILL.md"),
  path.join(root, "templates", "workflow.md"),
  path.join(root, ".agents", "skills", "cadre", "templates", "workflow.md"),
  path.join(root, ".claude", "skills", "cadre", "templates", "workflow.md"),
  path.join(root, "plugins", "cadre", "skills", "cadre", "templates", "workflow.md"),
  path.join(root, "plugins", "cadre-claude", "skills", "cadre", "templates", "workflow.md"),
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
    pattern: /\b(?:edit|write|rewrite|update|regenerate|rebuild)\s+`?tracks\.md`?/i,
  },
  { name: "track index as workflow source", pattern: /tracks\.md.{0,120}(?:authoritative|source of truth)|(?:authoritative|source of truth).{0,120}tracks\.md/i },
];

test("Cadre protocols and workflow template stay packet-only", () => {
  const failures = [];
  for (const file of files) {
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

test("Generated Codex and Claude skill bundles only differ in platform-sliced references", () => {
  const codexSkill = path.join(root, "plugins", "cadre", "skills", "cadre");
  const claudeSkill = path.join(root, "plugins", "cadre-claude", "skills", "cadre");
  const expectedDifferent = new Set([
    "references/parallel-execution.md",
  ]);
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
      if (!same && !expectedDifferent.has(rel)) failures.push(`unexpected platform diff: ${rel}`);
      if (same && expectedDifferent.has(rel)) failures.push(`expected platform diff was identical: ${rel}`);
    }
  }

  visit();
  assert.deepEqual(failures, []);
});

test("Generated plugin manifests and marketplace shims point at expected paths", () => {
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const codexManifest = readJson(path.join(root, "plugins", "cadre", ".codex-plugin", "plugin.json"));
  assert.equal(codexManifest.skills, "./skills/");
  assert.equal(codexManifest.mcpServers, "./.mcp.json");
  assert.equal(fs.existsSync(path.join(root, "plugins", "cadre", ".mcp.json")), true);
  assert.equal(fs.existsSync(path.join(root, "plugins", "cadre", "skills", "cadre", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(root, "plugins", "cadre", "scripts", "mcp", "cadre-server.js")), true);

  const claudeManifest = readJson(path.join(root, "plugins", "cadre-claude", ".claude-plugin", "plugin.json"));
  assert.equal(claudeManifest.skills, "./skills/");
  assert.equal(claudeManifest.agents, "./agents/");
  assert.equal(claudeManifest.mcpServers, "./mcp-config.json");
  assert.equal(fs.existsSync(path.join(root, "plugins", "cadre-claude", "mcp-config.json")), true);
  assert.equal(fs.existsSync(path.join(root, "plugins", "cadre-claude", "skills", "cadre", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(root, "plugins", "cadre-claude", "agents", "cadre-worker.md")), true);

  const harnessCodexMarketplace = readJson(path.join(root, ".agents", "plugins", "marketplace.json"));
  assert.equal(harnessCodexMarketplace.plugins[0].source.path, "./plugins/cadre");
  const harnessClaudeMarketplace = readJson(path.join(root, ".claude-plugin", "marketplace.json"));
  assert.equal(harnessClaudeMarketplace.plugins[0].source, "./plugins/cadre-claude");

  const repoRoot = path.resolve(root, "..");
  const rootCodexMarketplace = readJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"));
  assert.equal(rootCodexMarketplace.plugins[0].source.path, "./harness/plugins/cadre");
  const rootClaudeMarketplace = readJson(path.join(repoRoot, ".claude-plugin", "marketplace.json"));
  assert.equal(rootClaudeMarketplace.plugins[0].source, "./harness/plugins/cadre-claude");
});

test("Install docs use the repo-root Codex sparse plugin path", () => {
  for (const file of [path.join(repoRoot, "README.md"), path.join(publicDocsRoot, "getting-started.md")]) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /--sparse harness\/plugins\/cadre/);
    assert.doesNotMatch(text, /--sparse plugins\/cadre(?!-)/);
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

  const harnessTemplates = [
    path.join(root, "templates", "ci", "cadre-harness-check.github.yml"),
    path.join(root, "templates", "ci", "cadre-harness-check.gitlab.yml"),
  ];
  for (const file of harnessTemplates) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /pnpm check/);
    assert.doesNotMatch(text, /templates\/scripts|cadre-regen-index/);
  }
});

test("Hidden local skill discovery dirs contain only Cadre output", () => {
  for (const dir of [path.join(root, ".agents", "skills"), path.join(root, ".claude", "skills")]) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(entries, ["cadre"], path.relative(root, dir));
  }
});

test("User-facing workflow docs stay packet-owned", () => {
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
