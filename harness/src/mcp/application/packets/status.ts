import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import type { RuntimeDependencies } from "../ports";

export function statusPacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const root = deps.rootResolver.requireCadreRoot(args);
  const action = args.action || "live";
  if (action === "live") return envelope(deps.core.liveStatus(root));
  if (action === "team") return envelope(deps.core.teamStatus(root));
  if (action === "mine") return envelope(deps.core.teamBoard(root, { mine: true }));
  if (action === "available") return envelope(deps.core.availableWork(root));
  if (action === "collisions") return envelope(deps.core.collisionScan(root));
  if (action === "board") return envelope(deps.core.teamBoard(root, args));
  if (action === "fleet") return envelope(deps.core.fleetStatus(root, args));
  return envelope({ ok: false, error: `Unknown cadre_status action: ${action}` });
}
