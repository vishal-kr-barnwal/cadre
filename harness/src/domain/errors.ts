export interface SerializedCadreError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class CadreError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CadreError";
    this.code = code;
    this.details = details;
  }
}

// Diagnostics are process-local, bounded, and only returned by explicit reads.
const diagnostics = new Map<string, { text: string; expires: number }>();
const TTL = 30 * 60_000;
export const MAX_ERROR_BYTES = 8192;

export function readDiagnostic(id: string, offset = 0, maxBytes = 49152) {
  const entry = diagnostics.get(id);
  if (!entry || entry.expires < Date.now()) throw new CadreError("DIAGNOSTIC_EXPIRED", "Diagnostic expired; reproduce the failure to capture it again.");
  if (!Number.isInteger(offset) || offset < 0 || offset > entry.text.length || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 65536) throw new Error("Invalid diagnostic page bounds");
  let end = Math.min(entry.text.length, offset + Math.floor(maxBytes / 6));
  if (end < entry.text.length && /[\uD800-\uDBFF]/.test(entry.text[end - 1] ?? "")) end--;
  return { diagnosticId: id, content: entry.text.slice(offset, end), offset, nextOffset: end < entry.text.length ? end : null, totalBytes: Buffer.byteLength(entry.text) };
}

function bounded(error: SerializedCadreError): SerializedCadreError {
  const text = JSON.stringify(error);
  // Reserve room for the MCP text envelope (which escapes this JSON again).
  if (Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true })) <= MAX_ERROR_BYTES) return error;
  const now = Date.now();
  for (const [id, value] of diagnostics) if (value.expires < now) diagnostics.delete(id);
  while (diagnostics.size >= 16) diagnostics.delete(diagnostics.keys().next().value!);
  const diagnosticId = randomUUID();
  diagnostics.set(diagnosticId, { text, expires: now + TTL });
  const paths = Array.isArray(error.details?.paths) ? error.details.paths : [];
  return { code: error.code.slice(0, 64), message: error.message.slice(0, 192), details: {
    truncated: true, diagnosticId, totalBytes: Buffer.byteLength(text),
    ...(paths.length ? { pathCount: paths.length, representativePaths: paths.slice(0, 4).map((path) => String(path).slice(0, 96)) } : {})
  } };
}

export function serializeCadreError(error: unknown): SerializedCadreError {
  if (error instanceof CadreError) {
    return bounded({
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    });
  }
  return bounded({
    code: "CADRE_ERROR",
    message: error instanceof Error ? error.message : String(error)
  });
}
import { randomUUID } from "node:crypto";
