import path from "node:path";
import { randomUUID } from "node:crypto";

import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { CadreTrack, JsonObject, PlanTask, RuntimeArgs } from "../../../types";

import { fileExists, readJson, textHash, utcNow, writeJsonEnsured } from "../../infrastructure/runtime/json-store";
import { runCommand } from "../../infrastructure/runtime/system";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult, CoverageResult, WorkingRoot } from "./contracts";
import { traceResultFingerprint } from "./git-change-fingerprint";
import { gitCommitMembership } from "./git-commit-membership";
import { completionJournalPath, patchCompletionJournal, readCompletionJournal } from "./manual-verification";
import { appendCadreEvent } from "./native-state";
import { trackPlanJsonPath } from "./plan-docs";
import { markCompletionProductIntegrityFailed } from "./product-commit-integrity";
import { recordTaskResultUnlocked } from "./track-mutations";

const ACTIVE_STAGES = new Set([
  "state_pending",
  "commit_pending",
  "product_committed",
  "record_task_result_failed",
  "state_recorded",
  "event_log_failed",
  "event_recorded",
  "control_commit_failed",
  "completed",
]);

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function canonicalRepo(value: unknown): string {
  const repo = asOptionalString(value) || "root";
  return repo === "." ? "root" : repo;
}

function intentMarkerPath(track: CadreTrack, key: string): string {
  return path.join(track.dir, "..", "..", "local", "completion-intents", `${textHash(`${track.track_id}\0${key}`).slice(0, 24)}.json`);
}

function intentMarkedTerminal(track: CadreTrack, key: string, entry: JsonObject): boolean {
  const marker = readJson<JsonObject | null>(intentMarkerPath(track, key), null);
  return asOptionalString(marker?.entry_hash) === textHash(JSON.stringify(entry));
}

function markIntentTerminal(track: CadreTrack, key: string): void {
  const entry = asJsonObject(readCompletionJournal(track).entries[key]);
  if (Object.keys(entry).length === 0) return;
  writeJsonEnsured(intentMarkerPath(track, key), {
    journal_key: key,
    entry_hash: textHash(JSON.stringify(entry)),
    completed_at: utcNow(),
  });
}

function intentEntryCommitted(track: CadreTrack, key: string, entry: JsonObject): boolean {
  if (fileExists(intentMarkerPath(track, key)) && intentMarkedTerminal(track, key, entry)) return true;
  const root = path.resolve(track.dir, "../../..");
  const relative = path.relative(root, completionJournalPath(track));
  const shown = runCommand("git", ["--literal-pathspecs", "show", `HEAD:${relative}`], { cwd: root });
  if (!shown.ok) return false;
  try {
    const committed = asJsonObject(asJsonObject(JSON.parse(shown.stdout)).entries)[key];
    return JSON.stringify(asJsonObject(committed)) === JSON.stringify(entry);
  } catch {
    return false;
  }
}

export function completionIntentKey(phaseIndex: number, taskIndex: number, repo: string): string {
  return `intent:${phaseIndex}:${taskIndex}:${encodeURIComponent(repo || "root")}`;
}

