import { createHash } from "node:crypto";
import { readSafeArtifact } from "./memory.js";
import { readGitFileAtCommit } from "./git.js";

export interface PromotionFile { path: string; content: string | null; before?: string | null }
export interface BeforeEvidence { path: string; content: string }

/** Preserve exact pre-promotion bytes, including when canonical files were already written. */
export function promotionEvidence(root: string, files: PromotionFile[], saved: BeforeEvidence[] = [], base?: string | null) {
  const retained = new Map<string, string>();
  const originals = new Map(saved.map((file) => [file.path, file.content]));
  if (originals.size !== saved.length) throw new Error("Duplicate original transition evidence");
  const hash = (body: string) => createHash("sha256").update(body).digest("hex");
  return {
    read(path: string): string {
      if (retained.has(path)) return retained.get(path)!;
      const file = files.find((item) => item.path === path);
      if (!file) throw new Error(`Transition requires its original artifact in the promotion: ${path}`);
      if (file.before === null) throw new Error(`Transition cannot invent historical evidence: ${path}`);
      let body = originals.get(path) ?? readSafeArtifact(root, path);
      if (file.before !== undefined && hash(body) !== file.before && !originals.has(path) && base) {
        body = readGitFileAtCommit(root, base, path);
      }
      if (file.before !== undefined && hash(body) !== file.before) {
        throw new Error(`Transition lacks exact original evidence; retain intent and obtain an approved repair: ${path}`);
      }
      retained.set(path, body);
      return body;
    },
    retained: () => [...retained].map(([path, content]) => ({path, content}))
  };
}
