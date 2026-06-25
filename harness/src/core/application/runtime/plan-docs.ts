import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { appendCanonicalJsonBlock, markerForPlanStatus, normalizedText } from "./markdown-docs";
import { specItemsFromRaw } from "./spec-docs";
import { asArray } from "./status";

export const MANUAL_VERIFICATION_TASK_TYPE = "user_manual_verification";

export function trackPlanJsonPath(track: CadreTrack): string {
  return track.plan_json_path || path.join(track.dir, "plan.json");
}

export function trackSpecJsonPath(track: CadreTrack): string {
  return track.spec_json_path || path.join(track.dir, "spec.json");
}

export function trackLearningsJsonlPath(track: CadreTrack): string {
  return track.learnings_jsonl_path || path.join(track.dir, "learnings.jsonl");
}

export function trackHandoffJsonPath(track: CadreTrack): string {
  return track.handoff_json_path || path.join(track.dir, "handoff.json");
}

export function planJsonPathForPlanPath(file: string): string {
  if (file.endsWith(".json")) return file;
  return path.join(path.dirname(file), "plan.json");
}

export function manualVerificationScope(value: unknown): string | null {
  const task = asJsonObject(value);
  const manual = asJsonObject(task.manual_verification);
  const annotations = asJsonObject(task.annotations);
  return asOptionalString(manual.scope)
    || asOptionalString(annotations["manual-verification-scope"])
    || asOptionalString(annotations["manual-verification"])
    || null;
}

export function isManualVerificationTaskObject(value: unknown, scope?: "phase" | "track"): boolean {
  const task = asJsonObject(value);
  const annotations = asJsonObject(task.annotations);
  const type = asOptionalString(task.task_type) || asOptionalString(annotations["task-type"]);
  const taskScope = manualVerificationScope(task);
  const key = asOptionalString(task.task_key || task.key) || "";
  const title = asOptionalString(task.title) || "";
  const matchesManual = type === MANUAL_VERIFICATION_TASK_TYPE
    || title.toLowerCase().includes("user manual verification")
    || key.endsWith("_manual_verification")
    || key === "track_manual_verification";
  if (!matchesManual) return false;
  if (!scope) return true;
  if (taskScope) return taskScope === scope;
  return scope === "track" ? key === "track_manual_verification" : key !== "track_manual_verification";
}

export function manualVerificationCheck(id: string, heading: string, body: string, source: string): JsonObject {
  return { id, heading, body, source };
}

export function phaseManualVerificationChecks(phase: JsonObject, tasks: JsonObject[]): JsonObject[] {
  const phaseIndex = Number(phase.phase_index || phase.index || 1);
  const title = asOptionalString(phase.title) || `Phase ${phaseIndex}`;
  const taskTitles = tasks
    .map((task) => asOptionalString(task.title))
    .filter(Boolean)
    .map((value) => String(value).replace(/^Task\s+\d+:\s*/i, ""));
  const files = Array.from(new Set(tasks.flatMap((task) => asStringArray(task.files))));
  return [
    manualVerificationCheck(
      `phase${phaseIndex}-check-1`,
      "Exercise changed behavior",
      taskTitles.length > 0
        ? `Manually exercise the behavior delivered by ${title}: ${taskTitles.join("; ")}.`
        : `Manually exercise the behavior delivered by ${title}.`,
      "phase"
    ),
    ...(files.length > 0
      ? [manualVerificationCheck(
          `phase${phaseIndex}-check-2`,
          "Inspect affected surfaces",
          `Review the user-visible behavior around affected files: ${files.slice(0, 12).join(", ")}.`,
          "phase"
        )]
      : []),
  ];
}

