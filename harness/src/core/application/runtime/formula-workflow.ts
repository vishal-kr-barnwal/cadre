import fs from "node:fs";
import path from "node:path";

import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { CoreResult } from "./contracts";
import { appendJsonl, fileExists, readJson, safeName, textHash, utcNow, writeJsonEnsured } from "../../infrastructure/runtime/json-store";
import { appendCadreEvent, ensureNativeState } from "./native-state";
import { beginTrace, commitTrace } from "./commit-trace";
import { workflowNewTrack } from "./workflow-new-track";
import { workflowSummary } from "./workflow-response";

type FormulaAction =
  | "list"
  | "show"
  | "cook"
  | "wisp_create"
  | "wisp_list"
  | "wisp_update_step"
  | "wisp_squash"
  | "wisp_burn"
  | "pour";

const READ_ACTIONS = new Set(["list", "show", "cook", "wisp_list", "pour"]);

function formulaAction(args: RuntimeArgs): FormulaAction {
  const rawArgs = args as UnknownRecord;
  const raw = asOptionalString(rawArgs.operation)
    || asOptionalString(rawArgs.mode)
    || asOptionalString(rawArgs.formulaAction || rawArgs.formula_action)
    || (asOptionalString(args.action) && asOptionalString(args.action) !== "formula" ? asOptionalString(args.action) : null)
    || "list";
  const normalized = raw.replace(/^formula_/, "").replace(/-/g, "_");
  if (normalized === "wisp_update") return "wisp_update_step";
  if (normalized === "squash") return "wisp_squash";
  if (normalized === "burn") return "wisp_burn";
  if (normalized === "create_wisp") return "wisp_create";
  if (normalized === "list_wisps") return "wisp_list";
  if (normalized === "update_step") return "wisp_update_step";
  return ([
    "list",
    "show",
    "cook",
    "wisp_create",
    "wisp_list",
    "wisp_update_step",
    "wisp_squash",
    "wisp_burn",
    "pour",
  ] as FormulaAction[]).includes(normalized as FormulaAction)
    ? normalized as FormulaAction
    : "list";
}

function formulaDir(root: string): string {
  return path.join(root, "cadre", "formulas");
}

function wispDir(root: string): string {
  return path.join(root, "cadre", "local", "wisps");
}

function formulaId(args: RuntimeArgs): string | null {
  const rawArgs = args as UnknownRecord;
  return asOptionalString(args.id)
    || asOptionalString(rawArgs.formulaId || rawArgs.formula_id)
    || asOptionalString(args.name)
    || null;
}

function wispId(args: RuntimeArgs): string | null {
  const rawArgs = args as UnknownRecord;
  return asOptionalString(args.id)
    || asOptionalString(rawArgs.wispId || rawArgs.wisp_id)
    || null;
}

function formulaPath(root: string, id: string): string {
  return path.join(formulaDir(root), `${safeName(id).replace(/\.json$/i, "")}.json`);
}

function wispPath(root: string, id: string): string {
  return path.join(wispDir(root), `${safeName(id).replace(/\.json$/i, "")}.json`);
}

function loadFormula(root: string, id: string | null): CoreResult {
  if (!id) return { ok: false, error: "formula id is required" };
  const file = formulaPath(root, id);
  const formula = readJson<JsonObject | null>(file, null);
  if (!formula) return { ok: false, id, error: `Formula not found: ${id}`, path: path.relative(root, file) };
  return { ok: true, id: asOptionalString(formula.id) || id, path: path.relative(root, file), formula };
}

function variablesFromArgs(formula: JsonObject, args: RuntimeArgs): JsonObject {
  const rawArgs = args as UnknownRecord;
  return {
    ...asJsonObject(formula.defaults),
    ...asJsonObject(rawArgs.variables),
    ...asJsonObject(rawArgs.vars),
  };
}

function variableValue(variables: JsonObject, key: string): string {
  const value = key.split(".").reduce<unknown>((current, part) => isRecord(current) ? asJsonObject(current)[part] : undefined, variables);
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function renderTemplateValue(value: unknown, variables: JsonObject): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => variableValue(variables, String(key)));
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplateValue(item, variables));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(asJsonObject(value)).map(([key, entry]) => [key, renderTemplateValue(entry, variables)]));
  }
  return value;
}

function stepsFromFormula(formula: JsonObject): JsonObject[] {
  return Array.isArray(formula.steps) ? formula.steps.map(asJsonObject) : [];
}

