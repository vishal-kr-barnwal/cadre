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
    if (!args.planPath) return envelope({ ok: false, error: "planPath is required" });
    return envelope(deps.core.parsePlanFile(path.resolve(root, args.planPath)));
  }
  if (action === "integrity") return envelope(deps.core.planIntegrity(root, args.trackId || args.track_id || null));
  if (action === "phase_schedule") return envelope(deps.core.phaseSchedule(root, args));
  if (action === "prepare_implementation") return envelope(deps.core.implementationPrep(root, args));
  if (action === "create_beads_tree") return envelope(deps.core.createBeadsTree(root, args));
  if (action === "plan_assist") return envelope(deps.core.planAssist(root, args));
  if (action === "worktree_plan") return envelope(deps.core.worktreePlan(root, args));
  return envelope({ ok: false, error: `Unknown cadre_track action: ${action}` });
}