export function trackManualVerificationChecks(specJson: JsonObject | null | undefined): JsonObject[] {
  const spec = asJsonObject(specJson);
  const groups = [
    { key: "functional_requirements", label: "Functional", source: "functional_requirements" },
    { key: "non_functional_requirements", label: "Non-functional", source: "non_functional_requirements" },
    { key: "acceptance_criteria", label: "Acceptance", source: "acceptance_criteria" },
    { key: "out_of_scope", label: "Out of scope guardrail", source: "out_of_scope" },
  ];
  const checks: JsonObject[] = [];
  for (const group of groups) {
    const items = specItemsFromRaw(spec[group.key]);
    items.forEach((item, index) => {
      const heading = asOptionalString(item.heading) || `${group.label} ${index + 1}`;
      const body = asOptionalString(item.body) || heading;
      checks.push(manualVerificationCheck(
        `track-${group.source.replace(/_/g, "-")}-${index + 1}`,
        `${group.label}: ${heading}`,
        body,
        group.source
      ));
    });
  }
  if (checks.length > 0) return checks;
  return [
    manualVerificationCheck(
      "track-check-1",
      "Verify delivered outcome",
      "Manually verify that the completed track delivers the intended behavior from the spec.",
      "track"
    ),
  ];
}

export function normalizePlanManualVerification(plan: JsonObject, specJson?: JsonObject | null): JsonObject {
  const rawPhases = asArray(plan.phases).map(asJsonObject);
  const existingTrackPhase = rawPhases.find((phase) => {
    const title = (asOptionalString(phase.title) || "").toLowerCase();
    const tasks = asArray(phase.tasks);
    return title.includes("user manual verification")
      || tasks.some((task) => isManualVerificationTaskObject(task, "track"));
  });
  const implementationPhases = rawPhases.filter((phase) => phase !== existingTrackPhase);
  const phaseManualKeys: string[] = [];
  const normalizedPhases: JsonObject[] = implementationPhases.map((rawPhase, phaseOffset) => {
    const phaseIndex = phaseOffset + 1;
    const tasks = asArray(rawPhase.tasks).map(asJsonObject);
    const existingManual = tasks.find((task) => isManualVerificationTaskObject(task, "phase"));
    const implementationTasks = tasks.filter((task) => !isManualVerificationTaskObject(task, "phase") && !isManualVerificationTaskObject(task, "track"));
    const normalizedTasks: JsonObject[] = implementationTasks.map((task, taskOffset) => ({
      ...task,
      task_index: taskOffset + 1,
      task_key: asOptionalString(task.task_key) || `phase${phaseIndex}_task${taskOffset + 1}`,
      depends_on: asStringArray(task.depends_on || task.depends),
      files: asStringArray(task.files),
      commit_shas: asStringArray(task.commit_shas),
      repo_shas: asJsonObject(task.repo_shas),
    }));
    const manualTaskKey = `phase${phaseIndex}_manual_verification`;
    phaseManualKeys.push(manualTaskKey);
    const manualTask: JsonObject = {
      ...(existingManual || {}),
      task_index: normalizedTasks.length + 1,
      task_key: manualTaskKey,
      title: "User Manual Verification",
      status: asOptionalString(asJsonObject(existingManual).status) || "pending",
      task_type: MANUAL_VERIFICATION_TASK_TYPE,
      files: [],
      depends_on: normalizedTasks
        .map((task) => asOptionalString(task.task_key))
        .filter((value): value is string => Boolean(value)),
      repo: null,
      annotations: {
        ...asJsonObject(asJsonObject(existingManual).annotations),
        "task-type": MANUAL_VERIFICATION_TASK_TYPE,
        "manual-verification-scope": "phase",
      },
      commit_shas: asStringArray(asJsonObject(existingManual).commit_shas),
      repo_shas: asJsonObject(asJsonObject(existingManual).repo_shas),
      manual_verification: {
        ...asJsonObject(asJsonObject(existingManual).manual_verification),
        scope: "phase",
        suggested_checks: phaseManualVerificationChecks({ ...rawPhase, phase_index: phaseIndex }, normalizedTasks),
      },
      completion_evidence: asJsonObject(asJsonObject(existingManual).completion_evidence),
    };
    return {
      ...rawPhase,
      phase_index: phaseIndex,
      title: asOptionalString(rawPhase.title) || `Phase ${phaseIndex}`,
      execution_mode: asOptionalString(rawPhase.execution_mode) || asOptionalString(asJsonObject(rawPhase.annotations).execution) || "sequential",
      depends_on: asStringArray(rawPhase.depends_on),
      annotations: asJsonObject(rawPhase.annotations),
      tasks: [...normalizedTasks, manualTask],
    };
  });
  const trackPhaseIndex = normalizedPhases.length + 1;
  const trackPhaseDepends = normalizedPhases.map((phase) => `phase${phase.phase_index}`);
  const existingTrackTask = asArray(asJsonObject(existingTrackPhase).tasks).map(asJsonObject)
    .find((task) => isManualVerificationTaskObject(task, "track"));
  const trackManualTask: JsonObject = {
    ...(existingTrackTask || {}),
    task_index: 1,
    task_key: "track_manual_verification",
    title: "Track-Level User Manual Verification",
    status: asOptionalString(asJsonObject(existingTrackTask).status) || "pending",
    task_type: MANUAL_VERIFICATION_TASK_TYPE,
    files: [],
    depends_on: phaseManualKeys,
    repo: null,
    annotations: {
      ...asJsonObject(asJsonObject(existingTrackTask).annotations),
      "task-type": MANUAL_VERIFICATION_TASK_TYPE,
      "manual-verification-scope": "track",
    },
    commit_shas: asStringArray(asJsonObject(existingTrackTask).commit_shas),
    repo_shas: asJsonObject(asJsonObject(existingTrackTask).repo_shas),
    manual_verification: {
      ...asJsonObject(asJsonObject(existingTrackTask).manual_verification),
      scope: "track",
      suggested_checks: trackManualVerificationChecks(specJson),
    },
    completion_evidence: asJsonObject(asJsonObject(existingTrackTask).completion_evidence),
  };
  return {
    ...plan,
    phases: [
      ...normalizedPhases,
      {
        ...(existingTrackPhase || {}),
        phase_index: trackPhaseIndex,
        title: `Phase ${trackPhaseIndex}: User Manual Verification`,
        execution_mode: "sequential",
        depends_on: trackPhaseDepends,
        annotations: {
          ...asJsonObject(asJsonObject(existingTrackPhase).annotations),
          execution: "sequential",
          depends: trackPhaseDepends.join(","),
        },
        tasks: [trackManualTask],
      },
    ],
  };
}

