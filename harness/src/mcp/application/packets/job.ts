import type { JsonObject, RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope, executionGuard } from "../envelope";
import { jobEnvelope } from "../job-support";
import type { RuntimeDependencies } from "../ports";
import { asJsonObject, asOptionalString } from "../../../guards";

function pollCall(root: string, jobId: string): JsonObject {
  return { tool: "cadre_action", arguments: { root, action: "job.result", input: { jobId } } };
}

function completedJobContinuation(root: string, job: JsonObject): JsonObject | null {
  const id = typeof job.id === "string" ? job.id : null;
  if (job.stale === true) return null;
  if (job.status === "running") return id ? pollCall(root, id) : null;
  if (job.status !== "succeeded" || job.type !== "complete_task") return null;
  const jobArgs = asJsonObject(job.args);
  const trackId = asOptionalString(jobArgs.trackId || jobArgs.track_id);
  return {
    tool: "cadre_workflow",
    arguments: {
      root,
      workflow: "implement",
      input: typeof trackId === "string" ? { trackId } : {},
      execute: false,
    },
  };
}

function jobResultEnvelope(root: string, value: JsonObject): RuntimeEnvelope {
  const response = envelope(value);
  response.next = completedJobContinuation(root, asJsonObject(value.job));
  return response;
}

export function jobPacket(deps: RuntimeDependencies, args: RuntimeArgs): RuntimeEnvelope {
  const action = args.action || "status";
  if (action === "start") {
    const guard = executionGuard("job.start", args);
    if (guard) return guard;
    const root = deps.rootResolver.requireCadreRoot(args);
    const type = args.type;
    if (!type) return envelope({ ok: false, error: "input.type is required for cadre_action job.start" });
    return jobEnvelope(type, root, args.args || args, deps);
  }
  if (action === "status") {
    const root = deps.rootResolver.requireCadreRoot(args);
    const job = deps.jobs.get(root, args.jobId || args.id);
    if (job) return jobResultEnvelope(root, { ok: true, job: { ...deps.jobs.summary(job), args: job.args } });
    const persisted = deps.jobs.loadPersisted(root, args.jobId || args.id);
    return persisted
      ? jobResultEnvelope(root, { ok: true, job: persisted })
      : envelope({ ok: false, error: `Job not found: ${args.jobId || args.id}` });
  }
  if (action === "result") {
    const root = deps.rootResolver.requireCadreRoot(args);
    const managed = deps.jobs.get(root, args.jobId || args.id);
    const live = deps.jobs.result(root, args.jobId || args.id);
    if (managed) {
      const job = { ...asJsonObject(live.job), args: managed.args };
      return jobResultEnvelope(root, { ...live, job });
    }
    const persisted = deps.jobs.loadPersisted(root, args.jobId || args.id);
    if (!persisted) return envelope(live);
    const stale = persisted.stale === true;
    return jobResultEnvelope(root, {
      ok: !stale && (persisted.status === "running" || persisted.status === "succeeded"),
      ...(stale ? { error: "Job was interrupted by an MCP server restart; start it again." } : {}),
      job: persisted,
      result: asJsonObject(persisted.result),
    });
  }
  if (action === "cancel") {
    const guard = executionGuard("job.cancel", args);
    if (guard) return guard;
    const root = deps.rootResolver.requireCadreRoot(args);
    return envelope(deps.jobs.cancel(root, args.jobId || args.id));
  }
  if (action === "list") {
    const root = deps.rootResolver.requireCadreRoot(args);
    return envelope(deps.jobs.list(root));
  }
  return envelope({ ok: false, error: `Unknown cadre_action action: job.${action}` });
}
