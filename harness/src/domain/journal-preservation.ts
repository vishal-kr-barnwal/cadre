import { isDeepStrictEqual } from "node:util";
import { promotionEvidence, type BeforeEvidence, type PromotionFile } from "./promotion-evidence.js";
import { readSafeArtifact } from "./memory.js";
import { approvalModeMigrationSchema } from "./approval-policy.js";
import type { ExecutionJournal } from "./execution.js";
import type { TrackState } from "./state.js";

/** Context edits cannot rewrite delivery evidence; only migration and derived supersession differ. */
function requireJournalTransition(before: string, after: string, previous: TrackState, proposed: TrackState,
  path: string, artifacts: Set<string>, derived: boolean): void {
  if (before === after) return;
  const journal = JSON.parse(before) as ExecutionJournal, next = JSON.parse(after) as ExecutionJournal;
  const operation = previous.operation;
  const active = journal.status === "in_progress" && operation?.action === "implement"
    && operation.executionId === journal.executionId && path.endsWith(`/${operation.journal}`);
  if (!active) throw new Error("Refresh/revision must preserve historical execution journal bytes");
  if (derived && next.status === "superseded") {
    const history = proposed.history as Array<{previousExecution?: unknown}> | undefined;
    if (proposed.revision === Number(previous.revision) + 1 && proposed.operation === null
      && proposed.lastExecution?.executionId === journal.executionId
      && isDeepStrictEqual(history?.at(-1)?.previousExecution, operation)
      && isDeepStrictEqual(next, {...journal, status: "superseded", checkpoint: "superseded-by-revision"})) return;
    throw new Error("Revision must preserve the exact execution evidence during derived supersession");
  }
  const stable = ({approvalMode: _mode, approvalPolicyVersion: _version, ...value}: ExecutionJournal) => value;
  if (!isDeepStrictEqual(stable(journal), stable(next))) throw new Error("Migration must preserve the original execution contract, nodes and evidence");
  if (next.approvalMode === journal.approvalMode && next.approvalPolicyVersion === journal.approvalPolicyVersion) return;
  const migration = approvalModeMigrationSchema.safeParse(proposed.approvalModeMigration);
  if (journal.approvalMode !== "autonomous" || (journal.approvalPolicyVersion ?? 1) !== 1
    || !migration.success || migration.data.executionId !== journal.executionId
    || !artifacts.has(`.cadre/${migration.data.refreshPath}`) || next.approvalMode !== migration.data.approvalMode
    || next.approvalPolicyVersion !== 2 || proposed.operation?.executionId !== journal.executionId
    || proposed.operation.approvalMode !== next.approvalMode || proposed.operation.approvalPolicyVersion !== 2) {
    throw new Error("Refresh must preserve existing Autonomous approval policy; execution policy changes require the explicit supported legacy migration");
  }
}

export function requireJournalPreservation(root: string, files: PromotionFile[], saved?: BeforeEvidence[],
  base?: string | null, derived = true): BeforeEvidence[] {
  const evidence = promotionEvidence(root, files, saved, base), paths = new Set(files.map((file) => file.path));
  for (const file of files) {
    const match = /^\.cadre\/tracks\/([^/]+)\/executions\/execution-[^/]+\.json$/.exec(file.path);
    if (!match) continue;
    if (file.content === null) throw new Error("Refresh/revision cannot delete an execution journal");
    const before = evidence.read(file.path);
    if (before === file.content) continue;
    const statePath = `.cadre/tracks/${match[1]}/state.json`;
    // Authored candidates may omit an unchanged state; promotion always includes it.
    const stateFile = files.find((item) => item.path === statePath);
    const stateBefore = stateFile ? evidence.read(statePath) : readSafeArtifact(root, statePath);
    const previous = JSON.parse(stateBefore) as TrackState;
    const proposed = JSON.parse(stateFile?.content ?? stateBefore) as TrackState;
    requireJournalTransition(before, file.content, previous, proposed, file.path, paths, derived);
  }
  return evidence.retained();
}
