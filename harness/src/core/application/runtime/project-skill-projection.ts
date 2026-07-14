import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { ManagedManifest } from "../../domain/project-skill-management";
import { withGeneratedMarker } from "./markdown-docs";

function list(values: string[]): string { return values.length ? values.map((value) => `\`${value}\``).join(", ") : "Any"; }

export function renderProjectSkillProjection(manifest: ManagedManifest): string {
  const selectors = asJsonObject(manifest.selectors);
  const lines = [
    `# ${manifest.name}`, "", manifest.description, "", "## Selectors", "",
    `- Workflows: ${list(asStringArray(selectors.workflows))}`,
    `- Repositories: ${list(asStringArray(selectors.repos))}`,
    `- Files: ${list(asStringArray(selectors.file_patterns))}`, "", "## Rules", "",
  ];
  for (const value of manifest.rules) {
    const rule = asJsonObject(value);
    lines.push(`### ${asOptionalString(rule.id) || "rule"}`, "", asOptionalString(rule.text) || "", "", `Priority: ${Number(rule.priority || 100)} · Required: ${rule.required !== false ? "yes" : "no"}`);
    const references = asStringArray(rule.references);
    if (references.length) lines.push(`References: ${list(references)}`);
    lines.push("");
  }
  lines.push("## Reference inventory", "");
  if (manifest.references.length === 0) lines.push("No references.", "");
  for (const value of manifest.references) {
    const reference = asJsonObject(value);
    lines.push(`- \`${asOptionalString(reference.id) || "reference"}\`: \`${asOptionalString(reference.path) || ""}\``);
  }
  const body = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  const canonical = `${JSON.stringify(manifest, null, 2)}\n`;
  return withGeneratedMarker(
    `cadre/skills/${manifest.id}/skill.json`,
    "cadre.project-skill.v1",
    body,
    { canonicalContent: canonical, projection: `cadre/skills/${manifest.id}/SKILL.md` }
  );
}
