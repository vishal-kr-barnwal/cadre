import path from "node:path";

import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { CommandResult, JsonObject, RuntimeArgs } from "../../../types";
import { fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { plannedGitAction, runCommand } from "../../infrastructure/runtime/system";
import { claimPathError, concreteGitPathError, resolveClaimsToPaths } from "./claim-paths";
import { projectionGuard } from "./commit-trace-projections";
import type { CoreResult, PlannedGitAction } from "./contracts";
import { traceFingerprint, traceResultFingerprint } from "./git-change-fingerprint";
import { gitCommitMembership } from "./git-commit-membership";
import { dirtyUniverseError, traceFileKind } from "./git-dirty-classification";
import { withGitIndexLock } from "./git-index-lock";
import { captureGitIndex, restoreGitIndex, rollbackGitCommit } from "./git-index-state";

export { traceDirtyFiles, traceFileKind, traceNonIgnoredFiles } from "./git-dirty-classification";

export { traceFingerprint } from "./git-change-fingerprint";

const DEFAULT_NOTES_REF = "refs/notes/cadre";

export interface TraceSnapshot extends JsonObject {
  ok: boolean;
  cwd: string;
  git_root?: string;
  head_sha?: string;
  entries: JsonObject;
  dirty_files: string[];
  skipped?: boolean;
  reason?: string;
}

export interface CommitTraceOptions {
  kind: "product" | "control" | "automation";
  workflow: string;
  action?: string;
  subject: string;
  type?: string;
  scope?: string;
  body?: string;
  files?: string[];
  resolvedFiles?: string[];
  expectedFingerprint?: string;
  expectedResultFingerprint?: string;
  expectedParentSha?: string;
  expectedDirtyFiles?: string[];
  expectedDirtyKind?: "product" | "nonignored";
  includeDirtyFiles?: string[];
  cwd?: string;
  before?: TraceSnapshot | null;
  forceEnabled?: boolean;
  allowDirty?: boolean;
  note?: JsonObject;
  trackId?: string | null;
  taskKey?: string | null;
  repo?: string | null;
}

function configured(root: string): boolean {
  return fileExists(path.join(root, "cadre", "config.json"));
}

function traceability(root: string): JsonObject {
  return asJsonObject(loadTopology(root).config.traceability);
}

function traceEnabled(root: string, kind: CommitTraceOptions["kind"], args: RuntimeArgs, force = false): boolean {
  const mode = asOptionalString(args.commitMode || args.commit_mode)?.toLowerCase();
  if (["off", "none", "manual", "false"].includes(mode || "")) return false;
  if (force) return true;
  if (!configured(root)) return false;
  const trace = traceability(root);
  if (Object.keys(trace).length === 0) return false;
  if (trace.enabled === false) return false;
  if (kind === "product") return trace.auto_product_commits !== false;
  if (kind === "control") return trace.auto_control_commits !== false;
  return trace.auto_automation_commits !== false;
}

export function notesRef(root: string, args: RuntimeArgs = {}): string {
  return asOptionalString(args.notesRef || args.notes_ref)
    || asOptionalString(traceability(root).notes_ref)
    || DEFAULT_NOTES_REF;
}

function notesEnabled(root: string): boolean {
  const trace = traceability(root);
  return trace.git_notes !== false && trace.notes !== false;
}

export function notesPushEnabled(root: string): boolean {
  return traceability(root).push_notes !== false;
}

interface StatusEntriesResult {
  ok: boolean;
  entries: JsonObject;
  rename_pairs: Array<{ source: string; destination: string; status: string }>;
  error?: string;
}

function statusEntries(cwd: string): StatusEntriesResult {
  const result = runCommand("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd });
  if (!result.ok) {
    return {
      ok: false,
      entries: {},
      rename_pairs: [],
      error: result.stderr.trim() || result.stdout.trim() || "Unable to inspect Git status",
    };
  }
  const entries: JsonObject = {};
  const renamePairs: Array<{ source: string; destination: string; status: string }> = [];
  const records = result.stdout.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] || "";
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const file = record.slice(3);
    if (file) entries[file] = status;
    if (/[RC]/.test(status)) {
      const source = records[index + 1] || "";
      if (source && /R/.test(status)) {
        entries[source] = status;
        renamePairs.push({ source, destination: file, status });
      }
      index += 1;
    }
  }
  return { ok: true, entries, rename_pairs: renamePairs };
}

