import { asJsonObject, errorMessage, isRecord } from "../guards";
import type { McpMessage } from "./protocol-types";

function send(payload: unknown): void {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
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
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;
      const raw = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      let message: McpMessage | null = null;
      try {
        message = asJsonObject(JSON.parse(raw)) as McpMessage;
        const currentMessage = message;
        Promise.resolve(handle(currentMessage))
          .then((result) => {
            if (result !== undefined) respond(currentMessage, result);
          })
          .catch((error) => respondError(currentMessage, error));
      } catch (error) {
        respondError(message || { id: null }, error);
      }
    }
  });

  process.stdin.resume();
}
