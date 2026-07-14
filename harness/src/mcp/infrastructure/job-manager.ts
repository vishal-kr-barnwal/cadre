import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

import type { JsonObject, RuntimeArgs } from "../../types";
import { asJsonObject } from "../../guards";
import type { JobRecord } from "../domain/protocol-types";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { currentMcpServerPath, mcpRuntimeRoot } from "../../runtime-paths";

interface ManagedJobRecord extends JobRecord {
  proc: ChildProcessWithoutNullStreams | null;
}

const JOB_ID_PATTERN = /^job_[a-z0-9-]{1,96}$/i;
const MAX_JOB_ARTIFACT_BYTES = 2 * 1024 * 1024;

function isJobId(value: string | null | undefined): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function sameRoot(left: string, right: string): boolean {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

export class JobManager {
  jobs: Map<string, ManagedJobRecord>;
  ttlMs: number;

  constructor() {
    this.jobs = new Map();
    this.ttlMs = 60 * 60 * 1000;
  }

  private safeJobDirectory(root: string, create: boolean): string {
    const canonicalRoot = fs.realpathSync(root);
    const cadreDirectory = path.join(canonicalRoot, "cadre");
    if (create && !fs.existsSync(cadreDirectory)) fs.mkdirSync(cadreDirectory);
    const cadreStat = fs.lstatSync(cadreDirectory);
    if (!cadreStat.isDirectory() || cadreStat.isSymbolicLink()) throw new Error("Unsafe Cadre job directory");
    const canonicalCadre = fs.realpathSync(cadreDirectory);
    if (!inside(canonicalRoot, canonicalCadre)) throw new Error("Unsafe Cadre job directory");

    const directory = path.join(canonicalCadre, "jobs");
    if (create && !fs.existsSync(directory)) fs.mkdirSync(directory);
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("Unsafe Cadre job directory");
    const canonicalDirectory = fs.realpathSync(directory);
    if (!inside(canonicalRoot, canonicalDirectory)) throw new Error("Unsafe Cadre job directory");
    return canonicalDirectory;
  }

  private jobPath(root: string, id: string, createDirectory = false): string {
    if (!isJobId(id)) throw new Error("Invalid Cadre job id");
    const directory = this.safeJobDirectory(root, createDirectory);
    const candidate = path.resolve(directory, `${id}.json`);
    if (path.dirname(candidate) !== directory) throw new Error("Invalid Cadre job path");
    return candidate;
  }

  private artifactPath(id: string): string {
    if (!isJobId(id)) throw new Error("Invalid Cadre job id");
    return path.join("cadre", "jobs", `${id}.json`);
  }

  serialize(job: JobRecord, artifactPath: string | null = job.artifact_path || null): JsonObject {
    return {
      id: job.id,
      type: job.type,
      root: job.root,
      args: job.args,
      status: job.status,
      started_at: job.started_at,
      finished_at: job.finished_at,
      stdout_tail: job.stdout.slice(-8000),
      stderr_tail: job.stderr.slice(-8000),
      result: asJsonObject(job.result),
      exit_code: job.exit_code,
      signal: job.signal,
      artifact_path: artifactPath,
    };
  }

  persist(job: JobRecord): void {
    let temporaryPath: string | null = null;
    let descriptor: number | null = null;
    delete job.artifact_path;
    try {
      const artifactPath = this.jobPath(job.root, job.id, true);
      if (fs.existsSync(artifactPath)) {
        const stat = fs.lstatSync(artifactPath);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Unsafe Cadre job artifact");
      }
      const relativeArtifactPath = this.artifactPath(job.id);
      temporaryPath = `${artifactPath}.${crypto.randomUUID()}.tmp`;
      const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o600,
      );
      fs.writeFileSync(descriptor, `${JSON.stringify(this.serialize(job, relativeArtifactPath), null, 2)}\n`);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporaryPath, artifactPath);
      temporaryPath = null;
      job.artifact_path = relativeArtifactPath;
    } catch {
      // Job persistence must not crash the MCP server.
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch { /* best-effort cleanup */ }
      }
      if (temporaryPath) {
        try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best-effort cleanup */ }
      }
    }
  }

  loadPersisted(root: string, id: string | null | undefined): JsonObject | null {
    if (!isJobId(id)) return null;
    try {
      const file = this.jobPath(root, id);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_JOB_ARTIFACT_BYTES) return null;
      const canonicalFile = fs.realpathSync(file);
      if (canonicalFile !== file || path.dirname(canonicalFile) !== path.dirname(file)) return null;
      const parsed = asJsonObject(JSON.parse(fs.readFileSync(canonicalFile, "utf8")));
      if (typeof parsed.root !== "string" || !sameRoot(parsed.root, root)) return null;
      return {
        ...parsed,
        persisted: true,
        stale: parsed.status === "running",
      };
    } catch {
      return null;
    }
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      const finished = ["succeeded", "failed", "cancelled"].includes(job.status);
      if (finished && now - Date.parse(job.finished_at || job.started_at) > this.ttlMs) this.jobs.delete(id);
    }
  }

  private summaryFromState(job: JsonObject, persisted = false): JsonObject {
    const stdout = typeof job.stdout === "string"
      ? job.stdout
      : typeof job.stdout_tail === "string"
        ? job.stdout_tail
        : "";
    const stderr = typeof job.stderr === "string"
      ? job.stderr
      : typeof job.stderr_tail === "string"
        ? job.stderr_tail
        : "";
    const root = typeof job.root === "string" ? job.root : "";
    const id = typeof job.id === "string" ? job.id : "";
    return {
      id,
      type: typeof job.type === "string" ? job.type : "",
      root,
      status: typeof job.status === "string" ? job.status : "running",
      started_at: typeof job.started_at === "string" ? job.started_at : null,
      finished_at: typeof job.finished_at === "string" ? job.finished_at : null,
      exit_code: typeof job.exit_code === "number" ? job.exit_code : null,
      signal: typeof job.signal === "string" ? job.signal : null,
      stdout_tail: stdout.slice(-4000),
      stderr_tail: stderr.slice(-4000),
      artifact_path: typeof job.artifact_path === "string" ? job.artifact_path : null,
      persisted,
      stale: persisted && typeof job.status === "string" && job.status === "running",
    };
  }

  private persistedJobIds(root: string): string[] {
    try {
      return fs.readdirSync(this.safeJobDirectory(root, false))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5))
        .filter(isJobId);
    } catch {
      return [];
    }
  }

  private getManaged(root: string, id: string | null | undefined): ManagedJobRecord | null {
    this.cleanup();
    if (!isJobId(id)) return null;
    const job = this.jobs.get(id) || null;
    return job && sameRoot(job.root, root) ? job : null;
  }

  start(type: string, root: string, args: RuntimeArgs = {}) {
    this.cleanup();
    root = fs.realpathSync(root);
    const id = `job_${crypto.randomUUID()}`;
    const runner = currentMcpServerPath();
    if (!runner) throw new Error("Cadre MCP runtime not found for async job runner");
    const proc = spawn(process.execPath, [runner, "--cadre-job-runner"], {
      cwd: mcpRuntimeRoot(runner),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const job: ManagedJobRecord = {
      id,
      type,
      root,
      args,
      status: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      stdout: "",
      stderr: "",
      result: null,
      exit_code: null,
      signal: null,
      proc,
    };
    this.jobs.set(id, job);
    this.persist(job);
    proc.stdout.on("data", (chunk: Buffer) => {
      job.stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      job.stderr += chunk.toString("utf8");
    });
    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      job.exit_code = code;
      job.signal = signal || null;
      job.finished_at = new Date().toISOString();
      try {
        job.result = JSON.parse(job.stdout || "{}") as unknown;
      } catch {
        job.result = { ok: false, error: "Job returned invalid JSON", stdout_tail: job.stdout.slice(-4000) };
      }
      const resultObject = asJsonObject(job.result);
      if (job.status !== "cancelled") job.status = code === 0 && resultObject.ok !== false ? "succeeded" : "failed";
      job.proc = null;
      this.persist(job);
    });
    proc.stdin.end(JSON.stringify({ type, root, args }));
    return this.summary(job);
  }

  summary(job: JobRecord): JsonObject {
    return this.summaryFromState(asJsonObject(job), false);
  }

  get(root: string, id: string | null | undefined): JobRecord | null {
    return this.getManaged(root, id);
  }

  cancel(root: string, id: string | null | undefined): JsonObject {
    const job = this.getManaged(root, id);
    if (!job) return { ok: false, error: `Job not found: ${id}` };
    if (job.proc && job.status === "running") {
      job.status = "cancelled";
      job.proc.kill("SIGTERM");
      job.finished_at = new Date().toISOString();
      this.persist(job);
    }
    return { ok: true, job: this.summary(job) };
  }

  result(root: string, id: string | null | undefined): JsonObject {
    const job = this.getManaged(root, id);
    if (!job) return { ok: false, error: `Job not found: ${id}` };
    return {
      ok: job.status === "running" || job.status === "succeeded",
      job: this.summary(job),
      result: asJsonObject(job.result),
    };
  }

  list(root: string): JsonObject {
    this.cleanup();
    const live = Array.from(this.jobs.values())
      .filter((job) => sameRoot(job.root, root))
      .map((job) => this.summaryFromState(asJsonObject(job), false));
    const liveIds = new Set(live.map((job) => String(job.id)));
    const persisted = this.persistedJobIds(root)
      .filter((id) => !liveIds.has(id))
      .map((id) => this.loadPersisted(root, id))
      .filter((job): job is JsonObject => job !== null)
      .map((job) => this.summaryFromState(job, true));
    const jobs = [...live, ...persisted].sort((a, b) => {
      const left = Date.parse(String(a.started_at || a.finished_at || 0));
      const right = Date.parse(String(b.started_at || b.finished_at || 0));
      return Number.isFinite(right) && Number.isFinite(left) ? right - left : 0;
    });
    return { ok: true, jobs };
  }
}
