import type { JsonObject } from "../../types";

export const PROTOCOL_VERSION = "2026-07-10";

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
        execute: { type: "boolean" },
        approval: { type: "object", description: "Explicit staged approval supplied only after user confirmation." },
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
        execute: { type: "boolean" },
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
