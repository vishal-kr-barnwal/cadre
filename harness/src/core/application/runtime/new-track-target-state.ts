import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { asJsonArray, asJsonObject, asOptionalString } from "../../../guards";
import { readJson, safeName } from "../../infrastructure/runtime/json-store";
import { runCommand } from "../../infrastructure/runtime/system";
import { approvalSessionForTarget, type ApprovalSession } from "./approval-session-store";
import { branchSetForTrack } from "./branch-set";
import { withGeneratedMarker } from "./markdown-docs";
import { readCadreEvents } from "./native-state";
import { trackLearningsSeed, trackLearningsText } from "./review-bundles";
import { findTrack } from "./track-context";

export type NewTrackTargetKind =
  | "vacant"
  | "owned_draft"
  | "foreign_draft"
  | "mixed_or_orphan"
  | "pristine_track"
  | "established_track"
  | "inspection_error";

export interface NewTrackTargetState {
  kind: NewTrackTargetKind;
  occupied: string[];
  owner: ApprovalSession | null;
  ownerTrackId: string | null;
  reason?: string;
}

const PRISTINE_FILES = new Set([
  "learnings.jsonl",
  "learnings.md",
  "metadata.json",
  "plan.json",
  "plan.md",
  "spec.json",
  "spec.md",
]);

function pendingPlan(root: string, trackId: string): boolean {
  const plan = readJson<unknown>(path.join(root, "cadre", "tracks", safeName(trackId), "plan.json"), null);
  const phases = asJsonArray(asJsonObject(plan).phases);
  const tasks = phases.flatMap((phase) => asJsonArray(asJsonObject(phase).tasks).map(asJsonObject));
  return tasks.length > 0 && tasks.every((task) => (
    task.status === "pending"
    && asJsonArray(task.commit_shas).length === 0
    && Object.keys(asJsonObject(task.repo_shas)).length === 0
    && Object.keys(asJsonObject(task.completion_evidence)).length === 0
    && task.completed_at == null
    && task.started_at == null
  ));
}

function learningsSafetyError(root: string, trackId: string): string | null {
  const base = path.join(root, "cadre", "tracks", safeName(trackId));
  const canonicalPath = path.join(base, "learnings.jsonl");
  const projectionPath = path.join(base, "learnings.md");
  const canonical = fs.existsSync(canonicalPath) ? fs.readFileSync(canonicalPath, "utf8") : "";
  const lines = canonical.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1) return "track learnings contain implementation records";
  if (lines.length === 1) {
    try {
      const seed = asJsonObject(JSON.parse(lines[0]!));
      const recordedAt = asOptionalString(seed.recorded_at);
      const timestamp = recordedAt ? new Date(recordedAt) : null;
      const exactTimestamp = timestamp && !Number.isNaN(timestamp.getTime()) && (
        timestamp.toISOString() === recordedAt
        || timestamp.toISOString().replace(/\.000Z$/, "Z") === recordedAt
      );
      if (!recordedAt || !exactTimestamp || !isDeepStrictEqual(seed, trackLearningsSeed(trackId, recordedAt))) {
        return "track learnings contain non-seed evidence";
      }
    } catch {
      return "track learnings contain an invalid non-seed record";
    }
  }
  const projection = fs.existsSync(projectionPath) ? fs.readFileSync(projectionPath, "utf8") : "";
  const normalized = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
  const relativeCanonical = `cadre/tracks/${safeName(trackId)}/learnings.jsonl`;
  const relativeProjection = `cadre/tracks/${safeName(trackId)}/learnings.md`;
  const body = trackLearningsText(trackId);
  const generated = withGeneratedMarker(relativeCanonical, "cadre.learnings.v1", body, {
    canonicalContent: canonical,
    projection: relativeProjection,
  });
  const legacy = `# Learnings: ${trackId}\n`;
  return ["\n", normalized(body), normalized(generated), legacy]
    .includes(normalized(projection))
    ? null
    : "track learnings projection contains retained work evidence";
}

