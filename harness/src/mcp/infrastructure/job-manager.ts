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

export class JobManager {
  jobs: Map<string, ManagedJobRecord>;
  ttlMs: number;

  constructor() {
    this.jobs = new Map();
    this.ttlMs = 60 * 60 * 1000;
  }

  jobDir(root: string): string {
    return path.join(root, "cadre", "jobs");
  }

  jobPath(root: string, id: string): string {
    return path.join(this.jobDir(root), `${id}.json`);
  }

  serialize(job: JobRecord): JsonObject {
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
      artifact_path: job.artifact_path || path.relative(job.root, this.jobPath(job.root, job.id)),
    };
  }

  persist(job: JobRecord): void {
    try {
      fs.mkdirSync(this.jobDir(job.root), { recursive: true });
      const artifactPath = this.jobPath(job.root, job.id);
      job.artifact_path = path.relative(job.root, artifactPath);
      fs.writeFileSync(artifactPath, `${JSON.stringify(this.serialize(job), null, 2)}\n`);
    } catch {
      // Job persistence must not crash the MCP server.
    }
  }

  loadPersisted(root: string, id: string | null | undefined): JsonObject | null {
    if (!id) return null;
    const file = this.jobPath(root, id);
    try {
      const parsed = asJsonObject(JSON.parse(fs.readFileSync(file, "utf8")));
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
      artifact_path: typeof job.artifact_path === "string"
        ? job.artifact_path
        : (root && id ? path.relative(root, this.jobPath(root, id)) : null),
      persisted,
      stale: persisted && typeof job.status === "string" && job.status === "running",
    };
  }

  private persistedJobIds(root: string): string[] {
    try {
      return fs.readdirSync(this.jobDir(root))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -5));
    } catch {
      return [];
    }
  }

  private getManaged(id: string | null | undefined): ManagedJobRecord | null {
    this.cleanup();
    if (!id) return null;
    return this.jobs.get(id) || null;
  }

  start(type: string, root: string, args: RuntimeArgs = {}) {
    this.cleanup();
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

  get(id: string | null | undefined): JobRecord | null {
    return this.getManaged(id);
  }

  cancel(id: string | null | undefined): JsonObject {
    const job = this.getManaged(id);
    if (!job) return { ok: false, error: `Job not found: ${id}` };
    if (job.proc && job.status === "running") {
      job.status = "cancelled";
      job.proc.kill("SIGTERM");
      job.finished_at = new Date().toISOString();
      this.persist(job);
    }
    return { ok: true, job: this.summary(job) };
  }

  result(id: string | null | undefined): JsonObject {
    const job = this.getManaged(id);
    if (!job) return { ok: false, error: `Job not found: ${id}` };
    return { ok: job.status === "succeeded", job: this.summary(job), result: asJsonObject(job.result) };
  }

  list(root: string | null = null): JsonObject {
    this.cleanup();
    const live = Array.from(this.jobs.values()).map((job) => this.summaryFromState(asJsonObject(job), false));
    const persisted = root
      ? this.persistedJobIds(root)
        .filter((id) => !this.jobs.has(id))
        .map((id) => this.loadPersisted(root, id))
        .filter((job): job is JsonObject => job !== null)
        .map((job) => this.summaryFromState(job, true))
      : [];
    const jobs = [...live, ...persisted].sort((a, b) => {
      const left = Date.parse(String(a.started_at || a.finished_at || 0));
      const right = Date.parse(String(b.started_at || b.finished_at || 0));
      return Number.isFinite(right) && Number.isFinite(left) ? right - left : 0;
    });
    return { ok: true, jobs };
  }
}
