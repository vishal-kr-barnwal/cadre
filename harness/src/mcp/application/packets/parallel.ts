import type { JsonObject, RuntimeArgs } from "../../../types";
import { asJsonObject, asOptionalString } from "../../../guards";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import type { RuntimeDependencies } from "../ports";

const UNRESOLVED_WORKER_STATUSES = new Set(["in_progress", "blocked", "failed", "conflict"]);

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordFinishCall(
  root: string,
  trackId: string | undefined,
  worker: JsonObject,
  agentIdentifier: string | undefined,
): JsonObject | null {
  const workerId = asOptionalString(worker.worker_id);
  if (!trackId || !workerId) return null;
  const worktree = asOptionalString(worker.worktree) || "<worker-worktree>";
  const input: JsonObject = {
    trackId,
    workerId,
    status: "awaiting_merge",
    phaseIndex: numberOrNull(worker.phase_index),
    taskIndex: numberOrNull(worker.task_index),
    repo: asOptionalString(worker.repo) || ".",
    workerRef: asOptionalString(worker.worker_ref) || null,
    commitSha: "<commit-sha>",
    coverage: "<coverage-number-or-null>",
    filesChanged: ["<changed-file>"],
    tests: [{ command: "<test-command>", cwd: worktree, ok: true, status: 0 }],
    summary: "<worker-summary>",
    blockers: [],
    ...(agentIdentifier ? { agentIdentifier } : {}),
  };
  return actionCall(root, "parallel.record_finish", input);
}

function workerCallbacks(
  root: string,
  trackId: string | undefined,
  workers: JsonObject[],
  agentIdentifier: string | undefined,
): JsonObject[] {
  return workers.flatMap((worker) => {
    const recordFinishPacket = recordFinishCall(root, trackId, worker, agentIdentifier);
    return recordFinishPacket ? [{
      worker_id: asOptionalString(worker.worker_id) || null,
      status: asOptionalString(worker.status) || "unknown",
      kind: worker.status === "in_progress" ? "completion" : "recovery",
      record_finish_packet: recordFinishPacket,
    }] : [];
  });
}

function attachWorkerCallbacks(
  response: RuntimeEnvelope,
  root: string,
  trackId: string | undefined,
  workers: JsonObject[],
  agentIdentifier: string | undefined,
): void {
  response.data = {
    ...asJsonObject(response.data),
    worker_callbacks: workerCallbacks(root, trackId, workers, agentIdentifier),
  };
  response.required = ["data.worker_callbacks[].record_finish_packet"];
  response.next = null;
}

function currentWorkers(
  deps: RuntimeDependencies,
  root: string,
  trackId: string | undefined,
): { ok: boolean; workers: JsonObject[]; error: string | null } {
  const plan = asJsonObject(deps.core.parallelWorkflow(root, { action: "plan", trackId }));
  if (plan.ok === false) {
    return {
      ok: false,
      workers: [],
      error: asOptionalString(plan.error || plan.reason || plan.stage) || "Unable to read parallel worker state",
    };
  }
  const state = asJsonObject(plan.state);
  return {
    ok: true,
    workers: Array.isArray(state.workers) ? state.workers.map(asJsonObject) : [],
    error: null,
  };
}

function blockUnsafeContinuation(response: RuntimeEnvelope, reason: string): RuntimeEnvelope {
  response.ok = false;
  response.errors = Array.from(new Set([...response.errors, reason]));
  response.next = null;
  return response;
}

export function parallelPacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const root = deps.rootResolver.requireCadreRoot(args);
  const response = envelope(deps.core.parallelWorkflow(root, args));
  if (response.ok === false) return response;
  const trackId = asOptionalString(args.trackId || args.track_id);
  const agentIdentifier = asOptionalString(args.agentIdentifier);
  const action = args.action || "plan";

  if (action === "next_wave") {
    const data = asJsonObject(response.data);
    const workers = Array.isArray(data.workers) ? data.workers : [];
    if (workers.length === 0) {
      response.next = null;
      return response;
    }
    if (!agentIdentifier) {
      response.required = ["input.agentIdentifier"];
      response.next = null;
      return response;
    }
    response.next = actionCall(root, "parallel.setup_workers", {
      trackId: trackId || null,
      groupIndex: args.groupIndex || 0,
      maxWorkers: args.maxWorkers || args.limit || null,
      agentIdentifier,
    });
    return response;
  }

  if (action === "setup_workers") {
    const data = asJsonObject(response.data);
    const workers = Array.isArray(data.workers) ? data.workers : [];
    response.required = workers.length > 0
      ? (args.execute === true ? ["data.workers[].dispatch.record_finish_packet"] : ["execute"])
      : [];
    response.next = null;
    return response;
  }

  if (action === "record_finish" && args.execute === true) {
    const state = currentWorkers(deps, root, trackId);
    if (!state.ok) return blockUnsafeContinuation(response, state.error || "Unable to read parallel worker state");
    const unresolved = state.workers.filter((worker) => UNRESOLVED_WORKER_STATUSES.has(String(worker.status)));
    if (unresolved.length > 0) {
      attachWorkerCallbacks(response, root, trackId, unresolved, agentIdentifier);
      return response;
    }
    response.next = state.workers.some((worker) => worker.status === "awaiting_merge")
      ? actionCall(root, "parallel.merge_back", { trackId, agentIdentifier })
      : null;
    return response;
  }

  if (action === "merge_back" && args.execute === true) {
    const state = currentWorkers(deps, root, trackId);
    if (!state.ok) return blockUnsafeContinuation(response, state.error || "Unable to read parallel worker state");
    if (state.workers.length === 0) {
      return blockUnsafeContinuation(response, "Parallel merge produced no worker state to clean up");
    }
    const unmerged = state.workers.filter((worker) => worker.status !== "merged");
    if (unmerged.length > 0) {
      attachWorkerCallbacks(response, root, trackId, unmerged, agentIdentifier);
      return response;
    }
    response.next = actionCall(root, "parallel.cleanup", { trackId, agentIdentifier });
    return response;
  }

  if (action === "cleanup" && args.execute === true) {
    const state = currentWorkers(deps, root, trackId);
    if (!state.ok) return blockUnsafeContinuation(response, state.error || "Unable to read parallel worker state");
    if (state.workers.length === 0) {
      return blockUnsafeContinuation(response, "Parallel cleanup produced no completed worker state");
    }
    const unmerged = state.workers.filter((worker) => worker.status !== "merged");
    if (unmerged.length > 0) {
      attachWorkerCallbacks(response, root, trackId, unmerged, agentIdentifier);
      return response;
    }
    response.next = {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "implement",
        input: { ...(trackId ? { trackId } : {}), ...(agentIdentifier ? { agentIdentifier } : {}) },
        execute: false,
      },
    };
    return response;
  }
  return response;
}

function actionCall(root: string, action: string, input: JsonObject): JsonObject {
  return { tool: "cadre_action", arguments: { root, action, input, execute: true } };
}
