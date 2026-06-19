import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import { warmLspReview } from "../review-support";
import type { RuntimeDependencies } from "../ports";

export async function workflowPacket(deps: RuntimeDependencies, args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const workflow = args.workflow || args.action || "status";
  const setupWorkflows = new Set(["setup", "setup_assist", "setup_scaffold"]);
  if (setupWorkflows.has(workflow)) {
    const info = deps.rootResolver.rootFromCandidate(args.root || process.cwd());
    return envelope(deps.core.workflowPacket(info ? info.root : process.cwd(), { ...args, workflow }));
  }
  const root = deps.rootResolver.requireCadreRoot(args);
  if ((workflow === "review" || workflow === "revise") && args.includeLsp !== false) {
    const lspResult = await warmLspReview(deps, root, args);
    return envelope(deps.core.workflowPacket(root, { ...args, workflow, lspResult }));
  }
  return envelope(deps.core.workflowPacket(root, { ...args, workflow }));
}
