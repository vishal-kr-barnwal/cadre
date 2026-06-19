import type { RuntimeArgs } from "../../types";
import type { RuntimeEnvelope } from "../domain/protocol-types";
import { envelope } from "./envelope";
import type { RuntimeDependencies } from "./ports";

export function jobTypeForPacket(name: string, args: RuntimeArgs): string | null {
  if (name === "cadre_complete_task") return "complete_task";
  if (name === "cadre_review" && args.action === "assist") return "review_assist";
  if (name === "cadre_review" && args.action === "machine_gate") return "machine_gate";
  if (name === "cadre_intel" && args.action === "lsp_review") return "lsp_review";
  if (name === "cadre_intel" && args.action === "lsp_impact") return "lsp_impact";
  return args.type || null;
}

export function jobEnvelope(type: string | null, root: string, args: RuntimeArgs, deps: Pick<RuntimeDependencies, "jobs">): RuntimeEnvelope {
  if (!type) return envelope({ ok: false, error: "job type is required" });
  return envelope({ ok: true, job: deps.jobs.start(type, root, args) });
}
