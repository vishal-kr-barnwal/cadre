import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../types";

export interface RuntimeEnvelope extends UnknownRecord {
  ok: boolean;
  data: unknown;
  warnings: unknown[];
  errors: string[];
  required?: string[];
  next?: JsonObject | null;
  commands?: unknown;
  job?: unknown;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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
  signal: string | null;
  artifact_path?: string;
}

export type McpRequestId = string | number;

interface McpIncomingMessage extends JsonObject {
  jsonrpc: "2.0";
  method: string;
  params?: JsonObject;
}

export interface McpRequest extends McpIncomingMessage {
  id: McpRequestId;
}

export interface McpNotification extends McpIncomingMessage {
  id?: never;
}

export type McpMessage = McpRequest | McpNotification;
