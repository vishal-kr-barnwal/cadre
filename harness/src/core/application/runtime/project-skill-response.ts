import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";

export function compactProjectSkills(value: unknown): JsonObject {
  const skills = asJsonObject(value);
  const selected = Array.isArray(skills.selected) ? skills.selected.map(asJsonObject) : [];
  return {
    ok: skills.ok !== false,
    source: asOptionalString(skills.source) || "cadre/skills",
    workflow: asOptionalString(skills.workflow) || null,
    requested: asStringArray(skills.requested),
    installed: asStringArray(skills.installed),
    selected_ids: asStringArray(skills.selected_ids),
    target_repos: asStringArray(skills.target_repos),
    selected: selected.map((skill) => ({
      id: asOptionalString(skill.id) || null,
      name: asOptionalString(skill.name) || null,
      description: asOptionalString(skill.description) || null,
      path: asOptionalString(skill.path) || null,
      reasons: asStringArray(skill.reasons),
      instructions: asOptionalString(skill.instructions) || "",
      truncated: skill.truncated === true,
      references: Array.isArray(skill.references) ? skill.references : [],
      resource_uri: asOptionalString(skill.resource_uri) || null,
    })),
    warnings: asStringArray(skills.warnings),
    errors: asStringArray(skills.errors),
  };
}