export function beginTrace(cwd: string): TraceSnapshot {
  const gitRoot = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (!gitRoot.ok) {
    return {
      ok: true,
      cwd,
      entries: {},
      dirty_files: [],
      skipped: true,
      reason: "not a git repository",
    };
  }
  const root = gitRoot.stdout.trim() || cwd;
  const status = statusEntries(root);
  if (!status.ok) {
    return {
      ok: false,
      cwd: root,
      git_root: root,
      entries: {},
      dirty_files: [],
      reason: status.error || "Unable to inspect Git status",
    };
  }
  const head = runCommand("git", ["rev-parse", "HEAD"], { cwd: root });
  const entries = status.entries;
  return {
    ok: true,
    cwd: root,
    git_root: root,
    ...(head.ok && head.stdout.trim() ? { head_sha: head.stdout.trim() } : {}),
    entries,
    dirty_files: Object.keys(entries).sort(),
  };
}

function changedAfter(before: TraceSnapshot | null | undefined, after: JsonObject): string[] {
  const beforeEntries = asJsonObject(before?.entries);
  return Object.entries(after)
    .filter(([file, status]) => beforeEntries[file] !== status)
    .map(([file]) => file)
    .sort();
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter(Boolean))).sort();
}

function conventionalSubject(type: string, scope: string, subject: string): string {
  const cleanType = type.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "cadre";
  const cleanScope = scope.replace(/[^a-z0-9_.-]/gi, "-").toLowerCase() || "trace";
  return `${cleanType}(${cleanScope}): ${subject.trim() || "record trace"}`;
}

function messageBody(body: string | undefined, footers: Record<string, string | null | undefined>): string {
  const footerText = Object.entries(footers)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return [body?.trim() || "", footerText].filter(Boolean).join("\n\n");
}

function commandOk(result: CommandResult): boolean {
  return result.ok === true;
}

function commitSha(cwd: string): string | null {
  const result = runCommand("git", ["rev-parse", "HEAD"], { cwd });
  return result.ok ? result.stdout.trim() || null : null;
}

function writeNote(cwd: string, ref: string, sha: string, note: JsonObject): CommandResult {
  return runCommand("git", ["notes", "--ref", ref, "add", "-f", "-m", `${JSON.stringify(note, null, 2)}\n`, sha], { cwd });
}

export function commitTrace(root: string, args: RuntimeArgs, options: CommitTraceOptions): CoreResult {
  if (!traceEnabled(root, options.kind, args, options.forceEnabled === true)) {
    return { ok: true, skipped: true, reason: "traceability disabled or unconfigured" };
  }
  const cwd = options.cwd || root;
  return withGitIndexLock(root, cwd, () => commitTraceUnlocked(root, args, options));
}

