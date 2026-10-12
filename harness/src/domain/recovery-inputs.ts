import { dependencyContextSchema } from "./dependency-context.js";
import { MEMORY_START, MEMORY_END, seedMemorySchema, seedSection } from "./memory.js";

export interface RecoveryInput { path: string; sha256: string }
interface File { path: string; content: string | null }

/** Hashes retained in proposed artifacts also protect older pending receipts. */
export function recordedRecoveryInputs(files: File[]): RecoveryInput[] {
  const overlay = new Map(files.map((file) => [file.path, file.content]));
  const inputs: RecoveryInput[] = [];
  for (const file of files) {
    if (file.content === null || !/^\.cadre\/tracks\/[^/]+\/(?:learning\.md|dependency-context\.json)$/.test(file.path)) continue;
    const stateBody = overlay.get(file.path.replace(/[^/]+$/, "state.json"));
    if (stateBody && ["completed", "archived"].includes(JSON.parse(stateBody).status)) continue;
    if (file.path.endsWith("dependency-context.json")) {
      inputs.push(...dependencyContextSchema.parse(JSON.parse(file.content)).sources);
      continue;
    }
    const section = seedSection(file.content);
    if (!section || !section.includes(MEMORY_START)) continue; // Retained pre-memory legacy artifacts.
    const start = section.indexOf(MEMORY_START) + MEMORY_START.length, end = section.indexOf(MEMORY_END);
    const metadata = seedMemorySchema.parse(JSON.parse(section.slice(start, end).trim()));
    inputs.push(...metadata.patterns.map((pattern) => ({ ...pattern, path: `.cadre/${pattern.path}` })));
  }
  return mergeRecoveryInputs(files, inputs);
}

export function mergeRecoveryInputs(files: File[], inputs: RecoveryInput[]): RecoveryInput[] {
  const promoted = new Set(files.map((file) => file.path)), hashes = new Map<string, string>();
  for (const input of inputs) {
    if (promoted.has(input.path)) continue; // These have their own before/after recovery check.
    const previous = hashes.get(input.path);
    if (previous && previous !== input.sha256) throw new Error(`Conflicting approved recovery input: ${input.path}`);
    hashes.set(input.path, input.sha256);
  }
  return [...hashes].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 }));
}
