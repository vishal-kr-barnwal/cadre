const workflowPattern = /^[a-z][a-z0-9-]*$/;

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

export function renderWorkflowCommandSkills(
  template: string,
  workflows: readonly string[],
): Readonly<Record<string, Readonly<Record<string, string>>>> {
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
    commandSkills[workflow] = {
      "SKILL.md": content,
      "agents/openai.yaml": commandAgentManifest(workflow),
    };
  }
  return commandSkills;
}
