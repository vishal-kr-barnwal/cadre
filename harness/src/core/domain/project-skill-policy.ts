export const PROJECT_SKILL_WORKFLOWS = new Set([
  "setup",
  "newtrack",
  "implement",
  "debug",
  "status",
  "review",
  "validate",
  "archive",
  "handoff",
  "ship",
  "land",
  "release",
  "revise",
  "refresh",
  "flag",
  "revert",
  "formula",
  "artifacts",
]);

export const PROJECT_SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROJECT_SKILL_REFERENCE_EXTENSIONS = new Set([".json", ".md", ".txt", ".yaml", ".yml"]);
export const PROJECT_SKILL_MAX_FILE_BYTES = 128 * 1024;
export const PROJECT_SKILL_INLINE_RULE_BUDGET = 2400;
export const PROJECT_SKILL_MIN_INLINE_RULE_BUDGET = 1000;
export const PROJECT_SKILL_MAX_INLINE_RULE_BUDGET = 20000;

export function canonicalWorkflow(value: string): string {
  if (value === "new_track") return "newtrack";
  if (value === "setup_assist" || value === "setup_scaffold") return "setup";
  if (value === "artifact_sync") return "artifacts";
  return value;
}
