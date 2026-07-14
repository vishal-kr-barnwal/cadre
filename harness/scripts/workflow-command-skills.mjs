#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPattern = /^[a-z][a-z0-9-]*$/;
const claudeFrontmatterEnd = "\n---\n";

export const WORKFLOW_COMMAND_PLATFORMS = ["codex", "claude"];

function workflowDisplayName(workflow) {
  if (workflow === "newtrack") return "New Track";
  return workflow
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function commandAgentManifest(workflow) {
  const displayName = workflowDisplayName(workflow);
  return [
    "interface:",
    `  display_name: "Cadre ${displayName}"`,
    `  short_description: "Start or continue the Cadre ${displayName} workflow"`,
    `  default_prompt: "Start or continue the Cadre ${workflow} workflow for this project."`,
    "policy:",
    "  allow_implicit_invocation: false",
    "",
  ].join("\n");
}

function claudeCommandSkill(content) {
  if (!content.startsWith("---\n")) {
    throw new Error("Cadre workflow command template is missing YAML frontmatter");
  }
  const frontmatterEnd = content.indexOf(claudeFrontmatterEnd, 4);
  if (frontmatterEnd < 0) {
    throw new Error("Cadre workflow command template has unterminated YAML frontmatter");
  }
  const frontmatter = content.slice(4, frontmatterEnd);
  if (/^disable-model-invocation:/m.test(frontmatter)) {
    throw new Error("Cadre workflow command template must keep Claude invocation policy platform-specific");
  }
  return `${content.slice(0, frontmatterEnd)}\ndisable-model-invocation: true${content.slice(frontmatterEnd)}`;
}

function commandFiles(platform, workflow, content) {
  if (platform === "claude") {
    return { "SKILL.md": claudeCommandSkill(content) };
  }
  return {
    "SKILL.md": content,
    "agents/openai.yaml": commandAgentManifest(workflow),
  };
}

function commandPlatform(options) {
  const platform = options.platform ?? "codex";
  if (!WORKFLOW_COMMAND_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported Cadre workflow command platform: ${String(platform)}`);
  }
  return platform;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validatedWorkflows(contract) {
  if (!Array.isArray(contract.workflows) || contract.workflows.length === 0) {
    throw new Error("Cadre skill contract must declare workflows");
  }
  const workflows = contract.workflows.map((workflow) => {
    if (typeof workflow !== "string" || !workflowPattern.test(workflow)) {
      throw new Error(`Invalid Cadre workflow command id: ${String(workflow)}`);
    }
    return workflow;
  });
  if (new Set(workflows).size !== workflows.length) {
    throw new Error("Cadre skill contract contains duplicate workflows");
  }
  return workflows;
}

function validatedCommands(repoRoot, contract) {
  const protocolsRoot = path.join(repoRoot, "skills", "cadre", "protocols");
  const byWorkflow = new Map();
  for (const name of fs.readdirSync(protocolsRoot).filter((entry) => /^cadre-.*\.json$/.test(entry)).sort()) {
    const protocol = readJson(path.join(protocolsRoot, name));
    const workflow = protocol.workflow;
    const command = protocol.id;
    if (
      protocol.schema !== "cadre.protocol.v1"
      || protocol.version !== 1
      || typeof workflow !== "string"
      || typeof command !== "string"
      || command !== `cadre-${workflow}`
      || !workflowPattern.test(workflow)
    ) {
      throw new Error(`Invalid Cadre workflow command protocol: ${name}`);
    }
    if (byWorkflow.has(workflow)) throw new Error(`Duplicate Cadre workflow command protocol: ${workflow}`);
    byWorkflow.set(workflow, { protocolId: command, workflow });
  }
  const commands = validatedWorkflows(contract).map((workflow) => {
    const command = byWorkflow.get(workflow);
    if (!command) throw new Error(`Missing Cadre workflow command protocol: ${workflow}`);
    return command;
  });
  if (commands.length !== byWorkflow.size) {
    const extra = [...byWorkflow.keys()].filter((workflow) => !contract.workflows.includes(workflow));
    throw new Error(`Cadre command protocols missing from skill contract: ${extra.join(", ")}`);
  }
  return commands;
}

export function loadWorkflowCommandSource(repoRoot = scriptRoot) {
  const contract = readJson(path.join(repoRoot, "skills", "cadre", "skill.json"));
  const template = fs.readFileSync(
    path.join(repoRoot, "skills", "cadre", "workflow-command-template.md"),
    "utf8",
  );
  if (!template.includes("{{command}}") || !template.includes("{{workflow}}")) {
    throw new Error("Cadre workflow command template is missing required placeholders");
  }
  return {
    template,
    workflows: validatedCommands(repoRoot, contract).map(({ workflow }) => workflow),
  };
}

export function renderWorkflowCommandSkills({ template, workflows }, options = {}) {
  const platform = commandPlatform(options);
  return workflows.map((workflow) => {
    const skillName = workflow;
    const content = template
      .replaceAll("{{command}}", skillName)
      .replaceAll("{{workflow}}", workflow);
    if (content.includes("{{")) throw new Error(`Unresolved workflow command placeholder: ${skillName}`);
    return {
      command: skillName,
      workflow,
      files: commandFiles(platform, workflow, content),
    };
  });
}

export function loadWorkflowCommandSkills(repoRoot = scriptRoot, options = {}) {
  return renderWorkflowCommandSkills(loadWorkflowCommandSource(repoRoot), options);
}

export function writeWorkflowCommandSkills(skillsRoot, repoRoot = scriptRoot, options = {}) {
  const skills = loadWorkflowCommandSkills(repoRoot, options);
  fs.rmSync(skillsRoot, { recursive: true, force: true });
  for (const skill of skills) {
    const directory = path.join(skillsRoot, skill.command);
    for (const [relative, content] of Object.entries(skill.files)) {
      const file = path.join(directory, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, destination, ...extra] = process.argv.slice(2);
  const hasPlatform = extra.length === 2 && extra[0] === "--platform";
  const platform = hasPlatform ? extra[1] : "codex";
  if (
    operation !== "--write"
    || !destination
    || (extra.length > 0 && !hasPlatform)
    || !WORKFLOW_COMMAND_PLATFORMS.includes(platform)
  ) {
    process.stderr.write(
      "Usage: node scripts/workflow-command-skills.mjs --write <plugin-skills-root> [--platform codex|claude]\n",
    );
    process.exit(1);
  }
  writeWorkflowCommandSkills(path.resolve(destination), scriptRoot, { platform });
}
