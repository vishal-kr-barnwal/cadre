import type { JsonObject } from "../../types";

/** Published MCP revisions this server can serve over its newline-delimited stdio transport. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;
export type SupportedProtocolVersion = typeof SUPPORTED_PROTOCOL_VERSIONS[number];
export const PROTOCOL_VERSION: SupportedProtocolVersion = SUPPORTED_PROTOCOL_VERSIONS[0];

export const SERVER_INSTRUCTIONS = [
  "Cadre is a packet-led runtime. Call cadre_workflow first for workflows, cadre_action for a packet named by a workflow response, and cadre_read only for a relevant resource URI.",
  "Pass a root candidate to project-scoped calls. Cadre resolves it internally; setup accepts an uninitialized directory.",
  "Cadre owns control-plane, provider, worker, approval, merge, and generated projection state.",
].join(" ");

const root: JsonObject = {
  type: "string",
  description: "Project root candidate or a path inside the project.",
};

export const TOOLS: JsonObject[] = [
  {
    name: "cadre_workflow",
    description: "Start or continue a Cadre workflow. The response contains the current decision and at most one deterministic next call.",
    inputSchema: {
      type: "object",
      properties: {
        root,
        workflow: { type: "string" },
        input: { type: "object", description: "Workflow-specific structured input." },
        execute: { type: "boolean", description: "Apply the workflow after its required approval steps; omit or false for preview." },
        approval: { type: "object", description: "Explicit document approval supplied only after user confirmation, or cancel:true to abandon a review session." },
      },
      required: ["root", "workflow"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_action",
    description: "Run the namespaced action returned by a Cadre workflow, such as task.complete, intel.repo_map, or job.result.",
    inputSchema: {
      type: "object",
      properties: {
        root,
        action: { type: "string" },
        input: { type: "object", description: "Action-specific structured input." },
        execute: { type: "boolean", description: "Required for mutating actions; omit or false for read-only actions and supported dry runs." },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_read",
    description: "Read one targeted Cadre resource URI returned by a packet.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string" },
      },
      required: ["uri"],
      additionalProperties: false,
    },
  },
];
