#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "./types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "./guards";

const STATUS_MARKERS = {
  new: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  blocked: "[!]",
  skipped: "[-]",
} as const;
const VALID_STATUSES = new Set(Object.keys(STATUS_MARKERS));
const STALE_LEASE_MS = 30 * 60 * 1000;
const LOCK_STALE_MS = STALE_LEASE_MS;

interface LockOptions extends RuntimeArgs {
  owner?: string | null;
}

type JsonPatcher<T extends JsonObject = JsonObject> = (next: T, before: T) => T;
type LockedOperation<T = JsonObject> = (lock: CadreLock) => T;
interface CoreResult extends UnknownRecord {
  ok?: boolean | undefined;
  value?: unknown;
  error?: string | undefined;
  stage?: string | undefined;
}

interface PatchJsonOptions extends RuntimeArgs {
  root?: string;
  lockName?: string;
  lock?: boolean;
  retries?: number;
  lockOptions?: LockOptions;
}

interface RunCommandOptions extends RuntimeArgs {
  cwd?: string | undefined;
  shell?: boolean;
  timeoutMs?: number;
  maxBuffer?: number;
}

interface TopologyWithConfig extends Topology {
  config: JsonObject;
  defaultRepo: string;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: JsonObject): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function safeName(value: unknown): string {
  return String(value || "lock")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "lock";
}

function lockRoot(root: string): string {
  return path.join(root, "cadre", ".locks");
}

function processAlive(pid: unknown): boolean {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function readLockInfo(lockDir: string): LockInfo {
  return readJson<LockInfo | null>(path.join(lockDir, "owner.json"), null) ?? {};
}

function lockIsStale(info: LockInfo, nowMs = Date.now()): boolean {
  const stamp = Date.parse(info.updated_at || info.acquired_at || "");
  if (Number.isFinite(stamp) && nowMs - stamp > LOCK_STALE_MS) return true;
  if (info.pid && !processAlive(info.pid)) return true;
  return false;
}

function acquireLock(root: string, name: string, options: LockOptions = {}): CadreLock {
  const now = utcNow();
  const dir = path.join(lockRoot(root), `${safeName(name)}.lock`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (let attempt = 1; attempt <= Number(options.retries || 3); attempt += 1) {
    try {
      fs.mkdirSync(dir);
      const info: LockInfo = {
        name,
        pid: process.pid,
        owner: options.owner || gitIdentity(root) || null,
        acquired_at: now,
        updated_at: now,
        hostname: os.hostname(),
      };
      writeJson(path.join(dir, "owner.json"), info);
      return { ok: true, dir, info, attempts: attempt };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        return { ok: false, dir, error: errorMessage(error), attempts: attempt };
      }
      const current = readLockInfo(dir);
      if (lockIsStale(current)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          continue;
        } catch (removeError) {
          return {
            ok: false,
            dir,
            conflict: true,
            stale: true,
            holder: current,
            error: errorMessage(removeError),
            attempts: attempt,
          };
        }
      }
      return {
        ok: false,
        dir,
        conflict: true,
        stale: false,
        holder: current,
        error: `Lock already held: ${name}`,
        attempts: attempt,
      };
    }
  }
  return { ok: false, dir, conflict: true, error: `Unable to acquire lock: ${name}` };
}

function releaseLock(lock: CadreLock | null | undefined): CoreResult {
  if (!lock || !lock.ok || !lock.dir) return { ok: true, skipped: true };
  try {
    fs.rmSync(lock.dir, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function withLock<T = CoreResult>(root: string, name: string, fn: LockedOperation<T>, options: LockOptions = {}): CoreResult {
  const lock = acquireLock(root, name, options);
  if (!lock.ok) return { ok: false, stage: "lock", lock };
  try {
    const value = fn(lock);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.prototype.hasOwnProperty.call(value, "ok")
        ? { ...value, lock }
        : { ok: true, value, lock };
    }
    return { ok: true, value, lock };
  } catch (error) {
    return { ok: false, stage: "locked_operation", error: errorMessage(error), lock };
  } finally {
    releaseLock(lock);
  }
}

function trackLockName(trackId: string): string {
  return `track:${trackId}`;
}

function withTrackLock<T = CoreResult>(root: string, trackId: string, fn: LockedOperation<T>, options: LockOptions = {}): CoreResult {
  return withLock(root, trackLockName(trackId), fn, options);
}

function textHash(text: unknown): string {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function patchJsonFileUnlocked<T extends JsonObject = JsonObject>(file: string, patcher: JsonPatcher<T>, options: PatchJsonOptions = {}): CoreResult {
  const retries = Number(options.retries || 5);
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let beforeText: string;
    try {
      beforeText = fs.readFileSync(file, "utf8");
    } catch (error) {
      return { ok: false, file, error: `Unable to read JSON file: ${errorMessage(error)}` };
    }
    let before: T;
    try {
      before = asJsonObject(JSON.parse(beforeText || "{}")) as T;
    } catch (error) {
      return { ok: false, file, error: `Invalid JSON: ${errorMessage(error)}` };
    }
    const beforeHash = textHash(beforeText);
    let next: T;
    try {
      next = patcher({ ...before }, before);
    } catch (error) {
      return { ok: false, file, error: `JSON patcher failed: ${errorMessage(error)}` };
    }
    if (!next || typeof next !== "object") {
      return { ok: false, file, error: "JSON patcher must return an object" };
    }
    let latestText: string;
    try {
      latestText = fs.readFileSync(file, "utf8");
    } catch (error) {
      return { ok: false, file, error: `Unable to re-read JSON file: ${errorMessage(error)}` };
    }
    if (textHash(latestText) !== beforeHash) continue;
    writeJson(file, next);
    return {
      ok: true,
      file,
      attempts: attempt,
      before_hash: beforeHash,
      after_hash: textHash(`${JSON.stringify(next, null, 2)}\n`),
      value: next,
    };
  }
  return {
    ok: false,
    file,
    error: `JSON file changed during patch after ${retries} retries`,
    conflict: true,
  };
}

function patchJsonFile<T extends JsonObject = JsonObject>(file: string, patcher: JsonPatcher<T>, options: PatchJsonOptions = {}): CoreResult {
  if (options.root && options.lockName && options.lock !== false) {
    return withLock(options.root, options.lockName, () => patchJsonFileUnlocked(file, patcher, { ...options, lock: false }), options.lockOptions || {});
  }
  return patchJsonFileUnlocked(file, patcher, options);
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function fileExists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function isCadreProjectRoot(root: string): boolean {
  const cadreDir = path.join(root, "cadre");
  if (!fileExists(cadreDir)) return false;
  return [
    "tracks.md",
    "setup_state.json",
    "product.md",
    "tech-stack.md",
    "workflow.md",
    "beads.json",
    "config.json",
    "repos.json",
  ].some((name) => fileExists(path.join(cadreDir, name))) || fileExists(path.join(cadreDir, "tracks"));
}

function gitIdentity(root: string): string | null {
  for (const key of ["user.email", "user.name"]) {
    const result = spawnSync("git", ["config", key], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return null;
}

function runCommand(command: string, args: string[], options: RunCommandOptions = {}): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: options.shell === true,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
  });
  const commandResult: CommandResult = {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command: options.shell === true ? command : [command, ...args].join(" "),
    args,
  };
  if (options.cwd !== undefined) commandResult.cwd = options.cwd;
  return commandResult;
}

function parsePorcelainFiles(text: unknown): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const raw = line.slice(3).trim();
      if (!raw) return [];
      if (raw.includes(" -> ")) return [raw.split(" -> ").pop() ?? ""];
      return [raw.replace(/^"|"$/g, "")];
    })
    .filter(Boolean);
}

function isControlPlaneFile(file: unknown): boolean {
  const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return true;
  if (normalized.startsWith("cadre/")) return true;
  if (normalized.startsWith(".beads/")) return true;
  if (normalized === ".gitattributes" || normalized === ".gitmodules") return true;
  if (normalized === "cadre-merge-train.gitlab-ci.yml") return true;
  if (normalized === ".gitlab-ci.yml") return true;
  if (normalized.startsWith(".github/workflows/cadre-")) return true;
  return false;
}

function controlPlaneSyncSafety(root: string, mode: string, remote: string, branch: string): JsonObject {
  const status = runCommand("git", ["status", "--porcelain"], { cwd: root });
  const dirtyFiles = parsePorcelainFiles(status.stdout);
  const unsafeDirtyFiles = dirtyFiles.filter((file) => !isControlPlaneFile(file));
  const safety = {
    ok: true,
    mode,
    remote,
    branch,
    dirty_files: dirtyFiles,
    unsafe_dirty_files: unsafeDirtyFiles,
    ahead_files: [] as string[],
    unsafe_ahead_files: [] as string[],
    warnings: [] as string[],
  };
  if (!status.ok) {
    return { ...safety, ok: false, reason: "Unable to inspect git status", status };
  }
  if (unsafeDirtyFiles.length > 0) {
    return {
      ...safety,
      ok: false,
      reason: "Working tree has non-control-plane changes; refusing control-plane sync",
    };
  }
  if (mode !== "post") return safety;

  const remoteRef = `${remote}/${branch}`;
  const fetch = runCommand("git", ["fetch", "--quiet", remote, branch], { cwd: root });
  const rev = runCommand("git", ["rev-parse", "--verify", remoteRef], { cwd: root });
  let diff;
  if (fetch.ok && rev.ok) {
    diff = runCommand("git", ["diff", "--name-only", `${remoteRef}..HEAD`], { cwd: root });
  } else {
    return {
      ...safety,
      ok: false,
      reason: `Unable to verify ${remoteRef}; refusing control-plane post-sync rather than classifying only the last commit`,
      fetch,
      rev,
    };
  }
  const aheadFiles = diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const unsafeAheadFiles = aheadFiles.filter((file) => !isControlPlaneFile(file));
  safety.ahead_files = aheadFiles;
  safety.unsafe_ahead_files = unsafeAheadFiles;
  if (!diff.ok) {
    return { ...safety, ok: false, reason: "Unable to classify unpushed commits", diff };
  }
  if (unsafeAheadFiles.length > 0) {
    return {
      ...safety,
      ok: false,
      reason: "Unpushed commits include non-control-plane files; refusing control-plane push",
    };
  }
  return safety;
}

function commandExists(command: string, cwd: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v '${String(command).replace(/'/g, "'\\''")}'`], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0;
}

function loadTopology(root: string): TopologyWithConfig {
  const reposPath = path.join(root, "cadre", "repos.json");
  const configPath = path.join(root, "cadre", "config.json");
  const repos = readJson<JsonObject | null>(reposPath, null);
  const config = readJson<JsonObject>(configPath, {});
  const polyrepo = Boolean(repos && repos.mode === "polyrepo");
  return {
    polyrepo,
    repos: asJsonObject(repos || {}),
    config,
    defaultRepo: polyrepo ? asString(repos?.default_repo, ".") : ".",
  };
}

function loadPackageJson(root: string): JsonObject | null {
  return readJson<JsonObject | null>(path.join(root, "package.json"), null);
}

function configuredCoverageCommand(root: string, args: RuntimeArgs = {}, workingRoot = root): string | null {
  if (args.command) return String(args.command);
  const topology = loadTopology(root);
  const config = topology.config || {};
  for (const key of ["coverage_command", "test_coverage_command", "test_command"]) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const pkg = loadPackageJson(workingRoot);
  const scripts = isRecord(pkg?.scripts) ? pkg.scripts : null;
  if (scripts) {
    for (const name of ["coverage", "test:coverage", "test:cov", "test"]) {
      if (scripts[name]) {
        if (fileExists(path.join(workingRoot, "pnpm-lock.yaml"))) return `pnpm ${name}`;
        if (fileExists(path.join(workingRoot, "yarn.lock"))) return `yarn ${name}`;
        return `npm run ${name}`;
      }
    }
  }
  if (fileExists(path.join(workingRoot, "pyproject.toml")) || fileExists(path.join(workingRoot, "pytest.ini"))) {
    return "pytest --cov --cov-report=term";
  }
  if (fileExists(path.join(workingRoot, "go.mod"))) return "go test ./...";
  return null;
}

