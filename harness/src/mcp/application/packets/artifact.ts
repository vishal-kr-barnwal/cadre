import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope, syncedEnvelope } from "../envelope";
import type { RuntimeDependencies } from "../ports";

export function artifactPacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const action = args.action || "catalog";
  const root = deps.rootResolver.requireCadreRoot(args);
  if (["import", "sync"].includes(String(action)) && args.execute === true) {
    return syncedEnvelope(root, `artifact:${action}`, () => deps.core.artifactPacket(root, args));
  }
  return envelope(deps.core.artifactPacket(root, args));
}
