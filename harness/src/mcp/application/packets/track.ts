import path from "node:path";

import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import type { RuntimeDependencies } from "../ports";

export function trackPacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const root = deps.rootResolver.requireCadreRoot(args);
  const action = args.action || "context";
  if (action === "context") return envelope(deps.core.trackContext(root, args.trackId || args.track_id));
  if (action === "parse_plan") {
    if (args.plan && typeof args.plan === "object") return envelope(deps.core.parsePlanJson(args.plan));
    const trackId = args.trackId || args.track_id;
    if (!trackId) return envelope({ ok: false, error: "plan or trackId is required" });
    const context = deps.core.trackContext(root, trackId);
    const track = (context && typeof context === "object" ? (context as { track?: { plan_json_path?: string } }).track : undefined);
    if (!track?.plan_json_path) return envelope({ ok: false, error: `Track not found: ${trackId}` });
    return envelope(deps.core.parsePlanFile(path.resolve(root, track.plan_json_path)));
  }
  if (action === "integrity") return envelope(deps.core.planIntegrity(root, args.trackId || args.track_id || null));
  if (action === "phase_schedule") return envelope(deps.core.phaseSchedule(root, args));
  if (action === "prepare_implementation") return envelope(deps.core.implementationPrep(root, args));
  if (action === "plan_assist") return envelope(deps.core.planAssist(root, args));
  if (action === "worktree_plan") return envelope(deps.core.worktreePlan(root, args));
  return envelope({ ok: false, error: `Unknown cadre_track action: ${action}` });
}
