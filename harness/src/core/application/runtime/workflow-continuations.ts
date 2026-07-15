import { asJsonArray, asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, JsonValue, RuntimeArgs } from "../../../types";
import { isWorkflowInputReservedKey, WORKFLOW_INPUT_RESERVED_KEYS } from "../../../workflow-control-keys";

interface WorkflowContinuationCall extends JsonObject {
  tool: "cadre_workflow";
  arguments: JsonObject;
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
export interface WritablePathResult {
  paths: string[];
  error: string | null;
}

function safeArgumentSegments(value: string): string[] | null {
  const segments = value.split(".");
  return segments.length > 0 && segments.every((segment) => (
    /^[A-Za-z][A-Za-z0-9_]*$/.test(segment) && !FORBIDDEN_SEGMENTS.has(segment)
  )) && !isWorkflowInputReservedKey(segments[0]!) ? segments : null;
}

export function inputArgumentPointer(value: unknown): string | null {
  const argument = asOptionalString(value);
  if (!argument) return null;
  const segments = safeArgumentSegments(argument);
  return segments ? `/arguments/input/${segments.join("/")}` : null;
}

export function inputObjectMemberPointer(argument: unknown, member: string): string | null {
  const base = inputArgumentPointer(argument);
  if (!base || FORBIDDEN_SEGMENTS.has(member)) return null;
  return `${base}/${member.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function preferredArguments(values: string[]): string[] {
  const result: string[] = [];
  const semantic = new Set<string>();
  for (const value of values) {
    const key = value.split(".").map((segment) => segment.replace(/_/g, "").toLowerCase()).join(".");
    if (semantic.has(key)) continue;
    semantic.add(key);
    result.push(value);
  }
  return result.slice(0, 32);
}

export function writableInputPaths(arguments_: string[]): WritablePathResult {
  const paths: string[] = [];
  for (const argument of preferredArguments(arguments_)) {
    const pointer = inputArgumentPointer(argument);
    if (!pointer) return { paths: [], error: `Unsafe workflow input target: ${argument}` };
    if (!paths.includes(pointer)) paths.push(pointer);
  }
  return { paths, error: null };
}

function promptResponseTarget(prompt: JsonObject): JsonObject {
  const nested = asJsonObject(prompt.responseTarget);
  if (Object.keys(nested).length > 0) return nested;
  return {
    tool: prompt.tool,
    workflow: prompt.workflow,
    argument: prompt.argument,
    customArgument: prompt.customArgument,
    valueMap: prompt.valueMap,
    selectedIds: prompt.selectedIds,
  };
}

function promptTargetError(prompt: JsonObject, workflow: string): string | null {
  const id = asOptionalString(prompt.id) || "(unnamed prompt)";
  const target = promptResponseTarget(prompt);
  if (asOptionalString(target.tool) !== "cadre_workflow") return `${id} does not target cadre_workflow`;
  if (asOptionalString(target.workflow) !== workflow) return `${id} targets a different workflow`;
  if (!inputArgumentPointer(target.argument)) return `${id} has an unsafe or missing input argument`;
  if (target.customArgument != null && !inputArgumentPointer(target.customArgument)) {
    return `${id} has an unsafe custom input argument`;
  }
  if (target.valueMap != null && !isRecord(target.valueMap)) return `${id} has a non-object value map`;
  const valueMap = asJsonObject(target.valueMap);
  if (Object.keys(valueMap).length > 0) {
    const missing = asJsonArray(prompt.choices)
      .map((choice) => asOptionalString(asJsonObject(choice).id))
      .filter((choiceId): choiceId is string => Boolean(choiceId) && valueMap[choiceId!] === undefined);
    if (missing.length > 0) return `${id} is missing choice mappings for: ${missing.join(", ")}`;
    const argument = asOptionalString(target.argument)!;
    for (const [choiceId, patch] of Object.entries(valueMap)) {
      if (!isRecord(patch)) return `${id} has a non-object mapping for choice: ${choiceId}`;
      const patchPaths = mappedPatchPaths(patch as JsonObject);
      if (patchPaths.length === 0) return `${id} has an empty mapping for choice: ${choiceId}`;
      const outsideTarget = patchPaths.find((path) => path !== argument && !path.startsWith(`${argument}.`));
      if (outsideTarget) return `${id} mapping for ${choiceId} writes outside its declared target: ${outsideTarget}`;
    }
  }
  return null;
}

function mappedPatchPaths(value: JsonObject, prefix: string[] = []): string[] {
  const paths: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || FORBIDDEN_SEGMENTS.has(key)) return [`!unsafe:${[...prefix, key].join(".")}`];
    if (prefix.length === 0 && isWorkflowInputReservedKey(key)) return [`!reserved:${key}`];
    const next = [...prefix, key];
    if (isRecord(nested) && Object.keys(nested).length > 0) paths.push(...mappedPatchPaths(nested as JsonObject, next));
    else paths.push(next.join("."));
  }
  return paths;
}

export function promptWritableInputPaths(
  prompts: JsonObject[],
  required: string[],
  workflow: string,
  allowedArguments: string[] = [],
): WritablePathResult {
  const arguments_: string[] = [];
  for (const prompt of prompts) {
    const error = promptTargetError(prompt, workflow);
    if (error) return { paths: [], error };
    const target = promptResponseTarget(prompt);
    const argument = asOptionalString(target.argument);
    const customArgument = asOptionalString(target.customArgument);
    if (argument) arguments_.push(argument);
    if (customArgument) arguments_.push(customArgument);
  }
  arguments_.push(...required);
  const outsideStage = arguments_.find((argument) => allowedArguments.length > 0 && !allowedArguments.some((allowed) => (
    argument === allowed || argument.startsWith(`${allowed}.`)
  )));
  if (outsideStage) return { paths: [], error: `Workflow input target is outside the active stage: ${outsideStage}` };
  return writableInputPaths(arguments_);
}

export function publicWorkflowInput(args: RuntimeArgs): JsonObject {
  const input: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    if (!WORKFLOW_INPUT_RESERVED_KEYS.has(key)) input[key] = value as JsonValue;
  }
  return input;
}

export function workflowContinuationCall(
  root: string,
  workflow: string,
  input: JsonObject,
  sessionId: string | null,
): WorkflowContinuationCall {
  return {
    tool: "cadre_workflow",
    arguments: {
      root,
      workflow,
      input,
      execute: false,
      ...(sessionId ? { approval: { session_id: sessionId } } : {}),
    },
  };
}

export function approvalStageInputKeys(approval: JsonObject, stageId: string | null): string[] {
  if (!stageId) return [];
  const stage = asJsonArray(approval.stages)
    .map((entry) => asJsonObject(entry))
    .find((entry) => asOptionalString(entry.id) === stageId);
  return stage ? asStringArray(stage.input_keys) : [];
}
