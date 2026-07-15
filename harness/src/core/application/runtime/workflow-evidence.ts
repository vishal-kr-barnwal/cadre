import { asJsonObject, asOptionalString, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { choice, nativePrompt } from "./native-prompts";

function rawArgs(args: RuntimeArgs): UnknownRecord {
  return args as UnknownRecord;
}

function normalizedText(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

const GENERIC_ARTIFACT_TEXT = new Set([
  "todo",
  "tbd",
  "placeholder",
  "unknown",
  "deliver behavior",
  "implement the requested behavior",
  "the work is complete",
  "works",
  "describe the goal and intended outcome in concrete project terms",
  "user visible behavior",
  "state the behavior this track must deliver",
  "verified outcome",
  "state how completion will be verified",
  "excluded work",
  "state what this track must not change",
  "phase 1 implement",
  "implement the scoped change",
]);

function meaningfulArtifactText(value: unknown): boolean {
  const normalized = normalizedText(value);
  if (normalized.length < 8 || GENERIC_ARTIFACT_TEXT.has(normalized)) return false;
  return !/^(?:phase|task) \d+(?: build| implementation| work)?$/.test(normalized);
}

function evidenceValue(value: unknown): boolean {
  if (typeof value === "string") return meaningfulArtifactText(value);
  if (Array.isArray(value)) return value.some(evidenceValue);
  if (!isRecord(value)) return false;
  const item = asJsonObject(value);
  return [item.heading, item.title, item.name, item.body, item.description, item.text, item.summary]
    .some(evidenceValue);
}

function specRevisionHasEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const spec = asJsonObject(value);
  return [
    spec.description,
    spec.summary,
    spec.functional_requirements,
    spec.non_functional_requirements,
    spec.requirements,
    spec.acceptance_criteria,
    spec.scope,
    spec.out_of_scope,
  ].some(evidenceValue);
}

function planRevisionHasEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const phases = asJsonObject(value).phases;
  if (!Array.isArray(phases)) return false;
  return phases.map(asJsonObject).some((phase) => {
    const tasks = Array.isArray(phase.tasks) ? phase.tasks.map(asJsonObject) : [];
    return tasks.some((task) => [task.title, task.description, task.body].some(meaningfulArtifactText));
  });
}

export function meaningfulRevisionArtifact(
  value: unknown,
  kind: "spec" | "plan",
  _trackId: string | null
): boolean {
  return kind === "spec" ? specRevisionHasEvidence(value) : planRevisionHasEvidence(value);
}

export function meaningfulRevisionPayload(args: RuntimeArgs, trackId: string | null = null): boolean {
  const raw = rawArgs(args);
  const supplied = (["spec", "plan"] as const)
    .filter((kind) => raw[kind] !== undefined)
    .map((kind) => meaningfulRevisionArtifact(raw[kind], kind, trackId));
  return supplied.length > 0 && supplied.every(Boolean);
}

function meaningfulNarrative(value: unknown, genericValues: Set<string>): string | null {
  const text = asOptionalString(value);
  if (!text) return null;
  const normalized = normalizedText(text);
  if (normalized.length < 32 || normalized.split(" ").length < 6 || genericValues.has(normalized)) return null;
  return text;
}

function strategyValuePresent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(strategyValuePresent);
  if (!isRecord(value)) return false;
  return Object.values(value).some(strategyValuePresent);
}

function intentStrategyAnswered(args: RuntimeArgs, names: string[]): boolean {
  const raw = rawArgs(args);
  const intent = asJsonObject(raw.intent);
  return names.some((name) =>
    strategyValuePresent(raw[name])
    || strategyValuePresent(raw[`intent.${name}`])
    || strategyValuePresent(intent[name])
  );
}

const GENERIC_HANDOFF_TEXT = new Set([
  "continue with the next task",
  "handoff continue with the next task",
  "resume from the packet context",
  "resume from the packet context returned by cadre mcp",
  "current state",
  "blockers and decisions",
  "next owner",
]);

export function meaningfulHandoffText(args: RuntimeArgs): string | null {
  const raw = rawArgs(args);
  const text = meaningfulNarrative(raw.handoffText || raw.handoff_text, GENERIC_HANDOFF_TEXT);
  if (!text) return null;
  const normalized = normalizedText(text);
  const trackId = normalizedText(raw.trackId || raw.track_id);
  if (trackId && normalized === `handoff ${trackId}`) return null;
  if (
    normalized.includes("resume from the packet context returned by cadre mcp")
    || normalized.includes("continue with the next task")
    || normalized.includes("continue with next task")
  ) return null;
  return text;
}

export function handoffIntentStrategyAnswered(args: RuntimeArgs): boolean {
  return intentStrategyAnswered(args, [
    "handoffFocus",
    "handoff_focus",
    "handoffContent",
    "handoff_content",
    "handoffText",
    "handoff_text",
  ]);
}

const RELEASE_METADATA_WORDS = new Set([
  "release",
  "releases",
  "note",
  "notes",
  "generated",
  "highlights",
  "changes",
  "changelog",
  "summary",
  "details",
  "todo",
  "tbd",
  "none",
  "version",
  "custom",
  "completed",
  "tracks",
  "track",
]);

export function meaningfulReleaseNotes(args: RuntimeArgs): string | null {
  const raw = rawArgs(args);
  const text = asOptionalString(raw.releaseNotes || raw.release_notes);
  if (!text) return null;
  const normalized = normalizedText(text);
  const contentWords = normalized.split(" ").filter((word) =>
    word && !RELEASE_METADATA_WORDS.has(word) && !/^v?\d+$/.test(word)
  );
  return normalized.length >= 8 && contentWords.length > 0 ? text : null;
}

export function releaseIntentStrategyAnswered(args: RuntimeArgs): boolean {
  return intentStrategyAnswered(args, [
    "releaseSource",
    "release_source",
    "releaseEvidence",
    "release_evidence",
    "releaseNotes",
    "release_notes",
  ]);
}

function workflowPrompt(
  workflow: "handoff" | "release",
  id: string,
  title: string,
  question: string,
  choices: JsonObject[],
  argument: string,
  customArgument: string
): JsonObject {
  return nativePrompt(
    id,
    title,
    question,
    "single",
    choices,
    { tool: "cadre_workflow", workflow, argument, customArgument },
    customArgument
  );
}

export function handoffIntentPrompts(args: RuntimeArgs = {}): JsonObject[] {
  if (handoffIntentStrategyAnswered(args)) return [];
  return [workflowPrompt(
    "handoff",
    "handoff-content",
    "Handoff Content",
    "What evidence should the handoff capture for the next owner?",
    [
      choice("current-state", "Current State", "Summarize completed work, work in progress, and the exact resume point.", true),
      choice("blockers-decisions", "Blockers And Decisions", "Capture unresolved blockers, decisions, and constraints."),
      choice("next-owner", "Next Owner", "Describe the recipient, next actions, and verification still required."),
    ],
    "intent.handoffFocus",
    "handoffText"
  )];
}

export function releaseIntentPrompts(args: RuntimeArgs = {}): JsonObject[] {
  if (releaseIntentStrategyAnswered(args)) return [];
  return [workflowPrompt(
    "release",
    "release-evidence",
    "Release Evidence",
    "What evidence should Cadre use to prepare this release?",
    [
      choice("completed-tracks", "Completed Tracks", "Use completed Cadre tracks after their completion evidence is available.", true),
      choice("custom-notes", "Custom Notes", "Supply substantive release notes when no completed track represents the release."),
    ],
    "intent.releaseSource",
    "releaseNotes"
  )];
}