export function planJsonToParsedPlan(raw: JsonObject): ParsedPlan {
  const phases = asArray(raw.phases).map((rawPhase, phaseOffset) => {
    const phase = asJsonObject(rawPhase);
    const phaseIndex = Number(phase.phase_index || phase.index || phaseOffset + 1);
    const phaseDepends = asStringArray(phase.depends_on);
    const hasExplicitPhaseDepends = Object.prototype.hasOwnProperty.call(phase, "depends_on");
    const annotations = {
      ...asJsonObject(phase.annotations),
      ...(asOptionalString(phase.execution_mode) ? { execution: asOptionalString(phase.execution_mode) } : {}),
      ...(hasExplicitPhaseDepends ? { depends: phaseDepends.join(",") } : {}),
    };
    const tasks: PlanTask[] = asArray(phase.tasks).map((rawTask, taskOffset) => {
      const task = asJsonObject(rawTask);
      const taskIndex = Number(task.task_index || task.index || taskOffset + 1);
      const taskKey = asOptionalString(task.task_key) || `phase${phaseIndex}_task${taskIndex}`;
      const files = asStringArray(task.files);
      const depends = asStringArray(task.depends_on || task.depends);
      const labels = asStringArray(task.labels);
      const taskAnnotations: JsonObject = {
        ...asJsonObject(task.annotations),
        ...(files.length > 0 ? { files: files.join(", ") } : {}),
        ...(depends.length > 0 ? { depends: depends.join(",") } : {}),
        ...(labels.length > 0 ? { labels: labels.join(",") } : {}),
        ...(asOptionalString(task.repo) ? { repo: asOptionalString(task.repo) } : {}),
      };
      return {
        task_index: taskIndex,
        task_key: taskKey,
        title: asOptionalString(task.title) || `Task ${taskIndex}`,
        marker: markerForPlanStatus(task.status),
        annotations: taskAnnotations,
        files,
        depends,
        labels,
        repo: asOptionalString(task.repo) || null,
        line: Number(task.line || phaseIndex * 100 + taskIndex),
        phase_index: phaseIndex,
        commit_shas: asStringArray(task.commit_shas),
        repo_shas: asJsonObject(task.repo_shas),
        task_type: asOptionalString(task.task_type || taskAnnotations["task-type"]) || null,
        manual_verification: isRecord(task.manual_verification)
          ? asJsonObject(task.manual_verification)
          : (asOptionalString(taskAnnotations["manual-verification-scope"]) ? { scope: asOptionalString(taskAnnotations["manual-verification-scope"]) } : null),
        completion_evidence: isRecord(task.completion_evidence) ? asJsonObject(task.completion_evidence) : null,
      };
    });
    return {
      phase_index: phaseIndex,
      title: asOptionalString(phase.title) || `Phase ${phaseIndex}`,
      annotations,
      tasks,
      line: Number(phase.line || phaseIndex * 100),
    } as PlanPhase;
  });
  return { ok: true, phases, tasks: phases.flatMap((phase) => phase.tasks), warnings: [], errors: [] };
}

