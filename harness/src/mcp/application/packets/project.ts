import fs from "node:fs";
import path from "node:path";

import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import { PROTOCOL_VERSION } from "../../domain/tool-catalog";
import type { RuntimeDependencies } from "../ports";

function invalidRootError(received: unknown): Error {
  return Object.assign(
    new Error(`This Cadre MCP tool requires { root } pointing at, or inside, a project containing cadre/. Received: ${received || "(missing)"}`),
    { code: -32602 }
  );
}

function isPackagedCadreSkillDir(root: string): boolean {
  const normalized = root.split(path.sep).join("/");
  return normalized.endsWith("/harness/skills/cadre") && fs.existsSync(path.join(root, "SKILL.md"));
}

function setupSafeRoot(deps: RuntimeDependencies, args: RuntimeArgs): { root: string; has_cadre: boolean } {
  const info = deps.rootResolver.rootFromCandidate(args.root || process.cwd());
  if (!info || (!info.has_cadre && isPackagedCadreSkillDir(info.root))) throw invalidRootError(args.root);
  return info;
}

export async function projectPacket(deps: RuntimeDependencies, args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const action = args.action || "ping";
  if (action === "ping") {
    return envelope({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      server: "cadre",
      rootContract: "project-scoped tools require { root } per call; setup-safe reads accept root candidates before cadre/ exists",
    });
  }
  if (action === "doctor") {
    const info = deps.rootResolver.rootFromCandidate(args.root || process.cwd());
    return envelope(deps.core.doctor(info ? info.root : process.cwd(), { hasCadreProject: Boolean(info && info.has_cadre) }));
  }
  if (action === "root") {
    const info = setupSafeRoot(deps, args);
    return envelope({ ok: true, root: info.root, has_cadre: info.has_cadre, setup_candidate: !info.has_cadre, source: "argument.root" });
  }
  const setupSafeActions = new Set(["tech_stack_summary", "integrations"]);
  const root = setupSafeActions.has(String(action))
    ? setupSafeRoot(deps, args).root
    : deps.rootResolver.requireCadreRoot(args);
  if (action === "topology") return envelope({ ok: true, root, topology: deps.core.loadTopology(root) });
  if (action === "tech_stack_summary") return envelope(deps.core.techStackSummary(root, args));
  if (action === "integrations") return envelope(deps.core.integrationInventory(root, args));
  if (action === "sync_control_plane") return envelope(deps.core.syncControlPlane(root, args));
  if (action === "polyrepo_preflight") return envelope(deps.core.polyrepoPreflight(root));
  return envelope({ ok: false, error: `Unknown cadre_project action: ${action}` });
}
