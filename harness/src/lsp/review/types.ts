import type { JsonObject } from "../../types";
import type { LspClient } from "./client";

export interface CliArgs extends JsonObject {
  base: string;
  head: string;
  config: string;
  json: boolean;
}

export interface CommandAvailability extends JsonObject {
  state: "invalid" | "available" | "missing";
  command: string | null;
  path?: string;
  message?: string;
}

export interface LspServerConfig extends JsonObject {
  id?: string | undefined;
  command: string;
  args?: string[] | undefined;
  extensions?: string[] | undefined;
  filenames?: string[] | undefined;
  languageIds?: JsonObject | undefined;
  requestTimeoutMs?: number | undefined;
  startupTimeoutMs?: number | undefined;
  diagnosticsDelayMs?: number | undefined;
}

export interface ChangedEntry extends JsonObject {
  status: string;
  kind: string;
  path: string;
  oldPath: string | null;
  exists: boolean;
}

export interface SymbolCandidate extends JsonObject {
  name: string;
  added: boolean;
  removed: boolean;
  changeType: string;
  changedFile: string;
  oldPath: string | null;
  status: string;
  evidence: JsonObject[];
}

export interface LspPosition extends JsonObject {
  line: number;
  character: number;
}

export interface LspRange extends JsonObject {
  start: LspPosition;
  end?: LspPosition;
}

export interface LspLocation extends JsonObject {
  uri?: string;
  targetUri?: string;
  range?: LspRange;
  targetRange?: LspRange;
  targetSelectionRange?: LspRange;
}

export interface RelativeLocation extends JsonObject {
  file: string;
  relativeFile: string;
  line: number;
}

export interface LspDiagnostic extends JsonObject {
  severity?: number;
  code?: string | number;
  range?: LspRange;
  message?: string;
}

export interface LspSymbol extends JsonObject {
  name: string;
  selectionRange: LspRange;
  children?: LspSymbol[];
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface LspClientPool {
  get(root: string, server: LspServerConfig): Promise<{ client: LspClient }>;
  drop(root: string, server: LspServerConfig): Promise<boolean>;
}

export interface RunReviewOptions {
  base?: string | undefined;
  head?: string | undefined;
  config?: string | undefined;
  configOwnerRoot?: string | undefined;
  root?: string | undefined;
  clientPool?: LspClientPool | null | undefined;
}

export interface ServerReport extends JsonObject {
  id: string;
  command: string | null;
  availability: CommandAvailability;
  files: JsonObject[];
  candidates: JsonObject[];
  skipped: boolean;
  degraded?: boolean;
  fallback?: string | null;
  warm?: boolean;
  diagnostics?: JsonObject[];
  symbolEvidence?: JsonObject[];
}