export function renderPlanMarkdown(raw: JsonObject): string {
  const trackId = asOptionalString(raw.track_id) || "track";
  const parts: string[] = [`# Plan: ${trackId}`, ""];
  const parsed = planJsonToParsedPlan(raw);
  for (const phase of parsed.phases) {
    parts.push(`## Phase ${phase.phase_index}: ${phase.title.replace(/^Phase\s+\d+:\s*/i, "")}`);
    if (phase.annotations.execution) parts.push(`<!-- execution: ${phase.annotations.execution} -->`);
    if (Object.prototype.hasOwnProperty.call(phase.annotations, "depends")) {
      parts.push(`<!-- depends: ${phase.annotations.depends || ""} -->`);
    }
    parts.push("");
    for (const task of phase.tasks) {
      const commit = task.commit_shas && task.commit_shas.length > 0 ? ` (${task.commit_shas[task.commit_shas.length - 1]})` : "";
      parts.push(`- [${task.marker}] Task ${task.task_index}: ${task.title.replace(/^Task\s+\d+:\s*/i, "")}${commit}`);
      if (task.repo) parts.push(`  <!-- repo: ${task.repo} -->`);
      if (task.files.length > 0) parts.push(`  <!-- files: ${task.files.join(", ")} -->`);
      if (task.depends.length > 0) parts.push(`  <!-- depends: ${task.depends.join(", ")} -->`);
      if (task.labels && task.labels.length > 0) parts.push(`  <!-- labels: ${task.labels.join(", ")} -->`);
      if (task.commit_shas && task.commit_shas.length > 0) parts.push(`  <!-- commits: ${task.commit_shas.join(", ")} -->`);
      if (task.task_type) parts.push(`  <!-- task-type: ${task.task_type} -->`);
      if (task.manual_verification) {
        const manual = asJsonObject(task.manual_verification);
        const scope = asOptionalString(manual.scope);
        if (scope) parts.push(`  <!-- manual-verification-scope: ${scope} -->`);
        const checks = asArray(manual.suggested_checks);
        if (checks.length > 0) parts.push(`  <!-- manual-verification-checks: ${checks.length} suggested -->`);
      }
      parts.push("");
    }
  }
  appendCanonicalJsonBlock(parts, raw);
  return normalizedText(parts.join("\n"));
}
