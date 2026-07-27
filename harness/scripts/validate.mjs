#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skills = [
  "create", "track", "implement", "review", "revise",
  "archive", "refresh", "revert", "status", "wisp"
];
const errors = [];

for (const manifest of [
  ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", "marketplace/codex.json",
  "marketplace/claude.json", "package.json"
]) {
  try {
    JSON.parse(readFileSync(join(root, manifest), "utf8"));
  } catch (error) {
    errors.push(`${manifest}: ${error.message}`);
  }
}

const codexMarketplace = JSON.parse(readFileSync(join(root, "marketplace", "codex.json"), "utf8"));
const claudeMarketplace = JSON.parse(readFileSync(join(root, "marketplace", "claude.json"), "utf8"));
for (const [name, marketplace] of [["Codex", codexMarketplace], ["Claude", claudeMarketplace]]) {
  const entry = marketplace.plugins?.find((plugin) => plugin.name === "cadre");
  if (marketplace.name !== "cadre" || !entry) errors.push(`${name} marketplace: missing cadre entry`);
  else {
    const source = typeof entry.source === "string" ? entry.source : entry.source.path;
    if (source !== "./plugins/cadre") errors.push(`${name} marketplace: invalid local source`);
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

const projectTemplate = join(root, "skills", "create", "assets", "project", ".cadre");
for (const file of ["workflow.md", "product.md", "guidelines.md", "tech-stack.md", "project.json", "bin/cadre-state.mjs", "operations/.gitkeep"]) {
  if (!existsSync(join(projectTemplate, file))) errors.push(`project template: missing ${file}`);
}
const learningTemplate = join(projectTemplate, "templates", "track", "learning.md");
if (!readFileSync(learningTemplate, "utf8").includes("<!-- cadre:pattern-seed:start -->")) {
  errors.push("project template: learning.md lacks the marked Pattern Seed section");
}
const archiveOperationTemplate = join(projectTemplate, "templates", "project", "archive-operation.json");
if (!existsSync(archiveOperationTemplate)) {
  errors.push("project template: missing archive-operation.json");
} else {
  try {
    const archiveOperation = JSON.parse(readFileSync(archiveOperationTemplate, "utf8"));
    if (archiveOperation.action !== "archive" || !Array.isArray(archiveOperation.selectedTracks)) {
      errors.push("project template: invalid archive-operation.json");
    }
  } catch (error) {
    errors.push(`project template: archive-operation.json: ${error.message}`);
  }
}
const projectStateTemplate = JSON.parse(readFileSync(join(projectTemplate, "project.json"), "utf8"));
if (projectStateTemplate.project?.context !== "{{greenfield|brownfield}}") {
  errors.push("project template: project context classification placeholder is missing");
}
if (!projectStateTemplate.setup?.operation?.repositoryRoot || !projectStateTemplate.setup?.operation?.gitDisposition) {
  errors.push("project template: setup Git bootstrap fields are missing");
}
if (Object.hasOwn(projectStateTemplate, "tracks")) {
  errors.push("project template: project.json must not duplicate track records");
}
const trackStateTemplate = JSON.parse(readFileSync(join(projectTemplate, "templates", "track", "state.json"), "utf8"));
if (!trackStateTemplate.title) errors.push("project template: track state title is missing");
const styleguideRoot = join(root, "skills", "create", "assets", "styleguides");
for (const name of [
  "go", "java", "kotlin", "maven", "gradle", "javascript", "typescript",
  "react", "html-css", "flutter", "dart", "swift", "swiftui", "python"
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
