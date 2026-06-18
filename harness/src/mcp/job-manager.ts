import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import type { JsonObject, RuntimeArgs } from "../types";
import { asJsonObject } from "../guards";
import type { JobRecord } from "./protocol-types";

export class JobManager {
  jobs: Map<string, JobRecord>;
  nextId: number;
  ttlMs: number;

  constructor() {
    this.jobs = new Map();
    this.nextId = 1;
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
      return asJsonObject(JSON.parse(fs.readFileSync(file, "utf8")));
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

  start(type: string, root: string, args: RuntimeArgs = {}) {
    this.cleanup();
    const id = `job_${this.nextId++}`;
    const runner = path.resolve(__dirname, "..", "cadre-job-runner.js");
    const proc = spawn(process.execPath, [runner], {
      cwd: path.resolve(__dirname, "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const job: JobRecord = {
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
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      started_at: job.started_at,
      finished_at: job.finished_at,
      exit_code: job.exit_code,
      signal: job.signal,
      stdout_tail: job.stdout.slice(-4000),
      stderr_tail: job.stderr.slice(-4000),
      artifact_path: job.artifact_path || path.relative(job.root, this.jobPath(job.root, job.id)),
    };
  }

  get(id: string | null | undefined): JobRecord | null {
    this.cleanup();
    if (!id) return null;
    return this.jobs.get(id) || null;
  }

  cancel(id: string | null | undefined): JsonObject {
    const job = this.get(id);
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
    const job = this.get(id);
    if (!job) return { ok: false, error: `Job not found: ${id}` };
    return { ok: job.status === "succeeded", job: this.summary(job), result: asJsonObject(job.result) };
  }

  list(): JsonObject {
    this.cleanup();
    return { ok: true, jobs: Array.from(this.jobs.values()).map((job) => this.summary(job)) };
  }
}
