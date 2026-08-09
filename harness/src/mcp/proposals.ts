import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod/v4";

const TOKEN_PREFIX = "cadre_pt1_";
const TOKEN_PATTERN = /^cadre_pt1_[A-Za-z0-9_-]{32}$/;
const RECORD_PATTERN = /^cadre_pt1_[A-Za-z0-9_-]{32}\.json$/;
const MAX_PROPOSAL_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_RETAINED_PROPOSALS = 256;
const DEFAULT_MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const envelopeSchema = z.object({
  version: z.literal(2),
  kind: z.string().min(1),
  input: z.unknown(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime()
});

interface ProposalRecord {
  path: string;
  bytes: number;
  createdAt: number;
}

export interface ProposalTokenStoreOptions {
  root?: string;
  maxRetainedProposals?: number;
  maxRetainedBytes?: number;
  maxAgeMs?: number;
  now?: () => Date;
}

export const proposalTokenSchema = z.string().regex(TOKEN_PATTERN, "invalid proposal token format");

function defaultProposalRoot(): string {
  const cadreHome = process.env.CADRE_HOME ? resolve(process.env.CADRE_HOME) : join(homedir(), ".cadre");
  return join(cadreHome, "runtime", "proposals");
}

/**
 * Persists opaque preview capabilities in an MCP-owned, bounded runtime cache.
 * Callers receive only a short random token and can never select a filesystem
 * path. The cache survives MCP restarts without mutating project or Git state.
 */
export class ProposalTokenStore {
  private readonly root: string;
  private readonly maxRetainedProposals: number;
  private readonly maxRetainedBytes: number;
  private readonly maxAgeMs: number;
  private readonly now: () => Date;

  constructor(options: ProposalTokenStoreOptions = {}) {
    this.root = resolve(options.root ?? defaultProposalRoot());
    this.maxRetainedProposals = options.maxRetainedProposals ?? DEFAULT_MAX_RETAINED_PROPOSALS;
    this.maxRetainedBytes = options.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_BYTES;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.maxRetainedProposals) || this.maxRetainedProposals < 1) {
      throw new Error("maxRetainedProposals must be a positive integer");
    }
    if (!Number.isInteger(this.maxRetainedBytes) || this.maxRetainedBytes < MAX_PROPOSAL_BYTES) {
      throw new Error(`maxRetainedBytes must be at least ${MAX_PROPOSAL_BYTES}`);
    }
    if (!Number.isFinite(this.maxAgeMs) || this.maxAgeMs <= 0) {
      throw new Error("maxAgeMs must be positive");
    }
  }

  issue(kind: string, input: unknown, digest: string): string {
    const createdAt = this.now().toISOString();
    const serialized = `${JSON.stringify({ version: 2, kind, input, digest, createdAt })}\n`;
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MAX_PROPOSAL_BYTES) throw new Error("proposal is too large");
    envelopeSchema.parse(JSON.parse(serialized));

    this.prepareRoot();
    this.makeRoom(bytes);
    for (;;) {
      const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
      const path = this.pathFor(token);
      let descriptor: number | null = null;
      try {
        descriptor = openSync(
          path,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600
        );
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally {
        if (descriptor !== null) closeSync(descriptor);
      }
    }
  }

  resolve<T>(kind: string, token: string): { input: T; digest: string } {
    if (!TOKEN_PATTERN.test(token)) throw new Error("invalid proposal token format");
    this.prepareRoot();
    const path = this.pathFor(token);
    if (!existsSync(path)) {
      throw new Error(
        "proposal token is unknown or no longer retained; call the matching preview tool again"
      );
    }

    let descriptor: number | null = null;
    try {
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(descriptor);
      if (!stat.isFile()) throw new Error("proposal token does not reference a regular runtime record");
      if ((stat.mode & 0o077) !== 0) throw new Error("proposal runtime record permissions are too broad");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error("proposal runtime record is owned by another user");
      }
      if (stat.size > MAX_PROPOSAL_BYTES) throw new Error("proposal record is too large");
      const envelope = envelopeSchema.parse(JSON.parse(readFileSync(descriptor, "utf8")));
      if (this.now().getTime() - Date.parse(envelope.createdAt) > this.maxAgeMs) {
        closeSync(descriptor);
        descriptor = null;
        this.unlinkRecord(path);
        throw new Error("proposal token has expired; call the matching preview tool again");
      }
      if (envelope.kind !== kind) throw new Error(`proposal token is for ${envelope.kind}, not ${kind}`);
      return { input: envelope.input as T, digest: envelope.digest };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new Error("refusing proposal token through a symbolic link");
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "proposal token is unknown or no longer retained; call the matching preview tool again"
        );
      }
      throw error;
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  }

  private prepareRoot(): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`proposal runtime root is not a regular directory: ${this.root}`);
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error(`proposal runtime root is owned by another user: ${this.root}`);
    }
    if ((stat.mode & 0o077) !== 0) chmodSync(this.root, 0o700);
  }

  private pathFor(token: string): string {
    return join(this.root, `${token}.json`);
  }

  private records(): ProposalRecord[] {
    const records: ProposalRecord[] = [];
    for (const entry of readdirSync(this.root)) {
      if (!RECORD_PATTERN.test(entry)) continue;
      const path = join(this.root, entry);
      let stat;
      try {
        stat = lstatSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      let createdAt = stat.mtimeMs;
      try {
        const envelope = envelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
        createdAt = Date.parse(envelope.createdAt);
      } catch {
        // Malformed records are retained for a precise resolve error but remain
        // eligible for bounded oldest-first eviction.
      }
      records.push({ path, bytes: stat.size, createdAt });
    }
    return records.sort((left, right) => left.createdAt - right.createdAt);
  }

  private makeRoom(incomingBytes: number): void {
    const now = this.now().getTime();
    let records = this.records();
    for (const record of records) {
      if (now - record.createdAt <= this.maxAgeMs) continue;
      this.unlinkRecord(record.path);
    }
    records = this.records();
    let retainedBytes = records.reduce((total, record) => total + record.bytes, 0);
    while (
      records.length >= this.maxRetainedProposals
      || retainedBytes + incomingBytes > this.maxRetainedBytes
    ) {
      const oldest = records.shift();
      if (!oldest) break;
      this.unlinkRecord(oldest.path);
      retainedBytes -= oldest.bytes;
    }
  }

  private unlinkRecord(path: string): void {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