function parseCoveragePercent(text: unknown): number | null {
  const source = String(text || "");
  const patterns = [
    /All files[^|\n]*(?:\|[^|\n]*){3,}\|\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\||$)/i,
    /\bStatements\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /\bLines\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /\bTOTAL\b[^\n%]*\s([0-9]+(?:\.[0-9]+)?)%/i,
    /\bcoverage[^0-9%]{0,40}([0-9]+(?:\.[0-9]+)?)%/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

interface CoverageResult extends JsonObject {
  ok: boolean;
  available: boolean;
  command?: string | null;
  coverage?: number | null;
  reason?: string;
}

interface WorkState extends JsonObject {
  owner?: string | null;
  last_updated?: string;
  last_handoff?: string;
}

interface HoldInfo extends JsonObject {
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

interface TaskCounts extends JsonObject {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
  skipped: number;
  percent: number;
}

interface Claim extends UnknownRecord {
  track_id?: string;
  owner?: string | null;
  repo: string;
  file: string;
  phase?: string;
  task?: string;
  task_line?: number | undefined;
}

interface ClaimConflict extends UnknownRecord {
  left: Claim;
  right: Claim;
}

interface PhaseScheduleNode extends UnknownRecord {
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

interface BdJsonResult extends UnknownRecord {
  ok: boolean;
  available: boolean;
  args: string[];
  json: unknown;
  stdout_tail?: string;
  stderr_tail?: string;
}

interface TrackSummary extends UnknownRecord {
  track_id: string;
  name: string;
  status: string;
  priority: string;
  owner: string | null;
  reviewer: string | null;
  beads_epic: string | null;
  review: JsonObject | null;
}

interface RepoRuntimeInfo extends UnknownRecord {
  submodule_path?: string;
  worktree_path?: string;
  git_branch?: string;
  base_branch?: string;
}

interface WorkingRoot extends JsonObject {
  repo: string;
  path: string;
  source: string;
}

interface SpecContext extends JsonObject {
  overview: string;
  acceptance: string;
}

interface BeadsCommandPlanEntry extends JsonObject {
  command: string;
  args: string[];
}

interface CompletionJournal extends JsonObject {
  entries: Record<string, JsonObject>;
  updated_at?: string;
}

interface BeadsCompletionState extends UnknownRecord {
  attempted: boolean;
  required: boolean;
  available: boolean;
  note: CoreResult | null;
  close: CoreResult | null;
  skipped_reason: string | null;
}

interface ParallelWorker extends UnknownRecord {
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

interface ParallelState extends UnknownRecord {
  track_id?: string;
  execution_mode?: string;
  started_at?: string;
  workers: ParallelWorker[];
  completed_workers?: number;
  merged_workers?: number;
  conflict_workers?: number;
  updated_at?: string;
}

interface RepoExecutionEntry extends JsonObject {
  repo: string;
  path: string;
  root: string;
  source: string;
  base?: string;
  head?: string;
}

interface DiffSurface extends JsonObject {
  ok: boolean;
  base: string;
  head: string;
  stat: string;
  files: string[];
  errors: string;
}

interface TodoFinding extends JsonObject {
  file: string;
  line: number;
  snippet: string;
}

interface ReviewAssistFinding extends JsonObject {
  severity: string;
  message: string;
}

interface RepoSymbol extends JsonObject {
  name: string;
  file: string;
  line: number;
  language: string;
}

function parseLcovCoverage(root: string): number | null {
  const candidates = [
    path.join(root, "coverage", "lcov.info"),
    path.join(root, "lcov.info"),
  ];
  for (const file of candidates) {
    if (!fileExists(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    let found = 0;
    let hit = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("LF:")) found += Number(line.slice(3)) || 0;
      if (line.startsWith("LH:")) hit += Number(line.slice(3)) || 0;
    }
    if (found > 0) return Math.round((hit / found) * 10000) / 100;
  }
  return null;
}

function coverageThreshold(root: string): number {
  const topology = loadTopology(root);
  const config = topology.config || {};
  for (const key of ["coverage_threshold", "minimum_coverage", "min_coverage"]) {
    const value = Number(config[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const workflowPath = path.join(root, "cadre", "workflow.md");
  if (fileExists(workflowPath)) {
    const text = fs.readFileSync(workflowPath, "utf8");
    const match = text.match(/(?:coverage|test coverage)[^\n%]{0,80}?([0-9]+(?:\.[0-9]+)?)\s*%/i);
    if (match?.[1]) return Number(match[1]);
  }
  return 80;
}

function runCoverage(root: string, args: RuntimeArgs = {}, workingRoot = root): CoverageResult {
  const command = configuredCoverageCommand(root, args, workingRoot);
  if (!command) {
    return {
      ok: false,
      available: false,
      command: null,
      coverage: null,
      reason: "No coverage/test command configured or detected",
      hints: [
        "Set cadre/config.json coverage_command",
        "Add package.json scripts.coverage or scripts.test:coverage",
        "Pass { command } explicitly to cadre_complete_task",
      ],
    };
  }
  const timeoutMs = Number(args.timeoutMs || 10 * 60 * 1000);
  const result = runCommand(command, [], {
    cwd: workingRoot,
    shell: true,
    timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const parsed = parseCoveragePercent(combined);
  const lcov = parsed == null ? parseLcovCoverage(workingRoot) : null;
  const coverage = parsed == null ? lcov : parsed;
  return {
    ok: result.ok,
    available: true,
    command,
    cwd: workingRoot,
    status: result.status,
    signal: result.signal,
    coverage,
    coverage_source: parsed == null && lcov != null ? "lcov" : (parsed != null ? "output" : null),
    timed_out: result.signal === "SIGTERM" || result.signal === "SIGKILL",
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
    result,
  };
}

function parseIsoTime(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function staleInfo(value: unknown, now = Date.now()): { stale: boolean; age_minutes: number | null } {
  const time = parseIsoTime(value);
  if (!time) return { stale: false, age_minutes: null };
  const ageMs = Math.max(0, now - time);
  return {
    stale: ageMs > STALE_LEASE_MS,
    age_minutes: Math.floor(ageMs / 60000),
  };
}

function workStateForTrack(track: CadreTrack): WorkState | null {
  const statePath = path.join(track.dir, "implement_state.json");
  return readJson<WorkState | null>(statePath, null);
}

function holdInfo(track: CadreTrack, now = Date.now()): HoldInfo {
  const state = workStateForTrack(track);
  const lease = track.metadata.lease || null;
  const stateOwner = state?.owner || null;
  const owner = stateOwner || track.metadata.owner || null;
  const leaseOwner = lease?.owner || null;
  const leaseTime = lease && (asOptionalString(lease.heartbeat_at) || lease.acquired_at);
  const stateTime = state && (state.last_updated || state.last_handoff);
  const leaseStale = staleInfo(leaseTime, now);
  const stateStale = staleInfo(stateTime, now);
  return {
    owner,
    metadata_owner: track.metadata.owner || null,
    state_owner: stateOwner,
    lease_owner: leaseOwner,
    lease_heartbeat_at: leaseTime || null,
    lease_stale: lease ? leaseStale.stale : false,
    lease_age_minutes: leaseStale.age_minutes,
    state_last_updated: stateTime || null,
    state_stale: state ? stateStale.stale : false,
    state_age_minutes: stateStale.age_minutes,
  };
}

function taskCounts(plan: Pick<ParsedPlan, "phases">): TaskCounts {
  const counts: TaskCounts = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, skipped: 0, percent: 0 };
  for (const phase of plan.phases || []) {
    for (const task of phase.tasks || []) {
      counts.total += 1;
      if (task.marker === "x") counts.completed += 1;
      else if (task.marker === "~") counts.in_progress += 1;
      else if (task.marker === "!") counts.blocked += 1;
      else if (task.marker === "-") counts.skipped += 1;
      else counts.pending += 1;
    }
  }
  counts.percent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100);
  return counts;
}

function listTrackDirs(root: string): string[] {
  const tracksDir = path.join(root, "cadre", "tracks");
  if (!fileExists(tracksDir)) return [];
  return fs
    .readdirSync(tracksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tracksDir, entry.name))
    .sort();
}

function listTracks(root: string): CadreTrack[] {
  const tracks: CadreTrack[] = [];
  for (const dir of listTrackDirs(root)) {
      const metadataPath = path.join(dir, "metadata.json");
      const metadata = readJson<TrackMetadata | null>(metadataPath, null);
      if (!metadata) continue;
      const trackId = metadata.track_id || path.basename(dir);
      tracks.push({
        track_id: trackId,
        dir,
        metadata_path: metadataPath,
        plan_path: path.join(dir, "plan.md"),
        spec_path: path.join(dir, "spec.md"),
        metadata,
      });
  }
  return tracks;
}

function parseAnnotation(line: string): { key: string; value: string } | null {
  const match = line.match(/<!--\s*([a-zA-Z0-9_-]+)\s*:\s*([\s\S]*?)\s*-->/);
  if (!match?.[1] || match[2] === undefined) return null;
  return { key: match[1], value: match[2].trim() };
}

function extractCommitRefs(text: unknown): { commit_shas: string[]; repo_shas: JsonObject } {
  const value = String(text || "");
  const commitShas: string[] = [];
  const repoShas: JsonObject = {};
  const repoPattern = /\b([A-Za-z0-9_.-]+):([0-9a-f]{7,40})\b/g;
  let match: RegExpExecArray | null;
  while ((match = repoPattern.exec(value))) {
    if (!match[1] || !match[2]) continue;
    repoShas[match[1]] = match[2];
    commitShas.push(match[2]);
  }
  const shaPattern = /\b(?:commit[:\s]+|sha[:\s]+)?([0-9a-f]{7,40})\b/gi;
  while ((match = shaPattern.exec(value))) {
    if (match[1] && !commitShas.includes(match[1])) commitShas.push(match[1]);
  }
  return { commit_shas: commitShas, repo_shas: repoShas };
}

function parsePlanText(text: string): ParsedPlan {
  const phases: PlanPhase[] = [];
  let currentPhase: PlanPhase | null = null;
  let currentTask: PlanTask | null = null;

  const ensurePhase = () => {
    if (!currentPhase) {
      currentPhase = { title: "Unsectioned", annotations: {}, tasks: [], phase_index: phases.length + 1 };
      phases.push(currentPhase);
    }
    return currentPhase;
  };

  text.split(/\r?\n/).forEach((line, index) => {
    const phaseMatch = line.match(/^##+\s+(.+?)\s*$/);
    if (phaseMatch?.[1]) {
      currentPhase = {
        title: phaseMatch[1].trim(),
        annotations: {},
        tasks: [],
        line: index + 1,
        phase_index: phases.length + 1,
      };
      phases.push(currentPhase);
      currentTask = null;
      return;
    }

    const taskMatch = line.match(/^\s*-\s+\[([ x~!\-])\]\s+(.+?)\s*$/);
    if (taskMatch?.[1] && taskMatch[2]) {
      const phase = ensurePhase();
      const taskIndex = phase.tasks.length + 1;
      const title = taskMatch[2].trim();
      const refs = extractCommitRefs(title);
      currentTask = {
        marker: taskMatch[1],
        title,
        annotations: {},
        files: [],
        depends: [],
        repo: null,
        line: index + 1,
        phase_index: phase.phase_index || phases.indexOf(phase) + 1,
        task_index: taskIndex,
        task_key: `phase${phase.phase_index || phases.indexOf(phase) + 1}_task${taskIndex}`,
        commit_shas: refs.commit_shas,
        repo_shas: refs.repo_shas,
      };
      phase.tasks.push(currentTask);
      return;
    }

    const annotation = parseAnnotation(line);
    if (!annotation) return;
    const target = currentTask || ensurePhase();
    target.annotations = target.annotations || {};
    target.annotations[annotation.key] = annotation.value;
    if (currentTask) {
      if (annotation.key === "files") {
        currentTask.files = annotation.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (annotation.key === "depends") {
        currentTask.depends = annotation.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (annotation.key === "repo") {
        currentTask.repo = annotation.value;
      } else if (["commit", "commits", "sha", "shas"].includes(annotation.key)) {
        const refs = extractCommitRefs(annotation.value);
        currentTask.commit_shas = Array.from(new Set([...(currentTask.commit_shas ?? []), ...refs.commit_shas]));
        currentTask.repo_shas = { ...currentTask.repo_shas, ...refs.repo_shas };
      }
    }
  });

  const tasks = phases.flatMap((phase) => phase.tasks);
  return { ok: true, phases, tasks, warnings: [], errors: [] };
}

function parsePlanFile(file: string): ParsedPlan {
  if (!fileExists(file)) return { ok: true, phases: [], tasks: [], warnings: [], errors: [] };
  return parsePlanText(fs.readFileSync(file, "utf8"));
}

function planClaims(root: string, track: CadreTrack, topology = loadTopology(root)): Claim[] {
  const plan = parsePlanFile(track.plan_path);
  const claims: Claim[] = [];
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      const repo = topology.polyrepo
        ? task.repo || topology.defaultRepo
        : ".";
      for (const file of task.files) {
        claims.push({
          track_id: track.track_id,
          owner: track.metadata.owner || null,
          repo,
          file,
          phase: phase.title,
          task: task.title,
          task_line: task.line,
        });
      }
    }
  }
  return claims;
}

function phaseAliases(phase: PlanPhase): string[] {
  const title = String(phase.title || "").trim().toLowerCase();
  const simpleTitle = title.replace(/^phase\s+\d+\s*:\s*/, "").trim();
  return Array.from(new Set([
    `phase${phase.phase_index}`,
    `phase ${phase.phase_index}`,
    String(phase.phase_index),
    title,
    simpleTitle,
  ].filter(Boolean)));
}

function resolvePhaseDependency(value: unknown, aliasMap: Map<string, PlanPhase>): PlanPhase | null {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return null;
  if (aliasMap.has(key)) return aliasMap.get(key) ?? null;
  const compact = key.replace(/\s+/g, "");
  if (aliasMap.has(compact)) return aliasMap.get(compact) ?? null;
  const phaseNumber = key.match(/^phase\s*(\d+)$/i) || key.match(/^(\d+)$/);
  if (phaseNumber?.[1] && aliasMap.has(`phase${phaseNumber[1]}`)) return aliasMap.get(`phase${phaseNumber[1]}`) ?? null;
  return null;
}

function phaseDependencyIds(phase: PlanPhase, previousPhase: PlanPhase | undefined, aliasMap: Map<string, PlanPhase>): string[] {
  if (!Object.prototype.hasOwnProperty.call(phase.annotations || {}, "depends")) {
    return previousPhase ? [`phase${previousPhase.phase_index ?? ""}`] : [];
  }
  const raw = String((phase.annotations || {}).depends || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => resolvePhaseDependency(item, aliasMap))
    .filter((item): item is PlanPhase => item !== null)
    .map((item) => `phase${item.phase_index ?? ""}`);
}

function phaseStatus(phase: PlanPhase): string {
  const tasks = phase.tasks || [];
  if (tasks.length === 0) return "completed";
  if (tasks.every((task) => task.marker === "x" || task.marker === "-")) return "completed";
  if (tasks.some((task) => task.marker === "!")) return "blocked";
  if (tasks.some((task) => task.marker === "~" || task.marker === "x" || task.marker === "-")) return "in_progress";
  return "pending";
}

function claimsForPhase(root: string, phase: PlanPhase, topology = loadTopology(root)): Claim[] {
  const claims: Claim[] = [];
  for (const task of phase.tasks || []) {
    const repo = topology.polyrepo ? task.repo || topology.defaultRepo : ".";
    for (const file of task.files || []) {
      claims.push({
        phase_id: `phase${phase.phase_index}`,
        phase_index: phase.phase_index ?? 0,
        phase_title: phase.title,
        task_key: task.task_key ?? "",
        task_title: task.title,
        repo,
        file: normalizeClaimPath(file),
      });
    }
  }
  return claims;
}

function phaseConflict(left: PhaseScheduleNode, right: PhaseScheduleNode): ClaimConflict[] {
  const conflicts: ClaimConflict[] = [];
  for (const leftClaim of left.claims || []) {
    for (const rightClaim of right.claims || []) {
      if (leftClaim.repo !== rightClaim.repo) continue;
      if (!claimsOverlap(leftClaim.file, rightClaim.file)) continue;
      conflicts.push({ left: leftClaim, right: rightClaim });
    }
  }
  return conflicts;
}

function groupReadyPhases(readyPhases: PhaseScheduleNode[]): { groups: PhaseScheduleNode[][]; conflicts: ClaimConflict[] } {
  const groups: PhaseScheduleNode[][] = [];
  const conflicts: ClaimConflict[] = [];
  for (const phase of readyPhases) {
    let placed = false;
    for (const group of groups) {
      const groupConflicts = group.flatMap((existing) => phaseConflict(existing, phase));
      if (groupConflicts.length === 0) {
        group.push(phase);
        placed = true;
        break;
      }
      conflicts.push(...groupConflicts);
    }
    if (!placed) groups.push([phase]);
  }
  return { groups, conflicts };
}

function detectPhaseCycles(phaseNodes: PhaseScheduleNode[]): string[][] {
  const byId = new Map(phaseNodes.map((phase) => [phase.phase_id, phase]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push(stack.slice(start).concat(id));
      return;
    }
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id);
    for (const dep of (node && node.depends_on) || []) visit(dep);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const phase of phaseNodes) visit(phase.phase_id);
  return cycles;
}

function topologicalPhaseWaves(phaseNodes: PhaseScheduleNode[]): string[][] {
  const remaining = new Map(phaseNodes.map((phase) => [phase.phase_id, { ...phase }]));
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const wave = Array.from(remaining.values())
      .filter((phase) => phase.depends_on.every((dep) => completed.has(dep)))
      .sort((a, b) => a.phase_index - b.phase_index);
    if (wave.length === 0) break;
    waves.push(wave.map((phase) => phase.phase_id));
    for (const phase of wave) {
      completed.add(phase.phase_id);
      remaining.delete(phase.phase_id);
    }
  }
  return waves;
}

function phaseSchedule(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const plan = parsePlanFile(track.plan_path);
  const topology = loadTopology(root);
  const aliasMap = new Map<string, PlanPhase>();
  for (const phase of plan.phases || []) {
    for (const alias of phaseAliases(phase)) aliasMap.set(alias, phase);
  }

  const errors: CoreResult[] = [];
  const phases: PhaseScheduleNode[] = (plan.phases || []).map((phase, index, all) => {
    const rawDepends = Object.prototype.hasOwnProperty.call(phase.annotations || {}, "depends")
      ? String((phase.annotations || {}).depends || "").trim()
      : null;
    const unknownDepends = rawDepends == null || rawDepends === ""
      ? []
      : rawDepends
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !resolvePhaseDependency(item, aliasMap));
    for (const dep of unknownDepends) {
      errors.push({ phase_id: `phase${phase.phase_index}`, message: `Unknown phase dependency: ${dep}` });
    }
    const dependsOn = phaseDependencyIds(phase, all[index - 1], aliasMap);
    const claims = claimsForPhase(root, phase, topology);
    return {
      phase_id: `phase${phase.phase_index}`,
      phase_index: phase.phase_index ?? index + 1,
      title: phase.title,
      execution: asString(phase.annotations?.execution, "sequential"),
      depends_on: dependsOn,
      status: phaseStatus(phase),
      task_counts: taskCounts({ phases: [phase] }),
      claims,
      tasks: (phase.tasks || []).map((task) => ({
        task_key: task.task_key ?? "",
        task_index: task.task_index ?? 0,
        title: task.title,
        marker: task.marker,
        repo: task.repo || (topology.polyrepo ? topology.defaultRepo : "."),
        files: task.files || [],
        depends: task.depends || [],
      })),
    };
  });
  const cycles = detectPhaseCycles(phases);
  for (const cycle of cycles) {
    errors.push({ phase_id: cycle[0] || null, message: `Phase dependency cycle: ${cycle.join(" -> ")}` });
  }
  const completed = new Set(phases.filter((phase) => phase.status === "completed").map((phase) => phase.phase_id));
  const ready = errors.length === 0
    ? phases
      .filter((phase) => !["completed", "blocked"].includes(phase.status))
      .filter((phase) => phase.depends_on.every((dep) => completed.has(dep)))
    : [];
  const { groups, conflicts } = groupReadyPhases(ready);
  return {
    ok: errors.length === 0,
    track_id: track.track_id,
    phases,
    topological_waves: topologicalPhaseWaves(phases),
    ready_phases: ready.map((phase) => phase.phase_id),
    ready_groups: groups.map((group) => group.map((phase) => phase.phase_id)),
    conflict_splits: conflicts.map((conflict) => ({
      repo: conflict.left.repo,
      file: conflict.left.file === conflict.right.file ? conflict.left.file : `${conflict.left.file} <-> ${conflict.right.file}`,
      left_phase: conflict.left.phase_id,
      right_phase: conflict.right.phase_id,
      left_task: conflict.left.task_key,
      right_task: conflict.right.task_key,
    })),
    errors,
  };
}

function normalizeClaimPath(file: unknown): string {
  return String(file || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizeClaimPath(glob);
  let out = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else if (char && "\\^$+?.()|{}[]".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`);
}

function isGlobClaim(file: string): boolean {
  return /[*?]/.test(file);
}

function claimsOverlap(leftFile: string, rightFile: string): boolean {
  const left = normalizeClaimPath(leftFile);
  const right = normalizeClaimPath(rightFile);
  if (!left || !right) return false;
  if (left === right) return true;
  if (right.startsWith(`${left}/`) || left.startsWith(`${right}/`)) return true;
  if (isGlobClaim(left) && globToRegExp(left).test(right)) return true;
  if (isGlobClaim(right) && globToRegExp(right).test(left)) return true;
  return false;
}

function collisionScan(root: string): CoreResult {
  const topology = loadTopology(root);
  const active = listTracks(root).filter((track) =>
    ["new", "in_progress", "blocked"].includes(track.metadata.status || "new")
  );
  const claims: Claim[] = [];
  for (const track of active) {
    for (const claim of planClaims(root, track, topology)) {
      claims.push({
        ...claim,
        file: normalizeClaimPath(claim.file),
      });
    }
  }

  const collisions: CoreResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];
      if (!left || !right) continue;
      if (left.track_id === right.track_id) continue;
      if (left.repo !== right.repo) continue;
      if (!claimsOverlap(left.file, right.file)) continue;
      const trackIds = [left.track_id, right.track_id].sort();
      const files = [left.file, right.file].sort();
      const key = `${left.repo}\u0000${trackIds.join("\u0000")}\u0000${files.join("\u0000")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const collisionClaims: Claim[] = [left, right];
      collisions.push({
        repo: left.repo,
        file: left.file === right.file ? left.file : `${left.file} <-> ${right.file}`,
        kind: left.file === right.file ? "exact" : "overlap",
        claims: collisionClaims,
        track_ids: trackIds,
        owners: Array.from(new Set(collisionClaims.map((claim) => claim.owner).filter(Boolean))).sort(),
      });
    }
  }
  collisions.sort((a, b) => `${asString(a.repo)}${asString(a.file)}`.localeCompare(`${asString(b.repo)}${asString(b.file)}`));
  return {
    root,
    active_tracks: active.length,
    collisions,
  };
}

function liveStatus(root: string): CoreResult {
  const tracks = listTracks(root);
  const identity = gitIdentity(root);
  const byStatus = new Map<string, number>();
  const activeTracks: CoreResult[] = [];
  for (const track of tracks) {
    const status = track.metadata.status || "new";
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    if (status === "in_progress") {
      const plan = parsePlanFile(track.plan_path);
      activeTracks.push({
        track_id: track.track_id,
        name: track.metadata.name || track.metadata.description || track.track_id,
        owner: track.metadata.owner || null,
        git_branch: track.metadata.git_branch || `track/${track.track_id}`,
        task_counts: taskCounts(plan),
      });
    }
  }
  return {
    root,
    identity,
    total_tracks: tracks.length,
    by_status: Object.fromEntries(Array.from(byStatus.entries()).sort()),
    active_tracks: activeTracks,
  };
}

function teamStatus(root: string): CoreResult {
  const tracks = listTracks(root);
  const byOwner = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const track of tracks) {
    const owner = track.metadata.owner || "(unowned)";
    const status = track.metadata.status || "new";
    byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }
  return {
    root,
    identity: gitIdentity(root),
    total_tracks: tracks.length,
    by_owner: Object.fromEntries(Array.from(byOwner.entries()).sort()),
    by_status: Object.fromEntries(Array.from(byStatus.entries()).sort()),
    tracks: tracks.map((track) => ({
      track_id: track.track_id,
      status: track.metadata.status || "new",
      name: track.metadata.name || track.metadata.description || track.track_id,
      priority: track.metadata.priority || "medium",
      owner: track.metadata.owner || null,
      reviewer: track.metadata.reviewer || null,
      review_verdict: track.metadata.review ? track.metadata.review.verdict : null,
    })),
  };
}

function runBdJson(root: string, args: string[]): BdJsonResult {
  if (!commandExists("bd", root)) return { ok: false, available: false, args, json: null };
  const result = runCommand("bd", args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  let json: unknown = null;
  try {
    json = JSON.parse(result.stdout || "null");
  } catch {
    // Preserve raw output below.
  }
  return { ok: result.ok, available: true, args, json, stdout_tail: result.stdout.slice(-2000), stderr_tail: result.stderr.slice(-2000) };
}

function asArray(value: unknown): CoreResult[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.items)) return value.items.filter(isRecord).map(asJsonObject);
  if (isRecord(value) && Array.isArray(value.issues)) return value.issues.filter(isRecord).map(asJsonObject);
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord).map(asJsonObject);
  return [];
}

function taskMarkerName(marker: string): string {
  const names: Record<string, string> = {
    "~": "in_progress",
    "!": "blocked",
    "x": "completed",
    "-": "skipped",
    " ": "pending",
  };
  return names[marker] || "pending";
}

function metadataTrackSummary(track: CadreTrack): TrackSummary {
  return {
    track_id: track.track_id,
    name: track.metadata.name || track.metadata.description || track.track_id,
    status: track.metadata.status || "new",
    priority: track.metadata.priority || "medium",
    owner: track.metadata.owner || null,
    reviewer: track.metadata.reviewer || null,
    beads_epic: track.metadata.beads_epic || null,
    review: track.metadata.review ? asJsonObject(track.metadata.review) : null,
  };
}

function teamBoard(root: string, args: RuntimeArgs = {}): CoreResult {
  const tracks = listTracks(root);
  const identity = gitIdentity(root);
  const scope = args.mine === true ? "mine" : "all";
  const byId = new Map<string, CadreTrack>(tracks.map((track) => [track.track_id, track]));
  const byEpic = new Map<string, CadreTrack>(
    tracks
      .flatMap((track): Array<[string, CadreTrack]> => track.metadata.beads_epic ? [[track.metadata.beads_epic, track]] : [])
  );
  const wip: CoreResult[] = [];
  const reviewQueue: CoreResult[] = [];
  const blockers: CoreResult[] = [];

  for (const track of tracks) {
    const summary = metadataTrackSummary(track);
    const hold = holdInfo(track);
    if (
      summary.status === "in_progress" ||
      summary.status === "blocked" ||
      hold.owner ||
      hold.lease_owner
    ) {
      if (scope !== "mine" || summary.owner === identity || hold.owner === identity || hold.lease_owner === identity) {
        wip.push({ ...summary, hold });
      }
    }

    if (summary.review && (summary.review.verdict === "changes_requested" || Number(summary.review.blocking_count || 0) > 0)) {
      reviewQueue.push({ ...summary, review_state: "changes_requested" });
    } else if (summary.review && summary.review.verdict === "approved") {
      reviewQueue.push({ ...summary, review_state: "ready_to_ship" });
    }

    const deps = Array.isArray(track.metadata.depends_on) ? track.metadata.depends_on.filter((dep): dep is string => typeof dep === "string") : [];
    for (const dep of deps) {
      const depTrack = byId.get(dep);
      if (!depTrack || depTrack.metadata.status !== "completed") {
        blockers.push({
          kind: "track_dependency",
          track_id: track.track_id,
          blocked_on: dep,
          blocked_on_status: depTrack ? depTrack.metadata.status || "new" : "missing",
        });
      }
    }
    const plan = parsePlanFile(track.plan_path);
    for (const phase of plan.phases || []) {
      for (const task of phase.tasks || []) {
        if (task.marker === "!" || task.marker === "~") {
          blockers.push({
            kind: taskMarkerName(task.marker),
            track_id: track.track_id,
            phase: phase.phase_index,
            task: task.task_index,
            task_key: task.task_key,
            title: task.title,
          });
        }
      }
    }
  }

  const beads = {
    available: commandExists("bd", root),
    wip: null as BdJsonResult | null,
    handoffs: null as BdJsonResult | null,
    review_labels: {} as Record<string, BdJsonResult>,
    blocked_edges: null as BdJsonResult | null,
  };
  const handoffs: CoreResult[] = [];
  if (beads.available) {
    beads.wip = runBdJson(root, ["list", "--status", "in_progress", "--json"]);
    beads.handoffs = runBdJson(root, ["list", "--label", "handoff:pending", "--json"]);
    beads.blocked_edges = runBdJson(root, ["ready", "--json"]);
    for (const label of ["review:changes", "review:ready", "review:requested"]) {
      beads.review_labels[label] = runBdJson(root, ["list", "--label", label, "--json"]);
      const reviewLabel = beads.review_labels[label];
      for (const issue of asArray(reviewLabel?.json)) {
        const id = asOptionalString(issue.id) || asOptionalString(issue.issue_id) || asOptionalString(issue.issueId) || asOptionalString(issue.parent) || asOptionalString(issue.epic) || null;
        const track = id ? byEpic.get(id) : null;
        if (track) {
          reviewQueue.push({
            ...metadataTrackSummary(track),
            review_state: label.replace("review:", ""),
            source: "beads_label",
            bead_id: id,
          });
        }
      }
    }
    for (const issue of asArray(beads.handoffs?.json)) {
      const id = asOptionalString(issue.id) || asOptionalString(issue.issue_id) || asOptionalString(issue.issueId) || null;
      const track = id ? byEpic.get(id) : null;
      const assignee = asOptionalString(issue.assignee) || asOptionalString(issue.assigned_to) || null;
      if (scope === "mine" && assignee !== identity) continue;
      handoffs.push({
        track_id: track ? track.track_id : null,
        bead_id: id,
        assignee,
        title: issue.title || issue.summary || null,
      });
    }
  }

  const dedupReview = new Map();
  for (const item of reviewQueue) {
    const key = `${item.track_id}:${item.review_state}:${item.bead_id || ""}`;
    if (!dedupReview.has(key)) dedupReview.set(key, item);
  }

  return {
    ok: true,
    root,
    identity,
    scope,
    generated_at: utcNow(),
    summary: teamStatus(root),
    wip,
    incoming_handoffs: handoffs,
    review_queue: Array.from(dedupReview.values()),
    blockers,
    beads,
  };
}

function availableWork(root: string): CoreResult {
  const tracks = listTracks(root);
  const byId = new Map(tracks.map((track) => [track.track_id, track]));
  const available: CoreResult[] = [];
  const reclaimable: CoreResult[] = [];
  const now = Date.now();
  for (const track of tracks) {
    const status = track.metadata.status || "new";
    const owner = track.metadata.owner || null;
    const hold = holdInfo(track, now);
    const deps = Array.isArray(track.metadata.depends_on)
      ? track.metadata.depends_on.filter((dep): dep is string => typeof dep === "string")
      : [];
    const depsMet = deps.every((dep) => {
      const depTrack = byId.get(dep);
      return depTrack && depTrack.metadata.status === "completed";
    });
    if (status === "new" && !owner && depsMet) {
      available.push({
        track_id: track.track_id,
        priority: track.metadata.priority || "medium",
        description: track.metadata.description || track.metadata.name || track.track_id,
      });
    }
    const heldBy = hold.lease_owner || hold.owner;
    const stale = hold.lease_stale || hold.state_stale;
    if (depsMet && heldBy && stale && ["new", "in_progress", "blocked"].includes(status)) {
      reclaimable.push({
        track_id: track.track_id,
        status,
        priority: track.metadata.priority || "medium",
        description: track.metadata.description || track.metadata.name || track.track_id,
        held_by: heldBy,
        lease_age_minutes: hold.lease_age_minutes,
        state_age_minutes: hold.state_age_minutes,
      });
    }
  }
  return { root, available, reclaimable };
}

function findTrack(root: string, trackId: string | null | undefined): CadreTrack | null {
  return listTracks(root).find((item) => item.track_id === trackId) || null;
}

function priorityRank(priority: unknown): number {
  const ranks: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return ranks[String(priority || "medium").toLowerCase()] ?? 2;
}

function trackContext(root: string, trackId: string | null | undefined): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const topology = loadTopology(root);
  const plan = parsePlanFile(track.plan_path);
  const hold = holdInfo(track);
  const worktrees: CoreResult[] = [];
  if (track.metadata.worktree_path) {
    const abs = path.resolve(root, track.metadata.worktree_path);
    worktrees.push({
      repo: ".",
      path: track.metadata.worktree_path,
      exists: fileExists(abs),
      git_branch: track.metadata.git_branch || `track/${track.track_id}`,
    });
  }
  const reposMetadata = isRecord(track.metadata.repos) ? track.metadata.repos : null;
  if (reposMetadata) {
    for (const [repo, rawInfo] of Object.entries(reposMetadata)) {
      const info = asJsonObject(rawInfo) as RepoRuntimeInfo;
      const submodulePath = info.submodule_path || "";
      const worktreePath = info.worktree_path || "";
      worktrees.push({
        repo,
        submodule_path: submodulePath,
        path: worktreePath,
        exists: worktreePath ? fileExists(path.resolve(root, worktreePath)) : false,
        git_branch: info.git_branch || `track/${track.track_id}`,
        base_branch: info.base_branch || "main",
      });
    }
  }
  return {
    ok: true,
    root,
    topology: {
      polyrepo: topology.polyrepo,
      default_repo: topology.defaultRepo,
      sync_mode: topology.config.sync_mode || "local",
    },
    track: {
      track_id: track.track_id,
      status: track.metadata.status || "new",
      name: track.metadata.name || track.metadata.description || track.track_id,
      priority: track.metadata.priority || "medium",
      owner: track.metadata.owner || null,
      reviewer: track.metadata.reviewer || null,
      git_branch: track.metadata.git_branch || `track/${track.track_id}`,
      metadata_path: path.relative(root, track.metadata_path || path.join(track.dir, "metadata.json")),
      plan_path: path.relative(root, track.plan_path),
      spec_path: path.relative(root, track.spec_path),
      beads_epic: track.metadata.beads_epic || null,
      beads_tasks: track.metadata.beads_tasks || {},
      review: track.metadata.review || null,
      last_coverage: track.metadata.last_coverage ?? null,
    },
    hold,
    task_counts: taskCounts(plan),
    plan,
    worktrees,
  };
}

function resolveTaskWorkingRoot(root: string, track: CadreTrack, task: PlanTask | null = null, args: RuntimeArgs = {}): WorkingRoot {
  if (args.workingRoot) {
    const candidate = path.isAbsolute(args.workingRoot)
      ? args.workingRoot
      : path.resolve(root, args.workingRoot);
    return { repo: args.repo || task?.repo || ".", path: candidate, source: "argument.workingRoot" };
  }
  const topology = loadTopology(root);
  const reposMetadata = isRecord(track.metadata.repos) ? track.metadata.repos : null;
  if (topology.polyrepo && reposMetadata) {
    const repo = args.repo || task?.repo || topology.defaultRepo;
    const info = typeof repo === "string" ? asJsonObject(reposMetadata[repo]) as RepoRuntimeInfo : {};
    if (Object.keys(info).length > 0) {
      const rel = info.worktree_path || info.submodule_path || "";
      return {
        repo,
        path: rel ? path.resolve(root, rel) : root,
        source: info.worktree_path ? "metadata.repos.worktree_path" : "metadata.repos.submodule_path",
      };
    }
    return { repo, path: root, source: "polyrepo-missing-repo-fallback" };
  }
  if (track.metadata.worktree_path) {
    const candidate = path.resolve(root, track.metadata.worktree_path);
    if (fileExists(candidate)) {
      return { repo: ".", path: candidate, source: "metadata.worktree_path" };
    }
  }
  return { repo: ".", path: root, source: "project-root" };
}

function repoEntriesForTrack(root: string, track: CadreTrack, args: RuntimeArgs = {}): RepoExecutionEntry[] {
  const topology = loadTopology(root);
  const reposMetadata = isRecord(track.metadata.repos) ? track.metadata.repos : null;
  if (topology.polyrepo && reposMetadata) {
    return Object.entries(reposMetadata)
      .filter(([repo]) => !args.repo || args.repo === repo)
      .map(([repo, rawInfo]) => {
        const info = asJsonObject(rawInfo) as RepoRuntimeInfo;
        const rel = info.worktree_path || info.submodule_path || "";
        return {
          repo,
          root: rel ? path.resolve(root, rel) : root,
          path: rel,
          base: args.base || info.base_branch || "main",
          head: args.head || info.git_branch || track.metadata.git_branch || `track/${track.track_id}`,
          source: info.worktree_path ? "metadata.repos.worktree_path" : "metadata.repos.submodule_path",
        };
      });
  }
  return [{
    repo: args.repo || ".",
    root: args.workingRoot ? path.resolve(root, args.workingRoot) : root,
    path: args.workingRoot || ".",
    base: args.base || "main",
    head: args.head || track.metadata.git_branch || `track/${track.track_id}`,
    source: args.workingRoot ? "argument.workingRoot" : "project-root",
  }];
}

function gitRevParse(root: string, ref: string | null | undefined): string | null {
  if (!ref) return null;
  const result = runCommand("git", ["rev-parse", ref], { cwd: root });
  return result.ok ? result.stdout.trim() || null : null;
}

function reviewedShasForTrack(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const supplied = args.reviewedShas || args.reviewed_shas || null;
  const entries = repoEntriesForTrack(root, track, args);
  const reviewedShas: Record<string, string | null> = {};
  const controlHead = (supplied && asOptionalString(supplied["."]))
    || args.reviewedSha
    || args.reviewed_sha
    || gitRevParse(root, track.metadata.git_branch || `track/${track.track_id}`)
    || gitRevParse(root, "HEAD");
  if (controlHead) reviewedShas["."] = controlHead;
  for (const entry of entries) {
    const repo = asString(entry.repo, ".");
    reviewedShas[repo] = (supplied && asOptionalString(supplied[repo]))
      || gitRevParse(asString(entry.root, root), asString(entry.head, "HEAD"))
      || gitRevParse(asString(entry.root, root), "HEAD");
  }
  return {
    reviewed_sha: controlHead || null,
    reviewed_shas: reviewedShas,
  };
}

function implementationPrep(root: string, args: RuntimeArgs = {}): CoreResult {
  const identity = args.identity || gitIdentity(root);
  const team = teamStatus(root);
  const available = availableWork(root);
  let trackId = args.trackId || args.track_id || null;
  const warnings: string[] = [];
  const availableTracks = asArray(available.available);

  if (!trackId && availableTracks.length > 0) {
    trackId = asOptionalString(availableTracks[0]?.track_id) || null;
  }
  if (!trackId) {
    const teamTracks = asArray(team.tracks);
    const mine = teamTracks.find((track) => track.status === "in_progress" && (!track.owner || track.owner === identity));
    const anyOpen = teamTracks.find((track) => ["new", "in_progress", "blocked"].includes(asString(track.status)));
    trackId = asOptionalString((mine || anyOpen || {}).track_id) || null;
  }
  if (!trackId) {
    return {
      ok: false,
      root,
      identity,
      reason: "No available or incomplete track found",
      team,
      available,
    };
  }

  let claim = null;
  if (args.claim === true) {
    claim = claimTrack(root, trackId, { identity, takeover: args.takeover === true });
    if (!claim.ok) {
      return { ok: false, root, identity, selected_track: trackId, claim, team, available };
    }
  }

  const context = trackContext(root, trackId);
  const collisions = collisionScan(root);
  const selectedCollisions = asArray(collisions.collisions).filter((collision) =>
    asStringArray(collision.track_ids).includes(trackId)
  );
  const integrity = planIntegrity(root, trackId);
  const foreignCollisions = selectedCollisions.filter((collision) =>
    asStringArray(collision.owners).some((owner) => owner && owner !== identity)
  );
  if (foreignCollisions.length > 0) {
    warnings.push(`${foreignCollisions.length} cross-owner file collision(s) involve the selected track`);
  }
  const contextHold = asJsonObject(context.hold);
  if (context.ok && contextHold.owner && identity && contextHold.owner !== identity) {
    warnings.push(`Selected track is held by ${contextHold.owner}`);
  }

  return {
    ok: context.ok && integrity.ok,
    root,
    identity,
    selected_track: trackId,
    claim,
    context,
    team_summary: {
      total_tracks: team.total_tracks,
      by_status: team.by_status,
      by_owner: team.by_owner,
    },
    available,
    collisions: selectedCollisions,
    integrity,
    warnings,
  };
}

function planIntegrity(root: string, trackId: string | null = null): CoreResult {
  const topology = loadTopology(root);
  const foundTrack = trackId ? findTrack(root, trackId) : null;
  const tracks: CadreTrack[] = trackId ? (foundTrack ? [foundTrack] : []) : listTracks(root);
  if (trackId && tracks.length === 0) return { ok: false, error: `Track not found: ${trackId}` };
  const errors: JsonObject[] = [];
  const warnings: JsonObject[] = [];
  for (const track of tracks) {
    const plan = parsePlanFile(track.plan_path);
    const seenKeys = new Set<string>();
    for (const phase of plan.phases) {
      const execution = phase.annotations.execution || "sequential";
      const claimedFiles = new Set<string>();
      for (const task of phase.tasks) {
        if (seenKeys.has(task.task_key)) {
          errors.push({ track_id: track.track_id, line: task.line, message: `Duplicate task key ${task.task_key}` });
        }
        seenKeys.add(task.task_key);
        if (!task.files || task.files.length === 0) {
          warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: "Missing <!-- files: ... --> annotation" });
        }
        if (topology.polyrepo && !task.repo && !topology.defaultRepo) {
          errors.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: "Task has no repo annotation and repos.json has no default_repo" });
        }
        for (const dep of task.depends || []) {
          if (!/^task\d+$|^phase\d+_task\d+$/.test(dep)) {
            warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: `Unrecognized dependency reference ${dep}` });
          }
        }
        if (execution === "parallel") {
          for (const file of task.files || []) {
            const normalized = `${task.repo || topology.defaultRepo || "."}:${normalizeClaimPath(file)}`;
            if (claimedFiles.has(normalized)) {
              warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: `Parallel phase repeats file claim ${normalized}` });
            }
            claimedFiles.add(normalized);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, root, checked_tracks: tracks.length, errors, warnings };
}

