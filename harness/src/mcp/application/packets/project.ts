import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import { PROTOCOL_VERSION } from "../../domain/tool-catalog";
import type { RuntimeDependencies } from "../ports";

export async function projectPacket(deps: RuntimeDependencies, args: RuntimeArgs): Promise<RuntimeEnvelope> {
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
    const info = deps.rootResolver.rootFromCandidate(args.root || process.cwd());
    return envelope(deps.core.doctor(info ? info.root : process.cwd(), { hasCadreProject: Boolean(info && info.has_cadre) }));
  }
  if (action === "root") {
    const root = deps.rootResolver.requireCadreRoot(args);
    return envelope({ ok: true, root, source: "argument.root" });
  }
  const root = deps.rootResolver.requireCadreRoot(args);
  if (action === "topology") return envelope({ ok: true, root, topology: deps.core.loadTopology(root) });
  if (action === "tech_stack_summary") return envelope(deps.core.techStackSummary(root, args));
  if (action === "integrations") return envelope(deps.core.integrationInventory(root, args));
  if (action === "sync_control_plane") return envelope(deps.core.syncControlPlane(root, args));
  if (action === "polyrepo_preflight") return envelope(deps.core.polyrepoPreflight(root));
  return envelope({ ok: false, error: `Unknown cadre_project action: ${action}` });
}
