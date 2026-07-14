import { asJsonObject, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { packagedTemplateJson } from "./packaged-assets";

function meaningfulValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(meaningfulValue);
  if (!isRecord(value)) return false;
  return Object.values(value).some(meaningfulValue);
}

function normalizedText(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    : "";
}

function meaningfulEvidenceText(value: unknown): boolean {
  const normalized = normalizedText(value);
  if (!normalized) return false;
  const placeholders = [
    "todo",
    "tbd",
    "to be determined",
    "placeholder",
    "fill me",
    "unknown",
    "n a",
    "structured product context for agents fill sections from repo evidence and user intent do not leave examples as final content",
    "structured product rules for implementation and review decisions fill from product context repo evidence and user intent",
    "structured project workflow policy for cadre agents fill project specific commands and review gates from repo evidence",
  ];
  return !placeholders.some((placeholder) => normalized === placeholder || normalized.startsWith(`${placeholder} `));
}

function meaningfulEvidenceValue(value: unknown): boolean {
  if (typeof value === "string") return meaningfulEvidenceText(value);
  if (Array.isArray(value)) return value.some(meaningfulEvidenceValue);
  if (!isRecord(value)) return false;
  return Object.values(value).some(meaningfulEvidenceValue);
}

function productSectionHasEvidence(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.map(asJsonObject).some((section) => {
    const body = typeof section.body === "string" ? section.body.trim() : "";
    if (!body) return meaningfulEvidenceValue(section.content || section.text);
    return body.split(/\r?\n/).some((line) => {
      const trimmed = line.replace(/^[-*]\s*/, "").trim();
      if (!trimmed) return false;
      if (!meaningfulEvidenceText(trimmed)) return false;
      const colon = trimmed.indexOf(":");
      return meaningfulEvidenceText(colon < 0 ? trimmed : trimmed.slice(colon + 1));
    });
  });
}

function meaningfulProduct(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const product = asJsonObject(value);
  const identity = [product.title, product.name, product.productName, product.product_name]
    .some((entry) => typeof entry === "string" && entry.trim().length > 0);
  if (!identity) return false;
  const hasSummary = [product.summary, product.description, product.notes]
    .some(meaningfulEvidenceText);
  if (hasSummary) return true;
  for (const field of [
    "users", "personas", "audience", "operators", "integrators", "accessBoundaries", "access_boundaries",
    "operatingModel", "operating_model", "coreWorkflows", "core_workflows", "workflows", "setupWorkflow",
    "setup_workflow", "supportWorkflow", "support_workflow", "goals", "domainModel", "domain_model",
    "entities", "relationships", "stateMachines", "state_machines", "invariants", "productInvariants",
    "product_invariants", "nonGoals", "non_goals", "compatibility", "migrationGuarantees",
    "migration_guarantees", "boundaries", "entrypoints", "sourceDirectories", "source_directories",
    "contracts", "schemaFiles", "schema_files", "dataStores", "data_stores", "integrations",
    "observability", "retention", "commands", "testCommand", "test_command", "formatCommand",
    "format_command", "qualityBar", "quality_bar", "reviewFocus", "review_focus", "openQuestions",
    "open_questions", "risks",
  ]) {
    if (meaningfulEvidenceValue(product[field])) return true;
  }
  return productSectionHasEvidence(product.sections);
}

function meaningfulTechStack(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const techStack = asJsonObject(value);
  for (const field of [
    "languages", "language", "frameworks", "runtimes", "runtime", "platforms", "packageManagers",
    "package_managers", "build", "buildCommand", "build_command", "test", "testCommand", "test_command",
    "commands", "datastores", "dataStores", "data_stores", "database", "services", "dependencies",
    "keyDependencies", "key_dependencies", "summary", "notes",
  ]) {
    if (meaningfulEvidenceValue(techStack[field])) return true;
  }
  return false;
}

function policySectionHasEvidence(value: unknown, templateFilename: string): boolean {
  if (!Array.isArray(value)) return false;
  const template = packagedTemplateJson(templateFilename);
  const templateSections: JsonObject[] = Array.isArray(template?.sections)
    ? template.sections.map(asJsonObject)
    : [];
  const templateLinesById = new Map<string, Set<string>>(templateSections.map((section) => [
    String(section.id || ""),
    new Set(String(section.body || "").split(/\r?\n/).map(normalizedText).filter(Boolean)),
  ]));
  return value.map(asJsonObject).some((section) => {
    if (meaningfulEvidenceValue(section.content || section.text)) return true;
    const body = typeof section.body === "string" ? section.body : "";
    const templateLines = templateLinesById.get(String(section.id || "")) || new Set<string>();
    return body.split(/\r?\n/).some((line) => {
      const text = line.replace(/^[-*]\s*/, "").trim();
      if (!text) return false;
      if (templateLines.has(normalizedText(line))) return false;
      if (!meaningfulEvidenceText(text)) return false;
      const colon = text.indexOf(":");
      return meaningfulEvidenceText(colon < 0 ? text : text.slice(colon + 1));
    });
  });
}

