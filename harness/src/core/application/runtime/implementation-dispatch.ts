import path from "node:path";

import { asJsonObject, asOptionalString } from "../../../guards";
import type { JsonObject, PlanTask } from "../../../types";

import { patchJsonFile, readJson, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { withTrackLock } from "../../infrastructure/runtime/locking";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import type { CoreResult } from "./contracts";
import { findTrack } from "./track-context";
import { parsePlanFile } from "./track-schedule";

function canonicalRepo(value: unknown): string {
  const repo = asOptionalString(value) || "root";
  return repo === "." ? "root" : repo;
}

function taskFingerprint(task: PlanTask, repo: string): string {
  return textHash(JSON.stringify({
    task_key: task.task_key,
    repo: canonicalRepo(repo),
    files: [...(task.files || [])].sort(),
    depends: [...(task.depends || [])].sort(),
  }));
}

export function recordImplementationDispatch(root: string, trackId: string, taskPacket: JsonObject): CoreResult {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, stage: "implementation_dispatch", error: `Track not found: ${trackId}` };
  const plan = parsePlanFile(track.plan_path);
  const taskKey = asOptionalString(taskPacket.task_key);
  const task = plan.tasks.find((candidate) => candidate.task_key === taskKey);
  const call = asJsonObject(taskPacket.complete_packet);
  const input = asJsonObject(asJsonObject(call.arguments).input);
  const baselineSha = asOptionalString(input.baselineSha);
  const workingRoot = asOptionalString(input.workingRoot);
  if (!task || !baselineSha || !workingRoot || input.dispatchClean !== true) {
    return { ok: false, stage: "implementation_dispatch", error: "The clean sequential completion packet is incomplete." };
  }
  const repo = canonicalRepo(taskPacket.repo || task.repo || loadTopology(root).defaultRepo);
  return withTrackLock(root, track.track_id, () => {
    const statePath = path.join(track.dir, "implement_state.json");
    const result = patchJsonFile(statePath, (state) => ({
      ...state,
      status: "task_dispatched",
      last_updated: utcNow(),
      sequential_dispatch: {
        task_key: task.task_key,
        phase_index: task.phase_index,
        task_index: task.task_index,
        repo,
        working_root: workingRoot,
        baseline_sha: baselineSha,
        dispatch_clean: true,
        task_fingerprint: taskFingerprint(task, repo),
        dispatched_at: utcNow(),
      },
    }), { lock: false });
    return { ok: result.ok !== false, state_path: path.relative(root, statePath), dispatch: asJsonObject(result.value), result };
  });
}

export function implementationDispatchMatches(
  trackDir: string,
  task: PlanTask,
  repo: string,
  workingRoot: string,
  headSha: string,
): boolean {
  const state = readJson<JsonObject | null>(path.join(trackDir, "implement_state.json"), null);
  const dispatch = asJsonObject(state?.sequential_dispatch);
  return dispatch.dispatch_clean === true
    && asOptionalString(dispatch.task_key) === task.task_key
    && Number(dispatch.phase_index) === task.phase_index
    && Number(dispatch.task_index) === task.task_index
    && canonicalRepo(dispatch.repo) === canonicalRepo(repo)
    && path.resolve(asOptionalString(dispatch.working_root) || "") === path.resolve(workingRoot)
    && asOptionalString(dispatch.baseline_sha) === headSha
    && asOptionalString(dispatch.task_fingerprint) === taskFingerprint(task, repo);
}
