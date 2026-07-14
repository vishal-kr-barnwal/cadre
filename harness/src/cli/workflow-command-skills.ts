const workflowPattern = /^[a-z][a-z0-9-]*$/;
const claudeFrontmatterEnd = "\n---\n";

export const WORKFLOW_COMMAND_PLATFORMS = ["codex", "claude"] as const;

export type WorkflowCommandPlatform = typeof WORKFLOW_COMMAND_PLATFORMS[number];

export interface WorkflowCommandRenderOptions {
  platform?: WorkflowCommandPlatform;
}

export type WorkflowCommandSkills = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type WorkflowCommandSkillSets = Readonly<Record<WorkflowCommandPlatform, WorkflowCommandSkills>>;

function workflowDisplayName(workflow: string): string {
  if (workflow === "newtrack") return "New Track";
  return workflow
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function commandAgentManifest(workflow: string): string {
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

function claudeCommandSkill(content: string): string {
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

function commandFiles(
  platform: WorkflowCommandPlatform,
  workflow: string,
  content: string,
): Record<string, string> {
  if (platform === "claude") {
    return { "SKILL.md": claudeCommandSkill(content) };
  }
  return {
    "SKILL.md": content,
    "agents/openai.yaml": commandAgentManifest(workflow),
  };
}

export function renderWorkflowCommandSkills(
  template: string,
  workflows: readonly string[],
  options: WorkflowCommandRenderOptions = {},
): WorkflowCommandSkills {
  const platform = options.platform ?? "codex";
  if (!(WORKFLOW_COMMAND_PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error(`Unsupported Cadre workflow command platform: ${String(platform)}`);
  }
  if (!template.includes("{{command}}") || !template.includes("{{workflow}}")) {
    throw new Error("Cadre workflow command template is missing required placeholders");
  }
  const unique = new Set<string>();
  const commandSkills: Record<string, Record<string, string>> = {};
  for (const workflow of workflows) {
    if (!workflowPattern.test(workflow) || workflow === "cadre" || unique.has(workflow)) {
      throw new Error(`Invalid Cadre workflow command id: ${workflow}`);
    }
    unique.add(workflow);
    const content = template
      .replaceAll("{{command}}", workflow)
      .replaceAll("{{workflow}}", workflow);
    if (content.includes("{{")) {
      throw new Error(`Unresolved workflow command placeholder: ${workflow}`);
    }
    commandSkills[workflow] = commandFiles(platform, workflow, content);
  }
  return commandSkills;
}
