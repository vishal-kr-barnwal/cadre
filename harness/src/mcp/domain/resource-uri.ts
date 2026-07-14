import type { ResourceParameterName, ResourceParameterSpec } from "./resource-types";
import {
  resourceParameterSpecs,
  resourceSpecForUri,
  type ParsedResourceQuery,
  type RegisteredResourceSpec,
} from "./resource-specs";

function invalidResource(message: string): never {
  throw Object.assign(new Error(message), { code: -32602 });
}

function emptyQuery(uri: string, spec: RegisteredResourceSpec): ParsedResourceQuery {
  return {
    uri,
    base: spec.uri,
    spec,
    root: null,
    trackId: null,
    symbol: null,
    workflow: null,
    id: null,
    reference: null,
    path: null,
    token: null,
    skillRuleBudget: null,
    artifact: null,
    scope: null,
    jobId: null,
    baseRef: null,
    headRef: null,
    files: [],
    repos: [],
    responseMode: null,
    detail: null,
    compact: null,
    includeArchive: null,
  };
}

function decodeParameter(
  spec: RegisteredResourceSpec,
  parameter: ResourceParameterSpec,
  raw: string,
): string | string[] | number | boolean {
  if (raw.trim().length === 0) invalidResource(`${spec.uri} query parameter '${parameter.name}' must not be empty`);
  if (parameter.format === "string") return raw;
  if (parameter.format === "csv") {
    const values = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
    if (values.length === 0) {
      invalidResource(`${spec.uri} query parameter '${parameter.name}' must be a non-empty comma-separated list`);
    }
    return values;
  }
  if (parameter.format === "boolean") {
    if (raw !== "true" && raw !== "false") {
      invalidResource(`${spec.uri} query parameter '${parameter.name}' must be true or false`);
    }
    return raw === "true";
  }
  if (parameter.format === "positive-integer") {
    if (!/^[1-9][0-9]*$/.test(raw)) {
      invalidResource(`${spec.uri} query parameter '${parameter.name}' must be a positive integer`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      invalidResource(`${spec.uri} query parameter '${parameter.name}' exceeds the safe integer range`);
    }
    return value;
  }
  if (!parameter.values?.includes(raw)) {
    invalidResource(`${spec.uri} query parameter '${parameter.name}' must be one of: ${(parameter.values || []).join(", ")}`);
  }
  return raw;
}

function assignParameter(
  query: ParsedResourceQuery,
  name: ResourceParameterName,
  value: string | string[] | number | boolean,
): void {
  if (name === "root") query.root = value as string;
  else if (name === "trackId") query.trackId = value as string;
  else if (name === "symbol") query.symbol = value as string;
  else if (name === "workflow") query.workflow = value as string;
  else if (name === "id") query.id = value as string;
  else if (name === "reference") query.reference = value as string;
  else if (name === "path") query.path = value as string;
  else if (name === "token") query.token = value as string;
  else if (name === "skillRuleBudget") query.skillRuleBudget = value as number;
  else if (name === "artifact") query.artifact = value as string;
  else if (name === "scope") query.scope = value as string;
  else if (name === "jobId") query.jobId = value as string;
  else if (name === "base") query.baseRef = value as string;
  else if (name === "head") query.headRef = value as string;
  else if (name === "files") query.files = value as string[];
  else if (name === "repos") query.repos = value as string[];
  else if (name === "responseMode") query.responseMode = value as string;
  else if (name === "detail") query.detail = value as boolean;
  else if (name === "compact") query.compact = value as boolean;
  else if (name === "includeArchive") query.includeArchive = value as boolean;
  else {
    const exhaustive: never = name;
    invalidResource(`Unsupported resource query parameter: ${String(exhaustive)}`);
  }
}

export function parseResourceUri(uri: string): ParsedResourceQuery {
  if (uri.includes("#")) invalidResource("Cadre resource URIs must not contain fragments");
  const spec = resourceSpecForUri(uri);
  if (!spec) invalidResource(`Unknown resource: ${uri}`);
  const query = emptyQuery(uri, spec);
  const queryIndex = uri.indexOf("?");
  const search = new URLSearchParams(queryIndex === -1 ? "" : uri.slice(queryIndex + 1));
  const parameterSpecs = resourceParameterSpecs(spec);
  const allowed = new Map(parameterSpecs.map((parameter) => [parameter.name, parameter]));

  for (const [name] of search) {
    const parameter = allowed.get(name as ResourceParameterName);
    if (!parameter) invalidResource(`${spec.uri} does not accept query parameter '${name}'`);
    if (search.getAll(name).length > 1) {
      invalidResource(`${spec.uri} query parameter '${name}' must appear only once`);
    }
  }

  for (const parameter of parameterSpecs) {
    const raw = search.get(parameter.name);
    if (raw === null) {
      if (parameter.required) invalidResource(`${spec.uri} requires query parameter '${parameter.name}'`);
      continue;
    }
    assignParameter(query, parameter.name, decodeParameter(spec, parameter, raw));
  }

  const requiredAny = "requiredAny" in spec ? spec.requiredAny : undefined;
  if (requiredAny && !requiredAny.some((group) => group.every((name) => search.has(name)))) {
    const alternatives = requiredAny.map((group) => group.join(" + ")).join(" OR ");
    invalidResource(`${spec.uri} requires one of: ${alternatives}`);
  }
  return query;
}

export const validateResourceUri = parseResourceUri;
