#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { fileURLToPath } = require("url");
const core = require("../cadre-core");

const PROTOCOL_VERSION = "2025-11-25";

const TOOLS = [
  {
    name: "cadre_ping",
    description: "Verify that the required Cadre MCP runtime is available.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "cadre_current_root",
    description: "Resolve a caller-provided path to the Cadre project root.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_doctor",
    description: "Diagnose Cadre runtime wiring, project markers, Beads, LSP, provider CLIs, and generated-bundle checks.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "cadre_regen_index",
    description: "Regenerate cadre/tracks.md from per-track metadata.json status.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_parse_plan",
    description: "Parse a Cadre plan.md and return phases, tasks, and annotations.",
    inputSchema: {
      type: "object",
      properties: {
        planPath: { type: "string" },
        root: { type: "string" },
      },
      required: ["planPath", "root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_phase_schedule",
    description: "Compute the concrete phase-level scheduler packet: dependencies, ready phases, conflict-aware ready groups, and errors.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
      },
      required: ["root", "trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_team_status",
    description: "Return team status grouped by owner and track status.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_team_board",
    description: "Return a richer low-token team board: WIP, handoffs, review queue, blockers, and optional Beads label evidence.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        mine: { type: "boolean" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_live_status",
    description: "Return a compact live-status summary for the default status view.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_available_work",
    description: "Return unowned ready tracks plus stale held tracks that can be reclaimed.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_prepare_implementation",
    description: "Return one bounded implementation-start packet: selected track, optional claim, context, collisions, available work, and plan integrity.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        identity: { type: "string" },
        claim: { type: "boolean" },
        takeover: { type: "boolean" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_set_track_status",
    description: "Set metadata.json.status for a track and regenerate cadre/tracks.md.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        status: {
          type: "string",
          enum: ["new", "in_progress", "completed", "blocked", "skipped"],
        },
      },
      required: ["root", "trackId", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_metadata_patch",
    description: "Apply a top-level metadata.json patch with CAS retry semantics and report conflict/error details.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        patch: { type: "object" },
      },
      required: ["root", "trackId", "patch"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_collision_scan",
    description: "Return cross-track file collisions from plan <!-- files: --> claims, including prefix/glob overlaps.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_track_context",
    description: "Return one bounded context payload for a track: metadata, parsed plan, counts, worktree routing, hold state, and review state.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
      },
      required: ["root", "trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_plan_integrity",
    description: "Validate Cadre plan task annotations, task keys, dependency references, repo routing, and parallel file-claim shape.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_claim_track",
    description: "Claim a track for the current identity, mirror owner/lease metadata, and create implement_state.json.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        identity: { type: "string" },
        takeover: { type: "boolean" },
      },
      required: ["root", "trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_heartbeat_track",
    description: "Refresh a track owner's shared lease/implement-state heartbeat and mirror Beads assignment when available.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        identity: { type: "string" },
        now: { type: "string" },
      },
      required: ["root", "trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_record_task_result",
    description: "Record a task result in plan.md plus metadata last_task_result/last_coverage.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        phaseIndex: { type: "number" },
        taskIndex: { type: "number" },
        status: { type: "string", enum: ["pending", "new", "in_progress", "completed", "blocked", "skipped"] },
        commitSha: { type: "string" },
        coverage: { type: "number" },
      },
      required: ["root", "trackId", "phaseIndex", "taskIndex"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_complete_task",
    description: "Run the configured coverage/test command, enforce the threshold, then atomically record the plan task, metadata, and Beads completion.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        phaseIndex: { type: "number" },
        taskIndex: { type: "number" },
        commitSha: { type: "string" },
        command: { type: "string" },
        timeoutMs: { type: "number" },
        coverageThreshold: { type: "number" },
        allowMissingCoverage: { type: "boolean" },
        allowLowCoverage: { type: "boolean" },
        summary: { type: "string" },
        reason: { type: "string" },
        beadsTaskId: { type: "string" },
        repo: { type: "string" },
        workingRoot: { type: "string" },
      },
      required: ["root", "trackId", "phaseIndex", "taskIndex"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_record_parallel_worker",
    description: "Coordinator-owned parallel worker audit update; optionally completes the plan task after a clean merge using cadre_complete_task.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        workerId: { type: "string" },
        status: { type: "string", enum: ["in_progress", "awaiting_merge", "merged", "conflict", "failed"] },
        phaseIndex: { type: "number" },
        taskIndex: { type: "number" },
        beadsTaskId: { type: "string" },
        repo: { type: "string" },
        worktree: { type: "string" },
        branch: { type: "string" },
        commitSha: { type: "string" },
        coverage: { type: "number" },
        evidence: { type: "object" },
        completeTask: { type: "boolean" },
        command: { type: "string" },
        timeoutMs: { type: "number" },
        coverageThreshold: { type: "number" },
        allowMissingCoverage: { type: "boolean" },
        allowLowCoverage: { type: "boolean" },
        summary: { type: "string" },
        reason: { type: "string" },
        workingRoot: { type: "string" },
      },
      required: ["root", "trackId", "workerId", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_create_beads_tree",
    description: "Create or plan the Beads epic/phase/task/dependency tree for one Cadre track, then patch metadata with returned Beads IDs.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        identity: { type: "string" },
        epicId: { type: "string" },
        dryRun: { type: "boolean" },
        planText: { type: "string" },
        specText: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["root", "trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_record_review",
    description: "Write metadata.review with review_seq, self-review detection, override guard, and immediate review-gate evaluation.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        verdict: { type: "string", enum: ["approved", "changes_requested"] },
        blockingCount: { type: "number" },
        reviewer: { type: "string" },
        coverage: { type: "number" },
        reviewedSha: { type: "string" },
        reviewedShas: { type: "object" },
        date: { type: "string" },
        allowOverride: { type: "boolean" },
      },
      required: ["root", "trackId", "verdict"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_review_assist",
    description: "Assemble a review fallback packet: diff surface, unfinished plan tasks, TODO/stub scan, coverage, and LSP findings.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        base: { type: "string" },
        head: { type: "string" },
        includeLsp: { type: "boolean" },
        includeMachine: { type: "boolean" },
        machineCommand: { type: "string" },
        config: { type: "string" },
        todoLimit: { type: "number" },
        repo: { type: "string" },
      },
      required: ["root", "trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_review_machine_gate",
    description: "Run the configured review machine gate (typecheck/build/check/lint) inside MCP, per repo for polyrepo tracks.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        trackId: { type: "string" },
        repo: { type: "string" },
        workingRoot: { type: "string" },
        machineCommand: { type: "string" },
        command: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_sync_control_plane",
    description: "Run the shared-mode control-plane sync preamble or postamble as a structured operation.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        mode: { type: "string", enum: ["pre", "post"] },
      },
      required: ["root", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_lsp_review",
    description: "Run the Cadre LSP/code-intelligence review helper and return structured findings.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        base: { type: "string" },
        head: { type: "string" },
        config: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_lsp_warm_review",
    description: "Run the LSP/code-intelligence review through the persistent daemon so language servers stay warm across calls.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        base: { type: "string" },
        head: { type: "string" },
        config: { type: "string" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_lsp_daemon_status",
    description: "Return persistent LSP daemon status and warm language-server sessions.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "cadre_lsp_daemon_shutdown",
    description: "Stop the persistent LSP daemon and all warm language-server sessions.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "cadre_test_coverage",
    description: "Run the project's configured test/coverage command, parse measured coverage, and optionally record it on a track/task.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        command: { type: "string" },
        timeoutMs: { type: "number" },
        trackId: { type: "string" },
        phaseIndex: { type: "number" },
        taskIndex: { type: "number" },
        status: { type: "string", enum: ["pending", "new", "in_progress", "completed", "blocked", "skipped"] },
        commitSha: { type: "string" },
        repo: { type: "string" },
        workingRoot: { type: "string" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_pr_ci_status",
    description: "Read GitHub/GitLab PR/MR and CI status for a track branch or explicit PR/MR.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        provider: { type: "string", enum: ["github", "gitlab"] },
        trackId: { type: "string" },
        branch: { type: "string" },
        pr: { type: "string" },
        mr: { type: "string" },
        prNumber: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_repo_map",
    description: "Return a compact semantic repository map, or low-token references for a requested symbol.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        symbol: { type: "string" },
        limit: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_lsp_impact",
    description: "Return semantic impact data for symbols/files using repo-map references plus optional LSP diff review.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        symbol: { type: "string" },
        symbols: { type: "array", items: { type: "string" } },
        files: { type: "array", items: { type: "string" } },
        base: { type: "string" },
        head: { type: "string" },
        config: { type: "string" },
        limit: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_beads_write",
    description: "Run structured Beads task operations such as update, note, close, label changes, dependency add, create, ready, or show.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        operation: {
          type: "string",
          enum: ["ready", "show", "update", "note", "close", "label_add", "label_remove", "dep_add", "create"],
        },
        id: { type: "string" },
        taskId: { type: "string" },
        issueId: { type: "string" },
        parent: { type: "string" },
        status: { type: "string" },
        assignee: { type: "string" },
        priority: { type: "string" },
        note: { type: "string" },
        reason: { type: "string" },
        continue: { type: "boolean" },
        label: { type: "string" },
        dependsOn: { type: "string" },
        title: { type: "string" },
        type: { type: "string" },
        deps: { type: "string" },
      },
      required: ["root", "operation"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_review_gate",
    description: "Evaluate whether a track's metadata.review clears the ship/land gate.",
    inputSchema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        root: { type: "string" },
        headSha: { type: "string" },
        headShas: { type: "object" },
      },
      required: ["trackId", "root"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_polyrepo_preflight",
    description: "Run local polyrepo manifest and submodule sanity checks.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      required: ["root"],
      additionalProperties: false,
    },
  },
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
    if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
      candidate = path.dirname(candidate);
    }
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
    if (path.basename(dir) === "cadre" && isCadreStateDirectory(dir)) {
      return path.dirname(dir);
    }
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

function resolveRootInfo(args = {}) {
  const explicit = typeof args.root === "string" && args.root.trim() !== "";
  if (!explicit) return null;
  const resolved = rootFromCandidate(args.root);
  return resolved ? { ...resolved, source: "argument.root" } : null;
}

function requireCadreRoot(args = {}) {
  const info = resolveRootInfo(args);
  if (info && info.has_cadre) return info.root;
  throw Object.assign(
    new Error(
      `This Cadre MCP tool requires a per-call root argument pointing at, or inside, a project containing cadre/. ` +
        `Received: ${args.root || "(missing)"}`
    ),
    { code: -32602 }
  );
}

function asTextJson(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
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

const lspDaemon = new LspDaemonClient();

async function toolCall(name, args) {
  if (name === "cadre_ping") {
    return asTextJson({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      server: "cadre",
      rootContract: "project-scoped tools require a per-call root argument",
    });
  }
  if (name === "cadre_doctor") {
    const info = rootFromCandidate(args && args.root ? args.root : process.cwd());
    return asTextJson(core.doctor(info ? info.root : process.cwd(), { hasCadreProject: Boolean(info && info.has_cadre) }));
  }
  if (name === "cadre_current_root") {
    const root = requireCadreRoot(args || {});
    return asTextJson({
      root,
      source: "argument.root",
    });
  }
  if (name === "cadre_lsp_daemon_status") {
    return asTextJson(await lspDaemon.request("status", {}, 5000));
  }
  if (name === "cadre_lsp_daemon_shutdown") {
    return asTextJson(await lspDaemon.shutdown());
  }

  const root = requireCadreRoot(args || {});
  switch (name) {
    case "cadre_regen_index":
      return asTextJson(core.regenIndex(root));
    case "cadre_parse_plan": {
      const planPath = path.resolve(root, args.planPath);
      return asTextJson(core.parsePlanFile(planPath));
    }
    case "cadre_phase_schedule":
      return asTextJson(core.phaseSchedule(root, args));
    case "cadre_team_status":
      return asTextJson(core.teamStatus(root));
    case "cadre_team_board":
      return asTextJson(core.teamBoard(root, args));
    case "cadre_live_status":
      return asTextJson(core.liveStatus(root));
    case "cadre_available_work":
      return asTextJson(core.availableWork(root));
    case "cadre_prepare_implementation":
      return asTextJson(core.implementationPrep(root, args));
    case "cadre_set_track_status":
      return asTextJson(core.setTrackStatus(root, args.trackId, args.status));
    case "cadre_metadata_patch":
      return asTextJson(core.metadataPatch(root, args));
    case "cadre_collision_scan":
      return asTextJson(core.collisionScan(root));
    case "cadre_track_context":
      return asTextJson(core.trackContext(root, args.trackId));
    case "cadre_plan_integrity":
      return asTextJson(core.planIntegrity(root, args.trackId || null));
    case "cadre_claim_track":
      return asTextJson(core.claimTrack(root, args.trackId, args));
    case "cadre_heartbeat_track":
      return asTextJson(core.heartbeatTrack(root, args));
    case "cadre_record_task_result":
      return asTextJson(core.recordTaskResult(root, args));
    case "cadre_complete_task":
      return asTextJson(core.completeTask(root, args));
    case "cadre_record_parallel_worker":
      return asTextJson(core.recordParallelWorker(root, args));
    case "cadre_create_beads_tree":
      return asTextJson(core.createBeadsTree(root, args));
    case "cadre_record_review":
      return asTextJson(core.recordReview(root, args));
    case "cadre_review_assist":
      return asTextJson(core.reviewAssist(root, args));
    case "cadre_review_machine_gate":
      return asTextJson(core.reviewMachineGate(root, args));
    case "cadre_sync_control_plane":
      return asTextJson(core.syncControlPlane(root, args));
    case "cadre_lsp_review":
      return asTextJson(core.lspReview(root, args));
    case "cadre_lsp_warm_review":
      return asTextJson(await lspDaemon.request("review", { ...args, root }, Number(args.timeoutMs || 120000)));
    case "cadre_test_coverage":
      return asTextJson(core.testCoverage(root, args));
    case "cadre_pr_ci_status":
      return asTextJson(core.prCiStatus(root, args));
    case "cadre_repo_map":
      return asTextJson(core.repoMap(root, args));
    case "cadre_lsp_impact":
      return asTextJson(core.lspImpact(root, args));
    case "cadre_beads_write":
      return asTextJson(core.beadsTaskWrite(root, args));
    case "cadre_review_gate":
      return asTextJson(core.reviewGate(root, args.trackId, args));
    case "cadre_polyrepo_preflight":
      return asTextJson(core.polyrepoPreflight(root));
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

function resourceList() {
  return {
    resources: [
      {
        uri: "cadre://tracks",
        name: "Cadre tracks",
        description: "Per-track metadata from cadre/tracks/*/metadata.json. Read with ?root=/path/to/project.",
        mimeType: "application/json",
      },
      {
        uri: "cadre://team-status",
        name: "Cadre team status",
        description: "Team board grouped by owner and status. Read with ?root=/path/to/project.",
        mimeType: "application/json",
      },
      {
        uri: "cadre://team-board",
        name: "Cadre team board",
        description: "Rich team board with WIP, handoffs, review queue, blockers, and Beads evidence. Read with ?root=/path/to/project.",
        mimeType: "application/json",
      },
      {
        uri: "cadre://collisions",
        name: "Cadre file collisions",
        description: "Cross-track file claim collisions. Read with ?root=/path/to/project.",
        mimeType: "application/json",
      },
      {
        uri: "cadre://plan-integrity",
        name: "Cadre plan integrity",
        description: "Plan annotation and dependency validation. Read with ?root=/path/to/project and optional &trackId=<id>.",
        mimeType: "application/json",
      },
      {
        uri: "cadre://track-context",
        name: "Cadre track context",
        description: "Bounded per-track context. Read with ?root=/path/to/project&trackId=<id>.",
        mimeType: "application/json",
      },
      {
        uri: "cadre://repo-map",
        name: "Cadre semantic repo map",
        description: "Compact repository symbol map. Read with ?root=/path/to/project and optional &symbol=<name>.",
        mimeType: "application/json",
      },
    ],
  };
}

function parseResourceUri(uri) {
  const [base, query = ""] = uri.split("?");
  const params = new URLSearchParams(query);
  return { base, root: params.get("root"), trackId: params.get("trackId"), symbol: params.get("symbol"), mine: params.get("mine") };
}

function resourceRead(uri) {
  const resource = parseResourceUri(uri);
  const root = requireCadreRoot({ root: resource.root });
  let value;
  if (resource.base === "cadre://tracks") value = core.listTracks(root).map((track) => track.metadata);
  else if (resource.base === "cadre://team-status") value = core.teamStatus(root);
  else if (resource.base === "cadre://team-board") value = core.teamBoard(root, { mine: resource.mine === "true" });
  else if (resource.base === "cadre://collisions") value = core.collisionScan(root);
  else if (resource.base === "cadre://plan-integrity") value = core.planIntegrity(root, resource.trackId || null);
  else if (resource.base === "cadre://track-context") value = core.trackContext(root, resource.trackId);
  else if (resource.base === "cadre://repo-map") value = core.repoMap(root, { symbol: resource.symbol || null });
  else throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: -32602 });
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function handle(message) {
  const method = message.method;
  const params = message.params || {};
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        resources: { listChanged: false },
        tools: { listChanged: false },
      },
      serverInfo: {
        name: "cadre",
        version: "2.0.0",
      },
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
    error: {
      code: error.code || -32603,
      message: error.message || String(error),
    },
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
        .catch((error) => {
          respondError(message || { id: null }, error);
        });
    } catch (error) {
      respondError(message || { id: null }, error);
    }
  }
});

process.stdin.resume();