function extractBeadsId(json: unknown, fallback: string | null = null): string | null {
  if (!isRecord(json)) return fallback;
  for (const key of ["id", "issue_id", "issueId"]) {
    const value = json[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const issue = json.issue;
  if (isRecord(issue) && typeof issue.id === "string" && issue.id.trim()) return issue.id.trim();
  return fallback;
}

function extractAssignee(json: unknown): string | null {
  if (Array.isArray(json)) {
    for (const item of json) {
      const nested = extractAssignee(item);
      if (nested) return nested;
    }
    return null;
  }
  if (!isRecord(json)) return null;
  const direct = json.assignee || json.assigned_to || json.owner || json.claimed_by;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  for (const key of ["issue", "task", "epic", "data"]) {
    const nested = extractAssignee(json[key]);
    if (nested) return nested;
  }
  return null;
}

function parseCommandJson(result: Pick<CommandResult, "stdout"> | CoreResult): unknown {
  try {
    return JSON.parse(asString(result.stdout) || "null") as unknown;
  } catch {
    return null;
  }
}

function beadsCommandPlanEntry(args: string[]): BeadsCommandPlanEntry {
  return { command: ["bd", ...args].join(" "), args };
}

function compactLines(value: unknown, limit = 1200): string {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, limit);
}

function sectionText(markdown: unknown, headingPattern: RegExp): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] || "";
    if (/^#{1,4}\s+/.test(line) && out.length > 0) break;
    out.push(line);
  }
  return compactLines(out.join("\n"));
}