function cookedPlan(trackId: string, formula: JsonObject, rendered: JsonObject): JsonObject {
  if (isRecord(rendered.plan)) return asJsonObject(rendered.plan);
  const steps = stepsFromFormula(rendered);
  const phaseTitle = asOptionalString(rendered.phase_title)
    || asOptionalString(rendered.recommended_phase)
    || "Formula";
  return {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: trackId,
    title: `Plan: ${trackId}`,
    phases: [{
      phase_index: 1,
      title: phaseTitle,
      execution_mode: asOptionalString(rendered.execution_mode) || "sequential",
      depends_on: asStringArray(rendered.dependencies),
      tasks: steps.map((step, index) => ({
        task_index: index + 1,
        task_key: asOptionalString(step.id || step.key) || `formula_step_${index + 1}`,
        title: asOptionalString(step.title) || asOptionalString(step.description) || `Formula step ${index + 1}`,
        status: asOptionalString(step.status) || "pending",
        labels: asStringArray(step.labels),
        depends_on: asStringArray(step.depends_on || step.depends),
        files: asStringArray(step.files),
        repo: asOptionalString(step.repo) || null,
        task_type: asOptionalString(step.task_type) || null,
        description: asOptionalString(step.description) || null,
      })),
    }],
  };
}

function cookedSpec(trackId: string, formula: JsonObject, rendered: JsonObject): JsonObject {
  if (isRecord(rendered.spec)) return asJsonObject(rendered.spec);
  const description = asOptionalString(rendered.description) || asOptionalString(formula.description) || asOptionalString(formula.title) || trackId;
  const acceptance = asStringArray(rendered.acceptance);
  return {
    version: 1,
    schema: "cadre.spec.v1",
    track_id: trackId,
    title: asOptionalString(rendered.title) || `Spec: ${trackId}`,
    description,
    functional_requirements: [
      { heading: "Formula outcome", body: description },
    ],
    non_functional_requirements: [],
    acceptance_criteria: acceptance.length > 0
      ? acceptance.map((entry, index) => ({ heading: `Acceptance ${index + 1}`, body: entry }))
      : [{ heading: "Formula plan reviewed", body: "The generated formula plan is reviewed and approved before track creation." }],
    out_of_scope: [{ heading: "Formula boundaries", body: "Changes outside the generated formula plan remain out of scope until explicitly revised." }],
  };
}

function cookFormula(root: string, args: RuntimeArgs): CoreResult {
  const loaded = loadFormula(root, formulaId(args));
  if (loaded.ok === false) return loaded;
  const formula = asJsonObject(loaded.formula);
  const variables = variablesFromArgs(formula, args);
  const rendered = asJsonObject(renderTemplateValue(formula, variables));
  const trackId = asOptionalString(args.trackId || args.track_id)
    || asOptionalString((args as UnknownRecord).trackName || (args as UnknownRecord).track_name)
    || `${asOptionalString(formula.id) || loaded.id}-draft`;
  return {
    ok: true,
    formula_id: loaded.id,
    title: asOptionalString(formula.title) || loaded.id,
    variables,
    recommended_phase: asOptionalString(formula.recommended_phase) || null,
    dependencies: asStringArray(formula.dependencies),
    spec: cookedSpec(trackId, formula, rendered),
    plan: cookedPlan(trackId, formula, rendered),
  };
}

function listFormulas(root: string): CoreResult {
  ensureNativeState(root);
  const dir = formulaDir(root);
  const items = fileExists(dir)
    ? fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const file = path.join(dir, name);
        const formula = readJson<JsonObject>(file, {});
        return {
          id: asOptionalString(formula.id) || name.replace(/\.json$/i, ""),
          title: asOptionalString(formula.title) || asOptionalString(formula.id) || name,
          recommended_phase: asOptionalString(formula.recommended_phase) || null,
          path: path.relative(root, file),
        };
      })
    : [];
  return { ok: true, formulas: items, count: items.length };
}

function wispSteps(cooked: JsonObject): JsonObject[] {
  const plan = asJsonObject(cooked.plan);
  const phases = Array.isArray(plan.phases) ? plan.phases.map(asJsonObject) : [];
  return phases.flatMap((phase) => {
    const phaseIndex = Number(phase.phase_index || phase.index || 1);
    return (Array.isArray(phase.tasks) ? phase.tasks.map(asJsonObject) : []).map((task, index) => ({
      step_id: asOptionalString(task.task_key || task.id || task.key) || `step_${phaseIndex}_${index + 1}`,
      phase_index: phaseIndex,
      task_index: Number(task.task_index || task.index || index + 1),
      title: asOptionalString(task.title) || `Step ${index + 1}`,
      status: "pending",
      evidence: null,
      updated_at: null,
    }));
  });
}

