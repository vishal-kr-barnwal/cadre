import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod/v4";

const MAX_TOKEN_CHARACTERS = 2 * 1024 * 1024;
const MAX_PROPOSAL_BYTES = 8 * 1024 * 1024;

const envelopeSchema = z.object({
  version: z.literal(1),
  kind: z.string().min(1),
  input: z.unknown(),
  digest: z.string().regex(/^[0-9a-f]{64}$/)
});

export const proposalTokenSchema = z.string().min(1).max(MAX_TOKEN_CHARACTERS);

export function encodeProposalToken(kind: string, input: unknown, digest: string): string {
  return gzipSync(JSON.stringify({ version: 1, kind, input, digest })).toString("base64url");
}

export function decodeProposalToken<T>(kind: string, token: string): { input: T; digest: string } {
  if (token.length > MAX_TOKEN_CHARACTERS) throw new Error("proposal token is too large");
  let value: unknown;
  try {
    const compressed = Buffer.from(token, "base64url");
    value = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_PROPOSAL_BYTES }).toString("utf8"));
  } catch (error) {
    throw new Error(`invalid proposal token: ${error instanceof Error ? error.message : String(error)}`);
  }
  const envelope = envelopeSchema.parse(value);
  if (envelope.kind !== kind) throw new Error(`proposal token is for ${envelope.kind}, not ${kind}`);
  return { input: envelope.input as T, digest: envelope.digest };
}
