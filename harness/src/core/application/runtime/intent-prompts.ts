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

function hasField(record: JsonObject | null, names: string[]): boolean {
  if (!record) return false;
  return names.some((name) => Object.prototype.hasOwnProperty.call(record, name));
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
  const hasGoal = textPresent(spec?.description)
    || textPresent(spec?.title)
    || hasNamedValue(args, ["goal", "description"]);
  const hasOutcome = hasArrayField(spec, ["functional_requirements", "functionalRequirements", "outcomes"])
    || hasNamedValue(args, ["outcome", "outcomes"]);
  const hasAcceptance = hasArrayField(spec, ["acceptance_criteria", "acceptanceCriteria"])
    || hasNamedValue(args, ["acceptanceCriteria", "acceptance_criteria"]);
  const hasScope = hasField(spec, ["scope", "out_of_scope", "outOfScope"])
    || hasField(metadata, ["scope"])
    || hasNamedValue(args, ["scope"]);
  const hasPlan = hasArrayField(plan, ["phases", "tasks"]);

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
