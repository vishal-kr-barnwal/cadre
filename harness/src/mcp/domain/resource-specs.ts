import type {
  ResourceParameterName,
  ResourceParameterSpec,
  ResourceQuery,
  ResourceSpec,
} from "./resource-types";

const ROOT_PARAMETER: ResourceParameterSpec = { name: "root", format: "string", required: true };

function stringParameter(name: ResourceParameterName, required = false): ResourceParameterSpec {
  return { name, format: "string", required };
}

function csvParameter(name: "files" | "repos", required = false): ResourceParameterSpec {
  return { name, format: "csv", required };
}

function booleanParameter(name: "detail" | "compact" | "includeArchive"): ResourceParameterSpec {
  return { name, format: "boolean", required: false };
}

function positiveIntegerParameter(name: "skillRuleBudget"): ResourceParameterSpec {
  return { name, format: "positive-integer", required: false };
}

function enumParameter(name: "workflow" | "responseMode", values: readonly string[], required = false): ResourceParameterSpec {
  return { name, format: "enum", required, values };
}

export const RESOURCE_SPECS = [
  {
    uri: "cadre://template-inventory",
    name: "Cadre template inventory",
    description: "Packaged target-project template manifest.",
    handler: "template-inventory",
    rootPolicy: "none",
    parameters: [],
  },
  {
    uri: "cadre://team-board",
    name: "Cadre team board",
    description: "Rich team board for a Cadre project root.",
    handler: "team-board",
    rootPolicy: "cadre",
    parameters: [],
  },
  {
    uri: "cadre://fleet-board",
    name: "Cadre fleet board",
    description: "Mono/polyrepo fleet status for a Cadre project root.",
    handler: "fleet-board",
    rootPolicy: "cadre",
    parameters: [],
  },
  {
    uri: "cadre://workspace-health",
    name: "Cadre workspace health",
    description: "Topology, tech stack, LSP, dependency, and integration health.",
    handler: "workspace-health",
    rootPolicy: "candidate",
    parameters: [
      enumParameter("responseMode", ["compact", "detail"]),
      booleanParameter("detail"),
      booleanParameter("compact"),
    ],
  },
  {
    uri: "cadre://integrations",
    name: "Cadre integrations",
    description: "Optional MCP inventory and LSP coverage.",
    handler: "integrations",
    rootPolicy: "candidate",
    parameters: [
      enumParameter("responseMode", ["compact", "detail"]),
      booleanParameter("detail"),
      booleanParameter("compact"),
    ],
  },
  {
    uri: "cadre://mcp-readiness",
    name: "Cadre MCP readiness",
    description: "Provider and optional MCP capability evidence.",
    handler: "mcp-readiness",
    rootPolicy: "candidate",
    parameters: [],
  },
  {
    uri: "cadre://track-context",
    name: "Cadre track context",
    description: "Canonical context for one track.",
    handler: "track-context",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://review-evidence",
    name: "Cadre review evidence",
    description: "Review evidence artifact for one track.",
    handler: "review-evidence",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://collisions",
    name: "Cadre collisions",
    description: "File collision scan for a Cadre project.",
    handler: "collisions",
    rootPolicy: "cadre",
    parameters: [],
  },
  {
    uri: "cadre://repo-map",
    name: "Cadre repo map",
    description: "Repository symbol map, optionally narrowed to one symbol.",
    handler: "repo-map",
    rootPolicy: "candidate",
    parameters: [stringParameter("symbol")],
  },
  {
    uri: "cadre://workspace-diagnostics",
    name: "Cadre workspace diagnostics",
    description: "Detected build and test adapters.",
    handler: "workspace-diagnostics",
    rootPolicy: "candidate",
    parameters: [csvParameter("repos")],
  },
  {
    uri: "cadre://dependency-graph",
    name: "Cadre dependency graph",
    description: "Workspace manifests and dependency edges.",
    handler: "dependency-graph",
    rootPolicy: "candidate",
    parameters: [csvParameter("repos")],
  },
  {
    uri: "cadre://lsp-status",
    name: "Cadre LSP status",
    description: "Configured LSP servers and setup recommendations.",
    handler: "lsp-status",
    rootPolicy: "candidate",
    parameters: [],
  },
  {
    uri: "cadre://dap-status",
    name: "Cadre DAP status",
    description: "Configured DAP adapters and setup recommendations.",
    handler: "dap-status",
    rootPolicy: "candidate",
    parameters: [],
  },
  {
    uri: "cadre://repo-topology",
    name: "Cadre repo topology",
    description: "Mono/polyrepo topology.",
    handler: "repo-topology",
    rootPolicy: "candidate",
    parameters: [],
  },
  {
    uri: "cadre://provider-actions",
    name: "Cadre provider actions",
    description: "Provider action queue from a ship or land packet.",
    handler: "provider-actions",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true), enumParameter("workflow", ["ship", "land"], true)],
  },
  {
    uri: "cadre://ship-plan",
    name: "Cadre ship plan",
    description: "Ship workflow dry-run plan.",
    handler: "ship-plan",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://land-plan",
    name: "Cadre land plan",
    description: "Land workflow dry-run plan.",
    handler: "land-plan",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://my-next-actions",
    name: "Cadre next actions",
    description: "Mine, available, and reclaimable work queues.",
    handler: "my-next-actions",
    rootPolicy: "cadre",
    parameters: [],
  },
  {
    uri: "cadre://review-queue",
    name: "Cadre review queue",
    description: "Bounded tracks needing review or ship attention.",
    handler: "review-queue",
    rootPolicy: "cadre",
    parameters: [],
  },
  {
    uri: "cadre://handoff-inbox",
    name: "Cadre handoff inbox",
    description: "Incoming handoffs from native Cadre state.",
    handler: "handoff-inbox",
    rootPolicy: "cadre",
    parameters: [],
  },
  {
    uri: "cadre://parallel-state",
    name: "Cadre parallel state",
    description: "Parallel worker state for one track.",
    handler: "parallel-state",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://quality-gate",
    name: "Cadre quality gate",
    description: "Review and integrity gate summary for one track.",
    handler: "quality-gate",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://test-impact",
    name: "Cadre test impact",
    description: "Impacted tests and manifests from files or a base/head range.",
    handler: "test-impact",
    rootPolicy: "cadre",
    parameters: [csvParameter("files"), stringParameter("base"), stringParameter("head")],
    requiredAny: [["files"], ["base", "head"]],
  },
  {
    uri: "cadre://track-plan",
    name: "Cadre track plan",
    description: "Parsed canonical track plan.",
    handler: "track-plan",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://job-result",
    name: "Cadre job result",
    description: "Persisted asynchronous job result.",
    handler: "job-result",
    rootPolicy: "cadre",
    parameters: [stringParameter("jobId", true)],
  },
  {
    uri: "cadre://artifact-catalog",
    name: "Cadre artifact catalog",
    description: "Canonical and projection artifact catalog.",
    handler: "artifact-catalog",
    rootPolicy: "cadre",
    parameters: [stringParameter("scope"), stringParameter("artifact"), booleanParameter("includeArchive")],
  },
  {
    uri: "cadre://artifact-schema",
    name: "Cadre artifact schema",
    description: "JSON schema for an artifact kind.",
    handler: "artifact-schema",
    rootPolicy: "cadre",
    parameters: [stringParameter("artifact", true)],
  },
  {
    uri: "cadre://artifact-preview",
    name: "Cadre artifact preview",
    description: "Rendered artifact projection preview.",
    handler: "artifact-preview",
    rootPolicy: "cadre",
    parameters: [stringParameter("artifact", true), stringParameter("scope")],
  },
  {
    uri: "cadre://artifact-sync-plan",
    name: "Cadre artifact sync plan",
    description: "Dry-run artifact synchronization plan.",
    handler: "artifact-sync-plan",
    rootPolicy: "cadre",
    parameters: [stringParameter("scope"), stringParameter("artifact"), booleanParameter("includeArchive")],
  },
  {
    uri: "cadre://track-spec",
    name: "Cadre track spec",
    description: "Canonical track spec and projection preview.",
    handler: "track-spec",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId", true)],
  },
  {
    uri: "cadre://styleguide-selection",
    name: "Cadre styleguide selection",
    description: "Selected style guidance for a track or file list.",
    handler: "styleguide-selection",
    rootPolicy: "cadre",
    parameters: [stringParameter("trackId"), csvParameter("files")],
  },
  {
    uri: "cadre://project-skills",
    name: "Cadre project skills",
    description: "Repository-owned skill selection for a workflow.",
    handler: "project-skills",
    rootPolicy: "candidate",
    parameters: [
      stringParameter("workflow", true),
      stringParameter("trackId"),
      csvParameter("repos"),
      csvParameter("files"),
      positiveIntegerParameter("skillRuleBudget"),
    ],
  },
  {
    uri: "cadre://project-skill",
    name: "Cadre project skill",
    description: "Project skill manifest or one targeted reference.",
    handler: "project-skill",
    rootPolicy: "candidate",
    parameters: [stringParameter("id", true), stringParameter("reference")],
  },
  {
    uri: "cadre://project-skill-source",
    name: "Cadre project skill source",
    description: "Capability-bound project-local text source requested for model formatting.",
    handler: "project-skill-source",
    rootPolicy: "candidate",
    parameters: [stringParameter("path", true), stringParameter("token", true)],
  },
] as const satisfies readonly ResourceSpec[];

export type RegisteredResourceSpec = (typeof RESOURCE_SPECS)[number];
export type ResourceHandlerId = RegisteredResourceSpec["handler"];
export type ParsedResourceQuery = ResourceQuery<RegisteredResourceSpec>;

const RESOURCE_SPEC_BY_URI = new Map<string, RegisteredResourceSpec>(RESOURCE_SPECS.map((spec) => [spec.uri, spec]));

if (RESOURCE_SPEC_BY_URI.size !== RESOURCE_SPECS.length) {
  throw new Error("Cadre resource registry contains duplicate URIs");
}

export function resourceSpecForUri(uri: string): RegisteredResourceSpec | null {
  const queryIndex = uri.indexOf("?");
  const fragmentIndex = uri.indexOf("#");
  const end = Math.min(
    queryIndex === -1 ? uri.length : queryIndex,
    fragmentIndex === -1 ? uri.length : fragmentIndex,
  );
  return RESOURCE_SPEC_BY_URI.get(uri.slice(0, end)) || null;
}

export function resourceParameterSpecs(spec: RegisteredResourceSpec): readonly ResourceParameterSpec[] {
  return spec.rootPolicy === "none" ? spec.parameters : [ROOT_PARAMETER, ...spec.parameters];
}
