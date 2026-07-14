import { createHash, randomBytes } from "node:crypto";
import { readProjectSourceFile } from "../../core/infrastructure/runtime/project-source-files";
import type {
  ProjectSourceCapabilityResult,
  ProjectSourceReaderPort,
  ProjectSourceReadResult,
} from "../domain/resource-types";

const DEFAULT_CAPABILITY_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_CAPABILITIES = 1024;
const PATH_ERROR = "path must identify an existing project-local file";
const SOURCE_ERROR = "source must be a text file no larger than 128 KiB";
const CAPABILITY_ERROR = "a valid project-source capability is required";

interface SourceCapability {
  canonicalRoot: string;
  canonicalPath: string;
  contentDigest: string;
  expiresAt: number;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class NodeProjectSourceReader implements ProjectSourceReaderPort {
  private readonly capabilities = new Map<string, SourceCapability>();

  constructor(
    private readonly capabilityTtlMs = DEFAULT_CAPABILITY_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  issue(root: string, relativePath: string): ProjectSourceCapabilityResult {
    const source = readProjectSourceFile(root, relativePath);
    if (!source.ok) return { ok: false, error: source.kind === "source" ? SOURCE_ERROR : PATH_ERROR };
    this.removeExpired();
    while (this.capabilities.size >= MAX_ACTIVE_CAPABILITIES) {
      const oldest = this.capabilities.keys().next().value;
      if (typeof oldest !== "string") break;
      this.capabilities.delete(oldest);
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.capabilityTtlMs;
    this.capabilities.set(token, {
      canonicalRoot: source.canonicalRoot,
      canonicalPath: source.canonicalPath,
      contentDigest: digest(source.bytes),
      expiresAt,
    });
    return { ok: true, path: relativePath, token, expires_at: new Date(expiresAt).toISOString() };
  }

  readText(root: string, relativePath: string, token: string): ProjectSourceReadResult {
    const capability = token ? this.capabilities.get(token) : null;
    if (!capability || capability.expiresAt <= this.now()) {
      if (token) this.capabilities.delete(token);
      return { ok: false, error: CAPABILITY_ERROR };
    }
    const source = readProjectSourceFile(root, relativePath);
    if (!source.ok) return { ok: false, error: source.kind === "source" ? SOURCE_ERROR : PATH_ERROR };
    if (
      source.canonicalRoot !== capability.canonicalRoot
      || source.canonicalPath !== capability.canonicalPath
      || digest(source.bytes) !== capability.contentDigest
    ) {
      this.capabilities.delete(token);
      return { ok: false, error: CAPABILITY_ERROR };
    }
    return {
      ok: true,
      path: relativePath,
      bytes: source.bytes.length,
      content: source.bytes.toString("utf8"),
    };
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt <= now) this.capabilities.delete(token);
    }
  }
}
