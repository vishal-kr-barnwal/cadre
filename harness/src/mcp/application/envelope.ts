import type { RuntimeArgs, TextJsonResult } from "../../types";
import { asJsonObject, asStringArray } from "../../guards";
import type { RuntimeEnvelope } from "../domain/protocol-types";
import type { RuntimeDependencies } from "./ports";

export function asTextJson(value: unknown): TextJsonResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function envelope(value: unknown): RuntimeEnvelope {
  const object = asJsonObject(value);
  const ok = Object.prototype.hasOwnProperty.call(object, "ok") ? Boolean(object.ok) : true;
  const warnings = Array.isArray(object.warnings) ? object.warnings : [];
  const reason = object.error || object.reason || object.stage;
  const structuredErrors = asStringArray(object.errors);
  const primary = typeof reason === "string" ? reason : null;
  const errors = ok
    ? structuredErrors
    : Array.from(new Set([primary || structuredErrors[0] || "Cadre operation failed", ...structuredErrors]));
  const out: RuntimeEnvelope = { ok, data: value || null, warnings, errors };
  if (Object.prototype.hasOwnProperty.call(object, "commands")) out.commands = object.commands;
  if (Object.prototype.hasOwnProperty.call(object, "job")) out.job = object.job;
  return out;
}

export function executionGuard(action: string, args: RuntimeArgs): RuntimeEnvelope | null {
  if (args.execute === true) return null;
  const response = envelope({ ok: false, error: `cadre_action ${action} requires execute:true` });
  response.required = ["execute"];
  return response;
}

export function syncedEnvelope(
  core: Pick<RuntimeDependencies["core"], "syncControlPlane">,
  root: string,
  operation: string,
  fn: () => unknown,
): RuntimeEnvelope {
  const syncPre = core.syncControlPlane(root, { mode: "pre" });
  if (syncPre.ok === false) {
    return envelope({
      ok: false,
      phase_state: "blocked",
      stage: "sync_pre",
      operation,
      sync_pre: syncPre,
    });
  }
  const value = asJsonObject(fn());
  const valueOk = value.ok === false ? false : true;
  if (!valueOk) {
    return envelope({ ...value, sync_pre: syncPre, sync_post: null });
  }
  const syncPost = core.syncControlPlane(root, { mode: "post" });
  return envelope({
    ...value,
    ok: valueOk && syncPost.ok !== false,
    phase_state: syncPost.ok === false ? "recovery_required" : value.phase_state,
    sync_pre: syncPre,
    sync_post: syncPost,
  });
}