function specContextFromText(text: string): SpecContext {
  const overview = sectionText(text, /^#{1,4}\s+(overview|summary|technical approach|approach|requirements?)\b/i) || compactLines(text, 1400);
  const acceptance = sectionText(text, /^#{1,4}\s+(acceptance|success criteria|done|definition of done)\b/i) || compactLines(text, 1000);
  return { overview, acceptance };
}

function trackSpecContext(track: CadreTrack, fallbackText = ""): SpecContext {
  const text = track.spec_path && fileExists(track.spec_path)
    ? fs.readFileSync(track.spec_path, "utf8")
    : fallbackText;
  return specContextFromText(text);
}

function taskDesignText(track: CadreTrack, phase: PlanPhase, task: PlanTask, specContext: SpecContext): string {
  return compactLines([
    `Track: ${track.track_id}`,
    `Phase: ${phase.title}`,
    `Task: ${task.title}`,
    task.files && task.files.length ? `Files: ${task.files.join(", ")}` : null,
    task.depends && task.depends.length ? `Depends on: ${task.depends.join(", ")}` : null,
    task.repo ? `Repo: ${task.repo}` : null,
    specContext.overview ? `Spec context: ${specContext.overview}` : null,
  ].filter(Boolean).join("\n"), 1800);
}

function taskAcceptanceText(task: PlanTask, specContext: SpecContext): string {
  return compactLines([
    `Complete when this task is implemented, tested, and committed.`,
    task.files && task.files.length ? `Owned files changed only as needed: ${task.files.join(", ")}` : null,
    specContext.acceptance ? `Track acceptance context: ${specContext.acceptance}` : null,
  ].filter(Boolean).join("\n"), 1600);
}

function addCreateContext(args: string[], design: string | null | undefined, acceptance: string | null | undefined): string[] {
  if (design) args.push("--design", design);
  if (acceptance) args.push("--acceptance", acceptance);
  return args;
}

function createBeadsTree(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = args.trackId || args.track_id;
  if (!trackId) return { ok: false, error: "trackId is required" };
  const dryRun = args.dryRun === true;
  const diskTrack = findTrack(root, trackId);
  if (!diskTrack && !dryRun) return { ok: false, error: `Track not found: ${trackId}` };
  if (!diskTrack && dryRun && !args.planText) {
    return { ok: false, error: `Track not found: ${trackId}; dryRun without track files requires planText` };
  }
  const draftMetadata: TrackMetadata = {
    track_id: trackId,
    type: "feature",
    status: "new",
    priority: "medium",
    description: trackId,
    git_branch: `track/${trackId}`,
    ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
  };
  const track: CadreTrack = diskTrack || {
    track_id: trackId,
    dir: path.join(root, "cadre", "tracks", safeName(trackId)),
    metadata_path: path.join(root, "cadre", "tracks", safeName(trackId), "metadata.json"),
    plan_path: path.join(root, "cadre", "tracks", safeName(trackId), "plan.md"),
    spec_path: path.join(root, "cadre", "tracks", safeName(trackId), "spec.md"),
    metadata: draftMetadata,
  };
  if (!dryRun && !commandExists("bd", root)) {
    return { ok: false, available: false, reason: "Beads CLI (bd) is not installed or not on PATH" };
  }

  const identity = args.identity || gitIdentity(root);
  const plan = args.planText ? parsePlanText(args.planText) : parsePlanFile(track.plan_path);
  const specContext = trackSpecContext(track, args.specText || "");
  const epicId = args.epicId || track.metadata.beads_epic || `cadre-${track.track_id}`;
  const commands: BeadsCommandPlanEntry[] = [];
  const results: CommandResult[] = [];
  const beadsTasks: Record<string, string | null> = {};

  const runBd = (bdArgs: string[]): CommandResult => {
    commands.push(beadsCommandPlanEntry(bdArgs));
    if (dryRun) {
      const id = bdArgs[0] === "create" && bdArgs.includes("--id") ? epicId : `dry-${commands.length}`;
      return { ok: true, status: 0, stdout: JSON.stringify({ id }), stderr: "", command: "bd", args: bdArgs };
    }
    const result = runCommand("bd", bdArgs, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    results.push(result);
    return result;
  };

  const showEpic: CommandResult | CoreResult = dryRun ? { ok: false } : runCommand("bd", ["show", epicId, "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  if (showEpic.ok) {
    if (track.metadata.beads_epic === epicId && track.metadata.beads_tasks && Object.keys(track.metadata.beads_tasks).length > 0) {
      return {
        ok: true,
        available: true,
        existing: true,
        dry_run: false,
        track_id: track.track_id,
        beads_epic: epicId,
        beads_tasks: track.metadata.beads_tasks,
        commands,
        results,
        metadata_patch: {
          beads_epic: epicId,
          beads_tasks: track.metadata.beads_tasks,
        },
      };
    }
    return {
      ok: false,
      available: true,
      existing: true,
      reason: `Beads epic ${epicId} already exists but metadata.beads_tasks is missing; reconcile existing children before creating new ones`,
      commands,
      results,
    };
  } else {
    const epicArgs = addCreateContext([
      "create",
      `${track.track_id}: ${track.metadata.description || track.metadata.name || track.track_id}`,
      "--id",
      epicId,
      "-t",
      "epic",
      "-p",
      String(priorityRank(track.metadata.priority)),
    ], specContext.overview, specContext.acceptance);
    epicArgs.push("--json");
    if (identity) epicArgs.splice(epicArgs.length - 1, 0, "--assignee", identity);
    const epicResult = runBd(epicArgs);
    if (!epicResult.ok) return { ok: false, available: true, stage: "create_epic", commands, results };
  }

  const phaseIds: Record<string, string> = {};
  for (const phase of plan.phases) {
    const phaseKey = `phase${phase.phase_index}`;
    const phaseResult = runBd(addCreateContext(
      ["create", phase.title, "-t", "task", "--parent", epicId, "--labels", "cadre:phase"],
      `Phase for Cadre track ${track.track_id}: ${phase.title}`,
      `All tasks in this phase are complete or intentionally skipped.`
    ).concat("--json"));
    if (!phaseResult.ok) return { ok: false, available: true, stage: "create_phase", phase: phaseKey, commands, results };
    const phaseId = extractBeadsId(parseCommandJson(phaseResult), dryRun ? `dry-${phaseKey}` : null);
    if (!phaseId) return { ok: false, available: true, stage: "parse_phase_id", phase: phaseKey, commands, results };
    phaseIds[phaseKey] = phaseId;
    beadsTasks[phaseKey] = phaseId;

    for (const task of phase.tasks) {
      const taskKey = `phase${phase.phase_index}_task${task.task_index}`;
      const taskResult = runBd(addCreateContext([
        "create",
        task.title,
        "-t",
        "task",
        "--parent",
        phaseId,
        "--labels",
        "cadre:task",
      ], taskDesignText(track, phase, task, specContext), taskAcceptanceText(task, specContext)).concat("--json"));
      if (!taskResult.ok) return { ok: false, available: true, stage: "create_task", task: taskKey, commands, results };
      const taskId = extractBeadsId(parseCommandJson(taskResult), dryRun ? `dry-${taskKey}` : null);
      if (!taskId) return { ok: false, available: true, stage: "parse_task_id", task: taskKey, commands, results };
      beadsTasks[taskKey] = taskId;
    }
  }

  for (const phase of plan.phases) {
    const phaseKey = `phase${phase.phase_index}`;
    if (!phase.annotations.depends && phase.phase_index > 1) {
      const previousPhaseId = phaseIds[`phase${phase.phase_index - 1}`];
      const currentPhaseId = phaseIds[phaseKey];
      if (currentPhaseId && previousPhaseId) runBd(["dep", "add", currentPhaseId, previousPhaseId, "--json"]);
    } else if (phase.annotations.depends) {
      for (const dep of asString(phase.annotations.depends).split(",").map((item) => item.trim()).filter(Boolean)) {
        const currentPhaseId = phaseIds[phaseKey];
        const dependencyPhaseId = phaseIds[dep];
        if (currentPhaseId && dependencyPhaseId) runBd(["dep", "add", currentPhaseId, dependencyPhaseId, "--json"]);
      }
    }

    const execution = phase.annotations.execution || "sequential";
    for (const task of phase.tasks) {
      const taskKey = `phase${phase.phase_index}_task${task.task_index}`;
      if (execution !== "parallel" && task.task_index > 1) {
        const taskId = beadsTasks[taskKey];
        const previousTaskId = beadsTasks[`phase${phase.phase_index}_task${task.task_index - 1}`];
        if (taskId && previousTaskId) runBd(["dep", "add", taskId, previousTaskId, "--json"]);
      }
      if (execution === "parallel") {
        for (const dep of task.depends || []) {
          const taskDep = dep.match(/^task(\d+)$/);
          const depKey = taskDep ? `phase${phase.phase_index}_task${taskDep[1]}` : dep;
          const taskId = beadsTasks[taskKey];
          const dependencyTaskId = beadsTasks[depKey];
          if (taskId && dependencyTaskId) runBd(["dep", "add", taskId, dependencyTaskId, "--json"]);
        }
      }
    }
  }

  runBd([
    "note",
    epicId,
    [
      `TRACK INITIALIZED: ${track.track_id}`,
      `PHASES: ${plan.phases.length}`,
      `BRANCH: ${track.metadata.git_branch || `track/${track.track_id}`}`,
    ].join("\n"),
    "--json",
  ]);

  for (const phase of plan.phases) {
    if ((phase.annotations.execution || "sequential") !== "parallel") continue;
    for (const task of phase.tasks) {
      const taskKey = `phase${phase.phase_index}_task${task.task_index}`;
      const taskId = beadsTasks[taskKey];
      if (!taskId) continue;
      runBd([
        "note",
        taskId,
        [
          "PARALLEL_ENABLED: true",
          `FILES_OWNED: ${(task.files || []).join(", ")}`,
          `DEPENDS_ON: ${(task.depends || []).join(", ") || "none"}`,
          task.repo ? `REPO: ${task.repo}` : null,
        ].filter(Boolean).join("\n"),
        "--json",
      ]);
    }
  }

  let metadataPatch: CoreResult | null = null;
  if (!dryRun) {
    metadataPatch = patchJsonFile(track.metadata_path, (metadata) => ({
      ...metadata,
      beads_epic: epicId,
      beads_tasks: beadsTasks,
    }), {
      root,
      lockName: trackLockName(track.track_id),
    });
    if (!metadataPatch.ok) {
      return { ok: false, available: true, stage: "metadata_patch", commands, results, metadata_patch: metadataPatch };
    }
  }

  return {
    ok: true,
    available: true,
    dry_run: dryRun,
    track_id: track.track_id,
    beads_epic: epicId,
    beads_tasks: beadsTasks,
    commands,
    results,
    metadata_patch: {
      beads_epic: epicId,
      beads_tasks: beadsTasks,
    },
    metadata_write: metadataPatch,
  };
}

function reviewGate(root: string, trackId: string, options: RuntimeArgs = {}): CoreResult {
  const track = listTracks(root).find((item) => item.track_id === trackId);
  if (!track) {
    return { ok: false, track_id: trackId, reasons: [`Track not found: ${trackId}`] };
  }
  const config = loadTopology(root).config || {};
  const review = track.metadata.review || null;
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!review) {
    if (config.allow_unreviewed_ship === true) {
      warnings.push("No recorded review verdict; allowed by config.allow_unreviewed_ship");
    } else {
      reasons.push("No recorded review verdict");
    }
  } else {
    if (review.verdict !== "approved") {
      reasons.push(`Review verdict is ${review.verdict || "absent"}`);
    }
    if ((review.blocking_count || 0) > 0) {
      reasons.push(`Review has ${review.blocking_count} blocking finding(s)`);
    }
    if (config.require_second_reviewer === true && review.self_reviewed === true) {
      reasons.push("Self-review is not sufficient when require_second_reviewer is true");
    }
    const hasPinnedReview = Boolean(review.reviewed_sha)
      || Boolean(review.reviewed_shas && Object.values(review.reviewed_shas).some(Boolean));
    if (!hasPinnedReview) {
      if (config.allow_unpinned_review_ship === true) {
        warnings.push("Review does not record reviewed_sha/reviewed_shas; allowed by config.allow_unpinned_review_ship");
      } else {
        reasons.push("Review does not record reviewed_sha/reviewed_shas");
      }
    } else if (review.reviewed_sha && options.headSha && options.headSha !== review.reviewed_sha) {
      reasons.push(`Head ${options.headSha} differs from reviewed_sha ${review.reviewed_sha}; re-review required`);
    }
    if (review.reviewed_shas && options.headShas && typeof options.headShas === "object") {
      for (const [repo, reviewedSha] of Object.entries(review.reviewed_shas)) {
        const headSha = options.headShas[repo];
        if (typeof reviewedSha === "string" && typeof headSha === "string" && headSha !== reviewedSha) {
          reasons.push(`Repo ${repo} head ${headSha} differs from reviewed_shas.${repo} ${reviewedSha}; re-review required`);
        }
      }
    }
  }
  return {
    ok: reasons.length === 0,
    track_id: track.track_id,
    review,
    reasons,
    warnings,
  };
}

function metadataPatch(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const patch = args.patch && typeof args.patch === "object" ? args.patch : null;
  if (!patch) return { ok: false, error: "patch object is required" };
  const result = patchJsonFile(track.metadata_path, (metadata) => ({ ...metadata, ...patch }), {
    root,
    lockName: trackLockName(track.track_id),
  });
  return {
    ok: result.ok,
    track_id: track.track_id,
    metadata_path: path.relative(root, track.metadata_path),
    patch_keys: Object.keys(patch).sort(),
    result,
  };
}

function heartbeatTrack(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  return withTrackLock(root, track.track_id, () => heartbeatTrackUnlocked(root, track, args));
}

function heartbeatTrackUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const identity = args.identity || gitIdentity(root) || track.metadata.owner || null;
  const now = asOptionalString(args.now) || utcNow();
  const topology = loadTopology(root);
  const metadataResult = patchJsonFile(track.metadata_path, (metadata) => {
    if (topology.config.sync_mode === "shared") {
      const existingLease = asJsonObject(metadata.lease);
      metadata.lease = {
        ...existingLease,
        owner: identity,
        acquired_at: asOptionalString(existingLease.acquired_at) || now,
        heartbeat_at: now,
      };
    }
    metadata.owner = metadata.owner || identity;
    metadata.updated_at = now;
    return metadata;
  }, { lock: false });
  const statePath = path.join(track.dir, "implement_state.json");
  let stateResult = null;
  if (fileExists(statePath)) {
    stateResult = patchJsonFile(statePath, (state) => ({
      ...state,
      owner: state.owner || identity,
      last_updated: now,
    }), { lock: false });
  }
  let beads = null;
  const epic = track.metadata.beads_epic;
  if (epic && commandExists("bd", root)) {
    beads = beadsTaskWrite(root, { operation: "update", id: epic, assignee: identity || "" });
  }
  return {
    ok: metadataResult.ok && (!stateResult || stateResult.ok) && (!beads || beads.ok),
    track_id: track.track_id,
    owner: identity,
    heartbeat_at: now,
    metadata: metadataResult,
    state: stateResult,
    beads,
  };
}

function claimTrack(root: string, trackId: string, options: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  return withTrackLock(root, track.track_id, () => claimTrackUnlocked(root, track, options));
}

function claimTrackUnlocked(root: string, track: CadreTrack, options: RuntimeArgs = {}): CoreResult {
  const identity = options.identity || gitIdentity(root);
  if (!identity) return { ok: false, error: "No git identity found for claim" };
  const now = utcNow();
  const hold = holdInfo(track);
  const heldBy = hold.lease_owner || hold.owner;
  const stale = hold.lease_stale || hold.state_stale || !heldBy || heldBy === identity;
  if (heldBy && heldBy !== identity && !stale && options.takeover !== true) {
    return { ok: false, claimed: false, reason: "foreign-held", held_by: heldBy, hold };
  }

  const commands: CommandResult[] = [];
  if (track.metadata.beads_epic) {
    if (!commandExists("bd", root)) {
      return { ok: false, claimed: false, error: "Beads CLI (bd) is required but was not found" };
    }
    const escapedIdentity = identity.replace(/'/g, "''");
    const escapedEpic = String(track.metadata.beads_epic).replace(/'/g, "''");
    const sql =
      `UPDATE issues SET assignee='${escapedIdentity}' ` +
      `WHERE id='${escapedEpic}' AND (` +
      `assignee IS NULL OR assignee='' OR assignee='${escapedIdentity}' ` +
      `OR updated_at < datetime('now','-30 minutes'))`;
    commands.push(runCommand("bd", ["sql", sql], { cwd: root }));
    const last = commands[commands.length - 1];
    if (!last || !last.ok) return { ok: false, claimed: false, error: "Beads claim failed", commands };
    const verify = runCommand("bd", ["show", track.metadata.beads_epic, "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    commands.push(verify);
    if (!verify.ok) return { ok: false, claimed: false, error: "Beads claim verification failed", commands };
    const assignedTo = extractAssignee(parseCommandJson(verify));
    if (!assignedTo) {
      return {
        ok: false,
        claimed: false,
        reason: "claim-unverified",
        error: "Beads claim verification did not expose an assignee",
        commands,
      };
    }
    if (assignedTo !== identity) {
      return {
        ok: false,
        claimed: false,
        reason: "foreign-held",
        held_by: assignedTo,
        hold,
        commands,
      };
    }
  }

  const topology = loadTopology(root);
  const metadataResult = patchJsonFile(track.metadata_path, (metadata) => {
    metadata.owner = identity;
    metadata.updated_at = now;
    if (topology.config.sync_mode === "shared") {
      const existingLease = asJsonObject(metadata.lease);
      metadata.lease = {
        ...existingLease,
        owner: identity,
        acquired_at: existingLease.owner === identity ? asOptionalString(existingLease.acquired_at) || now : now,
        heartbeat_at: now,
      };
    }
    return metadata;
  }, { lock: false });
  if (!metadataResult.ok) return { ok: false, claimed: false, error: "Metadata claim patch failed", metadata: metadataResult, commands };
  const statePath = path.join(track.dir, "implement_state.json");
  writeJson(statePath, {
    status: "starting",
    owner: identity,
    track_id: track.track_id,
    last_updated: now,
  });
  return {
    ok: true,
    claimed: true,
    track_id: track.track_id,
    owner: identity,
    previous_hold: hold,
    metadata: metadataResult,
    commands,
  };
}

function setTrackStatus(root: string, trackId: string, status: string): CoreResult {
  if (!VALID_STATUSES.has(status)) {
    return {
      ok: false,
      error: `Invalid status: ${status}`,
      valid_statuses: Array.from(VALID_STATUSES),
    };
  }
  const track = listTracks(root).find((item) => item.track_id === trackId);
  if (!track) {
    return { ok: false, error: `Track not found: ${trackId}` };
  }
  return withTrackLock(root, trackId, () => {
    const metadata = patchJsonFile(track.metadata_path, (current) => ({
      ...current,
      status,
    }), { lock: false });
    if (!metadata.ok) {
      return { ok: false, track_id: trackId, status, stage: "metadata_patch", metadata };
    }
    const regen = regenIndex(root);
    return {
      ok: Boolean(regen.ok),
      track_id: trackId,
      status,
      metadata,
      regen,
    };
  });
}

function markerForStatus(status: string): string {
  const markers: Record<string, string> = {
    pending: " ",
    new: " ",
    in_progress: "~",
    completed: "x",
    blocked: "!",
    skipped: "-",
  };
  return markers[status] || status;
}

function recordTaskResultUnlocked(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const plan = parsePlanFile(track.plan_path);
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };

  const marker = markerForStatus(args.status || "completed");
  const lines = fs.readFileSync(track.plan_path, "utf8").split(/\r?\n/);
  const idx = task.line - 1;
  const line = lines[idx];
  if (!line) return { ok: false, error: `Task line missing at ${task.line}` };
  let nextLine = line.replace(/^(\s*-\s+\[)[ x~!\-](\]\s+)/, `$1${marker}$2`);
  const commitSha = args.commitSha ? String(args.commitSha).trim() : "";
  if (commitSha && !nextLine.includes(commitSha)) {
    nextLine = `${nextLine} (${commitSha.slice(0, 12)})`;
  }
  const recordedAt = utcNow();
  const lastTaskResult = {
    phase_index: phaseIndex,
    task_index: taskIndex,
    task_key: task.task_key,
    status: args.status || "completed",
    commit_sha: commitSha || null,
    repo: args.repo || task.repo || null,
    working_root: args.workingRoot || null,
    recorded_at: recordedAt,
  };
  const metadata = patchJsonFile(track.metadata_path, (current) => {
    if (typeof args.coverage === "number") current.last_coverage = args.coverage;
    if (args.lastTestRun && typeof args.lastTestRun === "object") current.last_test_run = args.lastTestRun;
    current.last_task_result = lastTaskResult;
    return current;
  });
  if (!metadata.ok) {
    return { ok: false, track_id: track.track_id, stage: "metadata_patch", metadata };
  }
  lines[idx] = nextLine;
  try {
    fs.writeFileSync(track.plan_path, `${lines.join("\n").replace(/\n+$/, "")}\n`);
  } catch (error) {
    return { ok: false, track_id: track.track_id, stage: "plan_write", error: errorMessage(error), metadata };
  }
  const metadataValue = asJsonObject(metadata.value);
  const beadsTasks = asJsonObject(metadataValue.beads_tasks);
  return {
    ok: true,
    track_id: track.track_id,
    task_key: task.task_key,
    line: task.line,
    status: args.status || "completed",
    commit_sha: commitSha || null,
    beads_task_id: asOptionalString(beadsTasks[task.task_key]) || null,
    metadata,
  };
}

function recordTaskResult(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  if (args.lock === false) return recordTaskResultUnlocked(root, args);
  return withTrackLock(root, track.track_id, () => recordTaskResultUnlocked(root, { ...args, lock: false }));
}

function completionJournalPath(track: CadreTrack): string {
  return path.join(track.dir, "completion_journal.json");
}

function readCompletionJournal(track: CadreTrack): CompletionJournal {
  const value = readJson<unknown>(completionJournalPath(track), { entries: {} });
  if (!isRecord(value)) return { entries: {} };
  const entries = isRecord(value.entries) ? value.entries : {};
  return {
    ...asJsonObject(value),
    entries: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, asJsonObject(entry)])),
  };
}

function writeCompletionJournal(track: CadreTrack, journal: CompletionJournal): void {
  writeJson(completionJournalPath(track), journal as JsonObject);
}

function patchCompletionJournal(
  track: CadreTrack,
  key: string,
  patcher: (current: JsonObject, journal: CompletionJournal) => JsonObject,
): JsonObject {
  const journal = readCompletionJournal(track);
  const before = journal.entries[key] || {};
  journal.entries[key] = patcher({ ...before }, journal);
  journal.updated_at = utcNow();
  writeCompletionJournal(track, journal);
  return journal.entries[key];
}

function completeTask(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const plan = parsePlanFile(track.plan_path);
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };

  const workingRoot = resolveTaskWorkingRoot(root, track, task, args);
  const coverage = runCoverage(root, args, workingRoot.path);
  const threshold = Number(args.coverageThreshold ?? coverageThreshold(root));
  const allowMissingCoverage = args.allowMissingCoverage === true;
  const allowLowCoverage = args.allowLowCoverage === true;
  if (!coverage.available && !allowMissingCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: coverage.reason || "Coverage command unavailable",
    };
  }
  if (coverage.available && !coverage.ok) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: "Coverage/test command failed; task was not marked complete",
    };
  }
  if (coverage.available && typeof coverage.coverage === "number" && coverage.coverage < threshold && !allowLowCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: `Coverage ${coverage.coverage}% is below required ${threshold}%; task was not marked complete`,
    };
  }

  const metadataBefore = readJson<TrackMetadata>(track.metadata_path, track.metadata) || track.metadata;
  const mappedBeadsTaskId = metadataBefore.beads_tasks ? asOptionalString(metadataBefore.beads_tasks[task.task_key]) || null : null;
  const explicitBeadsTaskId = args.beadsTaskId || args.taskId || null;
  const beadsTaskId = explicitBeadsTaskId || mappedBeadsTaskId;
  const beadsConfigured = Boolean(
    explicitBeadsTaskId ||
    metadataBefore.beads_epic ||
    (metadataBefore.beads_tasks && Object.keys(metadataBefore.beads_tasks).length > 0)
  );
  const beadsAvailable = commandExists("bd", root);
  const beads: BeadsCompletionState = {
    attempted: false,
    required: beadsConfigured,
    available: beadsAvailable,
    note: null,
    close: null,
    skipped_reason: null,
  };
  if (beadsConfigured && !beadsTaskId) {
    return {
      ok: false,
      stage: "beads_mapping",
      blocked: true,
      threshold,
      working_root: workingRoot,
      coverage,
      beads,
      reason: "Track has Beads metadata but this plan task has no mapped Beads task id; task was not marked complete",
    };
  }
  if (beadsTaskId && !beadsAvailable) {
    return {
      ok: false,
      stage: "beads_unavailable",
      blocked: true,
      threshold,
      working_root: workingRoot,
      coverage,
      beads,
      reason: "Beads CLI (bd) is required for this mapped task but is not installed or not on PATH; task was not marked complete",
    };
  }
  if (!beadsConfigured) {
    beads.skipped_reason = "Track has no Beads task mapping";
  } else {
    beads.attempted = true;
  }

  const lastTestRun = {
    command: coverage.command,
    cwd: coverage.cwd || workingRoot.path,
    ok: coverage.available ? coverage.ok : null,
    status: coverage.available ? coverage.status : null,
    signal: coverage.available ? coverage.signal : null,
    coverage: coverage.coverage,
    threshold,
    measured_at: utcNow(),
    allow_missing_coverage: allowMissingCoverage,
    allow_low_coverage: allowLowCoverage,
  };
  const sha = args.commitSha ? String(args.commitSha).slice(0, 12) : "unknown";
  const dedupKey = `key: ${track.track_id}:p${phaseIndex}:t${taskIndex}:${sha.slice(0, 7)}`;
  const journalKey = `${phaseIndex}:${taskIndex}:${sha}`;
  const recordState = (): CoreResult => {
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
    const taskResult = recordTaskResultUnlocked(root, {
      trackId: args.trackId,
      phaseIndex,
      taskIndex,
      status: args.status || "completed",
      commitSha: args.commitSha,
      coverage: coverage.coverage,
      repo: workingRoot.repo,
      workingRoot: path.relative(root, workingRoot.path) || ".",
      lastTestRun,
    });
    if (!taskResult.ok) {
      patchCompletionJournal(track, journalKey, (current) => ({
        ...current,
        stage: "record_task_result_failed",
        error: taskResult.error || asOptionalString(taskResult.stage) || "record task result failed",
      }));
      return { ok: false, stage: "record_task_result", threshold, working_root: workingRoot, coverage, task_result: taskResult, beads, journal: entry };
    }
    const taskResultJson = asJsonObject(taskResult);
    const recordedEntry = patchCompletionJournal(track, journalKey, (current) => ({
      ...current,
      stage: "state_recorded",
      state_recorded_at: utcNow(),
      task_result: {
        task_key: taskResultJson.task_key,
        commit_sha: taskResultJson.commit_sha,
        line: taskResultJson.line,
      },
    }));
    return { ok: true, task_result: taskResult, journal: recordedEntry };
  };
  const stateResult = args.lock === false
    ? recordState()
    : withTrackLock(root, track.track_id, recordState);
  if (!stateResult.ok) return { ...stateResult, threshold, working_root: workingRoot, coverage, beads };
  const stateTaskResult = asJsonObject(stateResult.task_result);

  if (beadsTaskId) {
    const latest = readCompletionJournal(track).entries[journalKey] || {};
    if (!latest.beads_note_written) {
      const note = [
        dedupKey,
        `COMPLETED: ${task.title}`,
        `COMMIT: ${sha}`,
        `COVERAGE: ${coverage.coverage == null ? "unmeasured" : `${coverage.coverage}%`}`,
        args.summary ? `SUMMARY: ${args.summary}` : null,
      ].filter(Boolean).join("\n");
      const noteResult = beadsTaskWrite(root, { operation: "note", id: beadsTaskId, note, dedupKey });
      beads.note = noteResult;
      if (!noteResult.ok) return { ok: false, stage: "beads_note", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads, journal: latest };
      const writeNote = () => patchCompletionJournal(track, journalKey, (current) => ({
        ...current,
        stage: "beads_note_written",
        beads_note_written: true,
        beads_note_at: utcNow(),
      }));
      if (args.lock === false) writeNote();
      else {
        const noteJournal = withTrackLock(root, track.track_id, writeNote);
        if (!noteJournal.ok) return { ...noteJournal, stage: "journal_note", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads };
      }
    } else {
      beads.note = { ok: true, skipped: true, reason: "completion journal already recorded Beads note" };
    }

    const afterNote = readCompletionJournal(track).entries[journalKey] || {};
    if (!afterNote.beads_close_written) {
      const closeResult = beadsTaskWrite(root, {
        operation: "close",
        id: beadsTaskId,
        continue: true,
        reason: args.reason || `commit: ${args.commitSha || "completed"}`,
      });
      beads.close = closeResult;
      if (!closeResult.ok) return { ok: false, stage: "beads_close", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads, journal: afterNote };
      const writeClose = () => patchCompletionJournal(track, journalKey, (current) => ({
        ...current,
        stage: "beads_closed",
        beads_close_written: true,
        beads_close_at: utcNow(),
      }));
      if (args.lock === false) writeClose();
      else {
        const closeJournal = withTrackLock(root, track.track_id, writeClose);
        if (!closeJournal.ok) return { ...closeJournal, stage: "journal_close", threshold, working_root: workingRoot, coverage, task_result: stateTaskResult, beads };
      }
    } else {
      beads.close = { ok: true, skipped: true, reason: "completion journal already recorded Beads close" };
    }
  }

  const markComplete = () => patchCompletionJournal(track, journalKey, (current) => ({
    ...current,
    stage: "completed",
    completed_at: current.completed_at || utcNow(),
  }));
  const completedJournal = args.lock === false
    ? markComplete()
    : withTrackLock(root, track.track_id, markComplete);

  return {
    ok: true,
    track_id: track.track_id,
    task_key: stateTaskResult.task_key,
    working_root: workingRoot,
    threshold,
    coverage,
    task_result: stateTaskResult,
    beads,
    journal: completedJournal.ok === false ? completedJournal : completedJournal.value || completedJournal,
  };
}