export function activeCompletionIntents(track: CadreTrack): Array<{ key: string; entry: JsonObject }> {
  const journal = readCompletionJournal(track);
  return Object.entries(journal.entries)
    .filter(([key, entry]) => {
      const stage = asOptionalString(entry.stage) || "";
      return key.startsWith("intent:") && ACTIVE_STAGES.has(stage) && (stage !== "completed" || !intentEntryCommitted(track, key, entry));
    })
    .map(([key, entry]) => ({ key, entry: asJsonObject(entry) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function validateJournalCommit(
  cwd: string,
  trackId: string,
  taskKey: string,
  headSha: string,
  entry: JsonObject,
): CoreResult {
  const expectedBaseline = asOptionalString(entry.baseline_sha) || "";
  const changed = gitCommitMembership(cwd, headSha);
  if (changed.ok === false || asStringArray(changed.parent_shas).length !== 1 || (expectedBaseline && asOptionalString(changed.parent_sha) !== expectedBaseline)) {
    return { ok: false, stage: "completion_state_recovery", error: "The journaled product commit is not a direct child of its recorded baseline." };
  }
  const expectedFiles = unique(asStringArray(entry.dirty_files));
  const actualFiles = unique(asStringArray(changed.files));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    return {
      ok: false,
      stage: "completion_state_recovery",
      error: "The journaled product commit does not contain the exact recorded task change set.",
      expected_files: expectedFiles,
      actual_files: actualFiles,
    };
  }
  const resultFingerprint = traceResultFingerprint(cwd, expectedFiles, headSha);
  const expectedResultFingerprint = asOptionalString(entry.result_fingerprint) || "";
  if (
    resultFingerprint.ok === false
    || !expectedResultFingerprint
    || asOptionalString(resultFingerprint.fingerprint) !== expectedResultFingerprint
  ) {
    return {
      ok: false,
      stage: "completion_state_recovery",
      error: "The journaled product commit content does not match the pre-commit result fingerprint.",
      expected_result_fingerprint: expectedResultFingerprint || null,
      actual_result_fingerprint: asOptionalString(resultFingerprint.fingerprint) || null,
    };
  }
  const message = runCommand("git", ["log", "-1", "--format=%B", headSha], { cwd });
  const trailers = new Set(message.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  if (
    !message.ok
    || !trailers.has("Cadre-Workflow: complete_task")
    || !trailers.has(`Cadre-Track: ${trackId}`)
    || !trailers.has(`Cadre-Task: ${taskKey}`)
  ) {
    return { ok: false, stage: "completion_state_recovery", error: "The journaled commit lacks the expected Cadre task identity." };
  }
  return { ok: true, files: actualFiles };
}

export function completionStateRecovery(
  track: CadreTrack,
  journalKey: string,
  task: PlanTask,
  workingRoot: WorkingRoot,
  currentHead: string,
  dirtyFiles: string[],
  promoteInterruptedCommit = true,
): CoreResult {
  const entry = asJsonObject(readCompletionJournal(track).entries[journalKey]);
  if (Object.keys(entry).length === 0 || !ACTIVE_STAGES.has(asOptionalString(entry.stage) || "")) {
    return { ok: true, active: false };
  }
  if (entry.stage === "completed" && intentEntryCommitted(track, journalKey, entry)) return { ok: true, active: false };
  const identityMatches = asOptionalString(entry.track_id) === track.track_id
    && Number(entry.phase_index) === task.phase_index
    && Number(entry.task_index) === task.task_index
    && asOptionalString(entry.task_key) === task.task_key
    && canonicalRepo(entry.repo) === canonicalRepo(workingRoot.repo)
    && path.resolve(asOptionalString(entry.working_root) || "") === path.resolve(workingRoot.path);
  if (!identityMatches) {
    return { ok: false, stage: "completion_state_recovery", blocked: true, journal_key: journalKey, reason: "The active completion journal does not match this exact task worktree." };
  }
  if (entry.stage === "commit_pending" && currentHead === asOptionalString(entry.baseline_sha)) {
    return { ok: true, active: false, journal_key: journalKey };
  }
  if (dirtyFiles.length > 0) {
    return {
      ok: false,
      stage: "completion_state_recovery",
      blocked: true,
      journal_key: journalKey,
      dirty_files: dirtyFiles,
      reason: "Task state cannot be recovered while the journaled product worktree is dirty.",
    };
  }
  if (entry.intent_mode === "state_only" || entry.stage === "state_pending") {
    const expectedHead = asOptionalString(entry.baseline_sha) || "";
    if (currentHead !== expectedHead) {
      return {
        ok: false,
        stage: "completion_state_recovery",
        blocked: true,
        journal_key: journalKey,
        expected_head: expectedHead || null,
        actual_head: currentHead || null,
        reason: "The state-only journal baseline no longer matches worktree HEAD.",
      };
    }
    return {
      ok: true,
      active: true,
      journal_key: journalKey,
      commit_sha: asOptionalString(entry.commit_sha) || "",
      entry,
    };
  }
  let committedSha = asOptionalString(entry.commit_sha) || "";
  if (entry.stage === "commit_pending") {
    const baseline = asOptionalString(entry.baseline_sha) || "";
    if (!currentHead || currentHead === baseline) return { ok: true, active: false, journal_key: journalKey };
    const inferred = validateJournalCommit(workingRoot.path, track.track_id, task.task_key, currentHead, entry);
    if (inferred.ok === false) return { ...inferred, blocked: true, journal_key: journalKey };
    committedSha = currentHead;
    if (promoteInterruptedCommit) {
      patchCompletionJournal(track, journalKey, (current) => ({
        ...current,
        stage: "product_committed",
        commit_sha: committedSha,
        committed_files: asStringArray(inferred.files),
        product_committed_at: utcNow(),
        inferred_after_interruption: true,
      }));
    }
  }
  if (!committedSha || committedSha !== currentHead) {
    return {
      ok: false,
      stage: "completion_state_recovery",
      blocked: true,
      journal_key: journalKey,
      expected_head: committedSha || null,
      actual_head: currentHead || null,
      reason: "The active completion journal product SHA does not match worktree HEAD.",
    };
  }
  const verified = validateJournalCommit(workingRoot.path, track.track_id, task.task_key, currentHead, entry);
  if (verified.ok === false) return { ...verified, blocked: true, journal_key: journalKey };
  return {
    ok: true,
    active: true,
    journal_key: journalKey,
    commit_sha: committedSha,
    entry: promoteInterruptedCommit
      ? asJsonObject(readCompletionJournal(track).entries[journalKey])
      : { ...entry, commit_sha: committedSha },
  };
}

interface CompletionIntentInput {
  track: CadreTrack;
  key: string;
  task: PlanTask;
  workingRoot: WorkingRoot;
  baselineSha: string;
  dirtyFiles: string[];
  fingerprint: string;
  resultFingerprint: string;
  coverage: CoverageResult;
  lastTestRun: JsonObject;
  threshold: number;
  status: string;
}

export function prepareCompletionIntent(input: CompletionIntentInput): JsonObject {
  return patchCompletionJournal(input.track, input.key, (current) => ({
    ...current,
    stage: "commit_pending",
    intent_mode: "product_commit",
    track_id: input.track.track_id,
    phase_index: input.task.phase_index,
    task_index: input.task.task_index,
    task_key: input.task.task_key,
    repo: input.workingRoot.repo,
    working_root: input.workingRoot.path,
    baseline_sha: input.baselineSha,
    dirty_files: unique(input.dirtyFiles),
    change_set_fingerprint: input.fingerprint,
    result_fingerprint: input.resultFingerprint,
    coverage: input.coverage as JsonObject,
    last_test_run: input.lastTestRun,
    threshold: input.threshold,
    requested_status: input.status,
    operation_id: randomUUID(),
    started_at: asOptionalString(current.started_at) || utcNow(),
    updated_at: utcNow(),
  }));
}

interface StateIntentInput {
  track: CadreTrack;
  key: string;
  task: PlanTask;
  workingRoot: WorkingRoot;
  baselineSha: string;
  commitSha: string;
  coverage: CoverageResult;
  lastTestRun: JsonObject | null;
  manualVerificationEvidence: JsonObject | null;
  threshold: number;
  status: string;
}

export function prepareCompletionStateIntent(input: StateIntentInput): JsonObject {
  return patchCompletionJournal(input.track, input.key, (current) => ({
    ...current,
    stage: "state_pending",
    intent_mode: "state_only",
    track_id: input.track.track_id,
    phase_index: input.task.phase_index,
    task_index: input.task.task_index,
    task_key: input.task.task_key,
    repo: input.workingRoot.repo,
    working_root: input.workingRoot.path,
    baseline_sha: input.baselineSha,
    commit_sha: input.commitSha || null,
    coverage: input.coverage as JsonObject,
    last_test_run: input.lastTestRun,
    manual_verification_evidence: input.manualVerificationEvidence,
    threshold: input.threshold,
    requested_status: input.status,
    operation_id: randomUUID(),
    started_at: asOptionalString(current.started_at) || utcNow(),
    updated_at: utcNow(),
  }));
}

export function markCompletionProductCommitted(
  track: CadreTrack,
  key: string,
  commitSha: string,
  files: string[],
): JsonObject {
  return patchCompletionJournal(track, key, (current) => ({
    ...current,
    stage: "product_committed",
    commit_sha: commitSha,
    committed_files: unique(files),
    product_committed_at: utcNow(),
  }));
}

interface RecordCompletionStateInput {
  root: string;
  args: RuntimeArgs;
  track: CadreTrack;
  task: PlanTask;
  phaseIndex: number;
  taskIndex: number;
  workingRoot: WorkingRoot;
  coverage: CoverageResult;
  threshold: number;
  resolvedCommitSha: string;
  productCommit: CoreResult | null;
  manualVerificationEvidence: JsonObject | null;
  lastTestRun: JsonObject | null;
  controlBefore: ReturnType<typeof beginTrace>;
  intentKey?: string | null;
  expectedProductHead?: string | null;
}

export function recordCompletionState(input: RecordCompletionStateInput): CoreResult {
  const { root, args, track, task, phaseIndex, taskIndex, workingRoot, coverage, threshold } = input;
  if (input.expectedProductHead) {
    const head = runCommand("git", ["rev-parse", "HEAD"], { cwd: workingRoot.path });
    const actualHead = head.ok ? head.stdout.trim() : "";
    if (actualHead !== input.expectedProductHead) {
      if (input.intentKey) markCompletionProductIntegrityFailed(track, input.intentKey, input.expectedProductHead, [], [], "Product HEAD changed before task state recording");
      return { ok: false, stage: "product_commit_integrity", blocked: true, recovery_required: true, manual_recovery_required: true, expected_head: input.expectedProductHead, actual_head: actualHead || null, reason: "Product HEAD changed before Cadre could record task state." };
    }
  }
  const sha = input.resolvedCommitSha ? input.resolvedCommitSha.slice(0, 12) : "unknown";
  const journalKey = `${phaseIndex}:${taskIndex}:${sha}`;
  const operationId = asOptionalString(input.intentKey ? asJsonObject(readCompletionJournal(track).entries[input.intentKey]).operation_id : null)
    || input.resolvedCommitSha
    || `${track.track_id}:p${phaseIndex}:t${taskIndex}:${sha}`;
  const dedupKey = `key:${operationId}`;
  const patchIntent = (stage: string, extra: JsonObject = {}): void => {
    if (!input.intentKey) return;
    patchCompletionJournal(track, input.intentKey, (current) => ({ ...current, stage, ...extra, updated_at: utcNow() }));
  };
  const intentEntry = input.intentKey
    ? asJsonObject(readCompletionJournal(track).entries[input.intentKey])
    : {};
  const resumeStage = asOptionalString(intentEntry.stage) || "";
  const entry = patchCompletionJournal(track, journalKey, (current) => ({
    ...current,
    stage: current.stage || "started",
    track_id: track.track_id,
    phase_index: phaseIndex,
    task_index: taskIndex,
    task_key: task.task_key,
    commit_sha: sha,
    dedup_key: dedupKey,
    started_at: current.started_at || utcNow(),
  }));
  const stateAlreadyRecorded = ["state_recorded", "event_log_failed", "event_recorded", "control_commit_failed", "completed"].includes(resumeStage);
  let taskResultJson = asJsonObject(intentEntry.task_result);
  let taskResult: CoreResult = { ok: true, ...taskResultJson };
  if (!stateAlreadyRecorded) {
    taskResult = recordTaskResultUnlocked(root, {
      trackId: track.track_id,
      phaseIndex,
      taskIndex,
      status: args.status || "completed",
      commitSha: input.resolvedCommitSha || args.commitSha,
      coverage: coverage.coverage,
      repo: workingRoot.repo,
      workingRoot: path.relative(root, workingRoot.path) || ".",
      dedupKey: `${dedupKey}:task-result`,
      ...(input.lastTestRun ? { lastTestRun: input.lastTestRun } : {}),
      ...(input.manualVerificationEvidence ? { manualVerificationEvidence: input.manualVerificationEvidence } : {}),
    });
    if (!taskResult.ok) {
      const error = taskResult.error || asOptionalString(taskResult.stage) || "record task result failed";
      patchCompletionJournal(track, journalKey, (current) => ({ ...current, stage: "record_task_result_failed", error }));
      patchIntent("record_task_result_failed", { error });
      return { ok: false, stage: "record_task_result", recovery_required: true, threshold, working_root: workingRoot, coverage, task_result: taskResult, journal: entry };
    }
    taskResultJson = asJsonObject(taskResult);
    const compactTaskResult = { task_key: taskResultJson.task_key, commit_sha: taskResultJson.commit_sha, line: taskResultJson.line };
    patchCompletionJournal(track, journalKey, (current) => ({
      ...current,
      stage: "state_recorded",
      state_recorded_at: utcNow(),
      task_result: compactTaskResult,
    }));
    patchIntent("state_recorded", { state_recorded_at: utcNow(), task_result: compactTaskResult });
  }
  if (Object.keys(taskResultJson).length === 0) {
    taskResultJson = { task_key: task.task_key, commit_sha: input.resolvedCommitSha || null, line: task.line };
  }
  const eventAlreadyRecorded = ["event_recorded", "control_commit_failed", "completed"].includes(resumeStage);
  const event = eventAlreadyRecorded
    ? { ok: true, event: asJsonObject(intentEntry.event), replayed: true }
    : appendCadreEvent(root, {
        id: `evt_${dedupKey.replace(/[^A-Za-z0-9_.-]+/g, "_")}_completed`,
        kind: "task_completed",
        workflow: "complete_task",
        track_id: track.track_id,
        phase_index: phaseIndex,
        task_index: taskIndex,
        task_key: taskResultJson.task_key,
        status: args.status || "completed",
        commit_sha: sha,
        coverage: coverage.coverage ?? null,
        summary: args.summary || null,
        journal_key: journalKey,
      });
  if (event.ok === false) {
    const error = asOptionalString(event.error) || "Task completion changed state but its required audit event was not recorded";
    patchIntent("event_log_failed", { error });
    return { ok: false, recovery_required: true, stage: "event_log", error, track_id: track.track_id, task_key: taskResultJson.task_key, working_root: workingRoot, threshold, coverage, product_commit: input.productCommit, task_result: taskResultJson, event };
  }
  patchIntent("event_recorded", { event: asJsonObject(event.event), event_recorded_at: utcNow() });
  const completedJournal = patchCompletionJournal(track, journalKey, (current) => ({
    ...current,
    stage: "completed",
    completed_at: current.completed_at || utcNow(),
  }));
  patchIntent("completed", { completed_at: utcNow() });
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "complete",
    subject: `record ${track.track_id} phase ${phaseIndex} task ${taskIndex}`,
    before: input.controlBefore,
    files: [
      path.relative(root, track.metadata_path),
      path.relative(root, track.plan_path),
      path.relative(root, trackPlanJsonPath(track)),
      path.relative(root, completionJournalPath(track)),
      path.relative(root, `${completionJournalPath(track)}l`),
      path.relative(root, path.join(track.dir, "implement_state.json")),
      "cadre/events.jsonl",
    ],
    allowDirty: true,
    trackId: track.track_id,
    taskKey: task.task_key,
    repo: ".",
    note: {
      event_id: asOptionalString(asJsonObject(event.event).id) || null,
      phase_index: phaseIndex,
      task_index: taskIndex,
      task_key: taskResultJson.task_key,
      product_commit_sha: asOptionalString(input.productCommit?.commit_sha) || input.resolvedCommitSha || null,
      coverage: coverage.coverage ?? null,
    },
  });
  if (controlCommit.ok === false) patchIntent("control_commit_failed", { error: asOptionalString(controlCommit.error) || "Control commit failed" });
  else if (input.intentKey) markIntentTerminal(track, input.intentKey);
  return {
    ok: controlCommit.ok !== false,
    track_id: track.track_id,
    task_key: taskResultJson.task_key,
    working_root: workingRoot,
    threshold,
    coverage,
    product_commit: input.productCommit,
    control_commit: controlCommit,
    task_result: taskResultJson,
    event,
    journal: completedJournal,
  };
}
