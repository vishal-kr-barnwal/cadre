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
const files = [
  ...protocolDirs.flatMap((protocolDir) =>
    fs.readdirSync(protocolDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.join(protocolDir, file))
  ),
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
];

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
