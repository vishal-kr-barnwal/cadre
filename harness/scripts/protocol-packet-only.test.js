#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
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
  path.join(root, "docs", "BEADS_INTEGRATION.md"),
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

test("User-facing workflow docs stay packet-owned", () => {
  const docs = [
    path.join(root, "README.md"),
    path.join(root, "docs", "PLATFORM_USAGE.md"),
    path.join(root, "docs", "manual-workflow-guide.md"),
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
      failures.push(`${path.relative(root, file)}:${line}: ${rule.name}: ${match[0]}`);
    }
  }
  assert.deepEqual(failures, []);
});
