import type { RuntimeArgs } from "../../types";
import { asJsonObject } from "../../guards";
import type { RuntimeEnvelope } from "../domain/protocol-types";
import { envelope } from "./envelope";
import type { RuntimeDependencies } from "./ports";

const ASYNC_JOB_TYPES: Record<string, string> = {
  "task.complete": "complete_task",
  "review.assist": "review_assist",
  "review.machine_gate": "machine_gate",
  "intel.lsp_review": "lsp_review",
  "intel.lsp_impact": "lsp_impact",
  "intel.dap_snapshot": "dap_snapshot",
};

export function jobTypeForAction(action: string): string | null {
  return ASYNC_JOB_TYPES[action] || null;
}

export function jobEnvelope(type: string | null, root: string, args: RuntimeArgs, deps: Pick<RuntimeDependencies, "jobs">): RuntimeEnvelope {
  if (!type) return envelope({ ok: false, error: "job type is required" });
  const response = envelope({ ok: true, job: deps.jobs.start(type, root, args) });
  const job = asJsonObject(response.job);
  response.next = job.id ? {
    tool: "cadre_action",
    arguments: { root, action: "job.result", input: { jobId: job.id } },
  } : null;
  return response;
}