function createWisp(root: string, args: RuntimeArgs): CoreResult {
  const cooked = cookFormula(root, args);
  if (cooked.ok === false) return cooked;
  const formula_id = asOptionalString(cooked.formula_id) || "formula";
  const now = utcNow();
  const id = asOptionalString((args as UnknownRecord).wispId || (args as UnknownRecord).wisp_id)
    || `wisp_${safeName(formula_id)}_${textHash(`${now}:${JSON.stringify(cooked.variables || {})}`).slice(0, 10)}`;
  const wisp: JsonObject = {
    version: 1,
    schema: "cadre.wisp.v1",
    id,
    formula_id,
    status: "active",
    owner: asOptionalString(args.identity) || null,
    ttl: asOptionalString((args as UnknownRecord).ttl) || null,
    created_at: now,
    updated_at: now,
    variables: asJsonObject(cooked.variables),
    spec: asJsonObject(cooked.spec),
    plan: asJsonObject(cooked.plan),
    steps: wispSteps(asJsonObject(cooked)),
    evidence: [],
  };
  const file = wispPath(root, id);
  writeJsonEnsured(file, wisp);
  const event = appendCadreEvent(root, { kind: "wisp_created", workflow: "formula", formula_id, wisp_id: id });
  return { ok: true, wisp_id: id, path: path.relative(root, file), wisp, event };
}

function listWisps(root: string): CoreResult {
  ensureNativeState(root);
  const dir = wispDir(root);
  const wisps = fileExists(dir)
    ? fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const file = path.join(dir, name);
        const wisp = readJson<JsonObject>(file, {});
        return {
          id: asOptionalString(wisp.id) || name.replace(/\.json$/i, ""),
          formula_id: asOptionalString(wisp.formula_id) || null,
          status: asOptionalString(wisp.status) || null,
          owner: asOptionalString(wisp.owner) || null,
          updated_at: asOptionalString(wisp.updated_at) || null,
          path: path.relative(root, file),
        };
      })
    : [];
  return { ok: true, wisps, count: wisps.length };
}

function updateWispStep(root: string, args: RuntimeArgs): CoreResult {
  const id = wispId(args);
  if (!id) return { ok: false, error: "wisp id is required" };
  const file = wispPath(root, id);
  const wisp = readJson<JsonObject | null>(file, null);
  if (!wisp) return { ok: false, error: `Wisp not found: ${id}`, path: path.relative(root, file) };
  const rawArgs = args as UnknownRecord;
  const stepId = asOptionalString(rawArgs.stepId || rawArgs.step_id || rawArgs.taskKey || rawArgs.task_key);
  const stepIndex = Number(rawArgs.stepIndex || rawArgs.step_index || args.taskIndex || 0);
  const steps = Array.isArray(wisp.steps) ? wisp.steps.map(asJsonObject) : [];
  const index = steps.findIndex((step, offset) =>
    (stepId && asOptionalString(step.step_id) === stepId) || (stepIndex > 0 && offset + 1 === stepIndex)
  );
  if (index < 0) return { ok: false, error: "Wisp step not found", wisp_id: id, step_id: stepId || null, step_index: stepIndex || null };
  const now = utcNow();
  const status = asOptionalString(args.status) || "completed";
  const currentStep = steps[index] || {};
  steps[index] = {
    ...currentStep,
    status,
    evidence: isRecord(args.evidence) ? asJsonObject(args.evidence) : asOptionalString(args.evidence) || asJsonObject(currentStep.evidence),
    summary: asOptionalString(args.summary) || asOptionalString(currentStep.summary) || null,
    updated_at: now,
  };
  const next = { ...wisp, steps, status: asOptionalString(wisp.status) || "active", updated_at: now };
  writeJsonEnsured(file, next);
  const event = appendCadreEvent(root, { kind: "wisp_step_updated", workflow: "formula", wisp_id: id, step_id: asOptionalString(steps[index].step_id) || null, status });
  return { ok: true, wisp_id: id, path: path.relative(root, file), step: steps[index], wisp: next, event };
}

function squashWisp(root: string, args: RuntimeArgs): CoreResult {
  const id = wispId(args);
  if (!id) return { ok: false, error: "wisp id is required" };
  const file = wispPath(root, id);
  const wisp = readJson<JsonObject | null>(file, null);
  if (!wisp) return { ok: false, error: `Wisp not found: ${id}`, path: path.relative(root, file) };
  const traceBefore = beginTrace(root);
  const digest: JsonObject = {
    version: 1,
    schema: "cadre.wisp_digest.v1",
    id: `digest_${safeName(id)}_${textHash(`${utcNow()}:${JSON.stringify(wisp)}`).slice(0, 10)}`,
    wisp_id: id,
    formula_id: asOptionalString(wisp.formula_id) || null,
    status: asOptionalString(args.status) || asOptionalString(wisp.status) || "squashed",
    summary: asOptionalString(args.summary) || null,
    recorded_at: utcNow(),
    steps: Array.isArray(wisp.steps) ? wisp.steps.map(asJsonObject) : [],
    evidence: Array.isArray(wisp.evidence) ? wisp.evidence.map(asJsonObject) : [],
  };
  const digestPath = path.join(root, "cadre", "operations", "wisp-digests.jsonl");
  appendJsonl(digestPath, digest);
  const event = appendCadreEvent(root, { kind: "wisp_squashed", workflow: "formula", wisp_id: id, digest_id: digest.id });
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "wisp",
    action: "wisp_squash",
    subject: `squash ${id}`,
    before: traceBefore,
    files: [
      path.relative(root, digestPath),
    ],
    note: {
      event_id: asOptionalString(asJsonObject(event.event).id) || null,
      wisp_id: id,
      digest_id: digest.id,
      formula_id: digest.formula_id,
    },
  });
  return { ok: controlCommit.ok !== false, wisp_id: id, digest, path: path.relative(root, digestPath), event, control_commit: controlCommit };
}

