#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { fileURLToPath } = require("url");
const core = require("../cadre-core");

const PROTOCOL_VERSION = "2025-11-25";

const packetSchema = (description, actionEnum = null) => ({
  name: description.name,
  description: description.text,
  inputSchema: {
    type: "object",
    properties: {
      root: { type: "string" },
      action: actionEnum ? { type: "string", enum: actionEnum } : { type: "string" },
      async: { type: "boolean" },
      trackId: { type: "string" },
      track_id: { type: "string" },
      phaseIndex: { type: "number" },
      taskIndex: { type: "number" },
      planPath: { type: "string" },
      status: { type: "string" },
      patch: { type: "object" },
      identity: { type: "string" },
      takeover: { type: "boolean" },
      base: { type: "string" },
      head: { type: "string" },
      config: { type: "string" },
      operation: { type: "string" },
      id: { type: "string" },
      command: { type: "string" },
      machineCommand: { type: "string" },
      timeoutMs: { type: "number" },
      provider: { type: "string" },
      symbol: { type: "string" },
      symbols: { type: "array", items: { type: "string" } },
      files: { type: "array", items: { type: "string" } },
      args: { type: "object" },
      type: { type: "string" },
      jobId: { type: "string" },
    },
    additionalProperties: true,
  },
});

const TOOLS = [
  packetSchema(
    { name: "cadre_project", text: "Cadre project packet: ping, doctor, root, topology/config, sync, and polyrepo preflight." },
    ["ping", "doctor", "root", "topology", "sync_control_plane", "polyrepo_preflight"]
  ),
  packetSchema(
    { name: "cadre_status", text: "Cadre status packet: live, team, mine, available, collisions, and team board." },
    ["live", "team", "mine", "available", "collisions", "board"]
  ),
  packetSchema(
    { name: "cadre_track", text: "Cadre track packet: context, plan parsing, integrity, phase scheduling, implementation prep, and Beads tree creation." },
    ["context", "parse_plan", "integrity", "phase_schedule", "prepare_implementation", "create_beads_tree"]
  ),
  packetSchema(
    { name: "cadre_mutate", text: "Cadre mutation packet: claim, heartbeat, status, metadata, review, worker, task-result, and index writes." },
    ["claim", "heartbeat", "set_status", "metadata_patch", "record_review", "record_worker", "record_task_result", "regen_index"]
  ),
  packetSchema(
    { name: "cadre_complete_task", text: "Journaled task completion: coverage gate, locked plan/metadata writes, and idempotent Beads note/close." },
    null
  ),
  packetSchema(
    { name: "cadre_beads", text: "CLI-backed Beads packet for ready/list/show/update/note/close/labels/deps/create/mail/formula/compact/dolt/sql/worktree." },
    null
  ),
  packetSchema(
    { name: "cadre_job", text: "Cadre job packet: start, status, result, cancel, and list process-local long-running jobs." },
    ["start", "status", "result", "cancel", "list"]
  ),
  packetSchema(
    { name: "cadre_review", text: "Cadre review packet: review assist, machine gate, review gate, and PR/CI status." },
    ["assist", "machine_gate", "gate", "pr_ci_status"]
  ),
  packetSchema(
    { name: "cadre_intel", text: "Cadre code intelligence packet: repo map, LSP impact, warm/cold LSP review, daemon status, and daemon shutdown." },
    ["repo_map", "lsp_impact", "lsp_review", "lsp_warm_review", "lsp_daemon_status", "lsp_daemon_shutdown"]
  ),
];

function isDirectory(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch (_) {
    return false;
  }
}

function hasCadreDirectory(dir) {
  return isDirectory(path.join(dir, "cadre"));
}

function isCadreStateDirectory(dir) {
  return [
    "tracks.md",
    "setup_state.json",
    "product.md",
    "tech-stack.md",
    "workflow.md",
    "beads.json",
    "config.json",
    "repos.json",
  ].some((name) => fs.existsSync(path.join(dir, name))) || isDirectory(path.join(dir, "tracks"));
}

