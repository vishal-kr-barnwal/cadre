import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../domain/lease-policy";
import { parsePlanText } from "../domain/plan-parser";
import { PROVIDER_MODES } from "../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../lsp/language-registry";

const commandExistsCache = new Map<string, boolean>();

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
    "tech-stack.json",
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

function plannedGitAction(id: string, kind: string, repo: string, cwd: string, args: string[], description: string): PlannedGitAction {
  return {
    id,
    kind,
    repo,
    cwd,
    command: "git",
    args,
    description,
  };
}

function runPlannedGitActions(actions: PlannedGitAction[]): CommandResult[] {
  return actions.map((action) => runCommand(action.command, action.args, { cwd: action.cwd }));
}

function actionResultsOk(results: CommandResult[]): boolean {
  return results.every((result) => result.ok);
}

function hasProviderEvidence(args: RuntimeArgs = {}): boolean {
  return Boolean(args.evidence || args.providerEvidence || args.provider_evidence);
}

function workflowPhaseState(args: RuntimeArgs, blocked: boolean, pendingProvider = false): WorkflowPhaseState {
  if (blocked) return "blocked";
  if (pendingProvider) return "pending_provider";
  return args.execute === true ? "executed" : "ready";
}

function continuationToken(workflow: string, trackId: string | null | undefined, actions: unknown[]): string {
  return textHash(JSON.stringify({ workflow, trackId, actions })).slice(0, 24);
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
  const key = `${process.env.PATH || ""}\u0000${cwd}\u0000${command}`;
  if (commandExistsCache.has(key)) return commandExistsCache.get(key) === true;
  const result = spawnSync("sh", ["-lc", `command -v '${String(command).replace(/'/g, "'\\''")}'`], {
    cwd,
    encoding: "utf8",
  });
  const exists = result.status === 0;
  commandExistsCache.set(key, exists);
  return exists;
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

function normalizeProviderMode(value: unknown): "local" | "github" | "gitlab" | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (["none", "no", "off", "local-only", "local_only"].includes(raw)) return "local";
  return PROVIDER_MODES.has(raw as "local" | "github" | "gitlab") ? raw as "local" | "github" | "gitlab" : null;
}

function gitRemoteUrls(root: string): string[] {
  const result = runCommand("git", ["remote", "-v"], { cwd: root });
  if (!result.ok) return [];
  return Array.from(new Set(result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[1] || "")
    .filter(Boolean)))
    .sort();
}

function remoteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    const ssh = url.match(/^[^@]+@([^:/]+)[:/]/);
    if (ssh?.[1]) return ssh[1].toLowerCase();
    const schemeLess = url.match(/^([^:/]+)[:/]/);
    return schemeLess?.[1] ? schemeLess[1].toLowerCase() : null;
  }
}

