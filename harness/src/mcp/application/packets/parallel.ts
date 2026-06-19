import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import type { RuntimeDependencies } from "../ports";

export function parallelPacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const root = deps.rootResolver.requireCadreRoot(args);
  return envelope(deps.core.parallelWorkflow(root, args));
}
