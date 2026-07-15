import { asJsonObject, asOptionalString } from "../../../guards";
import type { RuntimeArgs, UnknownRecord } from "../../../types";

import { meaningfulRevisionArtifact } from "./workflow-evidence";

export type RevisionScope = "spec" | "plan" | "both";

function explicitScope(args: RuntimeArgs): RevisionScope | null {
  const raw = args as UnknownRecord;
  const intent = asJsonObject(raw.intent);
  const value = asOptionalString(
    raw.revisionScope
      || raw.revision_scope
      || intent.revisionScope
      || intent.revision_scope
      || raw.revisionScopeOther
      || raw.revision_scope_other
      || intent.revisionScopeOther
      || intent.revision_scope_other,
  )?.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!value) return null;
  if (value === "spec" || value === "spec only") return "spec";
  if (value === "plan" || value === "plan only") return "plan";
  if (value === "both" || value === "all" || (value.includes("spec") && value.includes("plan"))) return "both";
  return null;
}

export function revisionScope(args: RuntimeArgs, trackId: string | null = null): RevisionScope | null {
  const explicit = explicitScope(args);
  if (explicit) return explicit;
  const raw = args as UnknownRecord;
  const hasSpec = meaningfulRevisionArtifact(raw.spec, "spec", trackId);
  const hasPlan = meaningfulRevisionArtifact(raw.plan, "plan", trackId);
  if (hasSpec && hasPlan) return "both";
  if (hasSpec) return "spec";
  if (hasPlan) return "plan";
  return null;
}

export function scopeIncludes(scope: RevisionScope, kind: "spec" | "plan"): boolean {
  return scope === "both" || scope === kind;
}
