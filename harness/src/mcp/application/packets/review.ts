import type { JsonObject, RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope, syncedEnvelope } from "../envelope";
import { jobEnvelope, jobTypeForPacket } from "../job-support";
import { warmLspReview } from "../review-support";
import type { RuntimeDependencies } from "../ports";

export async function reviewPacket(deps: RuntimeDependencies, args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const root = deps.rootResolver.requireCadreRoot(args);
  const action = args.action || "assist";
  if (args.async === true) return jobEnvelope(jobTypeForPacket("cadre_review", args), root, args, deps);
  if (action === "assist") {
    let lspResult: JsonObject | null = null;
    if (args.includeLsp !== false) {
      lspResult = await warmLspReview(deps, root, args);
    }
    const reviewArgs: RuntimeArgs = { ...args };
    if (lspResult) reviewArgs.lspResult = lspResult;
    return envelope(deps.core.reviewAssist(root, reviewArgs));
  }
  if (action === "machine_gate") return envelope(deps.core.reviewMachineGate(root, args));
  if (action === "gate") {
    const trackId = args.trackId || args.track_id;
    if (!trackId) return envelope({ ok: false, error: "trackId is required" });
    return envelope(deps.core.reviewGate(root, trackId, args));
  }
  if (action === "pr_ci_status") return envelope(deps.core.prCiStatus(root, args));
  if (action === "provider_evidence") return syncedEnvelope(root, "review:provider_evidence", () => deps.core.providerEvidence(root, args));
  return envelope({ ok: false, error: `Unknown cadre_review action: ${action}` });
}
