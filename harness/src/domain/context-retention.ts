import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { CadreError } from "./errors.js";

export interface RetainedSource { path: string; section: string; contentHash: string; sha256: string }
const secret = randomBytes(32);
const retained = new Map<string, { scope: string; sources: RetainedSource[]; expires: number }>();
const TTL = 30 * 60_000;

export function issueContextToken(scope: string, sources: RetainedSource[]): string {
  for (const [token, entry] of retained) if (entry.expires <= Date.now()) retained.delete(token);
  while (retained.size >= 256) retained.delete(retained.keys().next().value!);
  const token = `cadre_ctx1_${randomBytes(24).toString("base64url")}`;
  retained.set(token, { scope, sources, expires: Date.now() + TTL });
  return token;
}

export function retainedSources(token: string | undefined, scope: string): RetainedSource[] {
  if (!token) return [];
  const entry = retained.get(token);
  if (!entry || entry.expires <= Date.now()) throw new CadreError("CONTEXT_TOKEN_EXPIRED", "Retained context expired; read again without retainedContextToken or cursor.");
  if (entry.scope !== scope) throw new CadreError("CONTEXT_TOKEN_SCOPE", "Retained context belongs to another project or track.");
  return entry.sources;
}

export function encodeContextCursor(value: object): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function decodeContextCursor(cursor: string): unknown {
  const [body, signature, extra] = cursor.split(".");
  const expected = createHmac("sha256", secret).update(body ?? "").digest();
  const actual = Buffer.from(signature ?? "", "base64url");
  if (!body || extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new CadreError("CONTEXT_CURSOR_INVALID", "Invalid or expired context cursor; restart retrieval.");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}
