import type { CadreTrack, JsonObject } from "../../../types";
import { asOptionalString, asString, asStringArray } from "../../../guards";

import type { AgentIdentifier } from "./dispatch-adapters";
import { dispatchAdapterFor } from "./dispatch-adapters";

export function workerDispatchPayload(root: string, track: CadreTrack, worker: JsonObject, worktree: string, sourceRoot: string, agentIdentifier: AgentIdentifier): JsonObject {
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
    "Use only Cadre packets for Cadre, provider, index, and worker-state mutations.",
    "Change only the assigned product files unless the task requires a narrowly related test or manifest update.",
    "Run the smallest relevant tests first, then the configured project gate when practical.",
    "Commit the worker worktree changes and return the structured result JSON.",
  ].join("\n");
  const recordFinishArguments = {
    root,
    action: "record_finish",
    trackId: track.track_id,
    workerId,
    status: "awaiting_merge",
    phaseIndex: worker.phase_index,
    taskIndex: worker.task_index,
    repo,
    workerRef: asOptionalString(worker.worker_ref) || null,
    commitSha: "<commit-sha>",
    coverage: "<coverage-number-or-null>",
    filesChanged: ["<changed-file>"],
    tests: [{ command: "<test-command>", cwd: worktree, ok: true, status: 0 }],
    summary: "<worker-summary>",
    blockers: [],
  };
  return {
    prompt,
    canonical_worker_contract: "cadre_parallel.dispatch.v1",
    repo,
    worktree,
    source_root: sourceRoot,
    worker_ref: asOptionalString(worker.worker_ref) || null,
    owned_files: ownedFiles,
    agent_identifier: agentIdentifier,
    selected_dispatch: dispatchAdapterFor(agentIdentifier),
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
        worker_ref: { type: ["string", "null"] },
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
      arguments: recordFinishArguments,
    },
    finish_evidence_fields: Object.keys(recordFinishArguments),
  };
}
