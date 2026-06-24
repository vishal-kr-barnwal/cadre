import type { JsonObject } from "../types";
import { asJsonObject } from "../guards";

export function encodeDapMessage(message: JsonObject): Buffer {
  const body = JSON.stringify(message);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`, "utf8");
}

export class DapMessageBuffer {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer | string): JsonObject[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
    const messages: JsonObject[] = [];
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return messages;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return messages;
      const rawBody = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);
      try {
        messages.push(asJsonObject(JSON.parse(rawBody)));
      } catch {
        // Ignore malformed adapter frames; request timeouts handle missing replies.
      }
    }
  }
}