export function newTrackRestartSafetyError(root: string, trackId: string): string | null {
  const base = path.join(root, "cadre", "tracks", safeName(trackId));
  const metadataFile = path.join(base, "metadata.json");
  const planFile = path.join(base, "plan.json");
  const metadata = asJsonObject(readJson<unknown>(metadataFile, null));
  if (fs.existsSync(metadataFile)) {
    if (asOptionalString(metadata.track_id) !== trackId || metadata.status !== "new") {
      return "track metadata is not an exact new-track identity";
    }
    if (metadata.lease != null || metadata.review != null || metadata.review_evidence != null || metadata.last_task_result != null) {
      return "track metadata records implementation or review activity";
    }
  }
  if (fs.existsSync(planFile) && !pendingPlan(root, trackId)) {
    return "track plan contains started, completed, or noncanonical tasks";
  }
  const learningsError = learningsSafetyError(root, trackId);
  if (learningsError) return learningsError;
  const track = findTrack(root, trackId);
  if (track) {
    const activeRepo = branchSetForTrack(root, track).find((entry) => entry.exists || entry.branch_exists);
    if (activeRepo) {
      return `track integration worktree or branch already exists for repo ${activeRepo.repo}`;
    }
  } else {
    const worktree = asOptionalString(metadata.worktree_path)
      || `.worktrees/cadre/tracks/${safeName(trackId)}/integrate/root`;
    if (fs.existsSync(path.resolve(root, worktree))) return "track integration worktree already exists";
    const branch = asOptionalString(metadata.git_branch) || `track/${trackId}`;
    if (runCommand("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root }).ok) {
      return "track branch already exists";
    }
  }
  const startedEvent = readCadreEvents(root, 0).find((event) => (
    asOptionalString(event.track_id) === trackId
    && !["track_created", "formula_poured", "approval.completed", "track_restarted"]
      .includes(asOptionalString(event.kind) || "")
  ));
  return startedEvent ? `track event ${String(startedEvent.kind)} proves work has started` : null;
}

function pristineTrackReason(root: string, trackId: string, entryNames: string[]): string | null {
  if (entryNames.length !== PRISTINE_FILES.size || entryNames.some((entry) => !PRISTINE_FILES.has(entry))) {
    return "track directory contains files outside the never-started track artifact set";
  }
  return newTrackRestartSafetyError(root, trackId);
}

/** Classify an exact target without treating permission or mixed-ownership failures as vacancy. */
export function inspectNewTrackTarget(
  root: string,
  trackId: string,
  allowedSessionId: string | null,
  options: { lifecycleLocked?: boolean } = {},
): NewTrackTargetState {
  const relativeDirectory = `cadre/tracks/${safeName(trackId)}`;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "vacant", occupied: [], owner: null, ownerTrackId: null };
    }
    return {
      kind: "inspection_error",
      occupied: [relativeDirectory],
      owner: null,
      ownerTrackId: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const occupied = entries.map((entry) => `${relativeDirectory}/${entry.name}`);
  if (entries.length === 0) {
    return { kind: "mixed_or_orphan", occupied: [relativeDirectory], owner: null, ownerTrackId: null, reason: "empty orphan track directory" };
  }
  const owners = occupied.map((relativePath) => approvalSessionForTarget(root, relativePath, options));
  const ownedEntries = owners.filter((owner): owner is ApprovalSession => Boolean(owner));
  const ownerIds = new Set(ownedEntries.map((owner) => owner.session_id));
  if (ownedEntries.length === occupied.length && ownerIds.size === 1) {
    const owner = ownedEntries[0]!;
    const ownerTrackId = asOptionalString(owner.payload.trackId || owner.payload.track_id) || null;
    const exactDraft = owner.workflow === "newtrack" && ownerTrackId === trackId;
    return {
      kind: exactDraft && owner.session_id === allowedSessionId ? "owned_draft" : "foreign_draft",
      occupied,
      owner,
      ownerTrackId,
      ...(!exactDraft ? { reason: "target is owned by a different workflow or exact track id" } : {}),
    };
  }
  if (ownedEntries.length > 0) {
    return {
      kind: "mixed_or_orphan",
      occupied,
      owner: ownerIds.size === 1 ? ownedEntries[0]! : null,
      ownerTrackId: null,
      reason: "track directory mixes approval-owned and unowned files",
    };
  }
  const pristineReason = pristineTrackReason(root, trackId, entries.map((entry) => entry.name));
  return {
    kind: pristineReason ? "established_track" : "pristine_track",
    occupied,
    owner: null,
    ownerTrackId: null,
    ...(pristineReason ? { reason: pristineReason } : {}),
  };
}
