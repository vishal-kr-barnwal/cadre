import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { JsonObject, RuntimeArgs, UnknownRecord } from "../types";

export interface RuntimeEnvelope extends UnknownRecord {
  ok: boolean;
  data: unknown;
  warnings: unknown[];
  errors: string[];
  commands?: unknown;
  job?: unknown;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface JobRecord {
  id: string;
  type: string;
  root: string;
  args: RuntimeArgs;
  status: "running" | "succeeded" | "failed" | "cancelled";
  started_at: string;
  finished_at: string | null;
  stdout: string;
  stderr: string;
  result: unknown;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  proc: ChildProcessWithoutNullStreams | null;
  artifact_path?: string;
}

export interface McpMessage extends JsonObject {
  id?: string | number | null;
  method?: string;
  params?: JsonObject;
}

export interface ResourceQuery extends JsonObject {
  base: string;
  root: string | null;
  trackId: string | null;
  symbol: string | null;
  workflow: string | null;
  jobId: string | null;
  baseRef: string | null;
  headRef: string | null;
  files: string[];
}