function providerModeForHost(host: string | null): "github" | "gitlab" | null {
  if (!host) return null;
  if (host.includes("github")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  return null;
}

function detectedProviderFromRemotes(root: string): CoreResult {
  const remotes = gitRemoteUrls(root).map((url) => {
    const host = remoteHost(url);
    return { url, host, provider_mode: providerModeForHost(host) };
  });
  const providerModes = Array.from(new Set(remotes.map((remote) => remote.provider_mode).filter(Boolean))).sort();
  const hosts = Array.from(new Set(remotes.map((remote) => remote.host).filter(Boolean))).sort();
  const hasRemotes = remotes.length > 0;
  const ambiguous = providerModes.length > 1 || (hasRemotes && providerModes.length === 0);
  const providerMode = providerModes.length === 1 ? providerModes[0] : (!hasRemotes ? "local" : null);
  return {
    ok: true,
    provider_mode: providerMode,
    remote_host: hosts.length === 1 ? hosts[0] : null,
    remote_hosts: hosts,
    remotes,
    ambiguous,
    source: !hasRemotes ? "no_remote" : (providerModes.length === 0 ? "unknown_remote" : "git_remote"),
  };
}

function configuredProvider(root: string, args: RuntimeArgs = {}): CoreResult {
  const config = loadTopology(root).config || {};
  const detected = detectedProviderFromRemotes(root);
  const explicit = normalizeProviderMode(args.providerMode || args.provider_mode || args.provider);
  const configured = normalizeProviderMode(config.provider_mode) || normalizeProviderMode(config.pr_provider);
  const providerMode = explicit || configured || (detected.ambiguous ? null : normalizeProviderMode(detected.provider_mode));
  const remoteHostValue = args.remoteHost || args.remote_host || config.remote_host || detected.remote_host || null;
  const mode = providerMode || null;
  return {
    ok: Boolean(mode),
    provider_mode: mode,
    provider_mcp_required: mode === "github" || mode === "gitlab",
    remote_host: remoteHostValue,
    detected,
    source: explicit ? "argument" : (configured ? "config" : "detected"),
    requires_confirmation: !mode && detected.ambiguous === true,
  };
}

function providerMcpAvailability(root: string, args: RuntimeArgs = {}): CoreResult {
  const provider = configuredProvider(root, args);
  const mode = asOptionalString(provider.provider_mode) || "local";
  if (mode === "local") {
    return { ...provider, available: true, skipped: true, reason: "provider_mode is local" };
  }
  const explicit = args.provider_mcp_available ?? args.providerMcpAvailable;
  const modeSpecific = mode === "github" ? args.githubMcpAvailable : args.gitlabMcpAvailable;
  const available = typeof modeSpecific === "boolean"
    ? modeSpecific
    : (typeof explicit === "boolean" ? explicit : null);
  return {
    ...provider,
    available,
    availability_source: available == null ? "not_verifiable_by_cadre_runtime" : "caller",
    required_provider_mcp: {
      provider: mode,
      server: mode,
      purpose: "Fetch PR/MR metadata, reviews, CI/check status, and discussion evidence.",
    },
  };
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
  ok?: true;
  repo: string;
  path: string;
  source: string;
}

interface WorkingRootError extends JsonObject {
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

type WorkingRootResolution = WorkingRoot | WorkingRootError;

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

type WorkflowPhaseState = "dry_run" | "ready" | "pending_provider" | "executed" | "blocked" | "recovery_required";

interface PlannedGitAction extends JsonObject {
  id: string;
  kind: string;
  repo: string;
  cwd: string;
  command: string;
  args: string[];
  description: string;
}

interface PlannedProviderAction extends JsonObject {
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
  errors.push(...unresolvedPlanRepos(root, track, args));
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

function gitSummary(root: string): CoreResult {
  if (!fileExists(root)) return { ok: false, exists: false };
  const branch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
  const head = runCommand("git", ["rev-parse", "--short", "HEAD"], { cwd: root });
  const status = runCommand("git", ["status", "--porcelain"], { cwd: root });
  return {
    ok: branch.ok || head.ok || status.ok,
    exists: true,
    branch: branch.ok ? branch.stdout.trim() : null,
    head: head.ok ? head.stdout.trim() : null,
    dirty_files: status.ok ? status.stdout.split(/\r?\n/).filter(Boolean).length : null,
    errors: [branch.stderr, head.stderr, status.stderr].filter(Boolean).join("\n").trim(),
  };
}

function fleetStatus(root: string, args: RuntimeArgs = {}): CoreResult {
  const topology = loadTopology(root);
  const repos: CoreResult[] = [{
    name: ".",
    role: "control",
    path: ".",
    root,
    ...gitSummary(root),
  }];
  if (topology.polyrepo) {
    for (const raw of Array.isArray(topology.repos.repos) ? topology.repos.repos : []) {
      const repo = asJsonObject(raw);
      const name = asOptionalString(repo.name) || asOptionalString(repo.submodule_path) || "unknown";
      const rel = asOptionalString(repo.submodule_path) || "";
      const repoRoot = rel ? path.resolve(root, rel) : root;
      repos.push({
        name,
        role: "product",
        path: rel,
        root: repoRoot,
        enabled: repo.enabled !== false,
        ...gitSummary(repoRoot),
      });
    }
  }
  return {
    ok: true,
    root,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    repos,
    provider: providerMcpAvailability(root, args),
    beads_available: commandExists("bd", root),
    collisions: args.includeCollisions === false ? null : collisionScan(root),
  };
}

function beadsSummary(root: string): CoreResult {
  const available = commandExists("bd", root);
  if (!available) {
    return {
      ok: true,
      available: false,
      root,
      reason: "Beads CLI (bd) is not installed or not on PATH",
      ready: null,
      in_progress: null,
      blocked: null,
      review: null,
    };
  }
  const ready = runBdJson(root, ["ready", "--json"]);
  const inProgress = runBdJson(root, ["list", "--status", "in_progress", "--json"]);
  const blocked = runBdJson(root, ["list", "--status", "blocked", "--json"]);
  const review = {
    requested: runBdJson(root, ["list", "--label", "review:requested", "--json"]),
    ready: runBdJson(root, ["list", "--label", "review:ready", "--json"]),
    changes: runBdJson(root, ["list", "--label", "review:changes", "--json"]),
  };
  return {
    ok: true,
    available: true,
    root,
    ready,
    in_progress: inProgress,
    blocked,
    review,
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

function activeTrackId(root: string, identity: string | null = gitIdentity(root)): string | null {
  const tracks = listTracks(root);
  const topology = loadTopology(root);
  const active = tracks.filter((track) => (track.metadata.status || "new") === "in_progress");
  if (topology.config.sync_mode === "shared" && identity) {
    const mine = active.find((track) => track.metadata.owner === identity);
    if (mine) return mine.track_id;
  }
  return active[0]?.track_id || null;
}

function selectedTrackId(root: string, args: RuntimeArgs = {}): string | null {
  return args.trackId || args.track_id || activeTrackId(root);
}

function workflowResponseMode(args: RuntimeArgs = {}): "compact" | "detail" {
  const raw = asOptionalString(args.responseMode || args.response_mode
    || (args.detail === true ? "detail" : null)
    || (args.compact === true ? "compact" : null))?.trim().toLowerCase();
  if (raw && ["detail", "detailed", "full", "verbose"].includes(raw)) return "detail";
  return "compact";
}

function workflowSummary(root: string, workflow: string, args: RuntimeArgs = {}): CoreResult {
  const identity = gitIdentity(root);
  return {
    root,
    workflow,
    packet_only: true,
    execute: args.execute === true,
    phase_state: args.execute === true ? "executed" : "dry_run",
    response_mode: workflowResponseMode(args),
    detail_available: true,
    identity,
    generated_at: utcNow(),
  };
}

function resultOk(value: CoreResult | null | undefined): boolean {
  return !value || value.ok !== false;
}

function withSharedControlPlaneSync(root: string, args: RuntimeArgs = {}, operation: string, fn: () => CoreResult): CoreResult {
  const topology = loadTopology(root);
  if (args.execute !== true || topology.config.sync_mode !== "shared" || (args as UnknownRecord).skipSync === true) {
    return fn();
  }
  const syncPre = syncControlPlane(root, { mode: "pre" });
  if (syncPre.ok === false) {
    return {
      ok: false,
      phase_state: "blocked",
      stage: "sync_pre",
      operation,
      sync_pre: syncPre,
    };
  }
  const result = fn();
  if (result.ok === false) {
    return {
      ...result,
      sync_pre: syncPre,
      sync_post: null,
    };
  }
  const syncPost = syncControlPlane(root, { mode: "post" });
  return {
    ...result,
    ok: resultOk(result) && syncPost.ok !== false,
    phase_state: syncPost.ok === false ? "recovery_required" : result.phase_state,
    sync_pre: syncPre,
    sync_post: syncPost,
  };
}

function compactObject(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const limit = depth === 0 ? 80 : 25;
    return value.slice(0, limit).map((item) => compactObject(item, depth + 1));
  }
  const source = asJsonObject(value);
  const out: JsonObject = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key === "content" && typeof entry === "string" && entry.length > 800) {
      out[key] = `${entry.slice(0, 800)}\n...[truncated; request responseMode:\"detail\" for full content]`;
      continue;
    }
    if (key === "plan" && isRecord(entry)) {
      const plan = asJsonObject(entry);
      out[key] = {
        ok: plan.ok,
        phases: Array.isArray(plan.phases) ? plan.phases.length : 0,
        tasks: Array.isArray(plan.tasks) ? plan.tasks.length : 0,
        warnings: Array.isArray(plan.warnings) ? plan.warnings.length : 0,
        errors: Array.isArray(plan.errors) ? plan.errors.length : 0,
      };
      continue;
    }
    if (["stdout", "stderr"].includes(key) && typeof entry === "string" && entry.length > 1200) {
      out[`${key}_tail`] = entry.slice(-1200);
      out[`${key}_truncated`] = true;
      continue;
    }
    if (["repo_diffs", "repo_todos", "commands", "results"].includes(key) && Array.isArray(entry)) {
      out[key] = entry.slice(0, 20).map((item) => compactObject(item, depth + 1)) as JsonObject[];
      out[`${key}_count`] = entry.length;
      out[`${key}_truncated`] = entry.length > 20;
      continue;
    }
    out[key] = depth > 5 ? "[depth-limit]" : compactObject(entry, depth + 1) as JsonObject | string | number | boolean | null | JsonObject[];
  }
  return out;
}

function workflowResourceUris(root: string, workflow: string, result: CoreResult): string[] {
  const encodedRoot = encodeURIComponent(root);
  const trackId = asOptionalString(result.track_id)
    || asOptionalString(asJsonObject(result.track || {}).track_id)
    || asOptionalString(asJsonObject(asJsonObject(result.track_context).track).track_id);
  const uris = [
    `cadre://workspace-health?root=${encodedRoot}`,
    `cadre://team-board?root=${encodedRoot}`,
    `cadre://quality-gate?root=${encodedRoot}${trackId ? `&trackId=${encodeURIComponent(trackId)}` : ""}`,
  ];
  if (trackId) {
    uris.push(`cadre://track-context?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
    uris.push(`cadre://parallel-state?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
  }
  if (workflow === "ship" && trackId) uris.push(`cadre://ship-plan?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
  if (workflow === "land" && trackId) uris.push(`cadre://land-plan?root=${encodedRoot}&trackId=${encodeURIComponent(trackId)}`);
  if (workflow === "release") uris.push(`cadre://release-plan?root=${encodedRoot}`);
  return Array.from(new Set(uris));
}

function shapeWorkflowResponse(root: string, workflow: string, args: RuntimeArgs, result: CoreResult): CoreResult {
  const mode = workflowResponseMode(args);
  const enriched = {
    ...result,
    response_mode: mode,
    detail_available: true,
    resource_uris: workflowResourceUris(root, workflow, result),
  };
  if (mode === "detail") return enriched;
  return compactObject(enriched) as CoreResult;
}

function templatePath(relativePath: string): string | null {
  const candidates = [
    path.join(__dirname, "..", "templates", relativePath),
    path.join(__dirname, "..", "..", "templates", relativePath),
    path.join(__dirname, "templates", relativePath),
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function templateText(relativePath: string, fallback: string): string {
  const found = templatePath(relativePath);
  if (found) return fs.readFileSync(found, "utf8");
  return fallback;
}

function packetText(value: unknown, fallback: string): string {
  const text = asOptionalString(value);
  return (text && text.trim() ? text : fallback).replace(/\n*$/, "\n");
}

function templateJson(relativePath: string, fallback: JsonObject): JsonObject {
  return readJson<JsonObject>(templatePath(relativePath) || "", fallback);
}

function templateManifest(): JsonObject {
  return templateJson("manifest.json", { templates: [] });
}

function configuredCiProvider(root: string, args: RuntimeArgs = {}): "github" | "gitlab" | null {
  const raw = asOptionalString(args.ciProvider || args.ci_provider)
    || asOptionalString(args.providerMode || args.provider_mode || args.provider)
    || asOptionalString(loadTopology(root).config.provider_mode);
  const provider = normalizeProviderMode(raw);
  return provider === "github" || provider === "gitlab" ? provider : null;
}

function setupBeads(root: string, args: RuntimeArgs = {}): CoreResult {
  const available = commandExists("bd", root);
  const stateDir = path.join(root, ".beads");
  const initialized = fileExists(stateDir);
  const command = ["bd", "init", "--non-interactive", "--role", "maintainer"];
  if (args.execute !== true) {
    return {
      ok: true,
      available,
      initialized,
      dry_run: true,
      planned_command: command,
      state_path: ".beads",
    };
  }
  if (!available) {
    return {
      ok: false,
      available: false,
      initialized: false,
      required: true,
      error: "Beads CLI (bd) is required for cadre-setup execute and was not found on PATH",
    };
  }
  if (initialized) {
    return {
      ok: true,
      available: true,
      initialized: true,
      skipped: true,
      reason: ".beads already exists",
      state_path: ".beads",
    };
  }
  const result = runCommand("bd", command.slice(1), { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return {
    ok: result.ok,
    available: true,
    initialized: result.ok || fileExists(stateDir),
    command,
    result,
    state_path: ".beads",
  };
}

function setupGitattributes(root: string): CoreResult {
  const file = path.join(root, ".gitattributes");
  const required = [
    ".beads/** merge=ours",
    "cadre/tracks/**/parallel_state.json merge=ours",
  ];
  const existing = fileExists(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter(Boolean);
  let changed = false;
  for (const line of required) {
    if (!lines.includes(line)) {
      lines.push(line);
      changed = true;
    }
  }
  if (changed || !fileExists(file)) {
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
  }
  const mergeDriver = runCommand("git", ["config", "merge.ours.driver", "true"], { cwd: root });
  return {
    ok: mergeDriver.ok,
    path: path.relative(root, file),
    changed,
    merge_driver: mergeDriver,
  };
}

function setupCiTemplates(root: string, provider: "github" | "gitlab" | null, args: RuntimeArgs = {}): CoreResult {
  if (!provider) return { ok: true, skipped: true, reason: "No hosted provider selected" };
  if (args.writeCi === false || args.write_ci === false) {
    return { ok: true, skipped: true, reason: "writeCi=false" };
  }
  const topology = asOptionalString((args as UnknownRecord).topology)?.toLowerCase();
  const polyrepo = topology === "polyrepo" || asJsonObject((args as UnknownRecord).repos).mode === "polyrepo" || (args as UnknownRecord).polyrepo === true;
  const template = polyrepo
    ? (provider === "github" ? "ci/cadre-merge-train.github.yml" : "ci/cadre-merge-train.gitlab.yml")
    : (provider === "github" ? "ci/cadre-monorepo-check.github.yml" : "ci/cadre-monorepo-check.gitlab.yml");
  const source = templatePath(template);
  if (!source) return { ok: false, error: `Missing CI template ${template}` };
  const target = provider === "github"
    ? path.join(root, ".github", "workflows", polyrepo ? "cadre-merge-train.yml" : "cadre-monorepo-check.yml")
    : path.join(root, ".gitlab-ci.yml");
  if (fileExists(target) && args.force !== true) {
    return { ok: true, skipped: true, provider, source: path.relative(root, source), path: path.relative(root, target) };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return { ok: true, provider, source: path.relative(root, source), path: path.relative(root, target), written: true };
}

function setupSubmodulePlan(root: string, repos: JsonObject, args: RuntimeArgs = {}): CoreResult {
  const entries = Array.isArray(repos.repos) ? repos.repos.map(asJsonObject) : [];
  const commands: PlannedGitAction[] = [];
  for (const repo of entries) {
    const name = asOptionalString(repo.name);
    const url = asOptionalString(repo.url);
    const submodulePath = asOptionalString(repo.submodule_path);
    if (!name || !url || !submodulePath || repo.enabled === false) continue;
    if (fileExists(path.join(root, submodulePath))) continue;
    commands.push(plannedGitAction(
      `submodule-${safeName(name)}`,
      "submodule_add",
      name,
      root,
      ["submodule", "add", url, submodulePath],
      `Register ${name} as a product submodule`
    ));
  }
  const execute = args.addSubmodules === true || args.add_submodules === true || args.executeSubmodules === true || args.execute_submodules === true;
  const results = execute ? runPlannedGitActions(commands) : [];
  return {
    ok: !execute || actionResultsOk(results),
    execute,
    dry_run: !execute,
    commands,
    results,
  };
}

function lspSetupHelperCandidates(root: string): string[] {
  return [
    path.join(__dirname, "cadre-lsp-setup.js"),
    path.join(__dirname, "..", "cadre-lsp-setup.js"),
    path.join(__dirname, "..", "..", "scripts", "cadre-lsp-setup.js"),
    path.join(root, "cadre", "scripts", "cadre-lsp-setup.js"),
  ];
}

function lspSetup(root: string, args: RuntimeArgs = {}): CoreResult {
  const helper = lspSetupHelperCandidates(root).find(fileExists);
  if (!helper) {
    return {
      ok: false,
      available: false,
      reason: "No cadre-lsp-setup.js helper found",
      checked: lspSetupHelperCandidates(root),
    };
  }
  const config = asOptionalString(args.config) || "cadre/lsp.json";
  const commandArgs = [helper, "--root", root, "--config", config, "--json"];
  if (args.execute === true) commandArgs.push("--write");
  const result = runCommand("node", commandArgs, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  if (!result.ok) {
    return { ok: false, available: true, helper, result, reason: "LSP setup helper failed" };
  }
  try {
    return {
      ok: true,
      available: true,
      helper,
      execute: args.execute === true,
      dry_run: args.execute !== true,
      ...asJsonObject(JSON.parse(result.stdout || "{}")),
    };
  } catch {
    return { ok: false, available: true, helper, result, reason: "LSP setup helper returned invalid JSON" };
  }
}

function availableStyleGuideIds(): string[] {
  const dir = templatePath("code_styleguides/general.md");
  if (!dir) return [];
  const styleDir = path.dirname(dir);
  try {
    return fs.readdirSync(styleDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.basename(file, ".md"))
      .sort();
  } catch {
    return [];
  }
}

function normalizeStyleGuideId(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^.*code_styleguides\//, "")
    .replace(/\.md$/i, "")
    .toLowerCase();
}

function requestedStyleGuideIds(value: unknown): string[] {
  const raw = typeof value === "string"
    ? value.split(/[,\s]+/)
    : asStringArray(value);
  return Array.from(new Set(raw.map(normalizeStyleGuideId).filter(Boolean))).sort();
}

function collectTechStackTokens(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectTechStackTokens);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...collectTechStackTokens(entry)]);
}

function techStackStyleGuideOverrides(techStack: JsonObject): string[] {
  return requestedStyleGuideIds(
    techStack.styleGuideIds
      || techStack.style_guides
      || techStack.codeStyleGuides
      || techStack.code_style_guides
  );
}

function styleGuideIdsForTechStack(techStack: JsonObject): string[] {
  const tokens = collectTechStackTokens(techStack)
    .map((item) => item.toLowerCase().replace(/[^a-z0-9+#.-]+/g, " ").trim())
    .filter(Boolean);
  const tokenText = ` ${tokens.join(" ")} `;
  const detected = new Set<string>();
  const add = (id: string): void => {
    detected.add(id);
  };
  const has = (pattern: RegExp): boolean => pattern.test(tokenText);
  if (has(/\b(?:typescript|tsx|ts)\b/)) add("typescript");
  if (!detected.has("typescript") && has(/\b(?:javascript|node\.?js|js|jsx)\b/)) add("javascript");
  if (has(/\b(?:html|css|scss|sass|less|tailwind|frontend|web)\b/)) add("html-css");
  if (has(/\b(?:python|pytest|django|flask|fastapi)\b/)) add("python");
  if (has(/\b(?:go|golang)\b/)) add("go");
  if (has(/\b(?:rust|cargo)\b/)) add("rust");
  if (has(/\b(?:dart|flutter)\b/)) {
    add("dart");
    if (has(/\bflutter\b/)) add("flutter");
  }
  if (has(/\b(?:kotlin|gradle|jvm)\b/)) add("kotlin");
  if (has(/\b(?:android|jetpack compose)\b/)) add("android");
  if (has(/\b(?:compose multiplatform|kotlin multiplatform|kmp)\b/)) {
    add("compose-multiplatform");
    add("kotlin");
  }
  if (has(/\b(?:swift|swiftui|ios|macos)\b/)) {
    add("swift");
    if (has(/\bswiftui\b/)) add("swiftui");
  }
  return Array.from(new Set([...detected, ...techStackStyleGuideOverrides(techStack)])).sort();
}

function techStackFromArgs(args: RuntimeArgs = {}): JsonObject | null {
  return isRecord((args as UnknownRecord).techStack) ? asJsonObject((args as UnknownRecord).techStack) : null;
}

function loadTechStack(root: string): JsonObject | null {
  return readJson<JsonObject | null>(path.join(root, "cadre", "tech-stack.json"), null);
}

function techStackForPacket(root: string, args: RuntimeArgs = {}): JsonObject | null {
  return techStackFromArgs(args) || loadTechStack(root);
}

function summarizeList(label: string, value: unknown): string | null {
  const values = collectTechStackTokens(value)
    .filter((item) => item !== label)
    .slice(0, 12);
  return values.length > 0 ? `${label}: ${values.join(", ")}` : null;
}

function techStackSummary(root: string, args: RuntimeArgs = {}): CoreResult {
  const techStack = techStackForPacket(root, args);
  if (!techStack) {
    return {
      ok: false,
      root,
      path: path.relative(root, path.join(root, "cadre", "tech-stack.json")),
      error: "Missing structured tech stack: cadre/tech-stack.json",
    };
  }
  const lines = [
    summarizeList("languages", techStack.languages),
    summarizeList("frameworks", techStack.frameworks),
    summarizeList("runtimes", techStack.runtimes),
    summarizeList("platforms", techStack.platforms),
    summarizeList("packageManagers", techStack.packageManagers || techStack.package_managers),
    summarizeList("build", techStack.build),
    summarizeList("test", techStack.test),
    summarizeList("datastores", techStack.datastores),
    summarizeList("services", techStack.services),
    summarizeList("styleGuideIds", techStackStyleGuideOverrides(techStack)),
  ].filter((line): line is string => Boolean(line));
  return {
    ok: true,
    root,
    path: path.relative(root, path.join(root, "cadre", "tech-stack.json")),
    techStack,
    styleGuideIds: styleGuideIdsForTechStack(techStack),
    summary: lines.length > 0 ? lines.join("\n") : "No tech stack details recorded.",
  };
}

function setupStyleGuides(root: string, args: RuntimeArgs = {}): CoreResult {
  const available = new Set(availableStyleGuideIds());
  const techStack = techStackForPacket(root, args) || {};
  const detected = styleGuideIdsForTechStack(techStack).filter((id) => available.has(id));
  const requested = requestedStyleGuideIds((args as UnknownRecord).styleGuideIds);
  const missing = requested.filter((id) => !available.has(id));
  const selected = Array.from(new Set([
    ...(available.has("general") ? ["general"] : []),
    ...detected,
    ...requested.filter((id) => available.has(id)),
  ])).sort();
  return {
    ok: missing.length === 0,
    detected,
    requested,
    selected,
    written: [],
    skipped: [],
    missing,
    source: "tech-stack.json",
  };
}

function trackLearningsText(trackId: string): string {
  return templateText("learnings.md", "# Track Learnings: {{track_id}}\n\n")
    .replace(/\{\{track_id\}\}/g, trackId)
    .replace(/\n*$/, "\n");
}

function installedStyleGuideIds(root: string): string[] {
  const dir = path.join(root, "cadre", "code_styleguides");
  if (!fileExists(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.basename(file, ".md"))
      .sort();
  } catch {
    return [];
  }
}

function styleGuideIdsForFiles(files: string[]): string[] {
  const ids = new Set<string>();
  for (const rawFile of files) {
    const file = normalizeClaimPath(rawFile);
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();
    if ([".ts", ".tsx"].includes(ext)) ids.add("typescript");
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) ids.add("javascript");
    if ([".html", ".css", ".scss", ".sass", ".less", ".vue", ".svelte"].includes(ext)) ids.add("html-css");
    if (ext === ".py") ids.add("python");
    if (ext === ".go") ids.add("go");
    if (ext === ".rs") ids.add("rust");
    if ([".kt", ".kts"].includes(ext)) ids.add("kotlin");
    if (ext === ".swift") ids.add("swift");
    if (ext === ".dart") ids.add("dart");
    if (base === "androidmanifest.xml" || file.includes("/android/")) ids.add("android");
    if (file.includes("compose")) ids.add("compose-multiplatform");
    if (file.includes("swiftui")) ids.add("swiftui");
    if (ext === ".dart" && (file.startsWith("lib/") || file.includes("/flutter/"))) ids.add("flutter");
  }
  return Array.from(ids).sort();
}

function implementationStyleGuides(root: string, trackId: string | null | undefined, args: RuntimeArgs = {}): CoreResult {
  const installed = installedStyleGuideIds(root);
  if (installed.length === 0) {
    return {
      ok: true,
      available: false,
      source: "cadre/code_styleguides",
      installed: [],
      selected: [],
      guides: [],
      warning: "No installed Cadre code style guides found",
    };
  }
  const installedSet = new Set(installed);
  const track = findTrack(root, trackId);
  const plan = track ? parsePlanFile(track.plan_path) : { tasks: [] };
  const taskFiles = asArray(plan.tasks)
    .flatMap((task) => asStringArray(asJsonObject(task).files))
    .map(normalizeClaimPath)
    .filter(Boolean);
  const taskFileIds = styleGuideIdsForFiles(taskFiles).filter((id) => installedSet.has(id));
  const techStack = techStackForPacket(root, args);
  if (!techStack) {
    return {
      ok: false,
      available: false,
      source: "cadre/tech-stack.json",
      installed,
      selected: [],
      guides: [],
      error: "Missing structured tech stack: cadre/tech-stack.json",
    };
  }
  const techStackIds = styleGuideIdsForTechStack(techStack).filter((id) => installedSet.has(id));
  const requested = requestedStyleGuideIds((args as UnknownRecord).styleGuideIds);
  const missing = requested.filter((id) => !installedSet.has(id));
  const selected = Array.from(new Set([
    ...(installedSet.has("general") ? ["general"] : []),
    ...techStackIds,
    ...requested.filter((id) => installedSet.has(id)),
  ])).sort();
  const maxChars = Math.max(1000, Math.min(Number(args.styleGuideMaxChars || 6000), 20000));
  const guides = selected.map((id) => {
    const file = path.join(root, "cadre", "code_styleguides", `${id}.md`);
    const text = fileExists(file) ? fs.readFileSync(file, "utf8") : "";
    return {
      id,
      path: path.relative(root, file),
      content: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      bytes: Buffer.byteLength(text, "utf8"),
      reasons: [
        id === "general" ? "general" : null,
        techStackIds.includes(id) ? "tech_stack" : null,
        requested.includes(id) ? "explicit" : null,
      ].filter(Boolean),
    };
  });
  return {
    ok: missing.length === 0,
    available: true,
    source: "cadre/code_styleguides",
    tech_stack_source: "cadre/tech-stack.json",
    installed,
    selected,
    tech_stack_ids: techStackIds,
    task_file_ids: taskFileIds,
    task_files: taskFiles,
    missing,
    max_chars_per_guide: maxChars,
    guides,
  };
}

function workflowSetup(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "setup", args);
  const rawArgs = args as UnknownRecord;
  const requestedTopology = asOptionalString(rawArgs.topology)?.toLowerCase();
  const reposPayload = isRecord(rawArgs.repos) ? asJsonObject(rawArgs.repos) : null;
  const polyrepoRequested = Boolean(reposPayload && reposPayload.mode === "polyrepo")
    || requestedTopology === "polyrepo"
    || rawArgs.polyrepo === true;
  const styleGuides = setupStyleGuides(root, args);
  const provider = configuredProvider(root, args);
  const providerMode = asOptionalString(provider.provider_mode);
  const lspRecommendations = lspSetup(root, { ...args, execute: false });
  const detailMode = workflowResponseMode(args) === "detail";
  const workspaceHealthResult = workspaceHealth(root, { ...args, responseMode: detailMode ? "detail" : "compact" });
  const beadsPlan = setupBeads(root, { ...args, execute: false });
  const configOverrides = asJsonObject(rawArgs.config);
  const requestedSyncMode = asOptionalString(rawArgs.syncMode || rawArgs.sync_mode || configOverrides.sync_mode);
  const teamSize = Number(rawArgs.teamSize || rawArgs.team_size || 0);
  const syncModeRecommendation = requestedSyncMode || (teamSize >= 2 ? "shared" : "local");
  const result: CoreResult = {
    ...summary,
    ok: styleGuides.ok,
    doctor: doctor(root, { hasCadreProject: isCadreProjectRoot(root) }),
    workspace_health: workspaceHealthResult,
    workspace: workspaceHealthResult.workspace,
    dependency_graph: workspaceHealthResult.dependency_graph,
    lsp: workspaceHealthResult.lsp,
    lsp_setup: detailMode ? lspRecommendations : summarizeLspSetupResult(lspRecommendations),
    integrations: workspaceHealthResult.integrations,
    detail_resources: workspaceHealthResult.detail_resources,
    beads_init: beadsPlan,
    provider,
    sync_mode: syncModeRecommendation,
    sync_recommendation: teamSize >= 2 && syncModeRecommendation !== "shared"
      ? "Team setup detected; use syncMode/shared sync for 10-20 person coordination."
      : null,
    styleGuides,
    templates: templateManifest(),
    techStackSummary: techStackSummary(root, args),
    required_payload: args.execute === true
      ? ["productText", "techStack"]
        .concat(provider.requires_confirmation === true ? ["providerMode"] : [])
        .concat(polyrepoRequested && !reposPayload ? ["repos"] : [])
      : [],
    next_actions: provider.requires_confirmation === true
      ? ["Choose providerMode: local, github, or gitlab before setup writes cadre/config.json."]
      : [],
    packet_notes: [
      "cadre-setup is packet-only: agents gather user intent, then pass confirmed document text to this packet.",
      "Project mutation must be performed by MCP packets; clients must not recreate Cadre setup writes themselves.",
      "Provider evidence is direct-MCP only: GitHub/GitLab modes require the matching provider MCP, local mode requires none.",
    ],
  };
  if (styleGuides.ok === false) {
    return {
      ...result,
      ok: false,
      error: `Unknown setup style guide id: ${asStringArray(styleGuides.missing).join(", ")}`,
    };
  }
  if (args.execute !== true) return result;

  const cadreDir = path.join(root, "cadre");
  const force = asBoolean(rawArgs.force, false);
  const missingPayload = [
    ...(!asOptionalString(rawArgs.productText)?.trim() ? ["productText"] : []),
    ...(!techStackFromArgs(args) ? ["techStack"] : []),
    ...(provider.requires_confirmation === true || !providerMode ? ["providerMode"] : []),
    ...(polyrepoRequested && !reposPayload ? ["repos"] : []),
  ];
  if (missingPayload.length > 0) {
    return {
      ...result,
      ok: false,
      error: `Missing setup payload: ${missingPayload.join(", ")}`,
      missing_payload: missingPayload,
    };
  }
  const beadsInit = setupBeads(root, args);
  if (beadsInit.ok === false) {
    return {
      ...result,
      ok: false,
      phase_state: "blocked",
      stage: "beads_init",
      beads_init: beadsInit,
      error: asOptionalString(beadsInit.error) || asOptionalString(beadsInit.reason) || "Beads initialization failed",
    };
  }
  const written: string[] = [];
  const skipped: string[] = [];
  const writeText = (relativePath: string, text: string): void => {
    const file = path.join(cadreDir, relativePath);
    if (fileExists(file) && !force) {
      skipped.push(path.relative(root, file));
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    written.push(path.relative(root, file));
  };
  const writeSetupJson = (relativePath: string, value: JsonObject): void => {
    const file = path.join(cadreDir, relativePath);
    if (fileExists(file) && !force) {
      skipped.push(path.relative(root, file));
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJson(file, value);
    written.push(path.relative(root, file));
  };

  fs.mkdirSync(path.join(cadreDir, "tracks"), { recursive: true });
  fs.mkdirSync(path.join(cadreDir, "archive"), { recursive: true });
  writeText(
    "product.md",
    packetText(rawArgs.productText, "# Product Context\n\nDescribe the product, users, workflows, and constraints.\n")
  );
  writeSetupJson("tech-stack.json", techStackFromArgs(args) || {});
  writeText("workflow.md", packetText(rawArgs.workflowText, templateText("workflow.md", "# Project Workflow\n\nCadre state is recorded through MCP packets.\n")));
  writeText("tracks.md", "# Tracks\n\n<!-- cadre:index:start -->\n<!-- cadre:index:end -->\n");
  writeText("learnings.md", "# Project Learnings\n\n");
  writeText("patterns.md", templateText("patterns.md", "# Project Patterns\n\n"));
  const beforeStyleWritten = written.length;
  const beforeStyleSkipped = skipped.length;
  for (const guideId of asStringArray(styleGuides.selected)) {
    writeText(
      `code_styleguides/${guideId}.md`,
      templateText(`code_styleguides/${guideId}.md`, `# ${guideId}\n\n`)
    );
  }
  writeSetupJson("setup_state.json", {
    version: 1,
    packet_only: true,
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    initialized_at: utcNow(),
    updated_at: utcNow(),
  });
  const configPayload = {
    ...templateJson("config.json", { sync_mode: "local", auto_open: false }),
    packet_only: true,
    sync_mode: syncModeRecommendation,
    provider_mode: providerMode || "local",
    provider_mcp_required: providerMode === "github" || providerMode === "gitlab",
    ...(asOptionalString(provider.remote_host) ? { remote_host: asOptionalString(provider.remote_host) } : {}),
    ...(isRecord(rawArgs.integrations) ? { integrations: asJsonObject(rawArgs.integrations) } : {}),
    ...configOverrides,
  };
  writeSetupJson("config.json", configPayload);
  writeSetupJson("beads.json", {
    ...templateJson("beads.json", { enabled: true, mode: "normal" }),
    packet_only: true,
    ...asJsonObject(rawArgs.beadsConfig),
  });
  let repos: JsonObject | null = null;
  if (reposPayload) {
    repos = reposPayload;
    writeSetupJson("repos.json", reposPayload);
  }
  const lspWriteRequested = rawArgs.lsp === true
    || args.setupLsp === true
    || args.setup_lsp === true
    || args.writeLsp === true
    || args.write_lsp === true;
  const lspSetupResult = lspWriteRequested ? lspSetup(root, { ...args, execute: true }) : lspRecommendations;
  const gitattributesNeeded = polyrepoRequested
    || configPayload.sync_mode === "shared"
    || rawArgs.writeGitattributes === true
    || rawArgs.write_gitattributes === true;
  const gitattributes = gitattributesNeeded ? setupGitattributes(root) : null;
  const ciSetup = setupCiTemplates(
    root,
    configuredCiProvider(root, args) || (providerMode === "github" || providerMode === "gitlab" ? providerMode : null),
    { ...args, topology: polyrepoRequested ? "polyrepo" : "monorepo" }
  );
  const polyrepoSetup = polyrepoRequested && repos
    ? {
      gitattributes,
      ci: ciSetup,
      submodules: setupSubmodulePlan(root, repos, args),
    }
    : null;
  return {
    ...result,
    ok: true,
    scaffolded: true,
    phase_state: "executed",
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    written,
    skipped,
    styleGuides: {
      ...styleGuides,
      written: written.slice(beforeStyleWritten),
      skipped: skipped.slice(beforeStyleSkipped),
    },
    lsp_setup: lspSetupResult,
    beads_init: beadsInit,
    gitattributes,
    ci_setup: ciSetup,
    polyrepo_setup: polyrepoSetup,
    force,
    doctor_after: doctor(root, { hasCadreProject: true }),
  };
}

function workflowNewTrack(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = args.trackId || args.track_id;
  const planText = asOptionalString(args.planText);
  const specText = asOptionalString(args.specText);
  if (!trackId) return { ...workflowSummary(root, "newtrack", args), ok: false, error: "trackId is required" };
  if (!planText) return { ...workflowSummary(root, "newtrack", args), ok: false, error: "planText is required" };
  const metadata: TrackMetadata = {
    track_id: trackId,
    type: "feature",
    status: "new",
    priority: "medium",
    depends_on: [],
    description: asOptionalString(args.description) || trackId,
    owner: gitIdentity(root) || null,
    reviewer: null,
    git_branch: `track/${trackId}`,
    worktree_path: `.worktrees/${trackId}`,
    ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
  };
  const dryRun = args.execute !== true;
  const assist = planAssist(root, { ...args, planText, trackId });
  const beads = createBeadsTree(root, {
    ...args,
    dryRun: true,
    trackId,
    planText,
    specText: specText || "",
    metadata,
  });
  if (dryRun) {
    return {
      ...workflowSummary(root, "newtrack", args),
      ok: assist.ok !== false && beads.ok !== false,
      dry_run: true,
      track_id: trackId,
      metadata,
      plan_assist: assist,
      beads_tree: beads,
    };
  }
  if (findTrack(root, trackId)) {
    return { ...workflowSummary(root, "newtrack", args), ok: false, track_id: trackId, error: "Track already exists" };
  }
  if (!commandExists("bd", root)) {
    return {
      ...workflowSummary(root, "newtrack", args),
      ok: false,
      track_id: trackId,
      error: "Beads CLI (bd) is required for live track creation",
    };
  }
  const dir = path.join(root, "cadre", "tracks", safeName(trackId));
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "metadata.json"), metadata);
  fs.writeFileSync(path.join(dir, "spec.md"), specText || `# Spec: ${trackId}\n`);
  fs.writeFileSync(path.join(dir, "plan.md"), planText.endsWith("\n") ? planText : `${planText}\n`);
  fs.writeFileSync(path.join(dir, "learnings.md"), trackLearningsText(trackId));
  const liveBeads = createBeadsTree(root, { ...args, trackId, dryRun: false });
  if (!liveBeads.ok) {
    fs.rmSync(dir, { recursive: true, force: true });
    return {
      ...workflowSummary(root, "newtrack", args),
      ok: false,
      track_id: trackId,
      stage: "create_beads_tree",
      beads_tree: liveBeads,
    };
  }
  const regen = regenIndex(root);
  return {
    ...workflowSummary(root, "newtrack", args),
    ok: regen.ok !== false,
    dry_run: false,
    track_id: trackId,
    metadata_path: path.relative(root, path.join(dir, "metadata.json")),
    beads_tree: liveBeads,
    regen,
    worktree_plan: worktreePlan(root, { trackId }),
  };
}

function workflowImplement(root: string, args: RuntimeArgs = {}): CoreResult {
  const prep = implementationPrep(root, {
    ...args,
    claim: args.claim === true || args.execute === true,
  });
  const trackId = asOptionalString(prep.selected_track) || args.trackId || args.track_id || null;
  return {
    ...workflowSummary(root, "implement", args),
    ok: prep.ok !== false,
    prepare_implementation: prep,
    phase_schedule: trackId ? phaseSchedule(root, { ...args, trackId }) : null,
  };
}

function workflowStatus(root: string, args: RuntimeArgs = {}): CoreResult {
  const mode = args.mode || args.view || args.status || "live";
  const summary = workflowSummary(root, "status", args);
  if (mode === "team" || args.mine === true) return { ...summary, ok: true, status: teamBoard(root, { ...args, mine: args.mine === true }) };
  if (mode === "fleet" || mode === "repos") return { ...summary, ok: true, status: fleetStatus(root, args) };
  if (mode === "available") return { ...summary, ok: true, status: availableWork(root) };
  if (mode === "collisions") return { ...summary, ok: true, status: collisionScan(root) };
  if (mode === "beads") return { ...summary, ok: true, status: beadsSummary(root) };
  if (mode === "doctor") return { ...summary, ok: true, status: doctor(root, { hasCadreProject: true }) };
  return { ...summary, ok: true, status: liveStatus(root) };
}

function workflowReview(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "review", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  const review = reviewAssist(root, { ...args, trackId });
  const gate = reviewGate(root, trackId, args);
  const provider = args.includeProvider === false ? null : prCiStatus(root, { ...args, trackId });
  const pendingProvider = Boolean(provider && provider.ok === false);
  return {
    ...summary,
    ok: review.ok !== false,
    phase_state: pendingProvider ? "pending_provider" : summary.phase_state,
    track_context: context,
    review_assist: review,
    gate,
    provider,
    required_provider_mcp: provider && provider.ok === false ? provider.required_provider_mcp || null : null,
    required_evidence: provider && provider.ok === false ? provider.required_evidence || null : null,
    unsupported_reason: provider && provider.ok === false ? provider.unsupported_reason || provider.reason || null : null,
    next_actions: provider && Array.isArray(provider.next_actions) ? provider.next_actions : [],
  };
}

function workflowValidate(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "validate", args);
  return {
    ...summary,
    ok: true,
    doctor: doctor(root, { hasCadreProject: true }),
    team: teamStatus(root),
    integrity: planIntegrity(root, args.trackId || args.track_id || null),
    collisions: collisionScan(root),
    fleet: fleetStatus(root, { includeCollisions: false }),
    beads: beadsSummary(root),
  };
}

function workflowArchive(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "archive", args);
  const tracks = listTracks(root).filter((track) =>
    args.trackId || args.track_id
      ? track.track_id === (args.trackId || args.track_id)
      : (track.metadata.status || "new") === "completed"
  );
  if (tracks.length === 0) return { ...summary, ok: false, error: "No completed or selected track found" };
  if (args.execute !== true) {
    return {
      ...summary,
      ok: true,
      dry_run: true,
      tracks: tracks.map((track) => metadataTrackSummary(track)),
    };
  }
  const syncPre = syncControlPlane(root, { mode: "pre" });
  if (syncPre.ok === false) return { ...summary, ok: false, phase_state: "blocked", stage: "sync_pre", sync_pre: syncPre };
  const archived: CoreResult[] = [];
  const archiveRoot = path.join(root, "cadre", "archive");
  fs.mkdirSync(archiveRoot, { recursive: true });
  for (const track of tracks) {
    const target = path.join(archiveRoot, track.track_id);
    if (fileExists(target)) {
      archived.push({ track_id: track.track_id, ok: false, error: "Archive target already exists" });
      continue;
    }
    fs.renameSync(track.dir, target);
    archived.push({ track_id: track.track_id, ok: true, path: path.relative(root, target) });
  }
  const regen = regenIndex(root);
  const syncPost = syncControlPlane(root, { mode: "post" });
  return {
    ...summary,
    ok: archived.every((item) => item.ok !== false) && regen.ok !== false && syncPost.ok !== false,
    phase_state: syncPost.ok === false ? "recovery_required" : "executed",
    dry_run: false,
    archived,
    regen,
    sync_pre: syncPre,
    sync_post: syncPost,
  };
}

function workflowHandoff(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "handoff", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  if (context.ok === false) return { ...summary, ok: false, track_context: context };
  const text = asOptionalString(args.handoffText)
    || [
      `# Handoff: ${trackId}`,
      "",
      `Updated: ${utcNow()}`,
      "",
      "Resume from the packet context returned by Cadre MCP.",
    ].join("\n");
  if (args.execute === true) {
    const track = findTrack(root, trackId);
    if (!track) return { ...summary, ok: false, error: `Track not found: ${trackId}` };
    fs.writeFileSync(path.join(track.dir, "HANDOFF.md"), `${text.replace(/\n*$/, "")}\n`);
  }
  return {
    ...summary,
    ok: true,
    dry_run: args.execute !== true,
    track_context: context,
    beads: beadsSummary(root),
    handoff_path: `cadre/tracks/${trackId}/HANDOFF.md`,
  };
}

function providerActionKind(workflow: string, provider: string): string {
  if (provider === "gitlab") return workflow === "land" ? "open_merge_request_group" : "open_merge_request";
  return workflow === "land" ? "open_pull_request_group" : "open_pull_request";
}

function providerActionsForTrack(root: string, workflow: "ship" | "land", track: CadreTrack, args: RuntimeArgs = {}): PlannedProviderAction[] {
  const provider = providerFromConfig(root, args);
  if (provider === "local") return [];
  const entries = workflow === "land"
    ? repoEntriesForTrack(root, track, args)
    : repoEntriesForTrack(root, track, { ...args, repo: args.repo || "." }).filter((entry) => entry.repo === "." || !loadTopology(root).polyrepo);
  const label = `cadre-track:${track.track_id}`;
  return entries.map((entry) => {
    const repo = asString(entry.repo, ".");
    const target = entry.head || track.metadata.git_branch || `track/${track.track_id}`;
    return {
      id: `${workflow}-${safeName(repo)}`,
      provider,
      kind: providerActionKind(workflow, provider),
      repo,
      track_id: track.track_id,
      title: `${track.track_id}: ${track.metadata.description || track.metadata.name || track.track_id}`,
      source_branch: target,
      target_branch: entry.base || args.base || "main",
      body: [
        `Cadre track: ${track.track_id}`,
        `Repo: ${repo}`,
        "Provider evidence must be fetched through the installed provider MCP and written back to Cadre.",
      ].join("\n"),
      labels: [label],
      evidence_key: `${provider}:${workflow}:${track.track_id}:${repo}`,
      required_evidence: asJsonObject(providerEvidenceRequirement(root, { ...args, trackId: track.track_id })),
    };
  });
}

function shipGitActions(root: string, track: CadreTrack, args: RuntimeArgs = {}): PlannedGitAction[] {
  const remote = args.remote || "origin";
  const base = args.base || "main";
  const branch = args.branch || track.metadata.git_branch || `track/${track.track_id}`;
  return [
    plannedGitAction("ship-fetch", "fetch_base", ".", root, ["fetch", String(remote), String(base)], `Fetch ${remote}/${base}`),
    plannedGitAction("ship-rebase", "rebase_base", ".", root, ["rebase", `${remote}/${base}`], `Rebase ${branch} onto ${remote}/${base}`),
    plannedGitAction("ship-push", "push_branch", ".", root, ["push", "-u", String(remote), String(branch)], `Push ${branch}`),
  ];
}

function landGitActions(root: string, track: CadreTrack, args: RuntimeArgs = {}): PlannedGitAction[] {
  const remote = args.remote || "origin";
  const actions: PlannedGitAction[] = [];
  for (const entry of repoEntriesForTrack(root, track, args)) {
    const repo = asString(entry.repo, ".");
    const branch = asString(entry.head || track.metadata.git_branch || `track/${track.track_id}`);
    actions.push(plannedGitAction(
      `land-push-${safeName(repo)}`,
      "push_repo_branch",
      repo,
      asString(entry.root, root),
      ["push", "-u", String(remote), branch],
      `Push ${repo} branch ${branch}`
    ));
  }
  actions.push(plannedGitAction(
    "land-push-control",
    "push_control_branch",
    ".",
    root,
    ["push", String(remote), args.branch || "HEAD"],
    "Push control-plane branch"
  ));
  return actions;
}

function persistProviderEvidenceIfSupplied(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult | null {
  const evidence = args.evidence || args.providerEvidence || args.provider_evidence;
  if (!evidence || args.execute !== true) return null;
  return providerEvidence(root, {
    ...args,
    trackId: track.track_id,
    evidence,
  });
}

function workflowShip(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "ship", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, error: `Track not found: ${trackId}` };
  const gate = reviewGate(root, trackId, args);
  const provider = args.includeProvider === false ? null : prCiStatus(root, { ...args, trackId });
  const providerActions = providerActionsForTrack(root, "ship", track, args);
  const gitActions = shipGitActions(root, track, args);
  const evidenceSupplied = hasProviderEvidence(args);
  const pendingProvider = Boolean(provider && provider.ok === false && providerActions.length > 0 && !evidenceSupplied);
  const blocked = gate.ok === false;
  const evidenceWrite = persistProviderEvidenceIfSupplied(root, track, args);
  const canExecuteGit = args.execute === true && !blocked && !evidenceSupplied && (!evidenceWrite || evidenceWrite.ok !== false);
  const gitResults = canExecuteGit ? runPlannedGitActions(gitActions) : [];
  const executionFailed = canExecuteGit && !actionResultsOk(gitResults);
  const phaseState: WorkflowPhaseState = executionFailed
    ? "recovery_required"
    : workflowPhaseState(args, blocked || Boolean(evidenceWrite && evidenceWrite.ok === false), pendingProvider);
  return {
    ...summary,
    ok: gate.ok !== false && (!evidenceWrite || evidenceWrite.ok !== false) && !executionFailed,
    phase_state: phaseState,
    gate,
    provider,
    pr_ci_status: provider,
    provider_actions: providerActions,
    git_actions: gitActions,
    git_results: gitResults,
    git_action_state: canExecuteGit ? "executed" : (evidenceSupplied ? "skipped_provider_evidence_continuation" : "pending_execute"),
    provider_evidence_write: evidenceWrite,
    continuation_token: continuationToken("ship", trackId, [...providerActions, ...gitActions]),
    required_provider_mcp: provider && provider.ok === false ? provider.required_provider_mcp || null : null,
    required_evidence: provider && provider.ok === false ? provider.required_evidence || null : null,
    unsupported_reason: provider && provider.ok === false ? provider.unsupported_reason || provider.reason || null : null,
    next_actions: provider && Array.isArray(provider.next_actions) ? provider.next_actions : [],
  };
}

function workflowLand(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "land", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, error: `Track not found: ${trackId}` };
  const topology = loadTopology(root);
  const preflight = polyrepoPreflight(root);
  const gate = reviewGate(root, trackId, args);
  const provider = args.includeProvider === false ? null : prCiStatus(root, { ...args, trackId });
  const providerActions = topology.polyrepo && preflight.ok !== false ? providerActionsForTrack(root, "land", track, args) : [];
  const gitActions = topology.polyrepo && preflight.ok !== false ? landGitActions(root, track, args) : [];
  const evidenceSupplied = hasProviderEvidence(args);
  const pendingProvider = Boolean(provider && provider.ok === false && providerActions.length > 0 && !evidenceSupplied);
  const blocked = !topology.polyrepo || preflight.ok === false || gate.ok === false;
  const evidenceWrite = persistProviderEvidenceIfSupplied(root, track, args);
  const canExecuteGit = args.execute === true && !blocked && !evidenceSupplied && (!evidenceWrite || evidenceWrite.ok !== false);
  const gitResults = canExecuteGit ? runPlannedGitActions(gitActions) : [];
  const executionFailed = canExecuteGit && !actionResultsOk(gitResults);
  const phaseState: WorkflowPhaseState = executionFailed
    ? "recovery_required"
    : workflowPhaseState(args, blocked || Boolean(evidenceWrite && evidenceWrite.ok === false), pendingProvider);
  return {
    ...summary,
    ok: topology.polyrepo && preflight.ok !== false && gate.ok !== false && (!evidenceWrite || evidenceWrite.ok !== false) && !executionFailed,
    phase_state: phaseState,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    preflight,
    gate,
    provider,
    provider_actions: providerActions,
    git_actions: gitActions,
    git_results: gitResults,
    git_action_state: canExecuteGit ? "executed" : (evidenceSupplied ? "skipped_provider_evidence_continuation" : "pending_execute"),
    provider_evidence_write: evidenceWrite,
    continuation_token: continuationToken("land", trackId, [...providerActions, ...gitActions]),
    required_provider_mcp: provider && provider.ok === false ? provider.required_provider_mcp || null : null,
    required_evidence: provider && provider.ok === false ? provider.required_evidence || null : null,
    unsupported_reason: provider && provider.ok === false ? provider.unsupported_reason || provider.reason || null : null,
    next_actions: provider && Array.isArray(provider.next_actions) ? provider.next_actions : [],
    fleet: fleetStatus(root, { includeCollisions: false }),
  };
}

function workflowRelease(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "release", args);
  const completed = listTracks(root)
    .filter((track) => (track.metadata.status || "new") === "completed")
    .map((track) => metadataTrackSummary(track));
  const version = args.releaseVersion || args.release_version || args.bump || args.mode || `release-${utcNow().slice(0, 10)}`;
  const releaseDir = path.join(root, "cadre", "releases");
  const releaseSlug = safeName(version);
  const releaseMd = path.join(releaseDir, `${releaseSlug}.md`);
  const releaseJson = path.join(releaseDir, `${releaseSlug}.json`);
  const notes = asOptionalString(args.releaseNotes || args.release_notes)
    || [
      `# Release ${version}`,
      "",
      `Generated: ${utcNow()}`,
      "",
      "## Completed Tracks",
      "",
      ...completed.map((track) => `- ${track.track_id}: ${track.name}`),
      "",
    ].join("\n");
  const rawArgs = args as UnknownRecord;
  const gitActions = rawArgs.createTag === true || rawArgs.create_tag === true || rawArgs.tag === true
    ? [plannedGitAction("release-tag", "tag_release", ".", root, ["tag", "-a", String(version), "-m", `Cadre release ${version}`], `Create release tag ${version}`)]
    : [];
  if (args.execute !== true) {
    return {
      ...summary,
      ok: true,
      phase_state: "dry_run",
      dry_run: true,
      release_version: version,
      completed_tracks: completed,
      release_artifacts: [path.relative(root, releaseMd), path.relative(root, releaseJson)],
      git_actions: gitActions,
    };
  }
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(releaseMd, notes.endsWith("\n") ? notes : `${notes}\n`);
  writeJson(releaseJson, {
    version: String(version),
    generated_at: utcNow(),
    completed_tracks: completed.map((track) => ({
      track_id: track.track_id,
      name: track.name,
      status: track.status,
      priority: track.priority,
      owner: track.owner,
      reviewer: track.reviewer,
      beads_epic: track.beads_epic,
      review: track.review,
    })),
  });
  const indexPatch = patchJsonFile(path.join(root, "cadre", "setup_state.json"), (current) => {
    current.last_release = {
      version: String(version),
      path: path.relative(root, releaseMd),
      metadata: path.relative(root, releaseJson),
      completed_tracks: completed.length,
      released_at: utcNow(),
    };
    current.updated_at = utcNow();
    return current;
  }, { lock: false });
  const gitResults = runPlannedGitActions(gitActions);
  const gitOk = actionResultsOk(gitResults);
  return {
    ...summary,
    ok: indexPatch.ok !== false && gitOk,
    phase_state: gitOk ? "executed" : "recovery_required",
    dry_run: args.execute !== true,
    bump: args.bump || args.mode || "patch",
    release_version: version,
    completed_tracks: completed,
    release_artifacts: [path.relative(root, releaseMd), path.relative(root, releaseJson)],
    setup_state: indexPatch,
    git_actions: gitActions,
    git_results: gitResults,
  };
}

function workflowRevise(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "revise", args);
  if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
  return {
    ...summary,
    ok: true,
    track_context: trackContext(root, trackId),
    impact: lspImpact(root, args),
  };
}

function revertGitActions(root: string, track: CadreTrack, args: RuntimeArgs = {}): PlannedGitAction[] {
  const plan = parsePlanFile(track.plan_path);
  const requestedCommit = asOptionalString(args.commitSha || args.commit);
  const commits = requestedCommit
    ? [requestedCommit]
    : Array.from(new Set(plan.tasks.flatMap((task) => asStringArray(task.commit_shas || []).concat(task.commit ? [task.commit] : [])))).filter(Boolean);
  const topology = loadTopology(root);
  return commits.reverse().map((commit, index) => {
    const repo = asOptionalString(args.repo) || (topology.polyrepo ? topology.defaultRepo : ".");
    const entry = repoEntriesForTrack(root, track, { ...args, repo }).find((item) => item.repo === repo);
    return plannedGitAction(
      `revert-${index + 1}`,
      "revert_commit",
      repo,
      entry ? asString(entry.root, root) : root,
      ["revert", "--no-edit", commit],
      `Revert ${commit} in ${repo}`
    );
  });
}

function workflowRevert(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = selectedTrackId(root, args);
  const summary = workflowSummary(root, "revert", args);
  if (!trackId) return { ...summary, ok: false, phase_state: "blocked", error: "trackId is required" };
  const track = findTrack(root, trackId);
  if (!track) return { ...summary, ok: false, phase_state: "blocked", error: `Track not found: ${trackId}` };
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return { ...summary, ok: false, phase_state: "blocked", stage: "polyrepo_repo_resolution", repo_error: repoError };
  const gitActions = revertGitActions(root, track, args);
  if (gitActions.length === 0) {
    return {
      ...summary,
      ok: false,
      phase_state: "blocked",
      track_context: trackContext(root, trackId),
      reason: "No commit evidence found to revert; pass commitSha or record task commits first",
      git_actions: gitActions,
    };
  }
  const gitResults = args.execute === true ? runPlannedGitActions(gitActions) : [];
  const gitOk = actionResultsOk(gitResults);
  const statusResult = args.execute === true && gitOk
    ? metadataPatch(root, {
      trackId,
      patch: {
        status: "in_progress",
        last_revert: {
          reverted_at: utcNow(),
          commits: gitActions.map((action) => action.args[action.args.length - 1]).filter((commit): commit is string => typeof commit === "string"),
          reason: args.reason || null,
        },
      },
    })
    : null;
  return {
    ...summary,
    ok: args.execute === true ? gitOk && (!statusResult || statusResult.ok !== false) : true,
    phase_state: args.execute !== true ? "dry_run" : (gitOk ? "executed" : "recovery_required"),
    dry_run: args.execute !== true,
    track_context: trackContext(root, trackId),
    git_actions: gitActions,
    git_results: gitResults,
    metadata_patch: statusResult,
  };
}

function workflowRefresh(root: string, args: RuntimeArgs = {}): CoreResult {
  const summary = workflowSummary(root, "refresh", args);
  const rawArgs = args as UnknownRecord;
  const lspRequested = args.execute === true && (rawArgs.lsp === true || args.setupLsp === true || args.setup_lsp === true || args.writeLsp === true || args.write_lsp === true);
  const lsp = lspRequested ? lspSetup(root, { ...args, execute: true }) : lspSetup(root, { ...args, execute: false });
  const regen = args.execute === true ? regenIndex(root) : null;
  const patternsPath = path.join(root, "cadre", "patterns.md");
  let patterns: CoreResult | null = null;
  if (args.execute === true && fileExists(patternsPath)) {
    const text = fs.readFileSync(patternsPath, "utf8");
    const stamp = `Last refreshed: ${utcNow().slice(0, 10)}`;
    const next = /Last refreshed:\s*.*/.test(text)
      ? text.replace(/Last refreshed:\s*.*/, stamp)
      : `${text.replace(/\n*$/, "\n\n")}${stamp}\n`;
    fs.writeFileSync(patternsPath, next);
    patterns = { ok: true, path: path.relative(root, patternsPath), refreshed_at: stamp };
  }
  return {
    ...summary,
    ok: (!regen || regen.ok !== false) && lsp.ok !== false,
    phase_state: args.execute === true ? "executed" : "dry_run",
    doctor: doctor(root, { hasCadreProject: true }),
    workspace: workspaceDiagnostics(root, { execute: false }),
    dependency_graph: dependencyGraph(root),
    lsp: lspConfigStatus(root),
    lsp_setup: lsp,
    regen,
    patterns,
  };
}

function workflowPacket(root: string, args: RuntimeArgs = {}): CoreResult {
  const workflow = asOptionalString(args.workflow) || asOptionalString(args.action) || "status";
  const mutating = args.execute === true && [
    "newtrack",
    "new_track",
    "handoff",
    "release",
    "revise",
    "refresh",
    "flag",
    "revert",
  ].includes(workflow);
  if (mutating && (args as UnknownRecord).skipSync !== true) {
    const result = withSharedControlPlaneSync(root, args, `workflow:${workflow}`, () =>
      workflowPacket(root, { ...args, skipSync: true })
    );
    return shapeWorkflowResponse(root, workflow, args, result);
  }
  const result = (() => {
  switch (workflow) {
    case "setup":
    case "setup_assist":
    case "setup_scaffold":
      return workflowSetup(root, args);
    case "newtrack":
    case "new_track":
      return workflowNewTrack(root, args);
    case "implement":
      return workflowImplement(root, args);
    case "status":
      return workflowStatus(root, args);
    case "review":
      return workflowReview(root, args);
    case "validate":
      return workflowValidate(root, args);
    case "archive":
      return workflowArchive(root, args);
    case "handoff":
      return workflowHandoff(root, args);
    case "ship":
      return workflowShip(root, args);
    case "land":
      return workflowLand(root, args);
    case "release":
      return workflowRelease(root, args);
    case "revise":
      return workflowRevise(root, args);
    case "refresh":
      return workflowRefresh(root, args);
    case "flag":
      {
        const trackId = selectedTrackId(root, args);
        const summary = workflowSummary(root, "flag", args);
        if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
        const status = asOptionalString(args.status) || "blocked";
        const reason = asOptionalString(args.reason) || asOptionalString(args.note) || null;
        const context = trackContext(root, trackId);
        if (args.execute !== true) {
          return {
            ...summary,
            ok: context.ok !== false,
            dry_run: true,
            track_context: context,
            proposed_status: status,
            reason,
          };
        }
        const statusResult = setTrackStatus(root, trackId, status);
        if (statusResult.ok === false) return { ...summary, ok: false, track_context: context, status_result: statusResult };
        const patch = metadataPatch(root, {
          trackId,
          patch: {
            last_status_reason: reason,
            last_status_at: utcNow(),
          },
        });
        const latestTrack = findTrack(root, trackId);
        const epic = latestTrack?.metadata.beads_epic;
        const beads = epic && reason
          ? beadsTaskWrite(root, {
            operation: "note",
            id: epic,
            note: `Cadre ${status}: ${reason}`,
            dedupKey: `cadre-flag-${trackId}-${status}-${textHash(reason).slice(0, 12)}`,
          })
          : null;
        return {
          ...summary,
          ok: patch.ok !== false && (!beads || beads.ok !== false),
          dry_run: false,
          track_context: context,
          status_result: statusResult,
          metadata_patch: patch,
          beads,
        };
      }
    case "revert":
      return workflowRevert(root, args);
    case "formula":
      return {
        ...workflowSummary(root, "formula", args),
        ok: true,
        formulas: commandExists("bd", root) ? beadsTaskWrite(root, { operation: "formula_list" }) : { ok: false, available: false },
      };
    default:
      return {
        ...workflowSummary(root, workflow, args),
        ok: false,
        error: `Unknown Cadre workflow packet: ${workflow}`,
      };
  }
  })();
  return shapeWorkflowResponse(root, workflow, args, result);
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

function topologyRepoEntries(topology: TopologyWithConfig): Record<string, RepoRuntimeInfo> {
  const entries: Record<string, RepoRuntimeInfo> = {};
  for (const raw of Array.isArray(topology.repos.repos) ? topology.repos.repos : []) {
    const repo = asJsonObject(raw);
    const name = asOptionalString(repo.name);
    if (!name) continue;
    entries[name] = {
      submodule_path: asOptionalString(repo.submodule_path) || "",
      base_branch: asOptionalString(repo.default_branch) || asOptionalString(repo.base_branch) || "main",
    };
  }
  return entries;
}

function trackRepoEntries(root: string, track: CadreTrack): Record<string, RepoRuntimeInfo> {
  const topology = loadTopology(root);
  const entries = topologyRepoEntries(topology);
  const reposMetadata = isRecord(track.metadata.repos) ? track.metadata.repos : null;
  if (reposMetadata) {
    for (const [repo, rawInfo] of Object.entries(reposMetadata)) {
      entries[repo] = { ...entries[repo], ...(asJsonObject(rawInfo) as RepoRuntimeInfo) };
    }
  }
  return entries;
}

function availableRepoNames(root: string, track: CadreTrack): string[] {
  return Object.keys(trackRepoEntries(root, track)).sort();
}

function unresolvedWorkingRoot(root: string, track: CadreTrack, repo: string, task: PlanTask | null = null): WorkingRootError {
  return {
    ok: false,
    repo,
    path: "",
    source: "polyrepo-unresolved-repo",
    error: `Unknown polyrepo task repo "${repo}" for track ${track.track_id}`,
    unresolved_repo: repo,
    available_repos: availableRepoNames(root, track),
    track_id: track.track_id,
    task_key: task?.task_key,
  };
}

function isWorkingRootError(value: WorkingRootResolution): value is WorkingRootError {
  return value.ok === false;
}

function unresolvedPlanRepos(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult[] {
  const topology = loadTopology(root);
  if (!topology.polyrepo) return [];
  const entries = trackRepoEntries(root, track);
  const known = new Set(Object.keys(entries));
  const plan = parsePlanFile(track.plan_path);
  const errors: CoreResult[] = [];
  const seen = new Set<string>();
  for (const task of plan.tasks || []) {
    const repo = asOptionalString(args.repo) || task.repo || topology.defaultRepo;
    if (repo && known.has(repo)) continue;
    const key = `${repo || ""}:${task.task_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push({
      track_id: track.track_id,
      task_key: task.task_key,
      line: task.line,
      repo: repo || null,
      message: repo
        ? `Unknown polyrepo task repo "${repo}"`
        : "Task has no repo annotation and repos.json has no default_repo",
      available_repos: Array.from(known).sort(),
    });
  }
  return errors;
}

function repoEntriesError(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult | null {
  const topology = loadTopology(root);
  if (!topology.polyrepo) return null;
  const entries = trackRepoEntries(root, track);
  const requested = asOptionalString(args.repo);
  const missing = requested
    ? (entries[requested] ? [] : [{ repo: requested, message: `Unknown polyrepo repo "${requested}"` }])
    : unresolvedPlanRepos(root, track, args);
  if (missing.length === 0) return null;
  return {
    ok: false,
    stage: "polyrepo_repo_resolution",
    track_id: track.track_id,
    errors: missing,
    available_repos: Object.keys(entries).sort(),
  };
}

function resolveTaskWorkingRoot(root: string, track: CadreTrack, task: PlanTask | null = null, args: RuntimeArgs = {}): WorkingRootResolution {
  if (args.workingRoot) {
    const candidate = path.isAbsolute(args.workingRoot)
      ? args.workingRoot
      : path.resolve(root, args.workingRoot);
    return { repo: args.repo || task?.repo || ".", path: candidate, source: "argument.workingRoot" };
  }
  const topology = loadTopology(root);
  if (topology.polyrepo) {
    const repo = args.repo || task?.repo || topology.defaultRepo;
    const info = typeof repo === "string" ? trackRepoEntries(root, track)[repo] || {} : {};
    if (Object.keys(info).length > 0) {
      const rel = info.worktree_path || info.submodule_path || "";
      return {
        repo,
        path: rel ? path.resolve(root, rel) : root,
        source: info.worktree_path ? "metadata.repos.worktree_path" : "metadata.repos.submodule_path",
      };
    }
    return unresolvedWorkingRoot(root, track, String(repo || ""), task);
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
  if (topology.polyrepo) {
    const repos = trackRepoEntries(root, track);
    return Object.entries(repos)
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
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
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
  const styleGuides = implementationStyleGuides(root, trackId, args);
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
    styleGuides,
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

function likelyTestCandidatesForFile(root: string, file: string): string[] {
  const normalized = normalizeClaimPath(file);
  if (!normalized) return [];
  const parsed = path.parse(normalized);
  const candidates = [
    path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
    path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`),
    path.join(parsed.dir, `${parsed.name}_test${parsed.ext}`),
    path.join("test", normalized),
    path.join("tests", normalized),
  ].map((candidate) => normalizeClaimPath(candidate));
  return Array.from(new Set(candidates.filter((candidate) => fileExists(path.join(root, candidate)))));
}

function planAssist(root: string, args: RuntimeArgs = {}): CoreResult {
  const trackId = args.trackId || args.track_id || null;
  const track = trackId ? findTrack(root, trackId) : null;
  if (trackId && !track && !args.planText) return { ok: false, error: `Track not found: ${trackId}` };
  const topology = loadTopology(root);
  const plan = args.planText
    ? parsePlanText(args.planText)
    : track
      ? parsePlanFile(track.plan_path)
      : null;
  if (!plan) return { ok: false, error: "trackId or planText is required" };

  const repoErrors = track ? unresolvedPlanRepos(root, track, args) : [];
  const claims = (plan.tasks || []).map((task) => {
    const repo = topology.polyrepo ? task.repo || topology.defaultRepo : ".";
    return {
      phase_index: task.phase_index,
      task_index: task.task_index,
      task_key: task.task_key,
      title: task.title,
      repo,
      files: task.files || [],
      depends: task.depends || [],
      likely_tests: (task.files || []).flatMap((file) => likelyTestCandidatesForFile(root, file)),
    };
  });
  const fileClaims: Record<string, string[]> = {};
  for (const claim of claims) {
    const repo = asString(claim.repo, ".");
    if (!fileClaims[repo]) fileClaims[repo] = [];
    fileClaims[repo].push(...asStringArray(claim.files));
  }
  const rawFileClaims = Object.fromEntries(Object.entries(fileClaims).map(([repo, files]) => [repo, [...files]]));
  for (const repo of Object.keys(fileClaims)) {
    const files = fileClaims[repo] || [];
    fileClaims[repo] = Array.from(new Set(files.map(normalizeClaimPath).filter(Boolean))).sort();
  }
  const duplicateClaims = Object.entries(rawFileClaims).flatMap(([repo, files]) => {
    const counts = new Map<string, number>();
    for (const file of files) counts.set(file, (counts.get(file) || 0) + 1);
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([file, count]) => ({ repo, file, count }));
  });
  const phases = (plan.phases || []).map((phase) => {
    const phaseClaims = claims.filter((claim) => claim.phase_index === phase.phase_index);
    const phaseFiles = phaseClaims.flatMap((claim) => asStringArray(claim.files).map((file) => `${claim.repo}:${normalizeClaimPath(file)}`));
    return {
      phase_index: phase.phase_index,
      title: phase.title,
      execution: phase.annotations.execution || "sequential",
      tasks: phase.tasks.length,
      parallel_candidate: phaseClaims.length > 1 && new Set(phaseFiles).size === phaseFiles.length,
    };
  });
  const files = Array.from(new Set(Object.values(fileClaims).flat())).slice(0, Number(args.limit || 50));
  const semanticImpact = files.length > 0 ? lspImpact(root, { files, limit: args.limit || 50 }) : null;
  const schedule = track ? phaseSchedule(root, { ...args, trackId: track.track_id }) : null;
  return {
    ok: repoErrors.length === 0 && plan.ok !== false,
    root,
    track_id: track?.track_id || trackId,
    topology: {
      polyrepo: topology.polyrepo,
      default_repo: topology.defaultRepo,
    },
    claims,
    file_claims: fileClaims,
    duplicate_claims: duplicateClaims,
    likely_tests: Array.from(new Set(claims.flatMap((claim) => asStringArray(claim.likely_tests)))).sort(),
    phases,
    schedule,
    semantic_impact: semanticImpact,
    errors: [...(plan.errors || []), ...repoErrors],
    warnings: plan.warnings || [],
  };
}

function worktreePlan(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
  const topology = loadTopology(root);
  const branch = args.branch || track.metadata.git_branch || `track/${track.track_id}`;
  const entries = topology.polyrepo
    ? repoEntriesForTrack(root, track, args)
    : [{
      repo: ".",
      root,
      path: ".",
      source: "project-root",
      base: args.base || "main",
      head: branch,
    }];
  const plans = entries.map((entry) => {
    const repo = asString(entry.repo, ".");
    const repoBranch = args.branch || entry.head || branch;
    const base = args.base || entry.base || "main";
    const relWorktree = topology.polyrepo
      ? `.worktrees/${track.track_id}/${safeName(repo)}`
      : asOptionalString(track.metadata.worktree_path) || `.worktrees/${track.track_id}`;
    const absWorktree = path.resolve(root, relWorktree);
    return {
      repo,
      source_root: entry.root,
      source_path: entry.path,
      worktree_path: relWorktree,
      branch: repoBranch,
      base,
      exists: fileExists(absWorktree),
      commands: [
        {
          command: "git",
          args: ["worktree", "add", "-B", repoBranch, absWorktree, base],
          cwd: entry.root,
        },
      ],
    };
  });
  return {
    ok: true,
    root,
    track_id: track.track_id,
    execute: false,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    plans,
  };
}

function planIntegrity(root: string, trackId: string | null = null): CoreResult {
  const topology = loadTopology(root);
  const foundTrack = trackId ? findTrack(root, trackId) : null;
  const tracks: CadreTrack[] = trackId ? (foundTrack ? [foundTrack] : []) : listTracks(root);
  if (trackId && tracks.length === 0) return { ok: false, error: `Track not found: ${trackId}` };
  const errors: CoreResult[] = [];
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
    errors.push(...unresolvedPlanRepos(root, track));
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
  return withSharedControlPlaneSync(root, args, "complete_task", () => completeTaskInner(root, { ...args, skipSync: true }));
}

function completeTaskInner(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const plan = parsePlanFile(track.plan_path);
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };

  const workingRoot = resolveTaskWorkingRoot(root, track, task, args);
  if (isWorkingRootError(workingRoot)) {
    return {
      ok: false,
      stage: "polyrepo_repo_resolution",
      blocked: true,
      working_root: workingRoot,
      reason: workingRoot.error,
    };
  }
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
  return withSharedControlPlaneSync(root, args, "record_parallel_worker", () => recordParallelWorkerInner(root, args));
}

function recordParallelWorkerInner(root: string, args: RuntimeArgs = {}): CoreResult {
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
  if (status === "awaiting_merge" && !args.commitSha && !args.commit && args.allowNoCommit !== true) {
    return { ok: false, error: "commitSha is required before a parallel worker can move to awaiting_merge" };
  }

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

function parallelStatePath(track: CadreTrack): string {
  return path.join(track.dir, "parallel_state.json");
}

function readParallelState(track: CadreTrack): ParallelState {
  const existing = readJson<unknown>(parallelStatePath(track), {
    track_id: track.track_id,
    execution_mode: "parallel",
    started_at: utcNow(),
    workers: [],
  });
  const existingObject = isRecord(existing) ? asJsonObject(existing) : {};
  return {
    ...existingObject,
    track_id: asOptionalString(existingObject.track_id) || track.track_id,
    execution_mode: asOptionalString(existingObject.execution_mode) || "parallel",
    started_at: asOptionalString(existingObject.started_at) || utcNow(),
    workers: Array.isArray(existingObject.workers)
      ? existingObject.workers.map((worker) => asJsonObject(worker) as unknown as ParallelWorker)
      : [],
  };
}

function parallelWorkersForWave(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const schedule = phaseSchedule(root, { ...args, trackId: track.track_id });
  if (schedule.ok === false) return schedule;
  const readyGroups = Array.isArray(schedule.ready_groups) ? schedule.ready_groups : [];
  const groupIndex = Number(args.groupIndex || 0);
  const phaseIds = asStringArray(readyGroups[groupIndex]);
  const plan = parsePlanFile(track.plan_path);
  const state = readParallelState(track);
  const activeWorkers = state.workers.filter((worker) =>
    ["in_progress", "awaiting_merge", "merged"].includes(worker.status)
  );
  const activeTaskKeys = new Set(activeWorkers.map((worker) => asOptionalString(worker.task_key)).filter(Boolean));
  const completeTaskKeys = new Set(
    plan.tasks
      .filter((task) => ["x", "-"].includes(task.marker))
      .map((task) => task.task_key)
      .concat(activeWorkers
        .filter((worker) => ["awaiting_merge", "merged"].includes(worker.status))
        .map((worker) => asString(worker.task_key))
        .filter(Boolean))
  );
  const activeClaims = activeWorkers.flatMap((worker) => {
    const phase = plan.phases.find((item) => item.phase_index === worker.phase_index);
    const task = phase?.tasks.find((item) => item.task_index === worker.task_index || item.task_key === worker.task_key);
    return (task?.files || []).map((file) => ({
      repo: asOptionalString(worker.repo) || task?.repo || ".",
      file: normalizeClaimPath(file),
      worker_id: worker.worker_id,
      task_key: worker.task_key,
    }));
  });
  const normalizeTaskDependency = (phase: PlanPhase, dep: string): string => {
    const taskMatch = dep.match(/^task(\d+)$/i);
    if (taskMatch?.[1]) return `phase${phase.phase_index}_task${taskMatch[1]}`;
    const phaseTaskMatch = dep.match(/^phase(\d+)_task(\d+)$/i);
    if (phaseTaskMatch?.[1] && phaseTaskMatch[2]) return `phase${phaseTaskMatch[1]}_task${phaseTaskMatch[2]}`;
    return dep;
  };
  const taskIsReady = (phase: PlanPhase, task: PlanTask): boolean => {
    if (["x", "-", "!", "~"].includes(task.marker)) return false;
    if (activeTaskKeys.has(task.task_key)) return false;
    const dependencies = (task.depends || []).map((dep) => normalizeTaskDependency(phase, dep));
    if (dependencies.some((dep) => !completeTaskKeys.has(dep))) return false;
    const taskClaims = (task.files || []).map((file) => ({
      repo: task.repo || loadTopology(root).defaultRepo || ".",
      file: normalizeClaimPath(file),
    }));
    return taskClaims.every((claim) =>
      activeClaims.every((active) => claim.repo !== active.repo || !claimsOverlap(claim.file, active.file))
    );
  };
  const readyTasksForPhase = (phase: PlanPhase): PlanTask[] => {
    const execution = asString(phase.annotations.execution, "sequential");
    if (execution === "parallel") return phase.tasks.filter((task) => taskIsReady(phase, task));
    const firstOpen = phase.tasks.find((task) => !["x", "-"].includes(task.marker));
    return firstOpen && taskIsReady(phase, firstOpen) ? [firstOpen] : [];
  };
  const phases = plan.phases.filter((phase) => phaseIds.includes(`phase${phase.phase_index}`));
  const workers = phases
    .flatMap((phase) => readyTasksForPhase(phase).map((task) => ({
      worker_id: `${track.track_id}_${asString(task.task_key)}`,
      phase_id: `phase${phase.phase_index}`,
      phase_index: phase.phase_index,
      task_index: task.task_index,
      task_key: asString(task.task_key),
      title: asString(task.title),
      marker: asString(task.marker),
      repo: asString(task.repo, loadTopology(root).defaultRepo || "."),
      files: asStringArray(task.files),
      branch: `${track.metadata.git_branch || `track/${track.track_id}`}-${safeName(task.task_key)}`,
    })))
    .filter((worker) => !["x", "-"].includes(worker.marker));
  return {
    ok: true,
    track_id: track.track_id,
    schedule,
    state,
    group_index: groupIndex,
    phase_ids: phaseIds,
    workers,
  };
}

function plannedCommand(command: string, args: string[], cwd: string): CoreResult {
  return { command, args, cwd };
}

function runPlannedCommands(commands: CoreResult[]): CommandResult[] {
  return commands.map((entry) => runCommand(asString(entry.command), asStringArray(entry.args), { cwd: asString(entry.cwd) }));
}

function workerDispatchPayload(root: string, track: CadreTrack, worker: JsonObject, worktree: string, sourceRoot: string): JsonObject {
  const workerId = asString(worker.worker_id);
  const taskKey = asString(worker.task_key);
  const repo = asString(worker.repo, ".");
  const ownedFiles = asStringArray(worker.files);
  const prompt = [
    `You are a Cadre parallel worker for track ${track.track_id}.`,
    `Worker: ${workerId}`,
    `Task: ${taskKey} - ${asString(worker.title)}`,
    `Repo: ${repo}`,
    `Source root: ${sourceRoot}`,
    `Worker worktree: ${worktree}`,
    ownedFiles.length > 0 ? `Owned files: ${ownedFiles.join(", ")}` : "Owned files: none declared; inspect the task plan before editing.",
    "Use only Cadre packets for Cadre, Beads, provider, index, and worker-state mutations.",
    "Change only the assigned product files unless the task requires a narrowly related test or manifest update.",
    "Run the smallest relevant tests first, then the configured project gate when practical.",
    "Commit the worker worktree changes and return the structured result JSON.",
  ].join("\n");
  return {
    prompt,
    repo,
    worktree,
    source_root: sourceRoot,
    owned_files: ownedFiles,
    expected_result_schema: {
      type: "object",
      required: ["worker_id", "task_key", "repo", "status", "summary", "files_changed", "tests", "commit_sha"],
      properties: {
        worker_id: { type: "string" },
        task_key: { type: "string" },
        repo: { type: "string" },
        status: { type: "string", enum: ["awaiting_merge", "blocked"] },
        summary: { type: "string" },
        files_changed: { type: "array", items: { type: "string" } },
        tests: { type: "array", items: { type: "object" } },
        coverage: { type: ["number", "null"] },
        commit_sha: { type: ["string", "null"] },
        blockers: { type: "array", items: { type: "string" } },
      },
    },
    evidence_requirements: {
      commit: "Required unless blocked before code changes; record the commit SHA in record_finish.",
      tests: "Include every command run, cwd, exit status, and relevant stdout/stderr tail.",
      coverage: "Include parsed coverage when available or a reason coverage was not produced.",
    },
    record_finish_packet: {
      tool: "cadre_parallel",
      arguments: {
        root,
        action: "record_finish",
        trackId: track.track_id,
        workerId,
        status: "awaiting_merge",
        phaseIndex: worker.phase_index,
        taskIndex: worker.task_index,
        repo,
        commitSha: "<commit-sha>",
        coverage: "<coverage-number-or-null>",
      },
    },
  };
}

function parallelSetupWorkers(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const wave = parallelWorkersForWave(root, track, args);
  if (wave.ok === false) return wave;
  const topology = loadTopology(root);
  const entries = new Map(repoEntriesForTrack(root, track, args).map((entry) => [entry.repo, entry]));
  const commands: CoreResult[] = [];
  const workers: JsonObject[] = asArray(wave.workers).map((rawWorker): JsonObject => {
    const worker = asJsonObject(rawWorker);
    const repo = asString(worker.repo, ".");
    const entry = entries.get(repo) || { root, base: args.base || "main" };
    const worktree = path.resolve(root, ".worktrees", track.track_id, safeName(repo), safeName(worker.task_key));
    const sourceRoot = asString(entry.root || root);
    commands.push(plannedCommand(
      "git",
      ["worktree", "add", "-B", asString(worker.branch), worktree, asString(entry.base || args.base || "main")],
      sourceRoot
    ));
    return {
      ...worker,
      worktree,
      source_root: sourceRoot,
      dispatch: workerDispatchPayload(root, track, worker, worktree, sourceRoot),
    };
  });
  const execute = args.execute === true;
  const results = execute ? runPlannedCommands(commands) : [];
  const stateRecords: CoreResult[] = [];
  if (execute) {
    workers.forEach((worker, index) => {
      const commandResult = results[index];
      if (commandResult && commandResult.ok) {
        stateRecords.push(recordParallelWorker(root, {
          ...args,
          skipSync: true,
          trackId: track.track_id,
          workerId: asString(worker.worker_id),
          status: "in_progress",
          phaseIndex: asNumber(worker.phase_index),
          taskIndex: asNumber(worker.task_index),
          repo: asString(worker.repo, "."),
          worktree: asString(worker.worktree),
          branch: asString(worker.branch),
        }));
      }
    });
  }
  return {
    ok: results.every((result) => result.ok) && stateRecords.every((record) => record.ok !== false),
    track_id: track.track_id,
    action: "setup_workers",
    execute,
    dry_run: !execute,
    topology: topology.polyrepo ? "polyrepo" : "monorepo",
    workers,
    commands,
    results,
    state_records: stateRecords,
  };
}

function workerRepoRoot(root: string, track: CadreTrack, worker: ParallelWorker, args: RuntimeArgs = {}): string {
  const repo = asOptionalString(worker.repo) || asOptionalString(args.repo) || ".";
  const entry = repoEntriesForTrack(root, track, { ...args, repo }).find((item) => item.repo === repo);
  return asString(entry?.root, root);
}

function parallelMergeBack(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const state = readParallelState(track);
  const force = args.force === true;
  const workers = state.workers
    .filter((worker) => !args.workerId || worker.worker_id === args.workerId)
    .filter((worker) => force || worker.status === "awaiting_merge");
  const skipped = state.workers
    .filter((worker) => !args.workerId || worker.worker_id === args.workerId)
    .filter((worker) => !workers.includes(worker))
    .map((worker) => ({ worker_id: worker.worker_id, status: worker.status, reason: "worker is not awaiting_merge" }));
  const commands = workers
    .filter((worker) => worker.branch || worker.commit_sha)
    .map((worker) => plannedCommand("git", ["merge", "--no-ff", asString(worker.commit_sha || worker.branch)], workerRepoRoot(root, track, worker, args)));
  const execute = args.execute === true;
  const results = execute ? runPlannedCommands(commands) : [];
  const stateRecords: CoreResult[] = [];
  if (execute) {
    workers.forEach((worker, index) => {
      const result = results[index];
      if (result && result.ok) {
        const recordArgs: RuntimeArgs = {
          ...args,
          skipSync: true,
          trackId: track.track_id,
          workerId: worker.worker_id,
          status: "merged",
        };
        if (worker.phase_index != null) recordArgs.phaseIndex = worker.phase_index;
        if (worker.task_index != null) recordArgs.taskIndex = worker.task_index;
        if (worker.repo) recordArgs.repo = worker.repo;
        if (worker.worktree) recordArgs.worktree = worker.worktree;
        if (worker.branch) recordArgs.branch = worker.branch;
        if (worker.commit_sha) recordArgs.commitSha = worker.commit_sha;
        stateRecords.push(recordParallelWorker(root, recordArgs));
      }
    });
  }
  return {
    ok: results.every((result) => result.ok) && stateRecords.every((record) => record.ok !== false),
    track_id: track.track_id,
    action: "merge_back",
    execute,
    dry_run: !execute,
    workers,
    skipped,
    commands,
    results,
    state_records: stateRecords,
  };
}

function parallelCleanup(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const state = readParallelState(track);
  const force = args.force === true;
  const workers = state.workers.filter((worker) => worker.worktree && (force || worker.status === "merged"));
  const skipped = state.workers
    .filter((worker) => worker.worktree && !workers.includes(worker))
    .map((worker) => ({ worker_id: worker.worker_id, status: worker.status, reason: "worker is not merged" }));
  const commands = workers.map((worker) => plannedCommand("git", ["worktree", "remove", asString(worker.worktree)], workerRepoRoot(root, track, worker, args)));
  const execute = args.execute === true;
  const results = execute ? runPlannedCommands(commands) : [];
  return {
    ok: results.every((result) => result.ok),
    track_id: track.track_id,
    action: "cleanup",
    execute,
    dry_run: !execute,
    workers,
    skipped,
    commands,
    results,
  };
}

function parallelWorkflow(root: string, args: RuntimeArgs = {}): CoreResult {
  const action = args.action || "plan";
  const mutating = ["setup_workers", "record_finish", "merge_back", "cleanup"].includes(action);
  if (mutating && args.execute === true && (args as UnknownRecord).skipSync !== true) {
    return withSharedControlPlaneSync(root, args, `parallel:${action}`, () =>
      parallelWorkflow(root, { ...args, skipSync: true })
    );
  }
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
  if (action === "plan") {
    const schedule = phaseSchedule(root, { ...args, trackId: track.track_id });
    return { ok: schedule.ok !== false, track_id: track.track_id, schedule, state: readParallelState(track) };
  }
  if (action === "next_wave") return parallelWorkersForWave(root, track, args);
  if (action === "setup_workers") return parallelSetupWorkers(root, track, args);
  if (action === "record_finish") {
    if (args.execute !== true) {
      return {
        ok: true,
        track_id: track.track_id,
        action,
        dry_run: true,
        planned_record: {
          worker_id: args.workerId || args.worker_id,
          status: args.status || "awaiting_merge",
          phase_index: args.phaseIndex ?? null,
          task_index: args.taskIndex ?? null,
          commit_sha: args.commitSha || null,
        },
      };
    }
    return recordParallelWorker(root, { ...args, trackId: track.track_id, status: args.status || "awaiting_merge" });
  }
  if (action === "merge_back") return parallelMergeBack(root, track, args);
  if (action === "cleanup") return parallelCleanup(root, track, args);
  return { ok: false, error: `Unknown parallel action: ${action}` };
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
  if (pins.ok === false) return pins;
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

function reviewEvidencePath(track: CadreTrack): string {
  return path.join(track.dir, "review-evidence.json");
}

function reviewEvidence(root: string, trackId: string | null | undefined): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const evidencePath = reviewEvidencePath(track);
  const evidence = readJson<JsonObject>(evidencePath, {
    track_id: track.track_id,
    entries: [],
  });
  return {
    ok: true,
    track_id: track.track_id,
    path: path.relative(root, evidencePath),
    evidence,
  };
}

function providerEvidence(root: string, args: RuntimeArgs = {}): CoreResult {
  const track = findTrack(root, args.trackId || args.track_id);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId || args.track_id}` };
  return withTrackLock(root, track.track_id, () => providerEvidenceUnlocked(root, track, args));
}

function providerEvidenceUnlocked(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const evidencePath = reviewEvidencePath(track);
  const existing = readJson<JsonObject>(evidencePath, {
    track_id: track.track_id,
    entries: [],
  });
  const entries = Array.isArray(existing.entries) ? existing.entries.map(asJsonObject) : [];
  const findings = Array.isArray(args.findings) ? args.findings.map(asJsonObject) : [];
  const blockingCount = findings.filter((finding) =>
    finding.blocking === true || asString(finding.severity) === "blocking"
  ).length;
  const provider = args.provider || providerFromConfig(root, args);
  const fetched = args.evidence || args.providerEvidence || args.provider_evidence || null;
  const providerStatus = fetched ? asJsonObject(fetched) : null;
  if (!providerStatus && args.fetch !== false) {
    return {
      ok: false,
      track_id: track.track_id,
      stage: "provider_mcp_evidence_required",
      provider,
      requirement: providerEvidenceRequirement(root, { ...args, trackId: track.track_id }),
    };
  }
  const entry: JsonObject = {
    id: `review-${entries.length + 1}`,
    recorded_at: utcNow(),
    provider,
    reviewer: args.reviewer || gitIdentity(root) || null,
    reviewed_sha: args.reviewedSha || args.reviewed_sha || gitRevParse(root, "HEAD"),
    blocking_count: Number(args.blockingCount ?? blockingCount),
    verdict: args.verdict || null,
    findings,
    evidence: providerStatus,
    notes: asOptionalString(args.notes) || null,
  };
  const next = {
    ...existing,
    track_id: track.track_id,
    entries: [...entries, entry],
    updated_at: entry.recorded_at,
  };
  writeJson(evidencePath, next);
  const metadata = patchJsonFile(track.metadata_path, (current) => {
    current.review_evidence = {
      path: path.relative(root, evidencePath),
      entries: asArray(next.entries).length || entries.length + 1,
      latest_id: entry.id,
      latest_recorded_at: entry.recorded_at,
      provider,
      blocking_count: entry.blocking_count,
    };
    return current;
  }, { lock: false });
  if (!metadata.ok) return { ok: false, track_id: track.track_id, stage: "metadata_patch", metadata };
  return {
    ok: true,
    track_id: track.track_id,
    path: path.relative(root, evidencePath),
    entry,
    metadata,
  };
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
  let workingRoot: WorkingRootResolution = {
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
    if (isWorkingRootError(workingRoot)) {
      return {
        ok: false,
        available: false,
        stage: "polyrepo_repo_resolution",
        working_root: workingRoot,
        reason: workingRoot.error,
      };
    }
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
  if (track) {
    const repoError = repoEntriesError(root, track, args);
    if (repoError) return repoError;
  }
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
  return asOptionalString(configuredProvider(root, args).provider_mode) || "local";
}

function providerEvidenceRequirement(root: string, args: RuntimeArgs = {}): CoreResult {
  const providerInfo = configuredProvider(root, args);
  const provider = asOptionalString(providerInfo.provider_mode) || "local";
  const track = args.trackId ? findTrack(root, args.trackId) : null;
  const branch = args.branch || (track && (track.metadata.git_branch || `track/${track.track_id}`)) || null;
  const target = args.pr || args.prNumber || args.mr || branch || null;
  const kind = provider === "gitlab" ? "gitlab_merge_request_status" : "github_pull_request_status";
  const minimumFields = provider === "gitlab"
    ? ["url", "state", "source_branch", "target_branch", "head_sha", "approvals", "pipeline_status", "discussions"]
    : ["url", "state", "head_ref", "base_ref", "head_sha", "review_decision", "status_checks", "workflow_runs", "comments"];
  return {
    ok: false,
    available: false,
    provider,
    target,
    branch,
    provider_mode: provider,
    required_provider_mcp: provider === "local" ? null : {
      provider,
      server: provider,
      purpose: "Fetch provider evidence through the installed provider MCP. CLI fallback is intentionally disabled.",
    },
    required_evidence: provider === "local" ? null : {
      kind,
      provider,
      target,
      branch,
      minimum_fields: minimumFields,
      write_back: {
        tool: "cadre_review",
        action: "provider_evidence",
        trackId: args.trackId || args.track_id || null,
      },
    },
    next_actions: provider === "local"
      ? []
      : [
        `Use the installed ${provider} MCP to fetch PR/MR metadata, reviews, checks or pipeline status, and discussion evidence for the target.`,
        "Call cadre_review with action provider_evidence and the fetched evidence before recording review or shipping.",
      ],
    reason: provider === "local"
      ? "provider_mode is local; provider evidence is not required"
      : `${provider} provider evidence must come from the ${provider} MCP; CLI fallback is disabled`,
    unsupported_reason: provider === "local"
      ? null
      : `provider_mode ${provider} requires ${provider} MCP evidence; Cadre workflow packets do not use provider CLI fallback`,
  };
}

function prCiStatus(root: string, args: RuntimeArgs = {}): CoreResult {
  const provider = providerFromConfig(root, args);
  const evidence = args.evidence || args.providerEvidence || args.provider_evidence || null;
  if (provider === "local") {
    return {
      ok: true,
      available: false,
      skipped: true,
      provider,
      provider_mode: "local",
      reason: "provider_mode is local; no provider MCP evidence required",
    };
  }
  if (provider !== "github" && provider !== "gitlab") {
    return { ok: false, available: false, provider, reason: `Unsupported provider_mode: ${provider}` };
  }
  if (evidence) {
    return {
      ok: true,
      available: true,
      provider,
      provider_mode: provider,
      evidence_source: `${provider}_mcp`,
      evidence: asJsonObject(evidence),
    };
  }
  return providerEvidenceRequirement(root, args);
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
  const repoError = repoEntriesError(root, track, args);
  if (repoError) return repoError;
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

function selectedRepoNames(args: RuntimeArgs = {}): Set<string> | null {
  const values = [
    asOptionalString(args.repo),
    ...asStringArray((args as UnknownRecord).repos),
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? new Set(values) : null;
}

function intelRepoRoots(root: string, args: RuntimeArgs = {}): RepoExecutionEntry[] {
  const selected = selectedRepoNames(args);
  const topology = loadTopology(root);
  const control: RepoExecutionEntry = {
    repo: ".",
    root,
    path: ".",
    source: "control-root",
  };
  if (!topology.polyrepo) return selected && !selected.has(".") ? [] : [control];
  const entries: RepoExecutionEntry[] = [control];
  for (const raw of Array.isArray(topology.repos.repos) ? topology.repos.repos : []) {
    const repo = asJsonObject(raw);
    if (repo.enabled === false) continue;
    const name = asOptionalString(repo.name);
    const rel = asOptionalString(repo.submodule_path);
    if (!name || !rel) continue;
    entries.push({
      repo: name,
      root: path.resolve(root, rel),
      path: rel,
      source: "repos.json",
    });
  }
  return selected ? entries.filter((entry) => selected.has(entry.repo)) : entries;
}

function combineLanguageCounts(entries: CoreResult[]): JsonObject {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const languages = asJsonObject(entry.by_language);
    for (const [language, count] of Object.entries(languages)) {
      counts[language] = (counts[language] || 0) + Number(count || 0);
    }
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

const GENERIC_SYMBOL_PATTERNS = [
  /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g,
  /\b(?:export\s+)?(?:class|interface|type|enum|struct|record|trait)\s+([A-Za-z_$][\w$]*)\b/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g,
];

const LANGUAGE_SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\b/gm, /^\s*class\s+([A-Za-z_][\w]*)\b/gm],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\b/gm, /^\s*type\s+([A-Za-z_][\w]*)\s+/gm],
  rust: [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:pub\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_][\w]*)\b/gm],
  java: [/^\s*(?:public|private|protected|static|final|abstract|sealed|non-sealed|\s)*(?:class|interface|enum|record)\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:public|private|protected|static|final|abstract|synchronized|native|\s)*[\w<>\[\].?,\s]+\s+([A-Za-z_][\w]*)\s*\(/gm],
  kotlin: [/^\s*(?:public|private|protected|internal|open|final|abstract|data|sealed|\s)*(?:class|interface|object|enum|typealias)\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:public|private|protected|internal|suspend|inline|tailrec|operator|infix|fun|\s)*fun\s+([A-Za-z_][\w]*)\b/gm],
  swift: [/^\s*(?:public|private|internal|open|fileprivate|static|final|mutating|nonmutating|\s)*(?:func|class|struct|enum|protocol)\s+([A-Za-z_][\w]*)\b/gm],
  csharp: [/^\s*(?:public|private|protected|internal|static|partial|sealed|abstract|virtual|override|\s)*(?:class|interface|record|struct|enum)\s+([A-Za-z_][\w]*)\b/gm, /^\s*(?:public|private|protected|internal|static|async|\s)*[\w<>\[\].?,\s]+\s+([A-Za-z_][\w]*)\s*\(/gm],
  ruby: [/^\s*(?:class|module|def)\s+([A-Za-z_][\w!?=]*)\b/gm],
  elixir: [/^\s*(?:defmodule|defp?|defmacro)\s+([A-Za-z_][\w!?]*)\b/gm],
  lua: [/^\s*(?:local\s+)?function\s+([A-Za-z_][\w.]*)\b/gm],
  terraform: [/^\s*(?:resource|module|variable|output|data)\s+"?([A-Za-z0-9_.-]+)"?/gim],
  sql: [/^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TYPE)\s+([A-Za-z_][\w."]*)\b/gim],
  shell: [/^\s*function\s+([A-Za-z_][\w-]*)\b/gm, /^\s*(?:local\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{/gm],
};

function symbolPatternsForLanguage(language: string): RegExp[] {
  return [...GENERIC_SYMBOL_PATTERNS, ...(LANGUAGE_SYMBOL_PATTERNS[language] || [])].map(
    (pattern) => new RegExp(pattern.source, pattern.flags)
  );
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
  const patterns = symbolPatternsForLanguage(language);
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
  const repos = intelRepoRoots(root, args);
  if (symbol) {
    const repoResults = repos.map((entry) => {
      const result = runCommand("git", ["grep", "-n", "-w", "--", symbol], { cwd: entry.root, maxBuffer: 10 * 1024 * 1024 });
      const matches = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((line) => !isIgnoredRepoMapFile(line.split(":")[0] || ""))
        .slice(0, limit)
        .map((line) => {
          const [file, lineNo, ...rest] = line.split(":");
          return { repo: entry.repo, file: file || "", line: Number(lineNo), snippet: rest.join(":").trim().slice(0, 180) };
        });
      return { repo: entry.repo, root: entry.root, path: entry.path, ok: result.ok || matches.length > 0, matches, truncated: matches.length >= limit };
    });
    const matches = repoResults.flatMap((entry) => asArray(entry.matches)).slice(0, limit);
    return { ok: repoResults.some((entry) => entry.ok) || matches.length > 0, root, symbol, matches, repos: repoResults, truncated: matches.length >= limit };
  }
  const repoResults = repos.map((entry) => {
    const files = listWorkspaceFiles(entry.root).filter((file) => !isIgnoredRepoMapFile(file));
    const byLanguage: Record<string, number> = {};
    const symbols: RepoSymbol[] = [];
    for (const file of files) {
      const language = languageForFile(file);
      if (language) byLanguage[language] = (byLanguage[language] || 0) + 1;
      if (symbols.length < limit) symbols.push(...extractRepoSymbols(entry.root, file, 12).map((symbolEntry) => ({
        ...symbolEntry,
        repo: entry.repo,
      })));
      if (symbols.length > limit) symbols.length = limit;
    }
    return {
      ok: true,
      repo: entry.repo,
      root: entry.root,
      path: entry.path,
      files: files.length,
      by_language: Object.fromEntries(Object.entries(byLanguage).sort()),
      symbols,
      truncated: symbols.length >= limit,
    };
  });
  const files = repoResults.reduce((sum, entry) => sum + Number(entry.files || 0), 0);
  const symbols = repoResults.flatMap((entry) => asArray(entry.symbols)).slice(0, limit);
  return {
    ok: true,
    root,
    files,
    by_language: combineLanguageCounts(repoResults),
    symbols,
    repos: repoResults,
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
  const repoEntries = intelRepoRoots(root, args);
  const repoFileSymbols = repoEntries.map((entry) => {
    const fileSymbols: Record<string, RepoSymbol[]> = {};
    for (const file of files) {
      if (isIgnoredRepoMapFile(file)) continue;
      fileSymbols[file] = extractRepoSymbols(entry.root, file, limit).map((symbolEntry) => ({
        ...symbolEntry,
        repo: entry.repo,
      }));
    }
    return { repo: entry.repo, root: entry.root, path: entry.path, files: fileSymbols };
  });
  const fileSymbols: Record<string, RepoSymbol[]> = {};
  for (const entry of repoFileSymbols) {
    for (const [file, symbolsForFile] of Object.entries(asJsonObject(entry.files))) {
      const key = entry.repo === "." ? file : `${entry.repo}:${file}`;
      fileSymbols[key] = asArray(symbolsForFile) as RepoSymbol[];
    }
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
    repos: repoFileSymbols,
    review,
  };
}

function shellCommandPlan(command: string, cwd: string, adapter: string): CoreResult {
  return { adapter, command, cwd };
}

function detectWorkspaceAdapters(root: string): CoreResult[] {
  const adapters: CoreResult[] = [];
  const pkg = loadPackageJson(root);
  if (pkg) {
    const scripts = asJsonObject(pkg.scripts);
    const runner = fileExists(path.join(root, "pnpm-lock.yaml"))
      ? "pnpm"
      : fileExists(path.join(root, "yarn.lock"))
        ? "yarn"
        : "npm run";
    const scriptCommands = ["typecheck", "check", "test", "build", "lint"]
      .filter((script) => scripts[script])
      .map((script) => runner === "npm run" ? `npm run ${script}` : `${runner} ${script}`);
    adapters.push({
      id: "node",
      ecosystem: "javascript",
      manifest: "package.json",
      available: commandExists(runner.split(" ")[0] || "npm", root),
      commands: scriptCommands,
    });
    if (fileExists(path.join(root, "nx.json")) || asJsonObject(pkg.devDependencies).nx || asJsonObject(pkg.dependencies).nx) {
      adapters.push({
        id: "nx",
        ecosystem: "javascript",
        manifest: fileExists(path.join(root, "nx.json")) ? "nx.json" : "package.json",
        available: commandExists("nx", root) || commandExists("pnpm", root) || commandExists("npx", root),
        commands: ["nx affected -t test", "nx affected -t build"],
      });
    }
  }
  if (["pyproject.toml", "pytest.ini", "setup.cfg"].some((file) => fileExists(path.join(root, file)))) {
    adapters.push({ id: "pytest", ecosystem: "python", manifest: "pyproject.toml", available: commandExists("pytest", root), commands: ["pytest"] });
  }
  if (fileExists(path.join(root, "go.mod"))) {
    adapters.push({ id: "go", ecosystem: "go", manifest: "go.mod", available: commandExists("go", root), commands: ["go test ./..."] });
  }
  if (fileExists(path.join(root, "Cargo.toml"))) {
    adapters.push({ id: "cargo", ecosystem: "rust", manifest: "Cargo.toml", available: commandExists("cargo", root), commands: ["cargo test"] });
  }
  if (fileExists(path.join(root, "pom.xml"))) {
    adapters.push({ id: "maven", ecosystem: "java", manifest: "pom.xml", available: commandExists("mvn", root), commands: ["mvn test"] });
  }
  const gradleManifest = ["build.gradle", "build.gradle.kts"].find((file) => fileExists(path.join(root, file)));
  if (gradleManifest) {
    const gradlew = fileExists(path.join(root, "gradlew")) ? "./gradlew" : "gradle";
    adapters.push({ id: "gradle", ecosystem: "jvm", manifest: gradleManifest, available: gradlew === "./gradlew" || commandExists("gradle", root), commands: [`${gradlew} test`] });
  }
  if (["MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel"].some((file) => fileExists(path.join(root, file)))) {
    adapters.push({ id: "bazel", ecosystem: "polyglot", manifest: "MODULE.bazel", available: commandExists("bazel", root), commands: ["bazel test //..."] });
  }
  return adapters;
}

function workspaceDiagnostics(root: string, args: RuntimeArgs = {}): CoreResult {
  const repoEntries = intelRepoRoots(root, args);
  const repoDiagnostics = repoEntries.map((entry) => {
    const adapters: JsonObject[] = detectWorkspaceAdapters(entry.root).map((rawAdapter): JsonObject => {
      const adapter = asJsonObject(rawAdapter);
      return {
      ...adapter,
      repo: entry.repo,
      cwd: entry.root,
      path: entry.path,
      };
    });
    const commands = adapters.flatMap((adapter) =>
      asStringArray(adapter.commands).map((command) => ({
        ...shellCommandPlan(command, entry.root, asString(adapter.id)),
        repo: entry.repo,
        path: entry.path,
      }))
    );
    return { repo: entry.repo, root: entry.root, path: entry.path, adapters, commands };
  });
  const adapters = repoDiagnostics.flatMap((entry) => asArray(entry.adapters));
  const commands = repoDiagnostics.flatMap((entry) => asArray(entry.commands));
  const execute = args.execute === true;
  return {
    ok: true,
    root,
    execute,
    dry_run: !execute,
    adapters,
    commands,
    repos: repoDiagnostics,
    results: execute ? commands.map((entry) => runCommand(asString(entry.command), [], {
      cwd: asString(entry.cwd, root),
      shell: true,
      timeoutMs: Number(args.timeoutMs || 10 * 60 * 1000),
      maxBuffer: 30 * 1024 * 1024,
    })) : [],
  };
}

function impactedFiles(root: string, args: RuntimeArgs = {}): string[] {
  if (Array.isArray(args.files) && args.files.length > 0) return args.files.map(normalizeClaimPath).filter(Boolean);
  if (args.base || args.head) {
    return diffSurface(root, args.base || "main", args.head || "HEAD").files;
  }
  return [];
}

function testImpact(root: string, args: RuntimeArgs = {}): CoreResult {
  const repoEntries = intelRepoRoots(root, args);
  const repoImpacts = repoEntries.map((entry) => {
    const files = impactedFiles(entry.root, args);
    const likelyTests = Object.fromEntries(files.map((file) => [file, likelyTestCandidatesForFile(entry.root, file)]));
    const manifests = new Set<string>();
    for (const file of files) {
      let dir = path.dirname(path.join(entry.root, file));
      while (dir.startsWith(entry.root)) {
        for (const manifest of ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "MODULE.bazel", "nx.json"]) {
          const candidate = path.join(dir, manifest);
          if (fileExists(candidate)) manifests.add(normalizeClaimPath(path.relative(entry.root, candidate)));
        }
        if (dir === entry.root) break;
        dir = path.dirname(dir);
      }
    }
    return {
      repo: entry.repo,
      root: entry.root,
      path: entry.path,
      files,
      likely_tests: likelyTests,
      manifests: Array.from(manifests).sort(),
      adapters: detectWorkspaceAdapters(entry.root),
    };
  });
  const primary = repoImpacts[0] || { files: [], likely_tests: {}, manifests: [], adapters: [] };
  const files = asStringArray(primary.files);
  return {
    ok: true,
    root,
    files,
    likely_tests: asJsonObject(primary.likely_tests),
    manifests: asStringArray(primary.manifests),
    adapters: asArray(primary.adapters),
    repos: repoImpacts,
  };
}

function dependencyGraph(root: string, args: RuntimeArgs = {}): CoreResult {
  const repoEntries = intelRepoRoots(root, args);
  const manifestPatterns = new Set([
    "package.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "MODULE.bazel",
    "WORKSPACE",
    "WORKSPACE.bazel",
    "nx.json",
  ]);
  const repoGraphs = repoEntries.map((entry) => {
    const files = listWorkspaceFiles(entry.root).filter((file) => !isIgnoredRepoMapFile(file));
    const manifests = files
      .filter((file) => manifestPatterns.has(path.basename(file)))
      .map((file) => ({ repo: entry.repo, file, dir: normalizeClaimPath(path.dirname(file)), kind: path.basename(file) }));
    return {
      repo: entry.repo,
      root: entry.root,
      path: entry.path,
      manifests,
      adapters: detectWorkspaceAdapters(entry.root),
      edges: manifests.map((manifest) => ({
        repo: entry.repo,
        from: manifest.file,
        to: manifest.dir || ".",
        kind: "workspace_manifest",
      })),
    };
  });
  const manifests = repoGraphs.flatMap((entry) => asArray(entry.manifests));
  const edges = repoGraphs.flatMap((entry) => asArray(entry.edges));
  return {
    ok: true,
    root,
    manifests,
    adapters: repoGraphs.flatMap((entry) => asArray(entry.adapters)),
    edges,
    repos: repoGraphs,
  };
}

function countRecords(records: unknown): number {
  return Array.isArray(records) ? records.length : 0;
}

function workspaceHealthDetailResources(root: string): string[] {
  const encodedRoot = encodeURIComponent(root);
  return [
    `cadre://workspace-health?root=${encodedRoot}&responseMode=detail`,
    `cadre://workspace-diagnostics?root=${encodedRoot}`,
    `cadre://repo-topology?root=${encodedRoot}`,
    `cadre://repo-map?root=${encodedRoot}`,
    `cadre://lsp-status?root=${encodedRoot}`,
    `cadre://integrations?root=${encodedRoot}`,
  ];
}

function summarizeWorkspaceDiagnosticsResult(result: CoreResult): CoreResult {
  return {
    ok: result.ok !== false,
    repo_count: countRecords(result.repos),
    adapter_count: countRecords(result.adapters),
    command_count: countRecords(result.commands),
    result_count: countRecords(result.results),
  };
}

function summarizeDependencyGraphResult(result: CoreResult): CoreResult {
  return {
    ok: result.ok !== false,
    repo_count: countRecords(result.repos),
    manifest_count: countRecords(result.manifests),
    edge_count: countRecords(result.edges),
  };
}

function summarizeLspSetupResult(result: CoreResult): CoreResult {
  return {
    ok: result.ok !== false,
    available: result.available !== false,
    execute: result.execute === true,
    dry_run: result.dry_run !== false,
    written: result.written === true,
    added: Array.isArray(result.added) ? result.added.slice(0, 10) : [],
    added_count: countRecords(result.added),
    missing_from_config_count: countRecords(result.missingFromConfig),
    missing_commands_count: countRecords(result.missingCommands),
  };
}

function summarizeLspCoverage(root: string, args: RuntimeArgs = {}): CoreResult {
  const status = asJsonObject(lspConfigStatus(root));
  const setup = asJsonObject(lspSetup(root, { ...args, execute: false }));
  const configured = Array.isArray(status.servers)
    ? status.servers
      .map((server) => asJsonObject(server).id || null)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const recommended = Array.isArray(setup.recommended)
    ? setup.recommended
      .map((entry) => asJsonObject(entry).id || null)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const missing = recommended.filter((id) => !configured.includes(id));
  const covered = recommended.filter((id) => configured.includes(id));
  return {
    ok: status.configured !== false && setup.ok !== false,
    status_configured: status.configured !== false,
    configured_count: configured.length,
    recommended_count: recommended.length,
    covered_count: covered.length,
    missing_count: missing.length,
    coverage: recommended.length > 0 ? Math.round((covered.length / recommended.length) * 100) : null,
    configured: configured.slice(0, 10),
    recommended: recommended.slice(0, 10),
    missing: missing.slice(0, 10),
  };
}

function normalizeIntegrationValue(value: unknown): JsonObject {
  if (value == null) {
    return { configured: false, available: null };
  }
  if (typeof value === "boolean") {
    return { configured: true, available: value };
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { configured: false, available: null };
    const lower = text.toLowerCase();
    if (["false", "0", "no", "off", "disabled"].includes(lower)) {
      return { configured: true, available: false, label: text };
    }
    return { configured: true, available: true, label: text };
  }
  if (isRecord(value)) {
    const entry = asJsonObject(value);
    const configured = Object.keys(entry).length > 0;
    const available = typeof entry.available === "boolean"
      ? entry.available
      : typeof entry.enabled === "boolean"
        ? entry.enabled
        : typeof entry.configured === "boolean"
          ? entry.configured
          : (entry.command || entry.server || entry.url ? true : null);
    return {
      configured,
      available,
      label: asOptionalString(entry.label) || asOptionalString(entry.name),
      command: asOptionalString(entry.command),
      server: asOptionalString(entry.server),
      url: asOptionalString(entry.url),
      provider: asOptionalString(entry.provider),
      platform: asOptionalString(entry.platform),
      kind: asOptionalString(entry.kind),
    };
  }
  return { configured: false, available: null };
}

function pickIntegrationCandidate(scopes: Array<{ source: string; scope: UnknownRecord | JsonObject | null | undefined }>, keys: string[]): { source: string; value: unknown } | null {
  for (const { source, scope } of scopes) {
    if (!isRecord(scope)) continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(scope, key)) {
        const value = asJsonObject(scope)[key];
        if (value !== undefined && value !== null) return { source: `${source}.${key}`, value };
      }
    }
  }
  return null;
}