function recordParallelWorker(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  return withTrackLock(root, track.track_id, () => recordParallelWorkerUnlocked(root, track, args));
}

function recordParallelWorkerUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const workerId = args.workerId || args.worker_id;
  if (!workerId) return { ok: false, error: "workerId is required" };
  const status = args.status || "awaiting_merge";
  const valid = new Set(["in_progress", "awaiting_merge", "merged", "conflict", "failed"]);
  if (!valid.has(status)) return { ok: false, error: `Invalid parallel worker status: ${status}` };

  const statePath = path.join(track.dir, "parallel_state.json");
  const existing = readJson<unknown>(statePath, {
    track_id: track.track_id,
    execution_mode: "parallel",
    started_at: utcNow(),
    workers: [],
  });
  const existingObject = isRecord(existing) ? asJsonObject(existing) : {};
  const state: ParallelState = {
    ...existingObject,
    track_id: asOptionalString(existingObject.track_id) || track.track_id,
    execution_mode: asOptionalString(existingObject.execution_mode) || "parallel",
    started_at: asOptionalString(existingObject.started_at) || utcNow(),
    workers: Array.isArray(existingObject.workers)
      ? existingObject.workers.map((worker) => asJsonObject(worker) as unknown as ParallelWorker)
      : [],
  };
  const now = utcNow();
  const index = state.workers.findIndex((worker) => worker.worker_id === workerId);
  const existingWorker = index >= 0 ? state.workers[index] : undefined;
  const nextWorker: ParallelWorker = {
    ...(existingWorker || {}),
    worker_id: workerId,
    status,
    phase_index: args.phaseIndex ?? existingWorker?.phase_index ?? null,
    task_index: args.taskIndex ?? existingWorker?.task_index ?? null,
    task_key: args.phaseIndex && args.taskIndex ? `phase${args.phaseIndex}_task${args.taskIndex}` : existingWorker?.task_key ?? null,
    beads_task_id: args.beadsTaskId || args.taskId || existingWorker?.beads_task_id || null,
    repo: args.repo || existingWorker?.repo || null,
    worktree: args.worktree || existingWorker?.worktree || null,
    branch: args.branch || existingWorker?.branch || null,
    commit_sha: args.commitSha || existingWorker?.commit_sha || null,
    coverage: typeof args.coverage === "number" ? args.coverage : existingWorker?.coverage ?? null,
    evidence: args.evidence || existingWorker?.evidence || null,
    updated_at: now,
  };
  if (status === "awaiting_merge" && !nextWorker.completed_at) nextWorker.completed_at = now;
  if (status === "merged") nextWorker.merged_at = now;
  if (status === "conflict") nextWorker.conflict_at = now;
  if (index >= 0) state.workers[index] = nextWorker;
  else state.workers.push(nextWorker);
  state.completed_workers = state.workers.filter((worker) => ["awaiting_merge", "merged"].includes(worker.status)).length;
  state.merged_workers = state.workers.filter((worker) => worker.status === "merged").length;
  state.conflict_workers = state.workers.filter((worker) => worker.status === "conflict").length;
  state.updated_at = now;

  let completion: CoreResult | null = null;
  if (args.completeTask === true) {
    completion = completeTask(root, {
      trackId: track.track_id,
      phaseIndex: args.phaseIndex,
      taskIndex: args.taskIndex,
      commitSha: args.commitSha,
      command: args.command,
      timeoutMs: args.timeoutMs,
      coverageThreshold: args.coverageThreshold,
      allowMissingCoverage: args.allowMissingCoverage,
      allowLowCoverage: args.allowLowCoverage,
      summary: args.summary || `parallel worker ${workerId}`,
      reason: args.reason || `merged ${workerId}`,
      beadsTaskId: nextWorker.beads_task_id,
      repo: nextWorker.repo || args.repo,
      workingRoot: args.workingRoot || nextWorker.worktree || args.worktree,
      lock: false,
    });
    if (!completion.ok) return { ok: false, stage: "complete_task", state_path: statePath, worker: nextWorker, completion };
  }

  writeJson(statePath, state as JsonObject);
  return {
    ok: true,
    track_id: track.track_id,
    state_path: path.relative(root, statePath),
    worker: nextWorker,
    completion,
    summary: {
      total_workers: state.workers.length,
      completed_workers: state.completed_workers,
      merged_workers: state.merged_workers,
      conflict_workers: state.conflict_workers,
    },
  };
}

