import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope, syncedEnvelope } from "../envelope";
import type { RuntimeDependencies } from "../ports";

export function mutatePacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const root = deps.rootResolver.requireCadreRoot(args);
  const action = args.action;
  if (action === "claim") {
    const trackId = args.trackId || args.track_id;
    if (!trackId) return envelope({ ok: false, error: "trackId is required" });
    return syncedEnvelope(root, "mutate:claim", () => deps.core.claimTrack(root, trackId, args));
  }
  if (action === "heartbeat") return syncedEnvelope(root, "mutate:heartbeat", () => deps.core.heartbeatTrack(root, args));
  if (action === "set_status") {
    const trackId = args.trackId || args.track_id;
    if (!trackId || !args.status) return envelope({ ok: false, error: "trackId and status are required" });
    return syncedEnvelope(root, "mutate:set_status", () => deps.core.setTrackStatus(root, String(trackId), String(args.status)));
  }
  if (action === "metadata_patch") return syncedEnvelope(root, "mutate:metadata_patch", () => deps.core.metadataPatch(root, args));
  if (action === "record_review") return syncedEnvelope(root, "mutate:record_review", () => deps.core.recordReview(root, args));
  if (action === "record_worker") return syncedEnvelope(root, "mutate:record_worker", () => deps.core.recordParallelWorker(root, { ...args, execute: false }));
  if (action === "record_task_result") return syncedEnvelope(root, "mutate:record_task_result", () => deps.core.recordTaskResult(root, args));
  if (action === "regen_index") return syncedEnvelope(root, "mutate:regen_index", () => deps.core.regenIndex(root));
  return envelope({ ok: false, error: `Unknown cadre_mutate action: ${action}` });
}