function burnWisp(root: string, args: RuntimeArgs): CoreResult {
  const id = wispId(args);
  if (!id) return { ok: false, error: "wisp id is required" };
  const file = wispPath(root, id);
  const existed = fileExists(file);
  if (existed) fs.rmSync(file, { force: true });
  const event = appendCadreEvent(root, { kind: "wisp_burned", workflow: "formula", wisp_id: id, existed });
  return { ok: true, wisp_id: id, existed, path: path.relative(root, file), event };
}

function pourFormula(root: string, args: RuntimeArgs): CoreResult {
  const id = wispId(args);
  const wisp = id ? readJson<JsonObject | null>(wispPath(root, id), null) : null;
  const cooked = wisp
    ? { ok: true, formula_id: asOptionalString(wisp.formula_id), spec: asJsonObject(wisp.spec), plan: asJsonObject(wisp.plan), variables: asJsonObject(wisp.variables) }
    : cookFormula(root, args);
  if (cooked.ok === false) return cooked;
  const formula_id = asOptionalString(cooked.formula_id) || formulaId(args) || "formula";
  const trackId = asOptionalString(args.trackId || args.track_id)
    || asOptionalString((args as UnknownRecord).outputTrackId || (args as UnknownRecord).output_track_id)
    || `${safeName(formula_id)}-${textHash(JSON.stringify(cooked.variables || {})).slice(0, 8)}`;
  const tags = Array.from(new Set([
    `formula:${formula_id}`,
    ...asStringArray(asJsonObject((args as UnknownRecord).metadata).tags),
  ]));
  const result = workflowNewTrack(root, {
    ...args,
    workflow: "newtrack",
    action: "newtrack",
    trackId,
    formulaId: formula_id,
    wispId: id || undefined,
    spec: asJsonObject(cooked.spec),
    plan: asJsonObject(cooked.plan),
    description: asOptionalString(args.description) || `Formula output: ${formula_id}`,
    metadata: {
      ...asJsonObject((args as UnknownRecord).metadata),
      tags,
    },
  });
  const pourTraceBefore = result.ok === false ? null : beginTrace(root);
  const event = result.ok === false ? null : appendCadreEvent(root, { kind: "formula_poured", workflow: "formula", formula_id, wisp_id: id || null, track_id: trackId });
  const controlCommit = result.ok === false || !event
    ? null
    : { ok: true, skipped: true, reason: "formula pour is traced by the newtrack commit", trace_before: pourTraceBefore };
  return { ...result, ok: result.ok !== false && (!controlCommit || controlCommit.ok !== false), formula_id, wisp_id: id || null, pour_event: event, pour_commit: controlCommit };
}

export function workflowFormula(root: string, args: RuntimeArgs = {}): CoreResult {
  const action = formulaAction(args);
  const summary = workflowSummary(root, "formula", args);
  ensureNativeState(root);
  if (action === "list") return { ...summary, action, ...listFormulas(root) };
  if (action === "show") return { ...summary, action, ...loadFormula(root, formulaId(args)) };
  if (action === "cook") return { ...summary, action, ...cookFormula(root, args) };
  if (action === "wisp_list") return { ...summary, action, ...listWisps(root) };
  if (args.execute !== true && !READ_ACTIONS.has(action)) {
    return {
      ...summary,
      ok: false,
      action,
      dry_run: true,
      phase_state: "awaiting_execute",
      error: `Formula action ${action} requires execute:true`,
    };
  }
  if (action === "wisp_create") return { ...summary, action, ...createWisp(root, args) };
  if (action === "wisp_update_step") return { ...summary, action, ...updateWispStep(root, args) };
  if (action === "wisp_squash") return { ...summary, action, ...squashWisp(root, args) };
  if (action === "wisp_burn") return { ...summary, action, ...burnWisp(root, args) };
  if (action === "pour") return { ...summary, action, ...pourFormula(root, args) };
  return { ...summary, ok: false, action, error: `Unknown formula action: ${action}` };
}