function integrationStatus(root: string, args: RuntimeArgs, kind: string, label: string, keys: string[], mode: "compact" | "detail"): JsonObject {
  const topology = loadTopology(root);
  const config = asJsonObject(topology.config || {});
  const configIntegrations = isRecord(config.integrations) ? asJsonObject(config.integrations) : {};
  const candidate = pickIntegrationCandidate([
    { source: "config.integrations", scope: configIntegrations },
    { source: "config", scope: config },
    { source: "args", scope: args as UnknownRecord },
  ], keys);
  const normalized = normalizeIntegrationValue(candidate?.value);
  const status: JsonObject = {
    kind,
    label,
    configured: normalized.configured === true || candidate != null,
    available: normalized.available,
    source: candidate?.source || "not_configured",
  };
  if (normalized.label) status.value = normalized.label;
  if (normalized.command) status.command = normalized.command;
  if (normalized.server) status.server = normalized.server;
  if (normalized.url) status.url = normalized.url;
  if (normalized.provider) status.provider = normalized.provider;
  if (normalized.platform) status.platform = normalized.platform;
  if (normalized.kind) status.integration_kind = normalized.kind;
  if (mode === "detail") {
    status.candidates = keys;
  }
  return status;
}

function integrationInventory(root: string, args: RuntimeArgs = {}): CoreResult {
  const mode = workflowResponseMode(args);
  const provider = providerMcpAvailability(root, args);
  const lsp = summarizeLspCoverage(root, args);
  const optionalMcps = [
    integrationStatus(root, args, "code_search", "Code search", ["code_search", "codeSearch", "sourcegraph", "sourcegraph_mcp", "sourcegraphMcp", "search"], mode),
    integrationStatus(root, args, "issue_tracker", "Issue tracker", ["issue_tracker", "issueTracker", "jira", "jira_mcp", "jiraMcp", "linear", "linear_mcp", "linearMcp"], mode),
    integrationStatus(root, args, "ci", "CI", ["ci", "ci_provider", "ciProvider", "ci_mcp", "ciMcp", "ci_mcp_available", "ciMcpAvailable"], mode),
    integrationStatus(root, args, "logging", "Logging", ["logging", "observability", "telemetry", "sentry", "sentry_mcp", "datadog", "datadog_mcp", "honeycomb", "honeycomb_mcp"], mode),
    integrationStatus(root, args, "knowledge_base", "Knowledge base", ["knowledge_base", "knowledgeBase", "kb", "docs", "confluence", "notion", "knowledge_base_mcp", "knowledgeBaseMcp"], mode),
  ];
  const configuredOptionalCount = optionalMcps.filter((entry) => entry.configured === true).length;
  const availableOptionalCount = optionalMcps.filter((entry) => entry.available === true).length;
  const unavailableOptionalCount = optionalMcps.filter((entry) => entry.configured === true && entry.available === false).length;
  const detailResources = workspaceHealthDetailResources(root);
  const summary = {
    provider_mode: asOptionalString(provider.provider_mode) || "local",
    provider_available: provider.available ?? null,
    optional_configured_count: configuredOptionalCount,
    optional_available_count: availableOptionalCount,
    optional_unavailable_count: unavailableOptionalCount,
    lsp_configured_count: asOptionalNumber(lsp.configured_count),
    lsp_recommended_count: asOptionalNumber(lsp.recommended_count),
    lsp_covered_count: asOptionalNumber(lsp.covered_count),
    lsp_missing_count: asOptionalNumber(lsp.missing_count),
    lsp_coverage: asOptionalNumber(lsp.coverage),
  };
  if (mode === "detail") {
    return {
      ok: true,
      root,
      response_mode: mode,
      detail_available: true,
      provider,
      optional_mcps: optionalMcps,
      lsp: {
        coverage: lsp,
        status: lspConfigStatus(root),
        setup: lspSetup(root, { ...args, execute: false }),
      },
      summary,
      detail_resources: detailResources,
    };
  }
  return {
    ok: true,
    root,
    response_mode: mode,
    detail_available: true,
    provider: {
      ok: provider.ok !== false,
      provider_mode: provider.provider_mode || "local",
      available: provider.available ?? null,
      required_provider_mcp: provider.required_provider_mcp || null,
      source: provider.source || null,
      remote_host: provider.remote_host || null,
      requires_confirmation: provider.requires_confirmation === true,
    },
    optional_mcps: optionalMcps.map((entry) => ({
      kind: entry.kind,
      label: entry.label,
      configured: entry.configured,
      available: entry.available,
      source: entry.source,
    })),
    lsp,
    summary,
    detail_resources: detailResources,
  };
}

