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

import { CompletionJournal, CoreResult, WorkingRoot } from "./contracts";
import { appendJsonl, readJson, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { manualVerificationScope } from "./plan-docs";
import { asArray } from "./status";
import { gitIdentity, runCommand } from "../../infrastructure/runtime/system";
import { humanReviewConfirmed } from "./tech-stack";

export function completionJournalPath(track: CadreTrack): string {
  return path.join(track.dir, "completion_journal.json");
}

export function readCompletionJournal(track: CadreTrack): CompletionJournal {
  const value = readJson<unknown>(completionJournalPath(track), { entries: {} });
  if (!isRecord(value)) return { entries: {} };
  const entries = isRecord(value.entries) ? value.entries : {};
  return {
    ...asJsonObject(value),
    entries: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, asJsonObject(entry)])),
  };
}

export function writeCompletionJournal(track: CadreTrack, journal: CompletionJournal): void {
  writeJson(completionJournalPath(track), journal as JsonObject);
}

export function patchCompletionJournal(
  track: CadreTrack,
  key: string,
  patcher: (current: JsonObject, journal: CompletionJournal) => JsonObject,
): JsonObject {
  const journal = readCompletionJournal(track);
  const before = journal.entries[key] || {};
  journal.entries[key] = patcher({ ...before }, journal);
  journal.updated_at = utcNow();
  writeCompletionJournal(track, journal);
  appendJsonl(path.join(track.dir, "completion_journal.jsonl"), {
    key,
    recorded_at: journal.updated_at,
    entry: journal.entries[key],
  });
  return journal.entries[key];
}

export function manualVerificationChecksFromInput(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry === "string") return { id: `check-${index + 1}`, heading: entry, status: "reported" };
      return asJsonObject(entry);
    }).filter((entry) => Object.keys(entry).length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({ id: `check-${index + 1}`, heading: line, status: "reported" }));
  }
  const object = asJsonObject(value);
  if (Array.isArray(object.checks)) return manualVerificationChecksFromInput(object.checks);
  return Object.keys(object).length > 0 ? [object] : [];
}

export function manualVerificationResultObject(value: unknown): JsonObject {
  if (typeof value === "string" && value.trim()) return { summary: value.trim() };
  return asJsonObject(value);
}

export function manualVerificationInputResult(args: RuntimeArgs): JsonObject {
  return manualVerificationResultObject(args.manualVerificationResult || args.manual_verification_result);
}

export function manualVerificationInputSummary(args: RuntimeArgs, result: JsonObject): string {
  return asOptionalString(args.manualVerificationSummary || args.manual_verification_summary)
    || asOptionalString(result.summary)
    || asOptionalString(result.message)
    || "";
}

export function manualVerificationInputChecks(args: RuntimeArgs, result: JsonObject): JsonObject[] {
  return manualVerificationChecksFromInput(args.manualVerificationChecks || args.manual_verification_checks || result.checks);
}

export function manualVerificationCommand(args: RuntimeArgs): string | null {
  return asOptionalString(args.manualVerificationCommand || args.manual_verification_command) || null;
}

export function commandResultEvidence(result: CommandResult): JsonObject {
  return {
    ok: result.ok,
    status: result.status,
    signal: result.signal || null,
    command: result.command,
    cwd: result.cwd || null,
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
  };
}

export function prepareManualVerificationCompletion(
  root: string,
  track: CadreTrack,
  task: PlanTask,
  args: RuntimeArgs,
  workingRoot: WorkingRoot,
): CoreResult {
  const mode = asOptionalString(args.manualVerificationMode || args.manual_verification_mode)
    || (manualVerificationCommand(args) ? "autorun" : "offline");
  const command = manualVerificationCommand(args);
  const suggestedChecks: JsonObject[] = asArray(asJsonObject(task.manual_verification).suggested_checks).map(asJsonObject);
  const inputResult = manualVerificationInputResult(args);
  const confirmed = humanReviewConfirmed(args);
  if (mode === "autorun" && !confirmed) {
    if (!command) {
      return {
        ok: false,
        blocked: true,
        stage: "manual_verification",
        reason: "manualVerificationCommand is required for autorun manual verification",
      };
    }
    const result = runCommand(command, [], {
      cwd: workingRoot.path,
      shell: true,
      timeoutMs: Number(args.timeoutMs || 10 * 60 * 1000),
      maxBuffer: 30 * 1024 * 1024,
    });
    const evidence: JsonObject = {
      mode,
      approved: false,
      task_key: task.task_key,
      scope: manualVerificationScope(task),
      summary: result.ok
        ? "Autorun manual verification command completed successfully."
        : "Autorun manual verification command failed.",
      suggested_checks: suggestedChecks,
      checks: manualVerificationInputChecks(args, inputResult),
      command,
      result: commandResultEvidence(result),
      recorded_at: utcNow(),
    };
    return {
      ok: false,
      dry_run: true,
      blocked: true,
      phase_state: "awaiting_human_review",
      stage: "manual_verification_approval",
      track_id: track.track_id,
      task_key: task.task_key,
      manual_verification: evidence,
      reason: "Human approval is required before marking manual verification complete",
    };
  }
  if (!confirmed) {
    return {
      ok: false,
      dry_run: true,
      blocked: true,
      phase_state: "awaiting_human_review",
      stage: "manual_verification_approval",
      track_id: track.track_id,
      task_key: task.task_key,
      manual_verification: {
        mode,
        approved: false,
        task_key: task.task_key,
        scope: manualVerificationScope(task),
        suggested_checks: suggestedChecks,
      },
      reason: "Human approval is required before marking manual verification complete",
    };
  }

  let commandEvidence: JsonObject | null = isRecord(inputResult.result) ? asJsonObject(inputResult.result) : null;
  if (mode === "autorun" && command && !commandEvidence) {
    const result = runCommand(command, [], {
      cwd: workingRoot.path,
      shell: true,
      timeoutMs: Number(args.timeoutMs || 10 * 60 * 1000),
      maxBuffer: 30 * 1024 * 1024,
    });
    commandEvidence = commandResultEvidence(result);
  }
  const summary = manualVerificationInputSummary(args, inputResult)
    || (commandEvidence ? (commandEvidence.ok === true ? "Approved autorun manual verification result." : "Approved autorun manual verification result with failures noted.") : "");
  if (!summary.trim()) {
    return {
      ok: false,
      blocked: true,
      stage: "manual_verification_summary",
      track_id: track.track_id,
      task_key: task.task_key,
      reason: "manualVerificationSummary or manualVerificationResult.summary is required",
    };
  }
  const evidence: JsonObject = {
    mode,
    approved: true,
    approved_at: utcNow(),
    approved_by: gitIdentity(root) || null,
    task_key: task.task_key,
    scope: manualVerificationScope(task),
    summary: summary.trim(),
    suggested_checks: suggestedChecks,
    checks: manualVerificationInputChecks(args, inputResult),
    ...(command ? { command } : {}),
    ...(commandEvidence ? { result: commandEvidence } : {}),
    recorded_at: utcNow(),
  };
  return { ok: true, evidence };
}
