import { asJsonObject, errorMessage, isRecord } from "../../guards";
import type { McpMessage } from "../domain/protocol-types";

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respond(message: McpMessage, result: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  send({ jsonrpc: "2.0", id: message.id, result });
}

function respondError(message: McpMessage, error: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  const numericCode = isRecord(error) && typeof error.code === "number" ? error.code : -32603;
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: numericCode, message: errorMessage(error) },
  });
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
      let message: McpMessage;
      try {
        message = asJsonObject(JSON.parse(line)) as McpMessage;
      } catch (error) {
        respondError({ id: null } as McpMessage, error);
        continue;
      }
      Promise.resolve(handle(message))
        .then((result) => respond(message, result))
        .catch((error) => respondError(message, error));
    }
  });
}
