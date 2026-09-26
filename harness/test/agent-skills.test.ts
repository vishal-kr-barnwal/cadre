import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AGENT_SKILL_LIMITS, validateAgentSkill } from "../scripts/agent-skills.js";
import { CADRE_WORKFLOWS, createZedSkillAdapters } from "../scripts/zed.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function skill(name: string, description = "Summarize state. Use when status is requested.", extra = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# Skill\n`;
}

test("canonical workflow skills conform to the Agent Skills specification", () => {
  assert.equal(CADRE_WORKFLOWS.length, 10);
  for (const workflow of CADRE_WORKFLOWS) {
    const body = readFileSync(join(root, "skills", workflow, "SKILL.md"), "utf8");
    assert.deepEqual(validateAgentSkill(body, workflow), [], workflow);
  }
});

test("generated Zed adapters conform to the Agent Skills specification", () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "cadre-agent-skills-"));
  try {
    cpSync(join(root, "skills"), join(pluginRoot, "skills"), { recursive: true });
    createZedSkillAdapters(pluginRoot);
    for (const workflow of CADRE_WORKFLOWS) {
      const directory = `cadre-${workflow}`;
      const body = readFileSync(join(pluginRoot, "zed-skills", directory, "SKILL.md"), "utf8");
      assert.deepEqual(validateAgentSkill(body, directory), [], directory);
    }
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test("Agent Skills validation rejects invalid names, directories, and descriptions", () => {
  const nameRule = /name must use only lowercase letters, digits, and single hyphens/;
  assert.match(validateAgentSkill(skill("Cadre-Status"), "Cadre-Status").join("\n"), nameRule);
  assert.match(validateAgentSkill(skill("cadre--status"), "cadre--status").join("\n"), nameRule);
  assert.match(validateAgentSkill(skill("cadre-status-"), "cadre-status-").join("\n"), nameRule);
  assert.match(
    validateAgentSkill(skill("cadre-status"), "status").join("\n"),
    /name "cadre-status" must match its parent directory "status"/
  );
  assert.match(
    validateAgentSkill(skill("status", "x".repeat(AGENT_SKILL_LIMITS.descriptionLength + 1)), "status").join("\n"),
    /description must be 1-1024 characters, found 1025/
  );
  assert.deepEqual(validateAgentSkill(skill("status", "x".repeat(AGENT_SKILL_LIMITS.descriptionLength)), "status"), []);
  const longName = "a".repeat(AGENT_SKILL_LIMITS.nameLength + 1);
  assert.match(validateAgentSkill(skill(longName), longName).join("\n"), /name must be 1-64 characters, found 65/);
});

test("Agent Skills validation enforces frontmatter placement, keys, compatibility, and body length", () => {
  assert.deepEqual(validateAgentSkill(`\n${skill("status")}`, "status"), [
    "frontmatter must open the file with a \"---\" line"
  ]);
  assert.match(
    validateAgentSkill(skill("status", undefined, "version: 1\n"), "status").join("\n"),
    /frontmatter key version is not allowed/
  );
  assert.match(
    validateAgentSkill(skill("status", undefined, `compatibility: ${"c".repeat(501)}\n`), "status").join("\n"),
    /compatibility must be 1-500 characters, found 501/
  );
  assert.deepEqual(validateAgentSkill(skill("status", undefined, [
    "license: MIT",
    "compatibility: Requires Git and Node.js 18 or newer.",
    "metadata:",
    "  owner: cadre",
    "allowed-tools: Read Grep",
    ""
  ].join("\n")), "status"), []);
  const frontmatter = "---\nname: status\ndescription: Summarize state.\n---\n";
  assert.deepEqual(validateAgentSkill(`${frontmatter}${"line\n".repeat(AGENT_SKILL_LIMITS.bodyLines)}`, "status"), []);
  assert.match(
    validateAgentSkill(`${frontmatter}${"line\n".repeat(AGENT_SKILL_LIMITS.bodyLines + 1)}`, "status").join("\n"),
    /body has 501 lines; keep it at most 500 lines/
  );
});
