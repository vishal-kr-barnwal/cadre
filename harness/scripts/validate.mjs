#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skills = [
  "cadre-create", "cadre-track", "cadre-implement", "cadre-review", "cadre-revise",
  "cadre-archive", "cadre-refresh", "cadre-revert", "cadre-status", "cadre-wisp"
];
const errors = [];

for (const manifest of [".codex-plugin/plugin.json", ".claude-plugin/plugin.json", "package.json"]) {
  try {
    JSON.parse(readFileSync(join(root, manifest), "utf8"));
  } catch (error) {
    errors.push(`${manifest}: ${error.message}`);
  }
}

for (const skill of skills) {
  const skillPath = join(root, "skills", skill, "SKILL.md");
  const metadataPath = join(root, "skills", skill, "agents", "openai.yaml");
  if (!existsSync(skillPath)) errors.push(`${skill}: missing SKILL.md`);
  if (!existsSync(metadataPath)) errors.push(`${skill}: missing agents/openai.yaml`);
  if (existsSync(skillPath)) {
    const body = readFileSync(skillPath, "utf8");
    if (!body.startsWith(`---\nname: ${skill}\n`)) errors.push(`${skill}: invalid frontmatter name`);
    if (body.includes("TODO")) errors.push(`${skill}: unresolved TODO`);
  }
}

const projectTemplate = join(root, "skills", "cadre-create", "assets", "project", ".cadre");
for (const file of ["workflow.md", "product.md", "guidelines.md", "tech-stack.md", "project.json", "bin/cadre-state.mjs"]) {
  if (!existsSync(join(projectTemplate, file))) errors.push(`project template: missing ${file}`);
}
const learningTemplate = join(projectTemplate, "templates", "track", "learning.md");
if (!readFileSync(learningTemplate, "utf8").includes("<!-- cadre:pattern-seed:start -->")) {
  errors.push("project template: learning.md lacks the marked Pattern Seed section");
}
const projectStateTemplate = JSON.parse(readFileSync(join(projectTemplate, "project.json"), "utf8"));
if (projectStateTemplate.project?.context !== "{{greenfield|brownfield}}") {
  errors.push("project template: project context classification placeholder is missing");
}
const styleguideRoot = join(root, "skills", "cadre-create", "assets", "styleguides");
for (const name of [
  "go", "java", "kotlin", "maven", "gradle", "javascript", "typescript",
  "react", "flutter", "dart", "swift", "swiftui", "python"
]) {
  const path = join(styleguideRoot, `${name}.md`);
  if (!existsSync(path)) errors.push(`default styleguide: missing ${name}.md`);
  else if (!readFileSync(path, "utf8").includes("## Sources")) errors.push(`default styleguide: ${name}.md lacks sources`);
}

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${skills.length} skills and both plugin manifests.\n`);
}