function commitTraceUnlocked(root: string, args: RuntimeArgs, options: CommitTraceOptions): CoreResult {
  const cwd = options.cwd || root;
  const snapshot = options.before || beginTrace(cwd);
  if (!snapshot.ok) {
    return { ok: false, stage: "git_status", error: snapshot.reason || "Unable to inspect Git status" };
  }
  if (snapshot.skipped) return { ok: true, skipped: true, reason: snapshot.reason || "git unavailable" };
  const gitRoot = asOptionalString(snapshot.git_root) || cwd;
  const afterStatus = statusEntries(gitRoot);
  if (!afterStatus.ok) return { ok: false, stage: "git_status", error: afterStatus.error || "Unable to inspect Git status" };
  const after = afterStatus.entries;
  if (options.files && options.resolvedFiles) {
    return { ok: false, stage: "git_claim_scope", error: "Commit trace accepts files or resolvedFiles, not both" };
  }
  const resolvedFileErrors = options.resolvedFiles?.flatMap((file) => {
    const error = concreteGitPathError(file);
    return error ? [error] : [];
  }) || [];
  if (resolvedFileErrors.length > 0) {
    return { ok: false, stage: "git_claim_scope", error: resolvedFileErrors[0], errors: resolvedFileErrors };
  }
  const exactFiles = options.resolvedFiles ? uniqueFiles(options.resolvedFiles) : null;
  const missingExactFiles = exactFiles?.filter((file) => !Object.prototype.hasOwnProperty.call(after, file)) || [];
  if (missingExactFiles.length > 0) {
    return {
      ok: false,
      stage: "git_claim_scope",
      error: `Resolved Git paths are no longer dirty: ${missingExactFiles.join(", ")}`,
      missing_files: missingExactFiles,
    };
  }
  const requestedErrors = options.files?.flatMap((claim) => {
    const error = claimPathError(claim);
    return error ? [error] : [];
  }) || [];
  const requestedClaims = options.files ? uniqueFiles(options.files.map((file) => file.trim())) : null;
  if (requestedErrors.length > 0) {
    return {
      ok: false,
      stage: "git_claim_scope",
      error: requestedErrors[0],
      errors: requestedErrors,
      requested_files: requestedClaims || [],
    };
  }
  const resolved = requestedClaims ? resolveClaimsToPaths(requestedClaims, Object.keys(after)) : null;
  if (resolved && resolved.errors.length > 0) {
    return {
      ok: false,
      stage: "git_claim_scope",
      error: resolved.errors[0],
      errors: resolved.errors,
      requested_files: requestedClaims || [],
    };
  }
  const included = options.includeDirtyFiles
    ? resolveClaimsToPaths(options.includeDirtyFiles, Object.keys(after))
    : { files: [], errors: [] };
  if (included.errors.length > 0) {
    return { ok: false, stage: "git_claim_scope", error: included.errors[0], errors: included.errors };
  }
  const files = exactFiles
    || (requestedClaims
      ? resolved?.files || []
      : uniqueFiles([
        ...changedAfter(snapshot, after).filter((file) => traceFileKind(file) === (options.kind === "product" ? "product" : "control")),
        ...included.files,
      ]));
  const expectedDirtyFiles = options.expectedDirtyFiles ? uniqueFiles(options.expectedDirtyFiles) : null;
  const expectedDirtyKind = options.expectedDirtyKind || "nonignored";
  if (expectedDirtyFiles) {
    const universeError = dirtyUniverseError(after, expectedDirtyFiles, expectedDirtyKind);
    if (universeError) return universeError;
  }
  const partialRename = afterStatus.rename_pairs.find((pair) => (
    files.includes(pair.source) !== files.includes(pair.destination)
  ));
  if (partialRename) {
    return {
      ok: false,
      stage: "git_claim_scope",
      error: `Rename endpoints must be committed together: ${partialRename.source} -> ${partialRename.destination}`,
      rename: partialRename,
      files,
    };
  }
  if (options.expectedFingerprint) {
    const fingerprint = traceFingerprint({
      ok: true,
      cwd: gitRoot,
      git_root: gitRoot,
      entries: after,
      dirty_files: Object.keys(after).sort(),
    }, expectedDirtyFiles || files);
    if (fingerprint.ok === false || fingerprint.fingerprint !== options.expectedFingerprint) {
      return {
        ok: false,
        stage: "implementation_baseline",
        error: asOptionalString(fingerprint.error) || "The dirty change set changed after Cadre created its reconciliation packet.",
        expected_fingerprint: options.expectedFingerprint,
        actual_fingerprint: asOptionalString(fingerprint.fingerprint) || null,
        fingerprint,
      };
    }
  }
  if (files.length === 0) return { ok: true, skipped: true, reason: "no changed files to commit" };
  const projections = projectionGuard(root, files);
  if (projections.ok === false) return { ok: false, stage: "projection_drift", files, projection_validation: projections, error: projections.error };

  const beforeEntries = asJsonObject(snapshot.entries);
  const preexisting = files.filter((file) => beforeEntries[file]);
  const allowDirty = options.allowDirty === true || args.allowDirty === true || args.allow_dirty === true;
  if (preexisting.length > 0 && !allowDirty) {
    return {
      ok: false,
      stage: "preexisting_dirty_files",
      reason: "Refusing to commit files that were dirty before this packet",
      files,
      preexisting_dirty_files: preexisting,
    };
  }

  const commitBaseline = commitSha(gitRoot) || "";
  const requiredParent = asOptionalString(options.expectedParentSha) || "";
  if (requiredParent && commitBaseline !== requiredParent) {
    return { ok: false, stage: "implementation_baseline", expected_head: requiredParent, actual_head: commitBaseline || null, error: "Git HEAD changed before Cadre acquired the commit boundary." };
  }
  const indexBefore = captureGitIndex(gitRoot);
  if (!indexBefore) return { ok: false, stage: "git_index_snapshot", files, error: "Unable to snapshot the Git index before staging Cadre trace files." };
  const stagedRenameFiles = new Set(afterStatus.rename_pairs
    .filter((pair) => pair.status.startsWith("R"))
    .flatMap((pair) => [pair.source, pair.destination]));
  const filesToAdd = files.filter((file) => !stagedRenameFiles.has(file));
  if (filesToAdd.length > 0) {
    const add = runCommand("git", ["--literal-pathspecs", "add", "-A", "--", ...filesToAdd], { cwd: gitRoot });
    if (!add.ok) {
      const indexRestore = restoreGitIndex(indexBefore);
      return { ok: false, stage: indexRestore.ok === false ? "git_add_index_restore" : "git_add", files, add, index_restore: indexRestore };
    }
  }
  if (expectedDirtyFiles) {
    const stagedStatus = statusEntries(gitRoot);
    if (!stagedStatus.ok) {
      const indexRestore = restoreGitIndex(indexBefore);
      return { ok: false, stage: "git_status", files, error: stagedStatus.error, index_restore: indexRestore };
    }
    const universeError = dirtyUniverseError(stagedStatus.entries, expectedDirtyFiles, expectedDirtyKind);
    if (universeError) {
      const indexRestore = restoreGitIndex(indexBefore);
      return { ...universeError, files, index_restore: indexRestore };
    }
  }
  const staged = runCommand("git", ["--literal-pathspecs", "diff", "--cached", "--quiet", "--", ...files], { cwd: gitRoot });
  if (staged.status === 0) {
    const indexRestore = restoreGitIndex(indexBefore);
    return indexRestore.ok === false
      ? { ok: false, stage: "git_index_restore", files, index_restore: indexRestore, error: "Cadre found no staged change but could not restore the caller's Git index." }
      : { ok: true, skipped: true, reason: "no staged changes", files, index_restore: indexRestore };
  }

  const traceId = `trace_${textHash(JSON.stringify({ root, files, now: utcNow(), workflow: options.workflow })).slice(0, 16)}`;
  const type = asOptionalString(args.commitType || args.commit_type) || options.type || (options.kind === "product" ? "feat" : "cadre");
  const scope = asOptionalString(args.commitScope || args.commit_scope) || options.scope || options.workflow;
  const subject = asOptionalString(args.commitSubject || args.commit_subject) || options.subject;
  const fullSubject = conventionalSubject(type, scope, subject);
  const body = asOptionalString(args.commitBody || args.commit_body) || options.body;
  const commitBody = messageBody(body, {
    "Cadre-Trace-Id": traceId,
    "Cadre-Workflow": options.workflow,
    "Cadre-Track": options.trackId || null,
    "Cadre-Task": options.taskKey || null,
    "Cadre-Repo": options.repo || null,
  });
  const commit = runCommand("git", [
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Cadre",
    "-c", "user.email=cadre@local.invalid",
    "--literal-pathspecs",
    "commit",
    "-m", fullSubject,
    "-m", commitBody,
    "--only",
    "--", ...files,
  ], { cwd: gitRoot });
  if (!commit.ok) {
    const indexRestore = restoreGitIndex(indexBefore);
    return {
      ok: false,
      stage: indexRestore.ok === false ? "git_commit_index_restore" : "git_commit",
      files,
      commit,
      index_restore: indexRestore,
      error: indexRestore.ok === false
        ? "Git commit failed and Cadre could not restore the pre-commit index state."
        : "Git commit failed; Cadre restored the pre-commit index state for an exact retry.",
    };
  }

  const sha = commitSha(gitRoot);
  const membership = sha ? gitCommitMembership(gitRoot, sha) : { ok: false, files: [], parent_sha: null };
  const actualFiles = uniqueFiles(asStringArray(membership.files));
  const expectedParent = requiredParent || commitBaseline;
  const committedFingerprint = sha && options.expectedResultFingerprint
    ? traceResultFingerprint(gitRoot, files, sha)
    : null;
  const validatedHead = commitSha(gitRoot);
  const membershipValid = membership.ok !== false
    && validatedHead === sha
    && asStringArray(membership.parent_shas).length === (expectedParent ? 1 : 0)
    && (asOptionalString(membership.parent_sha) || "") === expectedParent
    && JSON.stringify(actualFiles) === JSON.stringify(uniqueFiles(files));
  const contentValid = !options.expectedResultFingerprint
    || (committedFingerprint?.ok !== false && asOptionalString(committedFingerprint?.fingerprint) === options.expectedResultFingerprint);
  if (!sha || !membershipValid || !contentValid) {
    const rollback = sha ? rollbackGitCommit(gitRoot, sha, expectedParent, indexBefore) : { ok: false, rolled_back: false };
    return {
      ok: false,
      stage: "git_commit_integrity",
      commit_sha: sha,
      actual_head: validatedHead,
      expected_parent: expectedParent || null,
      actual_parent: asOptionalString(membership.parent_sha) || null,
      expected_files: uniqueFiles(files),
      actual_files: actualFiles,
      expected_result_fingerprint: options.expectedResultFingerprint || null,
      actual_result_fingerprint: asOptionalString(committedFingerprint?.fingerprint) || null,
      membership,
      fingerprint: committedFingerprint,
      rollback,
      rolled_back: rollback.rolled_back === true,
      error: rollback.ok === false
        ? "Cadre rejected an expanded or altered commit, but could not safely restore its exact baseline."
        : "Cadre rejected and rolled back a commit that expanded or altered the validated task change set.",
    };
  }
  const notePayload: JsonObject = {
    version: 1,
    schema: "cadre.commit_trace.v1",
    trace_id: traceId,
    kind: options.kind,
    workflow: options.workflow,
    action: options.action || null,
    track_id: options.trackId || null,
    task_key: options.taskKey || null,
    repo: options.repo || null,
    files,
    commit_sha: sha,
    recorded_at: utcNow(),
    ...asJsonObject(options.note),
  };
  if (options.kind === "product") notePayload.product_commit_sha = sha;
  if (options.kind === "control") notePayload.control_commit_sha = sha;
  const ref = notesRef(root, args);
  const note = sha && notesEnabled(root) ? writeNote(gitRoot, ref, sha, notePayload) : null;
  const noteOk = !note || commandOk(note);
  return {
    ok: true,
    trace_complete: noteOk,
    trace_id: traceId,
    kind: options.kind,
    workflow: options.workflow,
    commit_sha: sha,
    subject: fullSubject,
    files,
    notes_ref: ref,
    note,
    warnings: noteOk ? [] : ["The Git commit succeeded, but its Cadre trace note could not be written; the committed workflow result remains authoritative."],
  };
}

export function notesPushAction(root: string, repo: string, cwd: string, remote = "origin"): PlannedGitAction {
  return plannedGitAction(
    `notes-push-${repo.replace(/[^A-Za-z0-9_.-]+/g, "-") || "root"}`,
    "push_notes",
    repo,
    cwd,
    ["push", remote, `${notesRef(root)}:${notesRef(root)}`],
    `Push Cadre git notes for ${repo}`
  );
}