function recordReview(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  return withTrackLock(root, track.track_id, () => recordReviewUnlocked(root, track, args));
}

function recordReviewUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const verdict = args.verdict || "";
  if (!["approved", "changes_requested"].includes(verdict)) {
    return { ok: false, error: `Invalid review verdict: ${verdict}` };
  }
  const reviewer = args.reviewer || gitIdentity(root);
  const pins = reviewedShasForTrack(root, track, args);
  const metadata = patchJsonFile(track.metadata_path, (current) => {
    const existing = asJsonObject(current.review);
    const existingReviewer = asOptionalString(existing.reviewer);
    const existingVerdict = asOptionalString(existing.verdict);
    const existingBlockingCount = Number(existing.blocking_count || 0);
    if (
      verdict === "approved" &&
      args.allowOverride !== true &&
      existingReviewer &&
      existingReviewer !== reviewer &&
      (existingVerdict === "changes_requested" || existingBlockingCount > 0)
    ) {
      throw new Error("Approval would override another reviewer's open changes_requested verdict");
    }
    current.review = {
      verdict,
      blocking_count: Number(args.blockingCount || 0),
      date: args.date || utcNow(),
      reviewer: reviewer || null,
      coverage: args.coverage ?? current.last_coverage ?? null,
      self_reviewed: Boolean(reviewer && current.owner && reviewer === current.owner),
      reviewed_sha: asOptionalString(pins.reviewed_sha) || null,
      reviewed_shas: asJsonObject(pins.reviewed_shas),
      review_seq: Number(existing.review_seq || 0) + 1,
    };
    return current;
  }, { lock: false });
  if (!metadata.ok) {
    return {
      ok: false,
      track_id: track.track_id,
      stage: "metadata_patch",
      error: metadata.error,
      requires_override: /override another reviewer/.test(metadata.error || ""),
      metadata,
    };
  }
  const gate = reviewGate(root, track.track_id, args);
  return { ok: true, track_id: track.track_id, review: asJsonObject(metadata.value).review, metadata, gate };
}

function syncControlPlane(root: string, args: RuntimeArgs = {}): CoreResult {
  const topology = loadTopology(root);
  if (topology.config.sync_mode !== "shared") {
    return { ok: true, skipped: true, reason: "sync_mode is not shared", commands: [] };
  }
  const mode = args.mode || "pre";
  const remote = asOptionalString(topology.config.control_remote) || "origin";
  const branch = asOptionalString(topology.config.control_branch) || "main";
  const commands: CommandResult[] = [];
  commands.push(runCommand("git", ["config", "merge.ours.driver", "true"], { cwd: root }));
  const safety = controlPlaneSyncSafety(root, mode, remote, branch);
  if (!safety.ok) {
    return { ok: false, mode, remote, branch, safety, commands };
  }
  if (mode === "pre") {
    commands.push(runCommand("git", ["pull", "--rebase", remote, branch], { cwd: root }));
    if (commandExists("bd", root)) commands.push(runCommand("bd", ["dolt", "pull"], { cwd: root }));
  } else if (mode === "post") {
    if (commandExists("bd", root)) commands.push(runCommand("bd", ["dolt", "push"], { cwd: root }));
    commands.push(runCommand("git", ["push", remote, branch], { cwd: root }));
  } else {
    return { ok: false, error: `Invalid sync mode: ${mode}`, commands };
  }
  return { ok: commands.every((cmd) => cmd.ok), mode, remote, branch, safety, commands };
}

