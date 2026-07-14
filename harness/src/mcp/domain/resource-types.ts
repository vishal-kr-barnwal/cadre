export type ResourceRootPolicy = "none" | "cadre" | "candidate";

export type ResourceParameterName =
  | "root"
  | "trackId"
  | "symbol"
  | "workflow"
  | "id"
  | "reference"
  | "path"
  | "token"
  | "skillRuleBudget"
  | "artifact"
  | "scope"
  | "jobId"
  | "base"
  | "head"
  | "files"
  | "repos"
  | "responseMode"
  | "detail"
  | "compact"
  | "includeArchive";

export type ResourceParameterFormat = "string" | "csv" | "boolean" | "positive-integer" | "enum";

export interface ResourceParameterSpec {
  name: ResourceParameterName;
  format: ResourceParameterFormat;
  required: boolean;
  values?: readonly string[];
}

export interface ResourceSpec<Handler extends string = string> {
  uri: `cadre://${string}`;
  name: string;
  description: string;
  handler: Handler;
  rootPolicy: ResourceRootPolicy;
  parameters: readonly ResourceParameterSpec[];
  requiredAny?: readonly (readonly ResourceParameterName[])[];
}

export interface ResourceQuery<S extends ResourceSpec = ResourceSpec> {
  uri: string;
  base: string;
  spec: S;
  root: string | null;
  trackId: string | null;
  symbol: string | null;
  workflow: string | null;
  id: string | null;
  reference: string | null;
  path: string | null;
  token: string | null;
  skillRuleBudget: number | null;
  artifact: string | null;
  scope: string | null;
  jobId: string | null;
  baseRef: string | null;
  headRef: string | null;
  files: string[];
  repos: string[];
  responseMode: string | null;
  detail: boolean | null;
  compact: boolean | null;
  includeArchive: boolean | null;
}

export type ProjectSourceReadResult =
  | { ok: true; path: string; bytes: number; content: string }
  | { ok: false; error: string };

export type ProjectSourceCapabilityResult =
  | { ok: true; path: string; token: string; expires_at: string }
  | { ok: false; error: string };

export interface ProjectSourceReaderPort {
  issue(root: string, relativePath: string): ProjectSourceCapabilityResult;
  readText(root: string, relativePath: string, token: string): ProjectSourceReadResult;
}
