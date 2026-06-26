import path from "node:path";

import type { CommandResult, JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { plannedGitAction, runCommand } from "../../infrastructure/runtime/system";
import type { CoreResult, PlannedGitAction } from "./contracts";

const DEFAULT_NOTES_REF = "refs/notes/cadre";

export interface TraceSnapshot extends JsonObject {
  ok: boolean;
  cwd: string;
  git_root?: string;
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
  includeDirtyFiles?: string[];
  cwd?: string;
  before?: TraceSnapshot | null;
  forceEnabled?: boolean;
  allowDirty?: boolean;
  note?: JsonObject;
  trackId?: string | null;
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

function statusEntries(cwd: string): JsonObject {
  const result = runCommand("git", ["status", "--porcelain", "--untracked-files=all"], { cwd });
  if (!result.ok) return {};
  const entries: JsonObject = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const file = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() || "" : rawPath;
    const normalized = file.replace(/^"|"$/g, "");
    if (normalized) entries[normalized] = status;
  }
  return entries;
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
  const entries = statusEntries(root);
  return {
    ok: true,
    cwd: root,
    git_root: root,
    entries,
    dirty_files: Object.keys(entries).sort(),
  };
}

function isControlPlaneFile(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith("cadre/local/")) return false;
  if (normalized.startsWith("cadre/.locks/")) return false;
  if (normalized.includes(".tmp")) return false;
  return normalized.startsWith("cadre/")
    || normalized === ".gitattributes"
    || normalized === ".gitmodules"
    || normalized === ".gitlab-ci.yml"
    || normalized === "cadre-merge-train.gitlab-ci.yml"
    || normalized.startsWith(".github/workflows/cadre-");
}

function changedAfter(before: TraceSnapshot | null | undefined, after: JsonObject): string[] {
  const beforeEntries = asJsonObject(before?.entries);
  return Object.entries(after)
    .filter(([file, status]) => beforeEntries[file] !== status)
    .map(([file]) => file)
    .sort();
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))).sort();
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
  const snapshot = options.before || beginTrace(cwd);
  if (snapshot.skipped) return { ok: true, skipped: true, reason: snapshot.reason || "git unavailable" };
  const gitRoot = asOptionalString(snapshot.git_root) || cwd;
  const after = statusEntries(gitRoot);
  const requestedFiles = options.files
    ? uniqueFiles(options.files)
    : uniqueFiles([
      ...changedAfter(snapshot, after).filter((file) => options.kind === "product" ? !isControlPlaneFile(file) : isControlPlaneFile(file)),
      ...(options.includeDirtyFiles || []),
    ]);
  const files = requestedFiles.filter((file) => after[file]);
  if (files.length === 0) return { ok: true, skipped: true, reason: "no changed files to commit" };

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

  const add = runCommand("git", ["add", "-A", "--", ...files], { cwd: gitRoot });
  if (!add.ok) return { ok: false, stage: "git_add", files, add };
  const staged = runCommand("git", ["diff", "--cached", "--quiet"], { cwd: gitRoot });
  if (staged.status === 0) return { ok: true, skipped: true, reason: "no staged changes", files };

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
    "Cadre-Repo": options.repo || null,
  });
  const commit = runCommand("git", [
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Cadre",
    "-c", "user.email=cadre@local.invalid",
    "commit",
    "-m", fullSubject,
    "-m", commitBody,
  ], { cwd: gitRoot });
  if (!commit.ok) return { ok: false, stage: "git_commit", files, commit };

  const sha = commitSha(gitRoot);
  const notePayload: JsonObject = {
    version: 1,
    schema: "cadre.commit_trace.v1",
    trace_id: traceId,
    kind: options.kind,
    workflow: options.workflow,
    action: options.action || null,
    track_id: options.trackId || null,
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
  return {
    ok: !note || commandOk(note),
    trace_id: traceId,
    kind: options.kind,
    workflow: options.workflow,
    commit_sha: sha,
    subject: fullSubject,
    files,
    notes_ref: ref,
    note,
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