function testCoverage(root: string, args: RuntimeArgs = {}): CoreResult {
  let track: CadreTrack | null = null;
  let task: PlanTask | null = null;
  let workingRoot: WorkingRoot = {
    repo: args.repo || ".",
    path: args.workingRoot ? path.resolve(root, args.workingRoot) : root,
    source: args.workingRoot ? "argument.workingRoot" : "project-root",
  };
  if (args.trackId) {
    track = findTrack(root, args.trackId);
    if (!track) {
      return { ok: false, available: false, error: `Track not found: ${args.trackId}` };
    }
    if (args.phaseIndex != null && args.taskIndex != null) {
      const plan = parsePlanFile(track.plan_path);
      const phase = (plan.phases || []).find((item) => item.phase_index === Number(args.phaseIndex));
      task = phase?.tasks.find((item) => item.task_index === Number(args.taskIndex)) || null;
    }
    workingRoot = resolveTaskWorkingRoot(root, track, task, args);
  }
  const coverageRun = runCoverage(root, args, workingRoot.path);
  if (!coverageRun.available) return coverageRun;
  const { command, coverage } = coverageRun;
  let task_result: CoreResult | null = null;
  let metadata: CoreResult | null = null;
  if (track) {
    const writeCoverage = () => {
      metadata = patchJsonFile(track.metadata_path, (current) => {
        current.last_test_run = {
          command,
          cwd: coverageRun.cwd || workingRoot.path,
          ok: coverageRun.ok,
          status: coverageRun.status,
          signal: coverageRun.signal,
          coverage,
          measured_at: utcNow(),
        };
        if (typeof coverage === "number") current.last_coverage = coverage;
        return current;
      }, { lock: false });
      return metadata;
    };
    const metadataWrite = withTrackLock(root, track.track_id, writeCoverage);
    if (!metadataWrite.ok) return { ok: false, available: true, command, coverage, working_root: workingRoot, stage: "metadata_lock", metadata: metadataWrite };
    const metadataResult = metadata ?? metadataWrite;
    if (!metadataResult.ok) {
      return { ok: false, available: true, command, coverage, working_root: workingRoot, stage: "metadata_patch", metadata: metadataResult };
    }
    if (args.phaseIndex != null && args.taskIndex != null) {
      task_result = recordTaskResult(root, {
        trackId: args.trackId,
        phaseIndex: args.phaseIndex,
        taskIndex: args.taskIndex,
        status: args.status || (coverageRun.ok ? "completed" : "blocked"),
        commitSha: args.commitSha,
        coverage,
        repo: workingRoot.repo,
        workingRoot: path.relative(root, workingRoot.path) || ".",
      });
    }
  }
  return {
    ok: coverageRun.ok,
    available: true,
    command,
    cwd: coverageRun.cwd,
    status: coverageRun.status,
    signal: coverageRun.signal,
    coverage,
    coverage_source: coverageRun.coverage_source,
    timed_out: coverageRun.signal === "SIGTERM" || coverageRun.signal === "SIGKILL",
    stdout_tail: coverageRun.stdout_tail,
    stderr_tail: coverageRun.stderr_tail,
    working_root: workingRoot,
    metadata,
    task_result,
  };
}

function configuredMachineGateCommand(root: string, args: RuntimeArgs = {}, workingRoot = root): string | null {
  const explicit = args.machineCommand || args.machine_command || args.command;
  if (explicit) return String(explicit);
  const config = loadTopology(root).config || {};
  for (const key of [
    "review_machine_gate_command",
    "machine_gate_command",
    "review_check_command",
    "typecheck_command",
    "build_command",
    "check_command",
  ]) {
    if (typeof config[key] === "string" && config[key].trim()) return config[key].trim();
  }
  const pkg = loadPackageJson(workingRoot);
  const scripts = pkg ? asJsonObject(pkg.scripts) : {};
  if (Object.keys(scripts).length > 0) {
    for (const name of ["typecheck", "check", "build", "lint"]) {
      if (scripts[name]) {
        if (fileExists(path.join(workingRoot, "pnpm-lock.yaml"))) return `pnpm ${name}`;
        if (fileExists(path.join(workingRoot, "yarn.lock"))) return `yarn ${name}`;
        return `npm run ${name}`;
      }
    }
  }
  return null;
}

function runMachineGate(root: string, args: RuntimeArgs = {}, workingRoot = root): CoreResult {
  const command = configuredMachineGateCommand(root, args, workingRoot);
  if (!command) {
    return {
      ok: true,
      available: false,
      reason: "No review machine-gate command configured or discovered",
      hints: [
        "Pass { machineCommand } explicitly",
        "Set cadre/config.json review_machine_gate_command",
        "Add a package script named typecheck, check, build, or lint",
      ],
    };
  }
  const timeoutMs = Number(args.timeoutMs || 10 * 60 * 1000);
  const result = runCommand(command, [], {
    cwd: workingRoot,
    shell: true,
    timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });
  return {
    ok: result.ok,
    available: true,
    command,
    cwd: workingRoot,
    status: result.status,
    signal: result.signal,
    timed_out: result.signal === "SIGTERM" || result.signal === "SIGKILL",
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
  };
}

function reviewMachineGate(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = args.trackId || args.track_id || null;
  const track = trackId ? findTrack(root, trackId) : null;
  if (trackId && !track) return { ok: false, error: `Track not found: ${trackId}` };
  const entries: RepoExecutionEntry[] = track
    ? repoEntriesForTrack(root, track, args)
    : [{
      repo: args.repo || ".",
      root: args.workingRoot ? path.resolve(root, args.workingRoot) : root,
      path: args.workingRoot || ".",
      source: args.workingRoot ? "argument.workingRoot" : "project-root",
    }];
  const results: CoreResult[] = entries.map((entry) => {
    const gate = runMachineGate(root, args, entry.root);
    return {
      repo: entry.repo,
      path: entry.path,
      source: entry.source,
      ...gate,
    };
  });
  const blocking = results.filter((result) => result.available === true && !result.ok);
  return {
    ok: blocking.length === 0,
    available: results.some((result) => result.available === true),
    track_id: trackId,
    results,
    blocking_count: blocking.length,
  };
}

function providerFromConfig(root: string, args: RuntimeArgs = {}): string {
  if (args.provider) return args.provider;
  const config = loadTopology(root).config || {};
  const configured = asOptionalString(config.pr_provider);
  if (configured) return configured;
  const remote = runCommand("git", ["remote", "get-url", "origin"], { cwd: root });
  const url = `${remote.stdout}\n${remote.stderr}`.toLowerCase();
  if (url.includes("gitlab")) return "gitlab";
  return "github";
}

function prCiStatus(root: string, args: RuntimeArgs = {}): CoreResult {
  const provider = providerFromConfig(root, args);
  const track = args.trackId ? findTrack(root, args.trackId) : null;
  const branch = args.branch || (track && (track.metadata.git_branch || `track/${track.track_id}`)) || null;
  if (provider === "github") {
    if (!commandExists("gh", root)) {
      return { ok: false, available: false, provider, reason: "GitHub CLI (gh) is not installed or not on PATH" };
    }
    const target = args.pr || args.prNumber || branch;
    if (!target) return { ok: false, available: true, provider, reason: "No PR number or branch supplied" };
    const fields = [
      "number",
      "url",
      "state",
      "title",
      "headRefName",
      "headRefOid",
      "baseRefName",
      "reviewDecision",
      "mergeStateStatus",
      "statusCheckRollup",
    ].join(",");
    const result = runCommand("gh", ["pr", "view", String(target), "--json", fields], { cwd: root });
    let data: unknown = null;
    try {
      data = JSON.parse(result.stdout || "{}") as unknown;
    } catch {
      // Keep raw output below.
    }
    return {
      ok: result.ok,
      available: true,
      provider,
      target,
      branch,
      status: result.status,
      pr: data,
      stdout_tail: result.stdout.slice(-2000),
      stderr_tail: result.stderr.slice(-2000),
    };
  }
  if (provider === "gitlab") {
    if (!commandExists("glab", root)) {
      return { ok: false, available: false, provider, reason: "GitLab CLI (glab) is not installed or not on PATH" };
    }
    const target = args.pr || args.mr || args.prNumber || branch;
    if (!target) return { ok: false, available: true, provider, reason: "No MR number or branch supplied" };
    const result = runCommand("glab", ["mr", "view", String(target), "--output", "json"], { cwd: root });
    let data: unknown = null;
    try {
      data = JSON.parse(result.stdout || "{}") as unknown;
    } catch {
      // Keep raw output below.
    }
    return {
      ok: result.ok,
      available: true,
      provider,
      target,
      branch,
      status: result.status,
      mr: data,
      stdout_tail: result.stdout.slice(-2000),
      stderr_tail: result.stderr.slice(-2000),
    };
  }
  return { ok: false, available: false, provider, reason: `Unsupported provider: ${provider}` };
}

function diffSurface(root: string, base: string, head: string): DiffSurface {
  const range = `${base}...${head}`;
  const stat = runCommand("git", ["diff", "--stat", range], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const names = runCommand("git", ["diff", "--name-only", range], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return {
    ok: stat.ok || names.ok,
    base,
    head,
    stat: stat.stdout.trim(),
    files: names.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    errors: [stat.stderr, names.stderr].filter(Boolean).join("\n").trim(),
  };
}

function scanReviewTodos(root: string, files: string[], limit = 100): TodoFinding[] {
  const findings: TodoFinding[] = [];
  const patterns = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /\bstub\b/i,
    /throw new Error\(["']not implemented/i,
  ];
  for (const file of files || []) {
    if (isIgnoredRepoMapFile(file)) continue;
    const abs = path.join(root, file);
    if (!fileExists(abs)) continue;
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.size > 1024 * 1024) continue;
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length && findings.length < limit; index += 1) {
      const line = lines[index] || "";
      if (patterns.some((pattern) => pattern.test(line))) {
        findings.push({ file, line: index + 1, snippet: line.trim().slice(0, 180) });
      }
    }
  }
  return findings;
}

function reviewAssist(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = args.trackId || args.track_id;
  if (!trackId) return { ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  if (!context.ok) return context;
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const plan = parsePlanFile(track.plan_path);
  const base = args.base || "main";
  const head = args.head || track.metadata.git_branch || "HEAD";
  const repoEntries = repoEntriesForTrack(root, track, args);
  const repoDiffs = repoEntries.map((entry) => ({
    repo: entry.repo,
    path: entry.path,
    cwd: entry.root,
    source: entry.source,
    ...diffSurface(entry.root, entry.base || base, entry.head || head),
  }));
  const diff = repoDiffs.find((entry) => entry.repo === ".") || diffSurface(root, base, head);
  const incompleteTasks: JsonObject[] = [];
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      if (task.marker !== "x" && task.marker !== "-") {
        incompleteTasks.push({
          phase: phase.phase_index,
          task: task.task_index,
          task_key: task.task_key,
          title: task.title,
          marker: task.marker,
          repo: task.repo || null,
        });
      }
    }
  }
  const todoLimit = Number(args.todoLimit || 100);
  const repoTodos = repoDiffs.map((entry) => ({
    repo: entry.repo,
    path: entry.path,
    cwd: entry.cwd,
    todos: scanReviewTodos(entry.cwd || root, entry.files, todoLimit),
  }));
  const todos = repoTodos.flatMap((entry) => entry.todos.map((todo) => ({ ...todo, repo: entry.repo }))).slice(0, todoLimit);
  const lsp = args.includeLsp === false
    ? null
    : (args.lspResult || args.lsp_result || lspReview(root, { base, head, config: args.config }));
  const machineGate = args.includeMachine === false ? null : reviewMachineGate(root, args);
  const lspObject = asJsonObject(lsp);
  const machineGateObject = asJsonObject(machineGate);
  const blocking: string[] = [];
  if (incompleteTasks.length > 0) blocking.push(`${incompleteTasks.length} plan task(s) are not completed or skipped`);
  if (todos.length > 0) blocking.push(`${todos.length} TODO/FIXME/stub marker(s) found in changed files`);
  if (track.metadata.last_coverage == null) blocking.push("No measured coverage recorded on the track");
  if (lsp && lspObject.available !== false && Array.isArray(lspObject.findings)) {
    const lspBlocking = asArray(lspObject.findings).filter((finding) => finding.severity === "blocking" || finding.blocking === true);
    if (lspBlocking.length > 0) blocking.push(`${lspBlocking.length} blocking LSP/code-intelligence finding(s)`);
  }
  const machineBlockingCount = asNumber(machineGateObject.blocking_count);
  if (machineGate && machineBlockingCount > 0) {
    blocking.push(`${machineBlockingCount} machine gate check(s) failed`);
  }

  return {
    ok: true,
    root,
    track_id: trackId,
    base,
    head,
    diff,
    repo_diffs: repoDiffs,
    task_counts: context.task_counts,
    incomplete_tasks: incompleteTasks,
    coverage: track.metadata.last_coverage ?? null,
    todos,
    repo_todos: repoTodos,
    lsp,
    machine_gate: machineGate,
    suggested_verdict: blocking.length === 0 ? "approved" : "changes_requested",
    blocking_reasons: blocking,
  };
}

function isIgnoredRepoMapFile(file: unknown): boolean {
  const normalized = String(file || "").replace(/\\/g, "/");
  if (!normalized) return true;
  if (normalized.startsWith(".agents/")) return true;
  if (normalized.startsWith(".claude/")) return true;
  if (normalized.startsWith(".claude-plugin/")) return true;
  if (normalized.startsWith("plugins/cadre/")) return true;
  if (normalized.startsWith("plugins/cadre-claude/")) return true;
  return normalized
    .split("/")
    .some((part) => [".git", ".beads", "node_modules", "dist", "build", "coverage"].includes(part));
}

function gitTrackedFiles(root: string): string[] {
  const result = runCommand("git", ["ls-files"], { cwd: root });
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !isIgnoredRepoMapFile(file));
}

function languageForFile(file: string): string | null {
  return {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rb": "ruby",
    ".php": "php",
  }[path.extname(file)] || null;
}

function extractRepoSymbols(root: string, file: string, limitPerFile = 40): RepoSymbol[] {
  const abs = path.join(root, file);
  if (!fileExists(abs)) return [];
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return [];
  }
  if (stat.size > 1024 * 1024) return [];
  const language = languageForFile(file);
  if (!language) return [];
  const text = fs.readFileSync(abs, "utf8");
  const patterns = [
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g,
    /\b(?:export\s+)?(?:class|interface|type|enum|struct)\s+([A-Za-z_$][\w$]*)\b/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g,
    /^\s*def\s+([A-Za-z_][\w]*)\b/gm,
    /^\s*class\s+([A-Za-z_][\w]*)\b/gm,
    /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\b/gm,
  ];
  const symbols: RepoSymbol[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) && symbols.length < limitPerFile) {
      const prefix = text.slice(0, match.index);
      const line = prefix.split(/\r?\n/).length;
      const name = match[1];
      if (name) symbols.push({ name, file, line, language });
    }
  }
  return symbols;
}

function repoMap(root: string, args: RuntimeArgs = {}): CoreResult {
  const limit = Number(args.limit || 200);
  const symbol = args.symbol ? String(args.symbol) : null;
  if (symbol) {
    const result = runCommand("git", ["grep", "-n", "-w", "--", symbol], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    const matches = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !isIgnoredRepoMapFile(line.split(":")[0] || ""))
      .slice(0, limit)
      .map((line) => {
        const [file, lineNo, ...rest] = line.split(":");
        return { file: file || "", line: Number(lineNo), snippet: rest.join(":").trim().slice(0, 180) };
      });
    return { ok: result.ok || matches.length > 0, root, symbol, matches, truncated: matches.length >= limit };
  }
  const files = gitTrackedFiles(root);
  const byLanguage: Record<string, number> = {};
  const symbols: RepoSymbol[] = [];
  for (const file of files) {
    const language = languageForFile(file);
    if (language) byLanguage[language] = (byLanguage[language] || 0) + 1;
    if (symbols.length < limit) symbols.push(...extractRepoSymbols(root, file, 12));
    if (symbols.length > limit) symbols.length = limit;
  }
  return {
    ok: true,
    root,
    files: files.length,
    by_language: Object.fromEntries(Object.entries(byLanguage).sort()),
    symbols,
    truncated: symbols.length >= limit,
  };
}

function lspImpact(root: string, args: RuntimeArgs = {}): CoreResult {
  const limit = Number(args.limit || 50);
  const symbols = Array.isArray(args.symbols)
    ? args.symbols
    : (args.symbol ? [args.symbol] : []);
  const files = Array.isArray(args.files) ? args.files : [];
  const symbolResults: Record<string, CoreResult> = {};
  for (const symbol of symbols.filter(Boolean)) {
    symbolResults[symbol] = repoMap(root, { symbol, limit });
  }
  const fileSymbols: Record<string, RepoSymbol[]> = {};
  for (const file of files) {
    if (isIgnoredRepoMapFile(file)) continue;
    fileSymbols[file] = extractRepoSymbols(root, file, limit);
  }
  const review = args.lspResult || args.lsp_result
    ? (args.lspResult || args.lsp_result)
    : args.base || args.head
      ? lspReview(root, { base: args.base || "main", head: args.head || "HEAD", config: args.config })
    : null;
  return {
    ok: true,
    root,
    symbols: symbolResults,
    files: fileSymbols,
    review,
  };
}

