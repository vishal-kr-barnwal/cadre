import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString, isRecord } from "../../../guards";

import { choice, hasAnyArg, nativePrompt } from "./native-prompts";

function rawArgs(args: RuntimeArgs): UnknownRecord {
  return args as UnknownRecord;
}

function intentArgs(args: RuntimeArgs): JsonObject {
  return asJsonObject(rawArgs(args).intent);
}

function nestedIntentValue(args: RuntimeArgs, name: string): unknown {
  return intentArgs(args)[name];
}

function textPresent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length >= 8;
}

function schemaTextPresent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedPromptText(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function isGenericSpecText(value: unknown): boolean {
  const text = normalizedPromptText(value);
  if (!text) return true;
  return [
    "deliver behavior",
    "implement the requested behavior",
    "works",
    "the work is complete",
    "the planned work is complete and verified",
    "verify delivered outcome",
    "manually verify that the completed track delivers the intended behavior from the spec",
  ].includes(text);
}

function isTrackPlaceholderText(value: unknown, trackId: string | null): boolean {
  const text = normalizedPromptText(value);
  const normalizedTrack = normalizedPromptText(trackId || "");
  if (!text || !normalizedTrack) return false;
  return text === normalizedTrack
    || text === `spec ${normalizedTrack}`
    || text === `spec for ${normalizedTrack}`
    || text === `plan ${normalizedTrack}`
    || text === `plan for ${normalizedTrack}`;
}

function meaningfulSpecText(value: unknown, trackId: string | null): boolean {
  return textPresent(value) && !isGenericSpecText(value) && !isTrackPlaceholderText(value, trackId);
}

function meaningfulSpecItems(value: unknown, trackId: string | null): boolean {
  if (!Array.isArray(value)) return false;
  return value.map(asJsonObject).some((entry) => {
    const heading = entry.heading || entry.title || entry.name;
    const body = entry.body || entry.description || entry.text;
    return meaningfulSpecText(heading, trackId) || meaningfulSpecText(body, trackId);
  });
}

function arrayPresent(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasNamedValue(args: RuntimeArgs, names: string[]): boolean {
  const raw = rawArgs(args);
  return names.some((name) => {
    const direct = raw[name];
    if (textPresent(direct) || arrayPresent(direct) || isRecord(direct)) return true;
    const nested = nestedIntentValue(args, name);
    return textPresent(nested) || arrayPresent(nested) || isRecord(nested);
  });
}

function hasArrayField(record: JsonObject | null, names: string[]): boolean {
  if (!record) return false;
  return names.some((name) => arrayPresent(record[name]));
}

const SPEC_SCHEMA = "cadre.spec.v1";
const PLAN_SCHEMA = "cadre.plan.v1";

const SPEC_FIELD_ALIASES: Record<string, string> = {
  functionalRequirements: "functional_requirements",
  nonFunctionalRequirements: "non_functional_requirements",
  acceptanceCriteria: "acceptance_criteria",
  outOfScope: "out_of_scope",
  requirements: "functional_requirements",
  successCriteria: "acceptance_criteria",
  goals: "description",
};

const PLAN_FIELD_ALIASES: Record<string, string> = {
  steps: "phases",
  phaseList: "phases",
  dependsOn: "depends_on",
  taskKey: "task_key",
  commitShas: "commit_shas",
  repoShas: "repo_shas",
};

function issue(field: string, message: string, expected: string): JsonObject {
  return { field, message, expected };
}

function checkSchemaLiteral(value: JsonObject, field: string, expected: string): JsonObject[] {
  const actual = value.schema;
  if (actual === undefined) return [issue(field, `Missing ${field}; load the Cadre artifact schema before drafting.`, expected)];
  if (actual !== expected) return [issue(field, `Unsupported schema ${String(actual)}.`, expected)];
  return [];
}

function aliasIssues(value: JsonObject, prefix: string, aliases: Record<string, string>): JsonObject[] {
  return Object.entries(aliases)
    .filter(([name]) => Object.prototype.hasOwnProperty.call(value, name))
    .map(([name, expected]) => issue(`${prefix}.${name}`, `Use Cadre canonical field ${expected}, not ${name}.`, `${prefix}.${expected}`));
}

function specArrayShapeIssues(spec: JsonObject, field: string): JsonObject[] {
  const value = spec[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [issue(`spec.${field}`, "Expected an array of structured requirement items.", `spec.${field}: [{ heading, body }]`)];
  return value.flatMap((entry, index) => {
    const item = asJsonObject(entry);
    if (!isRecord(entry)) return [issue(`spec.${field}[${index}]`, "Expected an object, not a string or primitive.", "{ heading: string, body?: string }")];
    if (!schemaTextPresent(item.heading)) return [issue(`spec.${field}[${index}].heading`, "Requirement item is missing a heading.", "string")];
    return [];
  });
}

function planPhaseShapeIssues(plan: JsonObject): JsonObject[] {
  const phases = plan.phases;
  if (plan.tasks !== undefined && phases === undefined) {
    return [issue("plan.tasks", "Top-level plan.tasks is not accepted for newtrack; put tasks inside plan.phases[].tasks.", "plan.phases[].tasks")];
  }
  if (phases === undefined) return [];
  if (!Array.isArray(phases)) return [issue("plan.phases", "Expected an array of phase objects.", "plan.phases: [{ phase_index, title, tasks }]")];
  return phases.flatMap((rawPhase, phaseIndex) => {
    const phase = asJsonObject(rawPhase);
    const prefix = `plan.phases[${phaseIndex}]`;
    if (!isRecord(rawPhase)) return [issue(prefix, "Expected a phase object.", "{ phase_index, title, tasks }")];
    const issues = aliasIssues(phase, prefix, PLAN_FIELD_ALIASES);
    if (!schemaTextPresent(phase.title)) issues.push(issue(`${prefix}.title`, "Phase title is required.", "string"));
    const tasks = phase.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      issues.push(issue(`${prefix}.tasks`, "Each phase must contain at least one task.", "array"));
      return issues;
    }
    tasks.forEach((rawTask, taskIndex) => {
      const task = asJsonObject(rawTask);
      const taskPrefix = `${prefix}.tasks[${taskIndex}]`;
      if (!isRecord(rawTask)) {
        issues.push(issue(taskPrefix, "Expected a task object.", "{ task_index, task_key, title, files, depends_on }"));
        return;
      }
      issues.push(...aliasIssues(task, taskPrefix, PLAN_FIELD_ALIASES));
      if (!schemaTextPresent(task.title)) issues.push(issue(`${taskPrefix}.title`, "Task title is required.", "string"));
      if (task.files !== undefined && !Array.isArray(task.files)) issues.push(issue(`${taskPrefix}.files`, "Task files must be an array.", "string[]"));
      if (task.depends_on !== undefined && !Array.isArray(task.depends_on)) issues.push(issue(`${taskPrefix}.depends_on`, "Task dependencies must use depends_on as an array.", "string[]"));
    });
    return issues;
  });
}

export function newTrackSchemaIssues(args: RuntimeArgs = {}): JsonObject[] {
  const raw = rawArgs(args);
  const spec = isRecord(raw.spec) ? asJsonObject(raw.spec) : null;
  const plan = isRecord(raw.plan) ? asJsonObject(raw.plan) : null;
  const issues: JsonObject[] = [];
  if (spec) {
    issues.push(...checkSchemaLiteral(spec, "spec.schema", SPEC_SCHEMA));
    issues.push(...aliasIssues(spec, "spec", SPEC_FIELD_ALIASES));
    for (const field of ["functional_requirements", "non_functional_requirements", "acceptance_criteria", "out_of_scope"]) {
      issues.push(...specArrayShapeIssues(spec, field));
    }
  }
  if (plan) {
    issues.push(...checkSchemaLiteral(plan, "plan.schema", PLAN_SCHEMA));
    issues.push(...aliasIssues(plan, "plan", PLAN_FIELD_ALIASES));
    issues.push(...planPhaseShapeIssues(plan));
  }
  return issues;
}

function target(toolWorkflow: string, argument: string, customArgument: string): JsonObject {
  return {
    tool: "cadre_workflow",
    workflow: toolWorkflow,
    argument,
    customArgument,
  };
}

export function intentPrompt(
  workflow: string,
  id: string,
  title: string,
  question: string,
  selectionMode: "single" | "multi",
  choices: JsonObject[],
  argument: string,
  customArgument: string
): JsonObject {
  return nativePrompt(id, title, question, selectionMode, choices, target(workflow, argument, customArgument), customArgument);
}

export function setupIntentPrompts(args: RuntimeArgs = {}): JsonObject[] {
  const prompts: JsonObject[] = [];
  const product = isRecord(rawArgs(args).product) ? asJsonObject(rawArgs(args).product) : null;
  const techStack = isRecord(rawArgs(args).techStack || rawArgs(args).tech_stack)
    ? asJsonObject(rawArgs(args).techStack || rawArgs(args).tech_stack)
    : null;
  if (!product && !hasNamedValue(args, ["productIntent", "productSummary"])) {
    prompts.push(intentPrompt(
      "setup",
      "setup-product-intent",
      "Product Intent",
      "What product context should Cadre seed for this project?",
      "single",
      [
        choice("use-readme", "Use README", "Derive initial product context from repository docs.", true),
        choice("ask-human", "Ask Human", "Collect a short product summary before writing setup files."),
        choice("minimal", "Minimal", "Seed only minimal product context for now."),
      ],
      "intent.product",
      "intent.productOther"
    ));
  }
  if (!techStack && !hasNamedValue(args, ["techStackIntent", "techStackSummary"])) {
    prompts.push(intentPrompt(
      "setup",
      "setup-tech-stack-intent",
      "Tech Stack",
      "How should Cadre establish the initial tech-stack context?",
      "single",
      [
        choice("detect", "Detect From Files", "Use repository manifests and source files as the starting point.", true),
        choice("ask-human", "Ask Human", "Collect explicit languages, frameworks, and test commands first."),
        choice("minimal", "Minimal", "Seed only detected languages for now."),
      ],
      "intent.techStack",
      "intent.techStackOther"
    ));
  }
  return prompts;
}

export function newTrackIntentPrompts(args: RuntimeArgs = {}): JsonObject[] {
  const prompts: JsonObject[] = [];
  const trackId = asOptionalString(rawArgs(args).trackId || rawArgs(args).track_id);
  const spec = isRecord(rawArgs(args).spec) ? asJsonObject(rawArgs(args).spec) : null;
  const plan = isRecord(rawArgs(args).plan) ? asJsonObject(rawArgs(args).plan) : null;
  const metadata = isRecord(rawArgs(args).metadata) ? asJsonObject(rawArgs(args).metadata) : null;
  const hasGoal = meaningfulSpecText(spec?.description, trackId || null)
    || meaningfulSpecText(spec?.title, trackId || null)
    || hasNamedValue(args, ["goal", "description"]);
  const hasOutcome = meaningfulSpecItems(spec?.functional_requirements || spec?.functionalRequirements || spec?.outcomes, trackId || null)
    || hasNamedValue(args, ["outcome", "outcomes"]);
  const hasAcceptance = meaningfulSpecItems(spec?.acceptance_criteria || spec?.acceptanceCriteria, trackId || null)
    || hasNamedValue(args, ["acceptanceCriteria", "acceptance_criteria"]);
  const hasScope = meaningfulSpecText(spec?.scope, trackId || null)
    || meaningfulSpecItems(spec?.out_of_scope || spec?.outOfScope, trackId || null)
    || meaningfulSpecText(metadata?.scope, trackId || null)
    || hasNamedValue(args, ["scope"]);
  const hasPlan = hasArrayField(plan, ["phases"]);

  if (!trackId) {
    prompts.push(intentPrompt(
      "newtrack",
      "newtrack-target-track",
      "Track Target",
      "What track id or track type should Cadre use?",
      "single",
      [
        choice("feature-track", "Feature Track", "Create a feature-oriented track id from the goal.", true),
        choice("bug-track", "Bug Track", "Create a bug-fix track id from the issue."),
        choice("custom-track-id", "Custom Track", "Use a specific track id supplied by the human."),
      ],
      "trackId",
      "trackId"
    ));
  }
  if (!hasGoal) {
    prompts.push(intentPrompt(
      "newtrack",
      "newtrack-goal",
      "Goal",
      "What concrete goal should this track achieve?",
      "single",
      [
        choice("feature", "New Feature", "Deliver a new user or product capability.", true),
        choice("bug-fix", "Bug Fix", "Correct incorrect behavior."),
        choice("refactor", "Refactor", "Improve internal structure without intended behavior change."),
        choice("research", "Research", "Investigate options before implementation."),
      ],
      "intent.goal",
      "intent.goalOther"
    ));
  }
  if (!hasOutcome) {
    prompts.push(intentPrompt(
      "newtrack",
      "newtrack-outcome",
      "Outcome",
      "What user-visible or engineering outcome proves this track matters?",
      "single",
      [
        choice("user-behavior", "User Behavior", "A user workflow changes in a verifiable way.", true),
        choice("reliability", "Reliability", "The system becomes safer, faster, or more observable."),
        choice("developer-experience", "Developer Experience", "The codebase or tooling becomes easier to work with."),
      ],
      "intent.outcome",
      "intent.outcomeOther"
    ));
  }
  if (!hasAcceptance) {
    prompts.push(intentPrompt(
      "newtrack",
      "newtrack-acceptance",
      "Acceptance",
      "What acceptance signal should the spec and plan optimize for?",
      "multi",
      [
        choice("automated-tests", "Automated Tests", "Tests demonstrate the changed behavior.", true),
        choice("manual-check", "Manual Check", "A human can verify the workflow end to end."),
        choice("metrics", "Metrics", "Runtime metrics or logs prove the outcome."),
        choice("docs", "Docs Updated", "Documentation reflects the changed behavior."),
      ],
      "intent.acceptanceCriteria",
      "intent.acceptanceCriteriaOther"
    ));
  }
  if (!hasScope || !hasPlan) {
    prompts.push(intentPrompt(
      "newtrack",
      "newtrack-scope",
      "Scope",
      "What implementation scope should Cadre plan around?",
      "single",
      [
        choice("single-module", "Single Module", "Keep the work focused to one package or subsystem.", true),
        choice("backend-api", "Backend/API", "Include service, persistence, or API changes."),
        choice("frontend-ui", "Frontend/UI", "Include user-interface behavior and states."),
        choice("cross-cutting", "Cross-Cutting", "Coordinate changes across multiple subsystems."),
      ],
      "intent.scope",
      "intent.scopeOther"
    ));
  }
  return prompts;
}

export function reviseIntentPrompts(args: RuntimeArgs = {}, trackId: string | null = null): JsonObject[] {
  const prompts: JsonObject[] = [];
  const hasTrack = Boolean(trackId || asOptionalString(rawArgs(args).trackId || rawArgs(args).track_id));
  const hasRevisionPayload = isRecord(rawArgs(args).spec) || isRecord(rawArgs(args).plan);
  const hasReason = hasNamedValue(args, ["reason", "revisionReason", "revision_reason", "changeSummary", "change_summary"]);
  const hasScope = hasRevisionPayload || hasNamedValue(args, ["scope", "revisionScope", "revision_scope", "reviseScope", "revise_scope"]);

  if (!hasTrack) {
    prompts.push(intentPrompt(
      "revise",
      "revise-target-track",
      "Target Track",
      "Which track should Cadre revise?",
      "single",
      [
        choice("current-track", "Current Track", "Use the currently active track if one is selected.", true),
        choice("blocked-track", "Blocked Track", "Revise a blocked track that needs changed requirements."),
        choice("custom-track-id", "Custom Track", "Use a specific track id supplied by the human."),
      ],
      "trackId",
      "trackId"
    ));
  }
  if (!hasReason) {
    prompts.push(intentPrompt(
      "revise",
      "revise-reason",
      "Revision Reason",
      "What changed that requires the spec or plan to be revised?",
      "single",
      [
        choice("implementation-discovery", "Implementation Discovery", "Code work exposed a requirement or plan mismatch.", true),
        choice("user-feedback", "User Feedback", "Human feedback changed the intended behavior."),
        choice("scope-change", "Scope Change", "The work needs to add, remove, or defer scope."),
        choice("risk-found", "Risk Found", "A constraint, risk, or dependency changed the plan."),
      ],
      "intent.revisionReason",
      "intent.revisionReasonOther"
    ));
  }
  if (!hasScope) {
    prompts.push(intentPrompt(
      "revise",
      "revise-scope",
      "Revision Scope",
      "Should Cadre update the spec, the plan, or both?",
      "single",
      [
        choice("both", "Spec And Plan", "Update requirements and implementation steps together.", true),
        choice("spec", "Spec Only", "Update requirements and acceptance criteria only."),
        choice("plan", "Plan Only", "Update tasks, sequencing, or verification only."),
      ],
      "intent.revisionScope",
      "intent.revisionScopeOther"
    ));
  }
  return prompts;
}

export function refreshScopeIds(args: RuntimeArgs = {}): string[] {
  const raw = rawArgs(args);
  const direct = [
    raw.refreshScope,
    raw.refresh_scope,
    raw.scope,
  ].flatMap((value) => typeof value === "string" ? value.split(",") : []);
  const listed = Array.isArray(raw.scopes) ? raw.scopes : [];
  const ids = direct.concat(listed.map(String)).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (raw.all === true) ids.push("all");
  if (raw.patterns === true) ids.push("patterns");
  if (raw.docs === true || raw.projections === true) ids.push("docs");
  if (raw.diagnostics === true) ids.push("diagnostics");
  if (hasAnyArg(args, ["lsp", "writeLsp", "write_lsp", "setupLsp", "setup_lsp"])) ids.push("lsp");
  return Array.from(new Set(ids));
}

export function refreshIntentPrompts(args: RuntimeArgs = {}): JsonObject[] {
  if (refreshScopeIds(args).length > 0) return [];
  return [
    intentPrompt(
      "refresh",
      "refresh-scope",
      "Refresh Scope",
      "What Cadre context should refresh update or inspect?",
      "single",
      [
        choice("patterns", "Patterns Only", "Refresh project pattern canonical data and projection.", true),
        choice("lsp", "LSP Setup", "Inspect or write language-server setup recommendations."),
        choice("docs", "Docs/Projections", "Regenerate supported human-readable projections."),
        choice("diagnostics", "Diagnostics", "Report workspace diagnostics without document changes."),
        choice("all", "All Supported", "Run all supported refresh checks and document updates."),
      ],
      "refreshScope",
      "refreshScopeOther"
    ),
  ];
}
