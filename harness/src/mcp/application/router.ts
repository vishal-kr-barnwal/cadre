import type { JsonObject, RuntimeArgs, TextJsonResult } from "../../types";
import { asJsonObject, asOptionalString } from "../../guards";
import { asTextJson, envelope, syncedEnvelope } from "./envelope";
import { resourceList, resourceTemplatesList } from "../domain/resource-catalog";
import { PROTOCOL_VERSION, SERVER_INSTRUCTIONS, TOOLS } from "../domain/tool-catalog";
import { resourceRead } from "./resources-service";
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
import type { McpMessage, RuntimeEnvelope } from "../domain/protocol-types";
import type { RuntimeDependencies } from "./ports";

function resourceUriFromToolArgs(args: RuntimeArgs): string {
  const uri = asOptionalString(args.uri);
  if (!uri) throw Object.assign(new Error("cadre_read requires uri"), { code: -32602 });
  return uri;
}

function workflowArgs(args: RuntimeArgs): RuntimeArgs {
  const input = asJsonObject(args.input);
  const approval = asJsonObject(args.approval);
  return {
    ...input,
    root: args.root,
    workflow: args.workflow,
    execute: args.execute === true,
    ...(Object.keys(approval).length > 0 ? {
      approvalStage: approval.stage,
      approvalSessionId: approval.session_id,
      approvedStages: approval.approved_stages,
      approvalComplete: approval.complete === true,
      approvalCancel: approval.cancel === true,
    } : {}),
  } as RuntimeArgs;
}

function actionArgs(args: RuntimeArgs, action: string): RuntimeArgs {
  return {
    ...asJsonObject(args.input),
    root: args.root,
    action,
    execute: args.execute === true,
  } as RuntimeArgs;
}

async function actionCall(deps: RuntimeDependencies, args: RuntimeArgs): Promise<TextJsonResult> {
  const namespaced = asOptionalString(args.action);
  if (!namespaced || !namespaced.includes(".")) {
    throw Object.assign(new Error("cadre_action requires a namespaced action"), { code: -32602 });
  }
  const [packet, ...rest] = namespaced.split(".");
  const action = rest.join(".");
  const normalized = actionArgs(args, action);
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
    if (normalized.async === true) return asTextJson(envelope({ ok: true, job: deps.jobs.start("complete_task", root, normalized) }));
    return asTextJson(syncedEnvelope(root, "complete_task", () => deps.core.completeTask(root, { ...normalized, execute: false })));
  }
  throw Object.assign(new Error(`Unknown cadre_action namespace: ${namespaced}`), { code: -32602 });
}

function createToolCall(deps: RuntimeDependencies) {
  return async function toolCall(name: string, args: RuntimeArgs = {}): Promise<TextJsonResult> {
    if (name === "cadre_read" || name === "cadre_resource") return asTextJson(resourceRead(resourceUriFromToolArgs(args), deps));
    if (name === "cadre_workflow") return asTextJson(await workflowPacket(deps, args.input || args.approval ? workflowArgs(args) : args));
    if (name === "cadre_action") return actionCall(deps, args);
    // Legacy packet names remain internal routing aliases but are not advertised.
    if (name === "cadre_project") return asTextJson(await projectPacket(deps, args));
    if (name === "cadre_status") return asTextJson(statusPacket(deps, args));
    if (name === "cadre_track") return asTextJson(trackPacket(deps, args));
    if (name === "cadre_parallel") return asTextJson(parallelPacket(deps, args));
    if (name === "cadre_mutate") return asTextJson(mutatePacket(deps, args));
    if (name === "cadre_complete_task") {
      const root = deps.rootResolver.requireCadreRoot(args);
      if (args.async === true) return asTextJson(envelope({ ok: true, job: deps.jobs.start("complete_task", root, args) }));
      return asTextJson(syncedEnvelope(root, "complete_task", () => deps.core.completeTask(root, { ...args, execute: false })));
    }
    if (name === "cadre_job") return asTextJson(jobPacket(deps, args));
    if (name === "cadre_review") return asTextJson(await reviewPacket(deps, args));
    if (name === "cadre_intel") return asTextJson(await intelPacket(deps, args));
    if (name === "cadre_artifact") return asTextJson(artifactPacket(deps, args));
    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  };
}

export function createMcpRuntime(deps: RuntimeDependencies) {
  const toolCall = createToolCall(deps);

  async function handle(message: McpMessage): Promise<unknown> {
    const method = message.method;
    const params = asJsonObject(message.params);
    if (method === "initialize") {
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { resources: { listChanged: false }, tools: { listChanged: false } },
        serverInfo: { name: "cadre", version: "1.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      };
    }
    if (method === "notifications/initialized") return undefined;
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: TOOLS };
    if (method === "tools/call") {
      const name = asOptionalString(params.name);
      if (!name) throw Object.assign(new Error("tools/call requires params.name"), { code: -32602 });
      return toolCall(name, asJsonObject(params.arguments) as RuntimeArgs);
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
