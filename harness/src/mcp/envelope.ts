import * as core from "../cadre-core";
import type { TextJsonResult } from "../types";
import { asJsonObject } from "../guards";
import type { RuntimeEnvelope } from "./protocol-types";

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
  const errors = ok ? [] : [typeof reason === "string" ? reason : "Cadre operation failed"];
  const out: RuntimeEnvelope = { ok, data: value || null, warnings, errors };
  if (Object.prototype.hasOwnProperty.call(object, "commands")) out.commands = object.commands;
  if (Object.prototype.hasOwnProperty.call(object, "job")) out.job = object.job;
  return out;
}

export function syncedEnvelope(root: string, operation: string, fn: () => unknown): RuntimeEnvelope {
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

export function beadsOperationMutates(operation: unknown): boolean {
  return !["ready", "list", "show", "formula_list"].includes(String(operation || ""));
}
