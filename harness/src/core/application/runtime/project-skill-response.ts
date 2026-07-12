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
    target_files: asStringArray(skills.target_files),
    inline_rule_chars: Number(skills.inline_rule_chars || 0),
    inline_rule_budget: Number(skills.inline_rule_budget || 2400),
    ...(asOptionalString(skills.inline_rule_budget_source) && skills.inline_rule_budget_source !== "default"
      ? { inline_rule_budget_source: skills.inline_rule_budget_source }
      : {}),
    ...(typeof skills.inline_rule_budget_requested === "number"
      ? { inline_rule_budget_requested: skills.inline_rule_budget_requested }
      : {}),
    decision: skills.decision || null,
    selected: selected.map((skill) => ({
      id: asOptionalString(skill.id) || null,
      name: asOptionalString(skill.name) || null,
      description: asOptionalString(skill.description) || null,
      path: asOptionalString(skill.path) || null,
      reasons: asStringArray(skill.reasons),
      rules: Array.isArray(skill.rules) ? skill.rules : [],
      resource_uri: asOptionalString(skill.resource_uri) || null,
    })),
    warnings: asStringArray(skills.warnings),
    errors: asStringArray(skills.errors),
  };
}