function lspConfigStatus(root: string): CoreResult {
  const configPath = path.join(root, "cadre", "lsp.json");
  const config = readJson<unknown>(configPath, null);
  if (!config) {
    return {
      configured: false,
      path: path.relative(root, configPath),
      servers: [],
      missing: [],
    };
  }
  const configObject = asJsonObject(config);
  const servers = Array.isArray(configObject.servers) ? configObject.servers.map((server) => asJsonObject(server)) : [];
  return {
    configured: true,
    path: path.relative(root, configPath),
    servers: servers.map((server) => {
      const command = asOptionalString(server.command);
      return {
        id: asOptionalString(server.id) || command || "unknown",
        command: command || null,
        available: command ? commandExists(command, root) : false,
      };
    }),
    missing: servers
      .filter((server) => {
        const command = asOptionalString(server.command);
        return !command || !commandExists(command, root);
      })
      .map((server) => asOptionalString(server.id) || asOptionalString(server.command) || "unknown"),
  };
}

function mergeDriverStatus(root: string): CoreResult {
  const result = runCommand("git", ["config", "merge.ours.driver"], { cwd: root });
  return {
    configured: result.ok && result.stdout.trim() !== "",
    value: result.stdout.trim() || null,
  };
}

function doctor(root: string, options: RuntimeArgs = {}): CoreResult {
  const candidateRoot = path.resolve(root || process.cwd());
  const generatedCheck = path.join(candidateRoot, "scripts", "generate-skills.sh");
  const lspStatus = lspConfigStatus(candidateRoot);
  const lspMissing = asStringArray(lspStatus.missing);
  const checks = {
    mcp_runtime: { ok: true, server: "cadre" },
    cadre_project: {
      ok: Boolean(options.hasCadreProject || isCadreProjectRoot(candidateRoot)),
      root: candidateRoot,
      markers: [
        "cadre/tracks.md",
        "cadre/setup_state.json",
        "cadre/product.md",
        "cadre/config.json",
        "cadre/beads.json",
        "cadre/lsp.json",
      ].filter((name) => fileExists(path.join(candidateRoot, name))),
    },
    git: {
      available: commandExists("git", candidateRoot),
      identity: gitIdentity(candidateRoot),
      merge_ours: mergeDriverStatus(candidateRoot),
    },
    beads: {
      available: commandExists("bd", candidateRoot),
      config_present: fileExists(path.join(candidateRoot, "cadre", "beads.json")),
    },
    lsp: lspStatus,
    providers: {
      gh: commandExists("gh", candidateRoot),
      glab: commandExists("glab", candidateRoot),
    },
    generated_bundles: {
      check_available: fileExists(generatedCheck),
      command: fileExists(generatedCheck) ? "bash scripts/generate-skills.sh --check" : null,
    },
  };
  const warnings: string[] = [];
  if (!checks.cadre_project.ok) {
    warnings.push("No Cadre project markers found. This is fine for the Cadre harness/source repo, but project-scoped Cadre workflows need setup first.");
  }
  if (checks.cadre_project.ok && !checks.beads.available) {
    warnings.push("Beads CLI (bd) is not available; Cadre project workflows require it.");
  }
  if (checks.lsp.configured && lspMissing.length > 0) {
    warnings.push(`LSP config exists but missing server commands: ${lspMissing.join(", ")}`);
  }
  return {
    ok: warnings.length === 0,
    root: candidateRoot,
    checks,
    warnings,
  };
}

function beadsTaskWrite(root: string, args: RuntimeArgs = {}): CoreResult {
  if (!commandExists("bd", root)) {
    return { ok: false, available: false, reason: "Beads CLI (bd) is not installed or not on PATH" };
  }
  const op = args.operation;
  const id = args.id || args.taskId || args.issueId;
  const commands: CommandResult[] = [];
  const runBd = (bdArgs: string[]): CommandResult => {
    const result = runCommand("bd", bdArgs, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    commands.push(result);
    return result;
  };
  if (op === "ready") {
    const bdArgs = ["ready", "--json"];
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    runBd(bdArgs);
  } else if (op === "list") {
    const bdArgs = ["list", "--json"];
    if (args.status) bdArgs.push("--status", String(args.status));
    if (args.label) bdArgs.push("--label", String(args.label));
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    runBd(bdArgs);
  } else if (op === "show") {
    if (!id) return { ok: false, available: true, error: "id is required for show" };
    const bdArgs = ["show", String(id)];
    if (args.long === true) bdArgs.push("--long");
    bdArgs.push("--json");
    runBd(bdArgs);
  } else if (op === "update") {
    if (!id) return { ok: false, available: true, error: "id is required for update" };
    const bdArgs = ["update", String(id), "--json"];
    if (args.status) bdArgs.push("--status", String(args.status));
    if (Object.prototype.hasOwnProperty.call(args, "assignee")) bdArgs.push("--assignee", String(args.assignee || ""));
    if (args.priority) bdArgs.push("--priority", String(args.priority));
    if (args.notes) bdArgs.push("--notes", String(args.notes));
    runBd(bdArgs);
  } else if (op === "note") {
    if (!id || !args.note) return { ok: false, available: true, error: "id and note are required for note" };
    if (args.dedupKey) {
      const show = runCommand("bd", ["show", String(id), "--long", "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
      commands.push(show);
      if (show.ok && `${show.stdout}\n${show.stderr}`.includes(String(args.dedupKey))) {
        return { ok: true, available: true, operation: op, skipped: true, reason: "dedupKey already present", commands, json: parseCommandJson(show) };
      }
    }
    runBd(["note", String(id), String(args.note), "--json"]);
  } else if (op === "close") {
    if (!id) return { ok: false, available: true, error: "id is required for close" };
    const bdArgs = ["close", String(id), "--reason", String(args.reason || "Task completed"), "--json"];
    if (args.continue === true) bdArgs.splice(2, 0, "--continue");
    runBd(bdArgs);
  } else if (op === "label_add" || op === "label_remove") {
    if (!id || !args.label) return { ok: false, available: true, error: "id and label are required for label operations" };
    runBd(["label", op === "label_add" ? "add" : "remove", String(id), String(args.label), "--json"]);
  } else if (op === "dep_add" || op === "dep_remove") {
    if (!id || !args.dependsOn) return { ok: false, available: true, error: "id and dependsOn are required for dependency operations" };
    runBd(["dep", op === "dep_add" ? "add" : "remove", String(id), String(args.dependsOn), "--json"]);
  } else if (op === "create") {
    if (!args.title) return { ok: false, available: true, error: "title is required for create" };
    const bdArgs = ["create", String(args.title), "--json"];
    if (args.id) bdArgs.push("--id", String(args.id));
    if (args.type) bdArgs.push("-t", String(args.type));
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    if (args.priority) bdArgs.push("-p", String(args.priority));
    if (args.deps) bdArgs.push("--deps", String(args.deps));
    if (args.labels) bdArgs.push("--labels", Array.isArray(args.labels) ? args.labels.join(",") : String(args.labels));
    if (args.design) bdArgs.push("--design", String(args.design));
    if (args.acceptance) bdArgs.push("--acceptance", String(args.acceptance));
    if (args.ephemeral === true) bdArgs.push("--ephemeral");
    runBd(bdArgs);
  } else if (op === "mail_send") {
    if (!args.to || !args.subject) return { ok: false, available: true, error: "to and subject are required for mail_send" };
    const bdArgs = ["mail", "send", String(args.to), "--subject", String(args.subject), "--json"];
    if (args.body) bdArgs.push("--body", String(args.body));
    runBd(bdArgs);
  } else if (op === "formula_list") {
    runBd(["formula", "list", "--json"]);
  } else if (op === "formula_show") {
    if (!args.name) return { ok: false, available: true, error: "name is required for formula_show" };
    runBd(["formula", "show", String(args.name), "--json"]);
  } else if (op === "compact") {
    if (args.all === true) runBd(["admin", "compact", "--auto", "--all"]);
    else if (id) runBd(["admin", "compact", "--auto", "--id", String(id)]);
    else return { ok: false, available: true, error: "id or all=true is required for compact" };
  } else if (op === "rules_compact") {
    runBd(["rules", "compact", "--auto"]);
  } else if (op === "dolt_pull" || op === "dolt_push") {
    runBd(["dolt", op === "dolt_pull" ? "pull" : "push"]);
  } else if (op === "sql") {
    if (!args.sql) return { ok: false, available: true, error: "sql is required for sql" };
    runBd(["sql", String(args.sql)]);
  } else if (op === "worktree_create") {
    if (!args.path || !args.branch) return { ok: false, available: true, error: "path and branch are required for worktree_create" };
    runBd(["worktree", "create", String(args.path), "--branch", String(args.branch)]);
  } else if (op === "worktree_remove") {
    if (!args.path) return { ok: false, available: true, error: "path is required for worktree_remove" };
    const bdArgs = ["worktree", "remove", String(args.path)];
    if (args.force === true) bdArgs.push("--force");
    runBd(bdArgs);
  } else {
    return {
      ok: false,
      available: true,
      error: `Unsupported Beads operation: ${op}`,
      operations: [
        "ready", "list", "show", "update", "note", "close",
        "label_add", "label_remove", "dep_add", "dep_remove", "create",
        "mail_send", "formula_list", "formula_show", "compact", "rules_compact",
        "dolt_pull", "dolt_push", "sql", "worktree_create", "worktree_remove",
      ],
    };
  }
  const ok = commands.every((cmd) => cmd.ok || (op === "close" && /already|closed/i.test(`${cmd.stdout}\n${cmd.stderr}`)));
  let json: unknown = null;
  const last = commands[commands.length - 1];
  try {
    json = JSON.parse(last && last.stdout ? last.stdout : "null") as unknown;
  } catch {
    // Keep raw output.
  }
  const rowsAffectedMatch = last ? `${last.stdout}\n${last.stderr}`.match(/(?:rows?\s+affected|affected\s+rows?)\D+(\d+)/i) : null;
  return {
    ok,
    available: true,
    operation: op,
    commands,
    json,
    rows_affected: rowsAffectedMatch?.[1] ? Number(rowsAffectedMatch[1]) : null,
  };
}

function lspReview(root: string, args: RuntimeArgs = {}): CoreResult {
  const candidates = [
    path.join(root, "templates", "scripts", "cadre-lsp-review.js"),
    path.join(__dirname, "cadre-lsp-review.js"),
    path.join(__dirname, "..", "cadre-lsp-review.js"),
    path.join(__dirname, "..", "templates", "scripts", "cadre-lsp-review.js"),
    path.join(__dirname, "..", "..", "templates", "scripts", "cadre-lsp-review.js"),
    path.join(__dirname, "..", "skills", "cadre", "templates", "scripts", "cadre-lsp-review.js"),
    path.join(__dirname, "..", "..", "skills", "cadre", "templates", "scripts", "cadre-lsp-review.js"),
  ];
  const helper = candidates.find(fileExists);
  if (!helper) return { available: false, reason: "No cadre-lsp-review.js helper found", checked: candidates };
  const commandArgs = [helper, "--base", args.base || "main", "--head", args.head || "HEAD", "--json"];
  if (args.config) commandArgs.push("--config", args.config);
  const result = runCommand("node", commandArgs, { cwd: root });
  if (!result.ok) {
    return { available: false, reason: "LSP review helper failed", helper, result };
  }
  try {
    return { helper, ...asJsonObject(JSON.parse(result.stdout || "{}")) };
  } catch {
    return { available: false, reason: "LSP review helper returned invalid JSON", helper, result };
  }
}

function polyrepoPreflight(root: string): CoreResult {
  const topology = loadTopology(root);
  if (!topology.polyrepo) {
    return { ok: true, polyrepo: false, checks: ["monorepo mode"] };
  }
  const checks: string[] = [];
  const errors: string[] = [];
  const gitmodules = path.join(root, ".gitmodules");
  for (const repo of topology.repos.repos || []) {
    if (repo.enabled === false) continue;
    const repoPath = path.join(root, repo.submodule_path || "");
    if (!repo.name) errors.push("repo entry missing name");
    if (!repo.submodule_path) errors.push(`repo ${repo.name || "?"} missing submodule_path`);
    if (repo.submodule_path && !fileExists(repoPath)) {
      errors.push(`repo ${repo.name} path is missing: ${repo.submodule_path}`);
    }
    if (fileExists(gitmodules) && repo.name) {
      const result = spawnSync(
        "git",
        ["config", "-f", ".gitmodules", "--get", `submodule.${repo.name}.path`],
        { cwd: root, encoding: "utf8" }
      );
      if (result.status === 0 && result.stdout.trim() !== repo.submodule_path) {
        errors.push(
          `repo ${repo.name} submodule_path mismatch: repos.json=${repo.submodule_path}, .gitmodules=${result.stdout.trim()}`
        );
      }
    }
    if (repo.name) checks.push(repo.name);
  }
  return { ok: errors.length === 0, polyrepo: true, checks, errors };
}

function regenIndex(root: string, options: RuntimeArgs = {}): CoreResult {
  if (options.lock !== false) {
    return withLock(root, "tracks-index", () => regenIndex(root, { ...options, lock: false }));
  }
  const tracksFile = path.join(root, "cadre", "tracks.md");
  const start = "<!-- cadre:index:start -->";
  const end = "<!-- cadre:index:end -->";
  const tracks = listTracks(root).sort((a, b) => a.track_id.localeCompare(b.track_id));
  const body = tracks
    .map((track) => {
      const status = asOptionalString(track.metadata.status) || "new";
      const marker = Object.prototype.hasOwnProperty.call(STATUS_MARKERS, status)
        ? STATUS_MARKERS[status as keyof typeof STATUS_MARKERS]
        : STATUS_MARKERS.new;
      const name = track.metadata.name || track.metadata.track_id || track.track_id;
      return `## ${marker} Track: ${name}`;
    })
    .join("\n");
  const existing = fileExists(tracksFile) ? fs.readFileSync(tracksFile, "utf8") : "";
  let next;
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex + start.length).replace(/[ \t]*$/g, "");
    const after = existing.slice(endIndex);
    next = `${before}\n${body}${body ? "\n" : ""}${after.replace(/^\n*/, "")}`;
  } else {
    const preamble = existing ? `${existing.replace(/\n*$/, "")}\n` : "";
    next = `${preamble}${start}\n${body}${body ? "\n" : ""}${end}\n`;
  }
  fs.mkdirSync(path.dirname(tracksFile), { recursive: true });
  const tmp = `${tracksFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, tracksFile);
  return {
    ok: true,
    tracks_file: tracksFile,
    tracks: tracks.length,
    stdout: `Regenerated ${tracksFile} index from ${tracks.length} tracks' metadata (preamble preserved).\n`,
    stderr: "",
  };
}

export {
  STATUS_MARKERS,
  acquireLock,
  availableWork,
  beadsTaskWrite,
  claimTrack,
  completeTask,
  collisionScan,
  createBeadsTree,
  doctor,
  gitIdentity,
  implementationPrep,
  isCadreProjectRoot,
  isIgnoredRepoMapFile,
  listTracks,
  liveStatus,
  loadTopology,
  lspImpact,
  lspReview,
  metadataPatch,
  parsePlanFile,
  parsePlanText,
  phaseSchedule,
  planClaims,
  planIntegrity,
  polyrepoPreflight,
  prCiStatus,
  recordParallelWorker,
  recordReview,
  recordTaskResult,
  regenIndex,
  repoMap,
  reviewAssist,
  reviewGate,
  reviewMachineGate,
  releaseLock,
  setTrackStatus,
  syncControlPlane,
  teamBoard,
  teamStatus,
  testCoverage,
  heartbeatTrack,
  trackContext,
  withLock,
  withTrackLock,
};
