import { asOptionalString } from "../../../guards";
import type { CoreResult } from "./contracts";

/** Convert a required event/audit write failure into a typed recovery result. */
export function requiredAuditFailure(
  audit: CoreResult | null,
  stage: "event_log" | "approval_audit",
  fallback: string,
  context: CoreResult = {},
): CoreResult | null {
  if (!audit || audit.ok !== false) return null;
  return {
    ...context,
    ok: false,
    recovery_required: true,
    phase_state: "recovery_required",
    stage,
    error: asOptionalString(audit.error) || fallback,
  };
}
