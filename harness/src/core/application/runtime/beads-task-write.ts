import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { parseCommandJson } from "./beads-tree";
import { CoreResult } from "./contracts";
import { commandExists, runCommand } from "../../infrastructure/runtime/system";

export function beadsTaskWrite(root: string, args: RuntimeArgs = {}): CoreResult {
  if (!commandExists("bd", root)) {
    return { ok: false, available: false, reason: "Beads CLI (bd) is not installed or not on PATH" };
  }
  const op = args.operation;
  const id = args.id || args.taskId || args.issueId;
  const commands: CommandResult[] = [];
  const runBd = (bdArgs: string[]): CommandResult => {
    const result = runCommand("bd", bdArgs, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    commands.push(result);
    return result;
  };
  if (op === "ready") {
    const bdArgs = ["ready", "--json"];
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    runBd(bdArgs);
  } else if (op === "list") {
    const bdArgs = ["list", "--json"];
    if (args.status) bdArgs.push("--status", String(args.status));
    if (args.label) bdArgs.push("--label", String(args.label));
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    runBd(bdArgs);
  } else if (op === "show") {
    if (!id) return { ok: false, available: true, error: "id is required for show" };
    const bdArgs = ["show", String(id)];
    if (args.long === true) bdArgs.push("--long");
    bdArgs.push("--json");
    runBd(bdArgs);
  } else if (op === "update") {
    if (!id) return { ok: false, available: true, error: "id is required for update" };
    const bdArgs = ["update", String(id), "--json"];
    if (args.status) bdArgs.push("--status", String(args.status));
    if (Object.prototype.hasOwnProperty.call(args, "assignee")) bdArgs.push("--assignee", String(args.assignee || ""));
    if (args.priority) bdArgs.push("--priority", String(args.priority));
    if (args.notes) bdArgs.push("--notes", String(args.notes));
    runBd(bdArgs);
  } else if (op === "note") {
    if (!id || !args.note) return { ok: false, available: true, error: "id and note are required for note" };
    if (args.dedupKey) {
      const show = runCommand("bd", ["show", String(id), "--long", "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
      commands.push(show);
      if (show.ok && `${show.stdout}\n${show.stderr}`.includes(String(args.dedupKey))) {
        return { ok: true, available: true, operation: op, skipped: true, reason: "dedupKey already present", commands, json: parseCommandJson(show) };
      }
    }
    runBd(["note", String(id), String(args.note), "--json"]);
  } else if (op === "close") {
    if (!id) return { ok: false, available: true, error: "id is required for close" };
    const bdArgs = ["close", String(id), "--reason", String(args.reason || "Task completed"), "--json"];
    if (args.continue === true) bdArgs.splice(2, 0, "--continue");
    runBd(bdArgs);
  } else if (op === "label_add" || op === "label_remove") {
    if (!id || !args.label) return { ok: false, available: true, error: "id and label are required for label operations" };
    runBd(["label", op === "label_add" ? "add" : "remove", String(id), String(args.label), "--json"]);
  } else if (op === "dep_add" || op === "dep_remove") {
    if (!id || !args.dependsOn) return { ok: false, available: true, error: "id and dependsOn are required for dependency operations" };
    runBd(["dep", op === "dep_add" ? "add" : "remove", String(id), String(args.dependsOn), "--json"]);
  } else if (op === "create") {
    if (!args.title) return { ok: false, available: true, error: "title is required for create" };
    const bdArgs = ["create", String(args.title), "--json"];
    if (args.id) bdArgs.push("--id", String(args.id));
    if (args.type) bdArgs.push("-t", String(args.type));
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    if (args.priority) bdArgs.push("-p", String(args.priority));
    if (args.deps) bdArgs.push("--deps", String(args.deps));
    if (args.labels) bdArgs.push("--labels", Array.isArray(args.labels) ? args.labels.join(",") : String(args.labels));
    if (args.design) bdArgs.push("--design", String(args.design));
    if (args.acceptance) bdArgs.push("--acceptance", String(args.acceptance));
    if (args.ephemeral === true) bdArgs.push("--ephemeral");
    runBd(bdArgs);
  } else if (op === "mail_send") {
    if (!args.to || !args.subject) return { ok: false, available: true, error: "to and subject are required for mail_send" };
    const bdArgs = ["mail", "send", String(args.to), "--subject", String(args.subject), "--json"];
    if (args.body) bdArgs.push("--body", String(args.body));
    runBd(bdArgs);
  } else if (op === "formula_list") {
    runBd(["formula", "list", "--json"]);
  } else if (op === "formula_show") {
    if (!args.name) return { ok: false, available: true, error: "name is required for formula_show" };
    runBd(["formula", "show", String(args.name), "--json"]);
  } else if (op === "compact") {
    if (args.all === true) runBd(["admin", "compact", "--auto", "--all"]);
    else if (id) runBd(["admin", "compact", "--auto", "--id", String(id)]);
    else return { ok: false, available: true, error: "id or all=true is required for compact" };
  } else if (op === "rules_compact") {
    runBd(["rules", "compact", "--auto"]);
  } else if (op === "dolt_pull" || op === "dolt_push") {
    runBd(["dolt", op === "dolt_pull" ? "pull" : "push"]);
  } else if (op === "sql") {
    if (!args.sql) return { ok: false, available: true, error: "sql is required for sql" };
    runBd(["sql", String(args.sql)]);
  } else if (op === "worktree_create") {
    if (!args.path || !args.branch) return { ok: false, available: true, error: "path and branch are required for worktree_create" };
    runBd(["worktree", "create", String(args.path), "--branch", String(args.branch)]);
  } else if (op === "worktree_remove") {
    if (!args.path) return { ok: false, available: true, error: "path is required for worktree_remove" };
    const bdArgs = ["worktree", "remove", String(args.path)];
    if (args.force === true) bdArgs.push("--force");
    runBd(bdArgs);
  } else {
    return {
      ok: false,
      available: true,
      error: `Unsupported Beads operation: ${op}`,
      operations: [
        "ready", "list", "show", "update", "note", "close",
        "label_add", "label_remove", "dep_add", "dep_remove", "create",
        "mail_send", "formula_list", "formula_show", "compact", "rules_compact",
        "dolt_pull", "dolt_push", "sql", "worktree_create", "worktree_remove",
      ],
    };
  }
  const ok = commands.every((cmd) => cmd.ok || (op === "close" && /already|closed/i.test(`${cmd.stdout}\n${cmd.stderr}`)));
  let json: unknown = null;
  const last = commands[commands.length - 1];
  try {
    json = JSON.parse(last && last.stdout ? last.stdout : "null") as unknown;
  } catch {
    // Keep raw output.
  }
  const rowsAffectedMatch = last ? `${last.stdout}\n${last.stderr}`.match(/(?:rows?\s+affected|affected\s+rows?)\D+(\d+)/i) : null;
  return {
    ok,
    available: true,
    operation: op,
    commands,
    json,
    rows_affected: rowsAffectedMatch?.[1] ? Number(rowsAffectedMatch[1]) : null,
  };
}
