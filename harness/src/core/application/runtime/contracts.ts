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

export interface LockOptions extends RuntimeArgs {
  owner?: string | null;
}

export type JsonPatcher<T extends JsonObject = JsonObject> = (next: T, before: T) => T;

export type LockedOperation<T = JsonObject> = (lock: CadreLock) => T;

export interface CoreResult extends UnknownRecord {
  ok?: boolean | undefined;
  value?: unknown;
  error?: string | undefined;
  stage?: string | undefined;
}

export interface ReviewFile {
  path: string;
  title: string;
  kind: "markdown" | "json" | "text";
  source: string;
  content: string;
  missing?: boolean;
}

export interface ArtifactDefinition {
  id: string;
  title: string;
  canonical: string;
  projection?: string;
  schema: string;
  scope: "project" | "track" | "styleguide" | "release" | "external";
  sourceFormat: "json" | "jsonl";
  projectionFormat?: "markdown" | "yaml" | "none";
}

export interface ArtifactRenderResult extends JsonObject {
  ok: boolean;
  artifact_id: string;
  canonical_path: string;
  projection_path?: string | undefined;
  content?: string | undefined;
  changed?: boolean | undefined;
  missing_canonical?: boolean | undefined;
  legacy_import_available?: boolean | undefined;
}

export interface PatchJsonOptions extends RuntimeArgs {
  root?: string;
  lockName?: string;
  lock?: boolean;
  retries?: number;
  lockOptions?: LockOptions;
}

export interface RunCommandOptions extends RuntimeArgs {
  cwd?: string | undefined;
  shell?: boolean;
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface TopologyWithConfig extends Topology {
  config: JsonObject;
  defaultRepo: string;
}

export interface CoverageResult extends JsonObject {
  ok: boolean;
  available: boolean;
  command?: string | null;
  coverage?: number | null;
  reason?: string;
}

export interface WorkState extends JsonObject {
  owner?: string | null;
  last_updated?: string;
  last_handoff?: string;
}

export interface HoldInfo extends JsonObject {
  owner?: string | null;
  metadata_owner?: string | null;
  state_owner?: string | null;
  lease_owner?: string | null;
  lease_heartbeat_at?: string | null;
  lease_stale: boolean;
  lease_age_minutes: number | null;
  state_last_updated?: string | null;
  state_stale: boolean;
  state_age_minutes: number | null;
}

export interface TaskCounts extends JsonObject {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
  skipped: number;
  percent: number;
}

export interface Claim extends UnknownRecord {
  track_id?: string;
  owner?: string | null;
  repo: string;
  file: string;
  phase?: string;
  task?: string;
  task_line?: number | undefined;
}

export interface ClaimConflict extends UnknownRecord {
  left: Claim;
  right: Claim;
}

export interface PhaseScheduleNode extends UnknownRecord {
  phase_id: string;
  phase_index: number;
  title: string;
  execution: string;
  depends_on: string[];
  status: string;
  task_counts: TaskCounts;
  claims: Claim[];
  tasks: JsonObject[];
}

export interface BdJsonResult extends UnknownRecord {
  ok: boolean;
  available: boolean;
  args: string[];
  json: unknown;
  stdout_tail?: string;
  stderr_tail?: string;
}

export interface TrackSummary extends UnknownRecord {
  track_id: string;
  name: string;
  status: string;
  priority: string;
  owner: string | null;
  reviewer: string | null;
  beads_epic: string | null;
  review: JsonObject | null;
}

export interface RepoRuntimeInfo extends UnknownRecord {
  submodule_path?: string;
  worktree_path?: string;
  git_branch?: string;
  base_branch?: string;
}

export interface WorkingRoot extends JsonObject {
  ok?: true;
  repo: string;
  path: string;
  source: string;
}

export interface WorkingRootError extends JsonObject {
  ok: false;
  repo: string;
  path: string;
  source: string;
  error: string;
  unresolved_repo: string;
  available_repos: string[];
  track_id?: string;
  task_key?: string | undefined;
}

export type WorkingRootResolution = WorkingRoot | WorkingRootError;

export interface SpecContext extends JsonObject {
  overview: string;
  acceptance: string;
}

export interface BeadsCommandPlanEntry extends JsonObject {
  command: string;
  args: string[];
}

export interface CompletionJournal extends JsonObject {
  entries: Record<string, JsonObject>;
  updated_at?: string;
}

export interface BeadsCompletionState extends UnknownRecord {
  attempted: boolean;
  required: boolean;
  available: boolean;
  note: CoreResult | null;
  close: CoreResult | null;
  skipped_reason: string | null;
}

export interface ParallelWorker extends UnknownRecord {
  worker_id: string;
  status: string;
  phase_index?: number | null;
  task_index?: number | null;
  task_key?: string | null;
  beads_task_id?: string | null;
  repo?: string | null;
  worktree?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  coverage?: number | null;
  evidence?: JsonObject | string | null;
  completed_at?: string;
  merged_at?: string;
  conflict_at?: string;
  updated_at: string;
}

export interface ParallelState extends UnknownRecord {
  track_id?: string;
  execution_mode?: string;
  started_at?: string;
  workers: ParallelWorker[];
  completed_workers?: number;
  merged_workers?: number;
  conflict_workers?: number;
  updated_at?: string;
}

export interface RepoExecutionEntry extends JsonObject {
  repo: string;
  path: string;
  root: string;
  source: string;
  base?: string;
  head?: string;
}

export type WorkflowPhaseState = "dry_run" | "ready" | "pending_provider" | "executed" | "blocked" | "recovery_required";

export interface PlannedGitAction extends JsonObject {
  id: string;
  kind: string;
  repo: string;
  cwd: string;
  command: string;
  args: string[];
  description: string;
}

export interface PlannedProviderAction extends JsonObject {
  id: string;
  provider: string;
  kind: string;
  repo: string;
  track_id: string;
  title: string;
  source_branch?: string | null;
  target_branch?: string | null;
  body?: string;
  labels?: string[];
  evidence_key: string;
  required_evidence: JsonObject | null;
}

export interface DiffSurface extends JsonObject {
  ok: boolean;
  base: string;
  head: string;
  stat: string;
  files: string[];
  errors: string;
}

export interface TodoFinding extends JsonObject {
  file: string;
  line: number;
  snippet: string;
}

export interface ReviewAssistFinding extends JsonObject {
  severity: string;
  message: string;
}

export interface RepoSymbol extends JsonObject {
  name: string;
  file: string;
  line: number;
  language: string;
}

export interface ReleaseArtifactPlan {
  version: string;
  generatedAt: string;
  completed: JsonObject[];
  releaseDir: string;
  releaseMd: string;
  releaseJson: string;
  notes: string;
  metadata: JsonObject;
  gitActions: PlannedGitAction[];
}