function workspaceHealth(root: string, args: RuntimeArgs = {}): CoreResult {
  const mode = workflowResponseMode(args);
  const topology = loadTopology(root);
  const techStack = techStackSummary(root, args);
  const workspace = workspaceDiagnostics(root, { execute: false });
  const dependencyGraphResult = dependencyGraph(root);
  const lspCoverage = summarizeLspCoverage(root, args);
  const availableWorkResult = availableWork(root);
  const integrations = integrationInventory(root, { ...args, responseMode: mode });
  const detailResources = workspaceHealthDetailResources(root);
  if (mode === "detail") {
    return {
      ok: true,
      root,
      response_mode: mode,
      detail_available: true,
      topology: {
        polyrepo: topology.polyrepo,
        default_repo: topology.defaultRepo || null,
        sync_mode: topology.config.sync_mode || "local",
        repos: topology.repos,
      },
      tech_stack: techStack,
      workspace,
      dependency_graph: dependencyGraphResult,
      parallel: availableWorkResult,
      languages: {
        detected: lspCoverage.recommended,
        configured: lspCoverage.configured,
      },
      lsp: {
        coverage: lspCoverage,
        status: lspConfigStatus(root),
        setup: lspSetup(root, { ...args, execute: false }),
      },
      integrations,
      detail_resources: detailResources,
    };
  }
  return {
    ok: true,
    root,
    response_mode: mode,
    detail_available: true,
    topology: {
      polyrepo: topology.polyrepo,
      default_repo: topology.defaultRepo || null,
      sync_mode: topology.config.sync_mode || "local",
      repo_count: countRecords(asJsonObject(topology.repos).repos),
    },
    tech_stack: techStack.ok === false
      ? { ok: false, error: techStack.error || "Missing tech stack" }
      : {
        ok: true,
        path: techStack.path,
        summary: techStack.summary,
        styleGuideIds: techStack.styleGuideIds,
    },
    workspace: summarizeWorkspaceDiagnosticsResult(workspace),
    dependency_graph: summarizeDependencyGraphResult(dependencyGraphResult),
    parallel: availableWorkResult.ok === false
      ? { ok: false, error: availableWorkResult.error || "Available work unavailable" }
      : {
        ok: true,
        available_count: countRecords(availableWorkResult.available),
        reclaimable_count: countRecords(availableWorkResult.reclaimable),
        available: Array.isArray(availableWorkResult.available) ? availableWorkResult.available.slice(0, 5) : [],
        reclaimable: Array.isArray(availableWorkResult.reclaimable) ? availableWorkResult.reclaimable.slice(0, 5) : [],
      },
    languages: {
      detected: lspCoverage.recommended,
      configured: lspCoverage.configured,
    },
    lsp: lspCoverage,
    integrations,
    detail_resources: detailResources,
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
    provider: providerMcpAvailability(candidateRoot, options),
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
    path.join(__dirname, "cadre-lsp-review.js"),
    path.join(__dirname, "..", "cadre-lsp-review.js"),
    path.join(__dirname, "..", "scripts", "cadre-lsp-review.js"),
    path.join(__dirname, "..", "..", "scripts", "cadre-lsp-review.js"),
    path.join(root, "cadre", "scripts", "cadre-lsp-review.js"),
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
  beadsSummary,
  beadsTaskWrite,
  claimTrack,
  completeTask,
  collisionScan,
  createBeadsTree,
  doctor,
  fleetStatus,
  gitIdentity,
  implementationPrep,
  dependencyGraph,
  isCadreProjectRoot,
  isIgnoredRepoMapFile,
  listTracks,
  liveStatus,
  loadTopology,
  lspConfigStatus,
  lspImpact,
  lspReview,
  lspSetup,
  metadataPatch,
  parallelWorkflow,
  parsePlanFile,
  parsePlanText,
  phaseSchedule,
  planClaims,
  planAssist,
  planIntegrity,
  polyrepoPreflight,
  prCiStatus,
  providerEvidence,
  recordParallelWorker,
  recordReview,
  recordTaskResult,
  regenIndex,
  repoMap,
  reviewAssist,
  reviewEvidence,
  reviewGate,
  reviewMachineGate,
  releaseLock,
  setTrackStatus,
  syncControlPlane,
  teamBoard,
  teamStatus,
  techStackSummary,
  testCoverage,
  heartbeatTrack,
  trackContext,
  testImpact,
  integrationInventory,
  worktreePlan,
  workflowPacket,
  workspaceHealth,
  workspaceDiagnostics,
  withLock,
  withTrackLock,
};
