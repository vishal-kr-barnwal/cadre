import fs from "node:fs";
import path from "node:path";

import type { JsonObject, TextJsonResult } from "../../types";
import { asJsonObject, asOptionalString } from "../../guards";
import { asTextJson, envelope } from "./envelope";
import { resourceList, resourceTemplatesList } from "../domain/resource-catalog";
import { PROTOCOL_VERSION, SERVER_INSTRUCTIONS, SUPPORTED_PROTOCOL_VERSIONS, TOOLS } from "../domain/tool-catalog";
import { resolveResource, resourceRead } from "./resources-service";
import { workflowPacket } from "./packets/workflow";
import { projectPacket } from "./packets/project";
import { statusPacket } from "./packets/status";
import { trackPacket } from "./packets/track";
import { mutatePacket } from "./packets/mutate";
import { parallelPacket } from "./packets/parallel";
import { reviewPacket } from "./packets/review";
import { intelPacket } from "./packets/intel";
import { jobPacket } from "./packets/job";
import { artifactPacket } from "./packets/artifact";
import type { McpMessage } from "../domain/protocol-types";
import type { RuntimeDependencies } from "./ports";
import {
  actionRuntimeArgs,
  parseActionToolRequest,
  parseReadToolRequest,
  parseWorkflowToolRequest,
  workflowRuntimeArgs,
  type ActionToolRequest,
} from "./tool-requests";

function packageVersion(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 5; depth += 1) {
    try {
      const manifest = asJsonObject(JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")));
      if (manifest.name === "cadre-ai") return asOptionalString(manifest.version) || "unknown";
    } catch {
      // Keep walking toward the package root.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return process.env.npm_package_version || "unknown";
}

function negotiatedProtocolVersion(params: JsonObject): string {
  const requested = asOptionalString(params.protocolVersion);
  if (!requested) throw Object.assign(new Error("initialize requires params.protocolVersion"), { code: -32602 });
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : PROTOCOL_VERSION;
}

const SERVER_VERSION = packageVersion();

function taskContinuation(root: string, trackId: string | undefined): JsonObject {
  return {
    tool: "cadre_workflow",
    arguments: {
      root,
      workflow: "implement",
      input: trackId ? { trackId } : {},
      execute: false,
    },
  };
}

async function actionCall(deps: RuntimeDependencies, request: ActionToolRequest): Promise<TextJsonResult> {
  const namespaced = request.action;
  const [packet, ...rest] = namespaced.split(".");
  const action = rest.join(".");
  const normalized = actionRuntimeArgs(request, action);
  if (packet === "project") return asTextJson(await projectPacket(deps, normalized));
  if (packet === "status") return asTextJson(statusPacket(deps, normalized));
  if (packet === "track") return asTextJson(trackPacket(deps, normalized));
  if (packet === "parallel") return asTextJson(parallelPacket(deps, normalized));
  if (packet === "mutate") return asTextJson(mutatePacket(deps, normalized));
  if (packet === "job") return asTextJson(jobPacket(deps, normalized));
  if (packet === "review") return asTextJson(await reviewPacket(deps, normalized));
  if (packet === "intel") return asTextJson(await intelPacket(deps, normalized));
  if (packet === "artifact") return asTextJson(artifactPacket(deps, normalized));
  if (packet === "task" && action === "complete") {
    const root = deps.rootResolver.requireCadreRoot(normalized);
    if (normalized.execute !== true) {
      const response = envelope({ ok: false, error: "cadre_action task.complete requires execute:true" });
      response.required = ["execute"];
      return asTextJson(response);
    }
    if (normalized.async === true) {
      const response = envelope({ ok: true, job: deps.jobs.start("complete_task", root, normalized) });
      const job = asJsonObject(response.job || asJsonObject(response.data).job);
      response.next = job.id ? {
        tool: "cadre_action",
        arguments: { root, action: "job.result", input: { jobId: job.id } },
      } : null;
      return asTextJson(response);
    }
    const response = envelope(deps.core.completeTask(root, normalized));
    response.next = response.ok
      ? taskContinuation(root, asOptionalString(normalized.trackId || normalized.track_id))
      : null;
    return asTextJson(response);
  }
  throw Object.assign(new Error(`Unknown cadre_action namespace: ${namespaced}`), { code: -32602 });
}

function createToolCall(deps: RuntimeDependencies) {
  return async function toolCall(name: string, args: unknown = {}): Promise<TextJsonResult> {
    if (name === "cadre_read") {
      const request = parseReadToolRequest(args);
      return asTextJson(resolveResource(request.uri, deps));
    }
    if (name === "cadre_workflow") {
      const request = parseWorkflowToolRequest(args);
      return asTextJson(await workflowPacket(deps, workflowRuntimeArgs(request)));
    }
    if (name === "cadre_action") return actionCall(deps, parseActionToolRequest(args));
    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  };
}

export function createMcpRuntime(deps: RuntimeDependencies) {
  const toolCall = createToolCall(deps);
  let lifecycle: "uninitialized" | "awaiting_initialized" | "ready" = "uninitialized";

  async function handle(message: McpMessage): Promise<unknown> {
    const method = message.method;
    const params = asJsonObject(message.params);
    if (method === "initialize") {
      if (!("id" in message)) throw Object.assign(new Error("initialize must be a request"), { code: -32600 });
      if (lifecycle !== "uninitialized") throw Object.assign(new Error("Server is already initialized"), { code: -32600 });
      const protocolVersion = negotiatedProtocolVersion(params);
      lifecycle = "awaiting_initialized";
      return {
        protocolVersion,
        capabilities: { resources: { listChanged: false }, tools: { listChanged: false } },
        serverInfo: { name: "cadre", version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      };
    }
    if (method === "notifications/initialized") {
      if ("id" in message) throw Object.assign(new Error("notifications/initialized must be a notification"), { code: -32600 });
      if (lifecycle !== "awaiting_initialized") throw Object.assign(new Error("Server has not accepted initialize"), { code: -32600 });
      lifecycle = "ready";
      return undefined;
    }
    if (["ping", "tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read"].includes(method) && !("id" in message)) {
      throw Object.assign(new Error(`${method} must be a request`), { code: -32600 });
    }
    if (method === "ping") return {};
    if (lifecycle !== "ready") throw Object.assign(new Error("Server not initialized"), { code: -32002 });
    if (method === "tools/list") return { tools: TOOLS };
    if (method === "tools/call") {
      const name = asOptionalString(params.name);
      if (!name) throw Object.assign(new Error("tools/call requires params.name"), { code: -32602 });
      return toolCall(name, params.arguments);
    }
    if (method === "resources/list") return resourceList();
    if (method === "resources/templates/list") return resourceTemplatesList();
    if (method === "resources/read") {
      const uri = asOptionalString(params.uri);
      if (!uri) throw Object.assign(new Error("resources/read requires params.uri"), { code: -32602 });
      return resourceRead(uri, deps);
    }
    throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }

  return { handle };
}

export type McpRuntime = ReturnType<typeof createMcpRuntime>;
