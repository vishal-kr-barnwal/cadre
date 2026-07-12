import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { warmLspReview } from "../review-support";
import type { RuntimeDependencies } from "../ports";
import { workflowEnvelope } from "../workflow-envelope";

export async function workflowPacket(deps: RuntimeDependencies, args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const workflow = args.workflow || args.action || "status";
  const setupWorkflows = new Set(["setup", "setup_assist", "setup_scaffold"]);
  if (setupWorkflows.has(workflow)) {
    const info = deps.rootResolver.rootFromCandidate(args.root || process.cwd());
    const root = info ? info.root : process.cwd();
    return workflowEnvelope(root, args, deps.core.workflowPacket(root, { ...args, workflow }));
  }
  const root = deps.rootResolver.requireCadreRoot(args);
  if (workflow === "debug") {
    if (args.async === true) return workflowEnvelope(root, args, { ok: true, workflow, phase_state: "running", job: deps.jobs.start("dap_snapshot", root, { ...args, action: "dap_snapshot" }) });
    if (args.execute === true) return workflowEnvelope(root, args, await deps.core.dapSnapshot(root, args));
    return workflowEnvelope(root, args, deps.core.workflowPacket(root, { ...args, workflow }));
  }
  if ((workflow === "review" || workflow === "revise") && args.includeLsp !== false) {
    const lspResult = await warmLspReview(deps, root, args);
    return workflowEnvelope(root, args, deps.core.workflowPacket(root, { ...args, workflow, lspResult }));
  }
  return workflowEnvelope(root, args, deps.core.workflowPacket(root, { ...args, workflow }));
}
