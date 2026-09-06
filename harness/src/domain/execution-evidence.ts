import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readInspectionJson } from "./inspection.js";

/** A repair operation may temporarily own state, but must retain its execution binding. */
export function inspectExecutionBindings(trackRoot: string, state: {
  operation?: Record<string, unknown> | null; lastExecution?: Record<string, unknown> | null;
}, read = (path: string) => readInspectionJson<Record<string, unknown>>(path), paths?: string[]): string[] {
  const directory = join(trackRoot, "executions");
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) return ["unsafe execution directory symbolic link"];
  const journals = paths ?? (existsSync(directory) ? readdirSync(directory).filter((path) => /^execution-.+\.json$/.test(path)) : []);
  const references = [state.operation, state.lastExecution].filter(Boolean);
  const errors: string[] = [];
  for (const file of journals) {
    try {
      const absolute = join(directory, file);
      if (!/^execution-[^/\\]+\.json$/.test(file)) throw new Error("unsafe execution journal path");
      if (existsSync(absolute) && (lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile())) throw new Error("unsafe execution journal file");
      const journal = read(absolute);
      if (journal.status === "in_progress" && !references.some((reference) => reference?.executionId === journal.executionId
        && reference?.journal === `executions/${file}`)) {
        errors.push(`orphaned in-progress execution ${file}; retain its executionId/journal binding during repair and resume from persisted checkpoints`);
      }
    } catch (error) { errors.push(`unreadable execution ${file}: ${String(error)}`); }
  }
  return errors;
}
