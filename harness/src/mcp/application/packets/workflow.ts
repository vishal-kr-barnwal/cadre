import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { authorizeProjectSourceResources } from "../project-source-capabilities";
import { warmLspReview } from "../review-support";
import type { RuntimeDependencies } from "../ports";

function finalizePacket(
  deps: RuntimeDependencies,
  root: string,
  packet: RuntimeEnvelope,
): RuntimeEnvelope {
  return authorizeProjectSourceResources(deps.projectSourceReader, root, packet);
}

function packetEnvelope(
  deps: RuntimeDependencies,
  root: string,
  args: RuntimeArgs,
  value: unknown,
): RuntimeEnvelope {
  return finalizePacket(
    deps,
    root,
    deps.core.workflowPacketEnvelopeV1(root, args, value) as RuntimeEnvelope,
  );
}

export async function workflowPacket(deps: RuntimeDependencies, args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const workflow = args.workflow || args.action || "status";
  const setupWorkflows = new Set(["setup", "setup_assist", "setup_scaffold"]);
  if (setupWorkflows.has(workflow)) {
    const info = deps.rootResolver.rootFromCandidate(args.root || process.cwd());
    const root = info ? info.root : process.cwd();
    return finalizePacket(
      deps,
      root,
      deps.core.workflowPacketV1(root, { ...args, workflow }) as RuntimeEnvelope,
    );
  }
  const root = deps.rootResolver.requireCadreRoot(args);
  if (workflow === "debug") {
    if (args.async === true && args.execute !== true) {
      return packetEnvelope(deps, root, args, {
        ok: false,
        workflow,
        phase_state: "blocked",
        error: "cadre_workflow debug with input.async:true requires execute:true",
        required_payload: ["execute"],
      });
    }
    if (args.async === true) return packetEnvelope(deps, root, args, { ok: true, workflow, phase_state: "running", job: deps.jobs.start("dap_snapshot", root, { ...args, action: "dap_snapshot" }) });
    if (args.execute === true) return packetEnvelope(deps, root, args, await deps.core.dapSnapshot(root, args));
    return finalizePacket(
      deps,
      root,
      deps.core.workflowPacketV1(root, { ...args, workflow }) as RuntimeEnvelope,
    );
  }
  if ((workflow === "review" || workflow === "revise") && args.includeLsp !== false) {
    const lspResult = await warmLspReview(deps, root, args);
    return packetEnvelope(deps, root, args, deps.core.workflowPacket(root, { ...args, workflow, lspResult }));
  }
  return finalizePacket(
    deps,
    root,
    deps.core.workflowPacketV1(root, { ...args, workflow }) as RuntimeEnvelope,
  );
}
