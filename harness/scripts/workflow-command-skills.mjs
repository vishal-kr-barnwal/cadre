#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPattern = /^[a-z][a-z0-9-]*$/;

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

function renderWorkflowCommandSkills({ template, workflows }) {
  return workflows.map((workflow) => {
    const skillName = workflow;
    const content = template
      .replaceAll("{{command}}", skillName)
      .replaceAll("{{workflow}}", workflow);
    if (content.includes("{{")) throw new Error(`Unresolved workflow command placeholder: ${skillName}`);
    return {
      command: skillName,
      workflow,
      files: {
        "SKILL.md": content,
        "agents/openai.yaml": commandAgentManifest(workflow),
      },
    };
  });
}

export function loadWorkflowCommandSkills(repoRoot = scriptRoot) {
  return renderWorkflowCommandSkills(loadWorkflowCommandSource(repoRoot));
}

export function writeWorkflowCommandSkills(skillsRoot, repoRoot = scriptRoot) {
  const skills = loadWorkflowCommandSkills(repoRoot);
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
  if (operation !== "--write" || !destination || extra.length > 0) {
    process.stderr.write("Usage: node scripts/workflow-command-skills.mjs --write <plugin-skills-root>\n");
    process.exit(1);
  }
  writeWorkflowCommandSkills(path.resolve(destination));
}