function meaningfulPolicy(value: unknown, fields: string[], templateFilename: string): boolean {
  if (!isRecord(value)) return false;
  const policy = asJsonObject(value);
  if ([policy.summary, policy.description, policy.notes].some(meaningfulEvidenceText)) return true;
  if (fields.some((field) => meaningfulEvidenceValue(policy[field]))) return true;
  return policySectionHasEvidence(policy.sections, templateFilename);
}

function meaningfulProductGuidelines(value: unknown): boolean {
  return meaningfulPolicy(value, [
    "principles", "userPromises", "user_promises", "promises", "qualityBar", "quality_bar",
    "trustAndSafety", "trust_and_safety", "safety", "boundaries", "rules", "domainRules",
    "domain_rules", "workflowRules", "workflow_rules", "stateMachines", "state_machines",
    "concurrencyRules", "concurrency_rules", "dataOwnership", "data_ownership", "dataStores",
    "data_stores", "contracts", "schemaFiles", "schema_files", "nonGoals", "non_goals",
    "decisionRules", "decision_rules", "reviewChecklist", "review_checklist", "reviewFocus",
    "review_focus",
  ], "product_guidelines.json");
}

function meaningfulWorkflowPolicy(value: unknown): boolean {
  return meaningfulPolicy(value, [
    "principles", "providerMode", "provider_mode", "taskLifecycle", "task_lifecycle", "commands",
    "completeTaskPolicy", "complete_task_policy", "commitPolicy", "commit_policy", "branchPolicy",
    "branch_policy", "topology", "repos", "repoCommands", "repo_commands", "testCommand",
    "test_command", "preferredTestCommand", "preferred_test_command", "coverageCommand",
    "coverage_command", "reviewFocus", "review_focus", "qualityBar", "quality_bar", "reviewGate",
    "review_gate", "phaseCompletion", "phase_completion", "manualVerification", "manual_verification",
    "coveragePolicy", "coverage_policy", "formatCommand", "format_command", "buildCommand",
    "build_command", "developmentCommands", "development_commands",
  ], "workflow.json");
}

export type SetupEvidenceStage = "product" | "product_guidelines" | "technical" | "workflow";

function meaningfulRepos(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const repos = asJsonObject(value);
  if (repos.mode !== "polyrepo" || !Array.isArray(repos.repos) || repos.repos.length === 0) return false;
  const meaningfulRepoText = (entry: unknown): boolean => typeof entry === "string"
    && meaningfulEvidenceText(entry)
    && !/(?:^|[^a-z])replace(?:_|[^a-z]|$)|example\.com|your[-_/ ]?(?:org|repo|project)/i.test(entry);
  const enabled = repos.repos.map(asJsonObject).filter((repo) => repo.enabled !== false);
  if (enabled.length === 0 || !enabled.every((repo) => (
    meaningfulRepoText(repo.name)
    && [repo.submodule_path, repo.path, repo.url].some(meaningfulRepoText)
  ))) return false;
  const defaultRepo = typeof repos.default_repo === "string" ? repos.default_repo : null;
  return !defaultRepo || (meaningfulRepoText(defaultRepo) && enabled.some((repo) => repo.name === defaultRepo));
}

export function setupIntentStrategyAnswered(args: RuntimeArgs, kind: "product" | "techStack"): boolean {
  const raw = args as UnknownRecord;
  const intent = asJsonObject(raw.intent);
  const intentNames = kind === "product"
    ? ["product", "productOther", "productIntent", "productSummary"]
    : ["techStack", "techStackOther", "techStackIntent", "techStackSummary"];
  const directNames = kind === "product"
    ? ["productOther", "productIntent", "productSummary"]
    : ["techStackOther", "techStackIntent", "techStackSummary"];
  return directNames.some((name) => meaningfulValue(raw[name]))
    || intentNames.some((name) => meaningfulValue(intent[name]));
}

export function setupMissingEvidence(args: RuntimeArgs = {}): string[] {
  const raw = args as UnknownRecord;
  return [
    ...(!meaningfulProduct(raw.product) ? ["product"] : []),
    ...(!meaningfulProductGuidelines(raw.productGuidelines ?? raw.product_guidelines) ? ["productGuidelines"] : []),
    ...(!meaningfulTechStack(raw.techStack ?? raw.tech_stack) ? ["techStack"] : []),
    ...(!meaningfulWorkflowPolicy(raw.workflowPolicy ?? raw.workflow_policy) ? ["workflowPolicy"] : []),
  ];
}

export function setupStageMissingEvidence(
  args: RuntimeArgs,
  stage: SetupEvidenceStage | null,
  polyrepoRequested = false,
): string[] {
  if (!stage) return [];
  const missing = new Set(setupMissingEvidence(args));
  if (stage === "product") return missing.has("product") ? ["product"] : [];
  if (stage === "product_guidelines") return missing.has("productGuidelines") ? ["productGuidelines"] : [];
  if (stage === "workflow") return missing.has("workflowPolicy") ? ["workflowPolicy"] : [];
  const raw = args as UnknownRecord;
  return [
    ...(missing.has("techStack") ? ["techStack"] : []),
    ...(polyrepoRequested && !meaningfulRepos(raw.repos) ? ["repos"] : []),
  ];
}
