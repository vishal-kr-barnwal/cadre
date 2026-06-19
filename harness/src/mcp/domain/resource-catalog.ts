import type { JsonObject } from "../../types";
import type { ResourceQuery } from "./protocol-types";

type ResourceDefinition = {
  uri: string;
  name: string;
  description: string;
};

type ResourceContract = {
  required: string[];
  requiredAny?: string[][];
  optional?: string[];
};

const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  { uri: "cadre://team-board", name: "Cadre team board", description: "Rich team board. Read with ?root=/path/to/project." },
  { uri: "cadre://fleet-board", name: "Cadre fleet board", description: "Mono/polyrepo fleet status. Read with ?root=/path." },
  { uri: "cadre://beads-summary", name: "Cadre Beads summary", description: "Beads ready/WIP/review summary. Read with ?root=/path." },
  { uri: "cadre://workspace-health", name: "Cadre workspace health", description: "Compact topology, tech stack, LSP, dependency, and integration health snapshot. Read with ?root=/path." },
  { uri: "cadre://integrations", name: "Cadre integrations", description: "Optional MCP inventory and LSP coverage. Read with ?root=/path." },
  { uri: "cadre://track-context", name: "Cadre track context", description: "Track context. Read with ?root=/path&trackId=<id>." },
  { uri: "cadre://review-evidence", name: "Cadre review evidence", description: "Review evidence artifact. Read with ?root=/path&trackId=<id>." },
  { uri: "cadre://collisions", name: "Cadre collisions", description: "File collision scan. Read with ?root=/path." },
  { uri: "cadre://repo-map", name: "Cadre repo map", description: "Symbol map. Read with ?root=/path and optional &symbol=<name>." },
  { uri: "cadre://workspace-diagnostics", name: "Cadre workspace diagnostics", description: "Detected build/test adapters. Read with ?root=/path." },
  { uri: "cadre://lsp-status", name: "Cadre LSP status", description: "Configured LSP servers plus setup recommendations. Read with ?root=/path." },
  { uri: "cadre://repo-topology", name: "Cadre repo topology", description: "Mono/polyrepo topology. Read with ?root=/path." },
  { uri: "cadre://provider-actions", name: "Cadre provider actions", description: "Provider action queue from ship/land packets. Read with ?root=/path&trackId=<id>&workflow=ship|land." },
  { uri: "cadre://ship-plan", name: "Cadre ship plan", description: "Ship workflow dry-run plan. Read with ?root=/path&trackId=<id>." },
  { uri: "cadre://land-plan", name: "Cadre land plan", description: "Land workflow dry-run plan. Read with ?root=/path&trackId=<id>." },
  { uri: "cadre://release-plan", name: "Cadre release plan", description: "Release workflow dry-run plan. Read with ?root=/path." },
  { uri: "cadre://my-next-actions", name: "Cadre next actions", description: "Mine/available/action queue. Read with ?root=/path." },
  { uri: "cadre://review-queue", name: "Cadre review queue", description: "Bounded tracks needing review/ship attention. Read with ?root=/path." },
  { uri: "cadre://handoff-inbox", name: "Cadre handoff inbox", description: "Incoming handoffs from team board and Beads. Read with ?root=/path." },
  { uri: "cadre://parallel-state", name: "Cadre parallel state", description: "Track parallel worker state. Read with ?root=/path&trackId=<id>." },
  { uri: "cadre://quality-gate", name: "Cadre quality gate", description: "Review and integrity gate summary. Read with ?root=/path&trackId=<id>." },
  { uri: "cadre://test-impact", name: "Cadre test impact", description: "Impacted tests/manifests. Read with ?root=/path&files=a,b." },
  { uri: "cadre://track-plan", name: "Cadre track plan", description: "Parsed track plan. Read with ?root=/path&trackId=<id>." },
  { uri: "cadre://job-result", name: "Cadre job result", description: "Persisted async job result. Read with ?root=/path&jobId=<id>." },
];

const RESOURCE_CONTRACTS: Record<string, ResourceContract> = {
  "cadre://team-board": { required: ["root"] },
  "cadre://fleet-board": { required: ["root"] },
  "cadre://beads-summary": { required: ["root"] },
  "cadre://workspace-health": { required: ["root"], optional: ["responseMode", "detail", "compact"] },
  "cadre://integrations": { required: ["root"], optional: ["responseMode", "detail", "compact"] },
  "cadre://track-context": { required: ["root", "trackId"] },
  "cadre://review-evidence": { required: ["root", "trackId"] },
  "cadre://collisions": { required: ["root"] },
  "cadre://repo-map": { required: ["root"], optional: ["symbol"] },
  "cadre://workspace-diagnostics": { required: ["root"] },
  "cadre://lsp-status": { required: ["root"] },
  "cadre://repo-topology": { required: ["root"] },
  "cadre://provider-actions": { required: ["root", "trackId", "workflow"] },
  "cadre://ship-plan": { required: ["root", "trackId"] },
  "cadre://land-plan": { required: ["root", "trackId"] },
  "cadre://release-plan": { required: ["root"] },
  "cadre://my-next-actions": { required: ["root"] },
  "cadre://review-queue": { required: ["root"] },
  "cadre://handoff-inbox": { required: ["root"] },
  "cadre://parallel-state": { required: ["root", "trackId"] },
  "cadre://quality-gate": { required: ["root", "trackId"] },
  "cadre://test-impact": { required: ["root"], requiredAny: [["files"], ["base", "head"]] },
  "cadre://track-plan": { required: ["root", "trackId"] },
  "cadre://job-result": { required: ["root", "jobId"] },
};

function contractQueryParams(contract: ResourceContract): string[] {
  return Array.from(new Set([
    ...contract.required,
    ...(contract.optional || []),
    ...(contract.requiredAny || []).flat(),
  ]));
}

export function resourceList(): JsonObject {
  return {
    resources: RESOURCE_DEFINITIONS.map((resource) => ({ ...resource, mimeType: "application/json" })),
  };
}

export function resourceTemplatesList(): JsonObject {
  const resources = RESOURCE_DEFINITIONS;
  const templates = resources.map((resource) => {
    const contract = RESOURCE_CONTRACTS[resource.uri] || { required: ["root"] };
    const queryParams = contractQueryParams(contract).filter(Boolean);
    return {
      uriTemplate: queryParams.length > 0 ? `${resource.uri}{?${queryParams.join(",")}}` : resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: "application/json",
      ...contract,
    };
  });
  return { resourceTemplates: templates };
}

export function parseResourceUri(uri: string): ResourceQuery {
  const [rawBase, query = ""] = uri.split("?");
  const base = rawBase || "";
  const params = new URLSearchParams(query);
  return {
    base,
    root: params.get("root"),
    trackId: params.get("trackId"),
    symbol: params.get("symbol"),
    workflow: params.get("workflow"),
    jobId: params.get("jobId"),
    baseRef: params.get("base"),
    headRef: params.get("head"),
    files: (params.get("files") || "").split(",").map((item) => item.trim()).filter(Boolean),
    responseMode: params.get("responseMode"),
    response_mode: params.get("response_mode"),
    detail: params.has("detail") ? params.get("detail") !== "false" : null,
    compact: params.has("compact") ? params.get("compact") !== "false" : null,
  };
}
