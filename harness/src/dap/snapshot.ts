import path from "node:path";

import type { JsonObject, RuntimeArgs } from "../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage } from "../guards";
import { DapClient } from "./client";
import { normalizeDapSession, redactDapValue, type DapSession } from "./config";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactText(value: string): string {
  return value
    .replace(/(token|password|secret|api[_-]?key|authorization)(\s*[=:]\s*)\S+/gi, "$1$2<redacted>")
    .slice(-8000);
}

function outputEvents(client: DapClient): JsonObject[] {
  return client.outputs.slice(-50).map((event) => {
    const body = asJsonObject(event.body);
    return {
      category: asOptionalString(body.category) || "console",
      output: redactText(asOptionalString(body.output) || ""),
    };
  });
}

async function requestOptional(client: DapClient, command: string, args: JsonObject, timeoutMs = 3000): Promise<JsonObject | null> {
  try {
    return await client.request(command, args, timeoutMs);
  } catch {
    return null;
  }
}

async function collectVariables(client: DapClient, variablesReference: number, limit: number): Promise<JsonObject[]> {
  if (variablesReference <= 0) return [];
  const result = await requestOptional(client, "variables", { variablesReference, start: 0, count: limit });
  const variables = Array.isArray(result?.variables) ? result.variables.map(asJsonObject) : [];
  return variables.slice(0, limit).map((variable) => ({
    name: asOptionalString(variable.name) || "",
    type: asOptionalString(variable.type) || null,
    value: redactText(asOptionalString(variable.value) || ""),
    variablesReference: asNumber(variable.variablesReference),
  }));
}

async function collectScopes(client: DapClient, frameId: number, variableLimit: number): Promise<JsonObject[]> {
  const scopesResult = await requestOptional(client, "scopes", { frameId });
  const scopes = Array.isArray(scopesResult?.scopes) ? scopesResult.scopes.map(asJsonObject) : [];
  const collected: JsonObject[] = [];
  for (const scope of scopes.slice(0, 6)) {
    const variablesReference = asNumber(scope.variablesReference);
    collected.push({
      name: asOptionalString(scope.name) || "scope",
      expensive: scope.expensive === true,
      variables: await collectVariables(client, variablesReference, variableLimit),
    });
  }
  return collected;
}

async function collectStoppedSnapshot(client: DapClient, event: JsonObject, args: RuntimeArgs): Promise<JsonObject> {
  const body = asJsonObject(event.body);
  const frameLimit = Math.max(1, Math.min(50, asNumber(args.limit, 20)));
  const variableLimit = Math.max(1, Math.min(100, asNumber(args.variableLimit || args.variable_limit, 25)));
  const threadsResult = await requestOptional(client, "threads", {});
  const threadIds = asNumber(body.threadId) > 0
    ? [asNumber(body.threadId)]
    : (Array.isArray(threadsResult?.threads) ? threadsResult.threads.map(asJsonObject).map((thread) => asNumber(thread.id)).filter(Boolean) : []);
  const threads: JsonObject[] = [];
  for (const threadId of threadIds.slice(0, 8)) {
    const stack = await requestOptional(client, "stackTrace", { threadId, startFrame: 0, levels: frameLimit });
    const frames = Array.isArray(stack?.stackFrames) ? stack.stackFrames.map(asJsonObject) : [];
    const summarizedFrames: JsonObject[] = [];
    for (const frame of frames.slice(0, frameLimit)) {
      const source = asJsonObject(frame.source);
      const frameId = asNumber(frame.id);
      summarizedFrames.push({
        id: frameId,
        name: asOptionalString(frame.name) || "",
        file: asOptionalString(source.path) || asOptionalString(source.name) || null,
        line: asNumber(frame.line),
        column: asNumber(frame.column),
        scopes: summarizedFrames.length === 0 ? await collectScopes(client, frameId, variableLimit) : [],
      });
    }
    threads.push({ threadId, frames: summarizedFrames });
  }
  return {
    event: "stopped",
    reason: asOptionalString(body.reason) || null,
    description: asOptionalString(body.description) || null,
    thread_id: asNumber(body.threadId) || null,
    threads,
  };
}

