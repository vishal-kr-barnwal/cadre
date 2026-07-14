import { errorMessage, isRecord } from "../../guards";
import type { McpMessage, McpRequest, McpRequestId } from "../domain/protocol-types";

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function isRequestId(value: unknown): value is McpRequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseMcpMessage(value: unknown): McpMessage | null {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") return null;
  if (hasOwn(value, "id") && !isRequestId(value.id)) return null;
  if (hasOwn(value, "params") && !isRecord(value.params)) return null;
  return value as McpMessage;
}

function invalidRequestId(value: unknown): McpRequestId | null {
  return isRecord(value) && hasOwn(value, "id") && isRequestId(value.id) ? value.id : null;
}

function isRequest(message: McpMessage): message is McpRequest {
  return hasOwn(message, "id");
}

function respond(message: McpRequest, result: unknown): void {
  send({ jsonrpc: "2.0", id: message.id, result });
}

function sendError(id: McpRequestId | null, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function respondError(message: McpRequest, error: unknown): void {
  const numericCode = isRecord(error) && typeof error.code === "number" ? error.code : -32603;
  sendError(message.id, numericCode, errorMessage(error));
}

export function startStdioTransport(handle: (message: McpMessage) => Promise<unknown>): void {
  let buffer = "";

  process.stdin.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        sendError(null, -32700, "Parse error");
        continue;
      }
      const message = parseMcpMessage(parsed);
      if (!message) {
        sendError(invalidRequestId(parsed), -32600, "Invalid Request");
        continue;
      }
      Promise.resolve(handle(message))
        .then((result) => {
          if (isRequest(message)) respond(message, result);
        })
        .catch((error) => {
          if (isRequest(message)) respondError(message, error);
        });
    }
  });
}
