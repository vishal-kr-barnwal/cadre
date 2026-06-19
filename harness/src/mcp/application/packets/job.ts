import type { RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import { jobEnvelope } from "../job-support";
import type { RuntimeDependencies } from "../ports";
import { asJsonObject } from "../../../guards";

export function jobPacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const action = args.action || "status";
  if (action === "start") {
    const root = deps.rootResolver.requireCadreRoot(args);
    const type = args.type;
    if (!type) return envelope({ ok: false, error: "type is required for cadre_job start" });
    return jobEnvelope(type, root, args.args || args, deps);
  }
  if (action === "status") {
    const job = deps.jobs.get(args.jobId || args.id);
    if (job) return envelope({ ok: true, job: deps.jobs.summary(job) });
    const info = args.root ? deps.rootResolver.rootFromCandidate(args.root) : null;
    const persisted = info ? deps.jobs.loadPersisted(info.root, args.jobId || args.id) : null;
    return envelope(persisted ? { ok: true, job: persisted } : { ok: false, error: `Job not found: ${args.jobId || args.id}` });
  }
  if (action === "result") {
    const live = deps.jobs.result(args.jobId || args.id);
    if (live.ok !== false) return envelope(live);
    const info = args.root ? deps.rootResolver.rootFromCandidate(args.root) : null;
    const persisted = info ? deps.jobs.loadPersisted(info.root, args.jobId || args.id) : null;
    return envelope(persisted ? { ok: persisted.status === "succeeded", job: persisted, result: asJsonObject(persisted.result) } : live);
  }
  if (action === "cancel") return envelope(deps.jobs.cancel(args.jobId || args.id));
  if (action === "list") {
    const info = args.root ? deps.rootResolver.rootFromCandidate(args.root) : null;
    return envelope(deps.jobs.list(info ? info.root : null));
  }
  return envelope({ ok: false, error: `Unknown cadre_job action: ${action}` });
}