async function setBreakpoints(client: DapClient, root: string, breakpoints: JsonObject[]): Promise<JsonObject[]> {
  const groups = new Map<string, JsonObject[]>();
  for (const breakpoint of breakpoints) {
    const file = asOptionalString(breakpoint.file);
    if (!file) continue;
    const entries = groups.get(file) || [];
    entries.push(breakpoint);
    groups.set(file, entries);
  }
  const results: JsonObject[] = [];
  for (const [file, entries] of groups.entries()) {
    const abs = path.isAbsolute(file) ? file : path.join(root, file);
    const response = await requestOptional(client, "setBreakpoints", {
      source: { path: abs },
      breakpoints: entries.map((entry) => ({
        line: asNumber(entry.line),
        condition: asOptionalString(entry.condition),
        hitCondition: asOptionalString(entry.hitCondition || entry.hit_condition),
        logMessage: asOptionalString(entry.logMessage || entry.log_message),
      })),
    });
    results.push({
      file,
      breakpoints: Array.isArray(response?.breakpoints) ? response.breakpoints.map(asJsonObject) : [],
    });
  }
  return results;
}

export async function dapSnapshot(root: string, args: RuntimeArgs = {}): Promise<JsonObject> {
  const normalized = normalizeDapSession(root, args);
  if ("ok" in normalized && normalized.ok === false) return normalized;
  const session = normalized as DapSession;
  const command = asOptionalString(session.adapter.command) || "";
  const adapterArgs = asStringArray(session.adapter.args);
  const client = new DapClient({
    command,
    args: adapterArgs,
    cwd: root,
    requestTimeoutMs: asNumber(session.adapter.requestTimeoutMs, 10000),
    outputLimit: 8000,
  });
  let launchResponse: JsonObject | null = null;
  let launchError: string | null = null;
  const startedAt = new Date().toISOString();
  try {
    await client.start();
    const initialize = await client.request("initialize", {
      adapterID: asOptionalString(session.adapter.id) || command,
      clientID: "cadre",
      clientName: "Cadre",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
    });
    const initialized = client.waitForAny(["initialized"], Math.min(5000, session.timeoutMs));
    const launch = client.request(session.request, session.arguments, session.timeoutMs)
      .then((body) => {
        launchResponse = body;
      })
      .catch((error) => {
        launchError = errorMessage(error);
      });
    await initialized;
    const breakpointResults = await setBreakpoints(client, root, session.breakpoints);
    await requestOptional(client, "configurationDone", {}, 3000);
    await Promise.race([launch, delay(250)]);
    if (launchError) throw new Error(launchError);
    const finalEvent = await client.waitForAny(["stopped", "terminated", "exited"], session.timeoutMs);
    const snapshot = finalEvent?.event === "stopped"
      ? await collectStoppedSnapshot(client, finalEvent, args)
      : {
        event: asOptionalString(finalEvent?.event) || "timeout",
        body: finalEvent ? asJsonObject(redactDapValue(asJsonObject(finalEvent.body))) : null,
      };
    return {
      ok: finalEvent !== null,
      root,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      adapter: {
        id: asOptionalString(session.adapter.id) || command,
        command,
        args: adapterArgs,
      },
      request: session.request,
      configuration: redactDapValue(session.configuration) as JsonObject,
      initialize,
      launch_response: launchResponse,
      breakpoints: breakpointResults,
      snapshot,
      output: outputEvents(client),
      adapter_stderr_tail: redactText(client.stderrTail()),
      error: finalEvent ? undefined : `DAP snapshot timed out after ${session.timeoutMs}ms`,
    };
  } catch (error) {
    return {
      ok: false,
      root,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      adapter: { command, args: adapterArgs },
      configuration: redactDapValue(session.configuration) as JsonObject,
      output: outputEvents(client),
      adapter_stderr_tail: redactText(client.stderrTail()),
      error: errorMessage(error),
    };
  } finally {
    await client.shutdown();
  }
}