function hasCadreProjectState(dir) {
  return hasCadreDirectory(dir) && isCadreStateDirectory(path.join(dir, "cadre"));
}

function normalizePathCandidate(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let candidate = value.trim();
  if (candidate.startsWith("file://")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch (_) {
      return null;
    }
  }
  candidate = path.resolve(candidate);
  try {
    if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) candidate = path.dirname(candidate);
  } catch (_) {
    return null;
  }
  return candidate;
}

function findCadreRoot(start) {
  let dir = normalizePathCandidate(start);
  if (!dir) return null;
  while (true) {
    if (hasCadreProjectState(dir)) return dir;
    if (path.basename(dir) === "cadre" && isCadreStateDirectory(dir)) return path.dirname(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function rootFromCandidate(candidate) {
  const normalized = normalizePathCandidate(candidate);
  if (!normalized) return null;
  const cadreRoot = findCadreRoot(normalized);
  if (cadreRoot) return { root: cadreRoot, has_cadre: true };
  return { root: normalized, has_cadre: false };
}

function requireCadreRoot(args = {}) {
  const info = rootFromCandidate(args.root);
  if (info && info.has_cadre) return info.root;
  throw Object.assign(
    new Error(
      `This Cadre MCP tool requires { root } pointing at, or inside, a project containing cadre/. Received: ${args.root || "(missing)"}`
    ),
    { code: -32602 }
  );
}

function asTextJson(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function envelope(value) {
  const ok = value && Object.prototype.hasOwnProperty.call(value, "ok") ? Boolean(value.ok) : true;
  const warnings = Array.isArray(value && value.warnings) ? value.warnings : [];
  const errors = ok ? [] : [value && (value.error || value.reason || value.stage) || "Cadre operation failed"];
  const out = { ok, data: value || null, warnings, errors };
  if (value && value.commands) out.commands = value.commands;
  if (value && value.job) out.job = value.job;
  return out;
}

class LspDaemonClient {
  constructor() {
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
  }

  ensure() {
    if (this.proc && !this.proc.killed) return;
    const daemon = path.resolve(__dirname, "..", "cadre-lsp-daemon.js");
    this.proc = spawn(process.execPath, [daemon], {
      cwd: path.resolve(__dirname, "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (chunk) => this.read(chunk));
    this.proc.stderr.on("data", () => {});
    this.proc.on("exit", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("LSP daemon exited"));
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  read(chunk) {
    this.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (!message.id || !this.pending.has(message.id)) continue;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || "LSP daemon error"));
      else pending.resolve(message.result);
    }
  }

  request(method, params = {}, timeoutMs = 60000) {
    this.ensure();
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP daemon ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${payload}\n`);
    });
  }

  async shutdown() {
    if (!this.proc) return { ok: true, stopped: 0, skipped: true };
    return this.request("shutdown", {}, 5000);
  }
}

class JobManager {
  constructor() {
    this.jobs = new Map();
    this.nextId = 1;
    this.ttlMs = 60 * 60 * 1000;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      const finished = ["succeeded", "failed", "cancelled"].includes(job.status);
      if (finished && now - Date.parse(job.finished_at || job.started_at) > this.ttlMs) this.jobs.delete(id);
    }
  }

  start(type, root, args = {}) {
    this.cleanup();
    const id = `job_${this.nextId++}`;
    const runner = path.resolve(__dirname, "..", "cadre-job-runner.js");
    const proc = spawn(process.execPath, [runner], {
      cwd: path.resolve(__dirname, "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const job = {
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
    proc.stdout.on("data", (chunk) => {
      job.stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      job.stderr += chunk.toString("utf8");
    });
    proc.on("close", (code, signal) => {
      job.exit_code = code;
      job.signal = signal || null;
      job.finished_at = new Date().toISOString();
      try {
        job.result = JSON.parse(job.stdout || "{}");
      } catch (_) {
        job.result = { ok: false, error: "Job returned invalid JSON", stdout_tail: job.stdout.slice(-4000) };
      }
      if (job.status !== "cancelled") job.status = code === 0 && job.result && job.result.ok !== false ? "succeeded" : "failed";
      job.proc = null;
    });
    proc.stdin.end(JSON.stringify({ type, root, args }));
    return this.summary(job);
  }

  summary(job) {
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
    };
  }

  get(id) {
    this.cleanup();
    return this.jobs.get(id) || null;
  }

  cancel(id) {
    const job = this.get(id);
    if (!job) return { ok: false, error: `Job not found: ${id}` };
    if (job.proc && job.status === "running") {
      job.status = "cancelled";
      job.proc.kill("SIGTERM");
    }
    return { ok: true, job: this.summary(job) };
  }

  result(id) {
    const job = this.get(id);
    if (!job) return { ok: false, error: `Job not found: ${id}` };
    return { ok: job.status === "succeeded", job: this.summary(job), result: job.result };
  }

  list() {
    this.cleanup();
    return { ok: true, jobs: Array.from(this.jobs.values()).map((job) => this.summary(job)) };
  }
}

const lspDaemon = new LspDaemonClient();
const jobs = new JobManager();

function jobTypeForPacket(name, args) {
  if (name === "cadre_complete_task") return "complete_task";
  if (name === "cadre_review" && args.action === "assist") return "review_assist";
  if (name === "cadre_review" && args.action === "machine_gate") return "machine_gate";
  if (name === "cadre_intel" && args.action === "lsp_review") return "lsp_review";
  if (name === "cadre_intel" && args.action === "lsp_impact") return "lsp_impact";
  return args.type || null;
}

function jobEnvelope(type, root, args) {
  return envelope({ ok: true, job: jobs.start(type, root, args) });
}

async function projectPacket(args) {
  const action = args.action || "ping";
  if (action === "ping") {
    return envelope({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      server: "cadre",
      rootContract: "project-scoped tools require { root } per call",
    });
  }
  if (action === "doctor") {
    const info = rootFromCandidate(args.root || process.cwd());
    return envelope(core.doctor(info ? info.root : process.cwd(), { hasCadreProject: Boolean(info && info.has_cadre) }));
  }
  if (action === "root") {
    const root = requireCadreRoot(args);
    return envelope({ ok: true, root, source: "argument.root" });
  }
  const root = requireCadreRoot(args);
  if (action === "topology") return envelope({ ok: true, root, topology: core.loadTopology(root) });
  if (action === "sync_control_plane") return envelope(core.syncControlPlane(root, args));
  if (action === "polyrepo_preflight") return envelope(core.polyrepoPreflight(root));
  return envelope({ ok: false, error: `Unknown cadre_project action: ${action}` });
}

function statusPacket(args) {
  const root = requireCadreRoot(args);
  const action = args.action || "live";
  if (action === "live") return envelope(core.liveStatus(root));
  if (action === "team") return envelope(core.teamStatus(root));
  if (action === "mine") return envelope(core.teamBoard(root, { ...args, mine: true }));
  if (action === "available") return envelope(core.availableWork(root));
  if (action === "collisions") return envelope(core.collisionScan(root));
  if (action === "board") return envelope(core.teamBoard(root, args));
  return envelope({ ok: false, error: `Unknown cadre_status action: ${action}` });
}

function trackPacket(args) {
  const root = requireCadreRoot(args);
  const action = args.action || "context";
  if (action === "context") return envelope(core.trackContext(root, args.trackId || args.track_id));
  if (action === "parse_plan") return envelope(core.parsePlanFile(path.resolve(root, args.planPath)));
  if (action === "integrity") return envelope(core.planIntegrity(root, args.trackId || args.track_id || null));
  if (action === "phase_schedule") return envelope(core.phaseSchedule(root, args));
  if (action === "prepare_implementation") return envelope(core.implementationPrep(root, args));
  if (action === "create_beads_tree") return envelope(core.createBeadsTree(root, args));
  return envelope({ ok: false, error: `Unknown cadre_track action: ${action}` });
}

function mutatePacket(args) {
  const root = requireCadreRoot(args);
  const action = args.action;
  if (action === "claim") return envelope(core.claimTrack(root, args.trackId || args.track_id, args));
  if (action === "heartbeat") return envelope(core.heartbeatTrack(root, args));
  if (action === "set_status") return envelope(core.setTrackStatus(root, args.trackId || args.track_id, args.status));
  if (action === "metadata_patch") return envelope(core.metadataPatch(root, args));
  if (action === "record_review") return envelope(core.recordReview(root, args));
  if (action === "record_worker") return envelope(core.recordParallelWorker(root, args));
  if (action === "record_task_result") return envelope(core.recordTaskResult(root, args));
  if (action === "regen_index") return envelope(core.regenIndex(root));
  return envelope({ ok: false, error: `Unknown cadre_mutate action: ${action}` });
}

async function reviewPacket(args) {
  const root = requireCadreRoot(args);
  const action = args.action || "assist";
  if (args.async === true) return jobEnvelope(jobTypeForPacket("cadre_review", args), root, args);
  if (action === "assist") {
    let lspResult = null;
    if (args.includeLsp !== false) {
      lspResult = await lspDaemon.request(
        "review",
        { ...args, root, base: args.base || "main", head: args.head || "HEAD" },
        Number(args.timeoutMs || 120000)
      ).catch((error) => ({ available: false, reason: error.message, findings: [] }));
    }
    return envelope(core.reviewAssist(root, { ...args, lspResult }));
  }
  if (action === "machine_gate") return envelope(core.reviewMachineGate(root, args));
  if (action === "gate") return envelope(core.reviewGate(root, args.trackId || args.track_id, args));
  if (action === "pr_ci_status") return envelope(core.prCiStatus(root, args));
  return envelope({ ok: false, error: `Unknown cadre_review action: ${action}` });
}

async function intelPacket(args) {
  const daemonRoot = args.root ? rootFromCandidate(args.root) : null;
  const root = args.action && args.action.startsWith("lsp_daemon")
    ? (daemonRoot ? daemonRoot.root : process.cwd())
    : requireCadreRoot(args);
  const action = args.action || "repo_map";
  if (args.async === true) return jobEnvelope(jobTypeForPacket("cadre_intel", args), root, args);
  if (action === "repo_map") return envelope(core.repoMap(root, args));
  if (action === "lsp_impact") {
    let lspResult = null;
    if ((args.base || args.head) && args.includeLsp !== false) {
      lspResult = await lspDaemon.request(
        "review",
        { ...args, root, base: args.base || "main", head: args.head || "HEAD" },
        Number(args.timeoutMs || 120000)
      ).catch((error) => ({ available: false, reason: error.message, findings: [] }));
    }
    return envelope(core.lspImpact(root, { ...args, lspResult }));
  }
  if (action === "lsp_review") return envelope(core.lspReview(root, args));
  if (action === "lsp_warm_review") {
    return envelope(await lspDaemon.request("review", { ...args, root }, Number(args.timeoutMs || 120000)));
  }
  if (action === "lsp_daemon_status") return envelope(await lspDaemon.request("status", {}, 5000));
  if (action === "lsp_daemon_shutdown") return envelope(await lspDaemon.shutdown());
  return envelope({ ok: false, error: `Unknown cadre_intel action: ${action}` });
}

function jobPacket(args) {
  const action = args.action || "status";
  if (action === "start") {
    const root = requireCadreRoot(args);
    const type = args.type;
    if (!type) return envelope({ ok: false, error: "type is required for cadre_job start" });
    return jobEnvelope(type, root, args.args || args);
  }
  if (action === "status") {
    const job = jobs.get(args.jobId || args.id);
    return envelope(job ? { ok: true, job: jobs.summary(job) } : { ok: false, error: `Job not found: ${args.jobId || args.id}` });
  }
  if (action === "result") return envelope(jobs.result(args.jobId || args.id));
  if (action === "cancel") return envelope(jobs.cancel(args.jobId || args.id));
  if (action === "list") return envelope(jobs.list());
  return envelope({ ok: false, error: `Unknown cadre_job action: ${action}` });
}

async function toolCall(name, args = {}) {
  if (name === "cadre_project") return asTextJson(await projectPacket(args));
  if (name === "cadre_status") return asTextJson(statusPacket(args));
  if (name === "cadre_track") return asTextJson(trackPacket(args));
  if (name === "cadre_mutate") return asTextJson(mutatePacket(args));
  if (name === "cadre_complete_task") {
    const root = requireCadreRoot(args);
    if (args.async === true) return asTextJson(jobEnvelope("complete_task", root, args));
    return asTextJson(envelope(core.completeTask(root, args)));
  }
  if (name === "cadre_beads") {
    const root = requireCadreRoot(args);
    return asTextJson(envelope(core.beadsTaskWrite(root, args)));
  }
  if (name === "cadre_job") return asTextJson(jobPacket(args));
  if (name === "cadre_review") return asTextJson(await reviewPacket(args));
  if (name === "cadre_intel") return asTextJson(await intelPacket(args));
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

function resourceList() {
  return {
    resources: [
      { uri: "cadre://team-board", name: "Cadre team board", description: "Rich team board. Read with ?root=/path/to/project.", mimeType: "application/json" },
      { uri: "cadre://track-context", name: "Cadre track context", description: "Track context. Read with ?root=/path&trackId=<id>.", mimeType: "application/json" },
      { uri: "cadre://collisions", name: "Cadre collisions", description: "File collision scan. Read with ?root=/path.", mimeType: "application/json" },
      { uri: "cadre://repo-map", name: "Cadre repo map", description: "Symbol map. Read with ?root=/path and optional &symbol=<name>.", mimeType: "application/json" },
    ],
  };
}

function parseResourceUri(uri) {
  const [base, query = ""] = uri.split("?");
  const params = new URLSearchParams(query);
  return { base, root: params.get("root"), trackId: params.get("trackId"), symbol: params.get("symbol") };
}

function resourceRead(uri) {
  const resource = parseResourceUri(uri);
  const root = requireCadreRoot({ root: resource.root });
  let value;
  if (resource.base === "cadre://team-board") value = core.teamBoard(root);
  else if (resource.base === "cadre://track-context") value = core.trackContext(root, resource.trackId);
  else if (resource.base === "cadre://collisions") value = core.collisionScan(root);
  else if (resource.base === "cadre://repo-map") value = core.repoMap(root, { symbol: resource.symbol || null });
  else throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: -32602 });
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(envelope(value), null, 2) }] };
}

async function handle(message) {
  const method = message.method;
  const params = message.params || {};
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { resources: { listChanged: false }, tools: { listChanged: false } },
      serverInfo: { name: "cadre", version: "2.0.0" },
    };
  }
  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") return toolCall(params.name, params.arguments || {});
  if (method === "resources/list") return resourceList();
  if (method === "resources/read") return resourceRead(params.uri);
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}

function send(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function respond(message, result) {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  send({ jsonrpc: "2.0", id: message.id, result });
}

function respondError(message, error) {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: error.code || -32603, message: error.message || String(error) },
  });
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const raw = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    let message;
    try {
      message = JSON.parse(raw);
      Promise.resolve(handle(message))
        .then((result) => {
          if (result !== undefined) respond(message, result);
        })
        .catch((error) => respondError(message || { id: null }, error));
    } catch (error) {
      respondError(message || { id: null }, error);
    }
  }
});

process.stdin.resume();
