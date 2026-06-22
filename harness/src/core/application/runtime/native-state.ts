import fs from "node:fs";
import path from "node:path";

import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString } from "../../../guards";
import type { CoreResult } from "./contracts";
import { appendJsonl, fileExists, textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { gitIdentity } from "../../infrastructure/runtime/system";

export type MessageBox = "inbox" | "outbox";

export function nativeStatePaths(root: string): JsonObject {
  return {
    events: path.join(root, "cadre", "events.jsonl"),
    formulas: path.join(root, "cadre", "formulas"),
    operations: path.join(root, "cadre", "operations"),
    messages: path.join(root, "cadre", "messages"),
    inbox: path.join(root, "cadre", "messages", "inbox.jsonl"),
    outbox: path.join(root, "cadre", "messages", "outbox.jsonl"),
    wisps: path.join(root, "cadre", "local", "wisps"),
  };
}

function compactStamp(value: string): string {
  return value.replace(/[^0-9A-Za-z]+/g, "").slice(0, 16);
}

function nativeId(prefix: string, payload: JsonObject): string {
  const recordedAt = asOptionalString(payload.recorded_at) || utcNow();
  return `${prefix}_${compactStamp(recordedAt)}_${textHash(JSON.stringify(payload)).slice(0, 12)}`;
}

function readJsonlObjects(file: string, limit = 200): JsonObject[] {
  if (!fileExists(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const selected = limit > 0 ? lines.slice(-limit) : lines;
  const out: JsonObject[] = [];
  for (const line of selected) {
    try {
      out.push(asJsonObject(JSON.parse(line)));
    } catch {
      // Ignore malformed historical rows; appenders always write strict JSON.
    }
  }
  return out;
}

function countJsonlLines(file: string): number {
  if (!fileExists(file)) return 0;
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function ensureCadreLocalIgnored(root: string): string | null {
  const cadreDir = path.join(root, "cadre");
  const ignorePath = path.join(cadreDir, ".gitignore");
  fs.mkdirSync(cadreDir, { recursive: true });
  const current = fileExists(ignorePath) ? fs.readFileSync(ignorePath, "utf8") : "";
  const lines = current.split(/\r?\n/).filter(Boolean);
  if (!lines.includes("/local/")) {
    lines.push("/local/");
    fs.writeFileSync(ignorePath, `${lines.join("\n")}\n`);
    return path.relative(root, ignorePath);
  }
  return null;
}

export function ensureNativeState(root: string): CoreResult {
  const paths = nativeStatePaths(root);
  for (const dir of [
    asOptionalString(paths.formulas),
    asOptionalString(paths.operations),
    asOptionalString(paths.messages),
    asOptionalString(paths.wisps),
  ].filter((value): value is string => Boolean(value))) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const ignore_path = ensureCadreLocalIgnored(root);
  return {
    ok: true,
    paths: {
      events: path.relative(root, String(paths.events)),
      formulas: path.relative(root, String(paths.formulas)),
      operations: path.relative(root, String(paths.operations)),
      messages: path.relative(root, String(paths.messages)),
      wisps: path.relative(root, String(paths.wisps)),
    },
    ignore_path,
  };
}

export function appendCadreEvent(root: string, event: JsonObject): CoreResult {
  ensureNativeState(root);
  const recorded_at = asOptionalString(event.recorded_at) || utcNow();
  const kind = asOptionalString(event.kind || event.type) || "event";
  const actor = asOptionalString(event.actor) || gitIdentity(root) || null;
  const entry: JsonObject = {
    ...event,
    version: 1,
    schema: "cadre.event.v1",
    id: asOptionalString(event.id) || nativeId("evt", { ...event, recorded_at, kind }),
    kind,
    recorded_at,
    actor,
  };
  const file = path.join(root, "cadre", "events.jsonl");
  appendJsonl(file, entry);
  return { ok: true, path: path.relative(root, file), event: entry };
}

export function readCadreEvents(root: string, limit = 50): JsonObject[] {
  return readJsonlObjects(path.join(root, "cadre", "events.jsonl"), limit);
}

export function appendCadreMessage(root: string, box: MessageBox, message: JsonObject): CoreResult {
  ensureNativeState(root);
  const recorded_at = asOptionalString(message.recorded_at) || utcNow();
  const direction = box === "outbox" ? "outgoing" : "incoming";
  const entry: JsonObject = {
    ...message,
    version: 1,
    schema: "cadre.message.v1",
    id: asOptionalString(message.id) || nativeId(`msg_${box}`, { ...message, recorded_at, direction }),
    box,
    direction,
    status: asOptionalString(message.status) || "pending",
    recorded_at,
    from: asOptionalString(message.from) || gitIdentity(root) || null,
  };
  const file = path.join(root, "cadre", "messages", `${box}.jsonl`);
  appendJsonl(file, entry);
  return { ok: true, path: path.relative(root, file), message: entry };
}

export function readCadreMessages(root: string, box: MessageBox, limit = 50): JsonObject[] {
  return readJsonlObjects(path.join(root, "cadre", "messages", `${box}.jsonl`), limit);
}

export function nativeStateSummary(root: string): CoreResult {
  const paths = nativeStatePaths(root);
  return {
    ok: true,
    paths: {
      events: path.relative(root, String(paths.events)),
      inbox: path.relative(root, String(paths.inbox)),
      outbox: path.relative(root, String(paths.outbox)),
      operations: path.relative(root, String(paths.operations)),
      formulas: path.relative(root, String(paths.formulas)),
      wisps: path.relative(root, String(paths.wisps)),
    },
    counts: {
      events: countJsonlLines(String(paths.events)),
      inbox: countJsonlLines(String(paths.inbox)),
      outbox: countJsonlLines(String(paths.outbox)),
    },
    recent_events: readCadreEvents(root, 8),
    recent_inbox: readCadreMessages(root, "inbox", 8),
    recent_outbox: readCadreMessages(root, "outbox", 8),
  };
}
