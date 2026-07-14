import { asJsonObject, isRecord } from "../../../guards";
import type { RuntimeArgs, UnknownRecord } from "../../../types";

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
    ...(!meaningfulTechStack(raw.techStack ?? raw.tech_stack) ? ["techStack"] : []),
  ];
}
