import type { RuntimeArgs } from "../../../types";

import { withLock, withTrackLock } from "../../infrastructure/runtime/locking";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import type { CoreResult, LockOptions } from "./contracts";
import { syncControlPlane } from "./review-records";
import { findTrack } from "./track-context";
import { withSharedControlPlaneSync } from "./workflow-response";

export const TASK_COMPLETION_LOCK = "task-completion-control";

export function taskCompletionLockOptions(args: RuntimeArgs): LockOptions {
  return {
    timeoutMs: Number(args.timeoutMs || 10 * 60 * 1000),
    retries: Number(args.retries || 1200),
    retryDelayMs: 25,
  };
}

export function runTaskCompletionLocked(
  root: string,
  args: RuntimeArgs,
  operation: () => CoreResult,
): CoreResult {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const timeoutMs = Number(args.timeoutMs || 10 * 60 * 1000);
  const inner = () => withTrackLock(root, track.track_id, operation, { timeoutMs });
  const run = () => {
    const stateRecovery = args.stateRecovery === true || args.state_recovery === true;
    if (!stateRecovery) return withSharedControlPlaneSync(root, args, "complete_task", inner);
    const result = inner();
    if (result.ok === false || args.execute !== true || loadTopology(root).config.sync_mode !== "shared") return result;
    const syncPost = syncControlPlane(root, { mode: "post" });
    return {
      ...result,
      ok: syncPost.ok !== false,
      sync_pre: { ok: true, skipped: true, reason: "state-only recovery" },
      sync_post: syncPost,
    };
  };
  return withLock(root, TASK_COMPLETION_LOCK, run, taskCompletionLockOptions(args));
}
