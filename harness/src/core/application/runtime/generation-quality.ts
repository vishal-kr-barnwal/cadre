import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" ");
  if (isRecord(value)) return Object.values(value).map(text).filter(Boolean).join(" ");
  return "";
}

function hasAny(record: JsonObject, names: string[]): boolean {
  return names.some((name) => text(record[name]).length > 0);
}

function hasArray(record: JsonObject, names: string[], min = 1): boolean {
  return names.some((name) => Array.isArray(record[name]) && (record[name] as unknown[]).length >= min);
}

function isGeneric(value: unknown): boolean {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return true;
  return [
    "works",
    "implement core",
    "add tests",
    "verify",
    "done",
    "deliver behavior",
    "the work is complete",
    "tests pass",
    "use readme",
  ].includes(normalized);
}

function sectionWarning(kind: string, section: string, expected: string): string {
  return `${kind} context is thin: ${section} should include ${expected}.`;
}

export function setupGenerationWarnings(args: JsonObject): string[] {
  const product = isRecord(args.product) ? asJsonObject(args.product) : {};
  const guidelines = isRecord(args.productGuidelines || args.product_guidelines) ? asJsonObject(args.productGuidelines || args.product_guidelines) : {};
  const workflow = isRecord(args.workflowPolicy || args.workflow_policy) ? asJsonObject(args.workflowPolicy || args.workflow_policy) : {};
  const techStack = isRecord(args.techStack || args.tech_stack) ? asJsonObject(args.techStack || args.tech_stack) : {};
  const warnings: string[] = [];
  if (!hasAny(product, ["name", "title"]) || !hasAny(product, ["summary", "description"])) {
    warnings.push(sectionWarning("product", "summary", "name and a concrete product summary"));
  }
  if (!hasArray(product, ["users", "personas", "audience"])) {
    warnings.push(sectionWarning("product", "users/personas", "primary users, operators, or integrators"));
  }
  if (!hasArray(product, ["coreWorkflows", "core_workflows", "workflows", "goals"], 2)) {
    warnings.push(sectionWarning("product", "core workflows", "at least two repo-grounded workflows"));
  }
  if (!hasAny(product, ["domainModel", "domain_model", "entities", "stateMachines", "state_machines"])) {
    warnings.push(sectionWarning("product", "domain model", "entities, relationships, or lifecycle states"));
  }
  if (!hasArray(product, ["invariants", "productInvariants", "product_invariants"])) {
    warnings.push(sectionWarning("product", "invariants", "behaviors that must remain stable"));
  }
  if (!hasAny(product, ["dataStores", "data_stores", "schemaFiles", "schema_files", "integrations"])) {
    warnings.push(sectionWarning("product", "data and integrations", "data stores, schemas, or external services"));
  }
  if (!hasArray(guidelines, ["principles", "userPromises", "user_promises", "promises"])) {
    warnings.push(sectionWarning("product guidelines", "principles/promises", "product rules derived from observed behavior"));
  }
  if (!hasAny(guidelines, ["domainRules", "domain_rules", "workflowRules", "workflow_rules", "rules", "decisionRules", "decision_rules"])) {
    warnings.push(sectionWarning("product guidelines", "domain and decision rules", "workflow, lifecycle, or tradeoff rules"));
  }
  if (!hasAny(techStack, ["languages", "language", "frameworks", "runtime", "database", "keyDependencies", "key_dependencies"])) {
    warnings.push(sectionWarning("tech stack", "detected stack", "languages, frameworks, runtime, database, or dependencies"));
  }
  if (!hasAny(workflow, ["testCommand", "test_command", "defaultTestCommand", "default_test_command", "commands"])) {
    warnings.push(sectionWarning("workflow", "commands", "test/build/format commands when discoverable"));
  }
  if (!hasArray(workflow, ["reviewFocus", "review_focus", "qualityBar", "quality_bar"])) {
    warnings.push(sectionWarning("workflow", "quality gates", "review focus or quality bar"));
  }
  return warnings;
}

export function trackGenerationWarnings(spec: JsonObject, plan: JsonObject): string[] {
  const warnings: string[] = [];
  const functional = Array.isArray(spec.functional_requirements) ? spec.functional_requirements.map(asJsonObject) : [];
  const acceptance = Array.isArray(spec.acceptance_criteria) ? spec.acceptance_criteria.map(asJsonObject) : [];
  const outOfScope = Array.isArray(spec.out_of_scope) ? spec.out_of_scope.map(asJsonObject) : [];
  if (isGeneric(spec.description) || functional.length === 0) {
    warnings.push("spec context is thin: include concrete functional requirements grounded in the user request.");
  }
  if (acceptance.length === 0 || acceptance.some((entry) => isGeneric(entry.heading) && isGeneric(entry.body))) {
    warnings.push("spec context is thin: acceptance criteria should be concrete and verifiable.");
  }
  if (outOfScope.length === 0) {
    warnings.push("spec context is thin: out_of_scope should record meaningful boundaries.");
  }
  const phases = Array.isArray(plan.phases) ? plan.phases.map(asJsonObject) : [];
  const tasks = phases.flatMap((phase) => Array.isArray(phase.tasks) ? phase.tasks.map(asJsonObject) : []);
  if (tasks.length === 0) warnings.push("plan context is thin: add phase tasks under plan.phases[].tasks.");
  if (tasks.some((task) => isGeneric(task.title))) warnings.push("plan context is thin: task titles should describe specific implementation work.");
  const implementationTasks = tasks.filter((task) => asOptionalString(task.task_type) !== "user_manual_verification");
  if (implementationTasks.some((task) => asStringArray(task.files).length === 0)) {
    warnings.push("plan context is thin: implementation tasks should claim expected files where practical.");
  }
  const hasManualVerification = tasks.some((task) => asOptionalString(task.task_type) === "user_manual_verification" || isRecord(task.manual_verification));
  if (!hasManualVerification) warnings.push("plan context is thin: include manual verification for user-facing or integration behavior.");
  return warnings;
}
