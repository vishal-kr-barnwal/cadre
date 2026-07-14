import fs from "node:fs";
import path from "node:path";

import type { CadreTrack, CommandResult, JsonObject, RuntimeArgs } from "../../../types";
import { asOptionalString, asString } from "../../../guards";

import type { CoreResult, ParallelWorker } from "./contracts";
import { branchSetEntryForRepo } from "./branch-set";
import { readParallelState, recordParallelCleanup } from "./parallel-state";
import { runCommand } from "../../infrastructure/runtime/system";

interface CleanupCommand {
  worker: ParallelWorker;
  command: JsonObject;
}

function cleanupRepoRoot(root: string, track: CadreTrack, worker: ParallelWorker, args: RuntimeArgs): string {
  const repo = asOptionalString(worker.repo) || asOptionalString(args.repo) || ".";
  const branchEntry = branchSetEntryForRepo(root, track, repo, args);
  return asString(branchEntry?.integration_worktree || branchEntry?.source_root || root);
}

function plannedCommand(args: string[], cwd: string): JsonObject {
  return { command: "git", args, cwd };
}

function run(command: JsonObject): CommandResult {
  return runCommand("git", Array.isArray(command.args) ? command.args.map(String) : [], { cwd: asString(command.cwd) });
}

function resolvedWorktree(root: string, worker: ParallelWorker): string {
  const worktree = asString(worker.worktree);
  return path.isAbsolute(worktree) ? worktree : path.resolve(root, worktree);
}

function worktreeResult(root: string, entry: CleanupCommand): CommandResult {
  if (fs.existsSync(resolvedWorktree(root, entry.worker))) return run(entry.command);
  return {
    ok: true,
    status: 0,
    stdout: "",
    stderr: "",
    command: "git worktree remove",
    args: Array.isArray(entry.command.args) ? entry.command.args.map(String) : [],
    cwd: asString(entry.command.cwd),
    skipped: true,
    reason: "worker worktree is already absent",
  };
}

export function parallelCleanup(root: string, track: CadreTrack, args: RuntimeArgs = {}): CoreResult {
  const state = readParallelState(track);
  const force = args.force === true;
  const eligible = state.workers.filter((worker) => force || worker.status === "merged");
  const worktreeCommands: CleanupCommand[] = eligible.flatMap((worker) => worker.worktree
    ? [{
      worker,
      command: plannedCommand(
        ["worktree", "remove", asString(worker.worktree)],
        cleanupRepoRoot(root, track, worker, args),
      ),
    }]
    : []);
  const refCommands: CleanupCommand[] = eligible.flatMap((worker) => {
    if (!worker.worker_ref) return [];
    const repo = asOptionalString(worker.repo) || asOptionalString(args.repo) || ".";
    const branchEntry = branchSetEntryForRepo(root, track, repo, args);
    return [{
      worker,
      command: plannedCommand(
        ["update-ref", "-d", asString(worker.worker_ref)],
        asString(branchEntry?.source_root || root),
      ),
    }];
  });
  const workers = Array.from(new Set([...worktreeCommands, ...refCommands].map((entry) => entry.worker)));
  const skipped = state.workers
    .filter((worker) => (worker.worktree || worker.worker_ref) && !eligible.includes(worker))
    .map((worker) => ({ worker_id: worker.worker_id, status: worker.status, reason: "worker is not merged" }));
  const alreadyCleaned = state.workers
    .filter((worker) => !worker.worktree && !worker.worker_ref && (worker.cleaned_at || worker.worker_ref_cleaned_at))
    .map((worker) => ({
      worker_id: worker.worker_id,
      status: worker.status,
      cleaned_at: worker.cleaned_at || null,
      worker_ref_cleaned_at: worker.worker_ref_cleaned_at || null,
    }));
  const execute = args.execute === true;
  const worktreeResults = execute ? worktreeCommands.map((entry) => worktreeResult(root, entry)) : [];
  const refResults = execute ? refCommands.map((entry) => run(entry.command)) : [];
  const stateRecords: CoreResult[] = [];
  if (execute) {
    for (const worker of workers) {
      const worktreeIndex = worktreeCommands.findIndex((entry) => entry.worker === worker);
      const refIndex = refCommands.findIndex((entry) => entry.worker === worker);
      const worktreeCleaned = worktreeIndex >= 0 && worktreeResults[worktreeIndex]?.ok === true;
      const workerRefCleaned = refIndex >= 0 && refResults[refIndex]?.ok === true;
      if (!worktreeCleaned && !workerRefCleaned) continue;
      stateRecords.push(recordParallelCleanup(root, {
        trackId: track.track_id,
        workerId: worker.worker_id,
        worktreeCleaned,
        workerRefCleaned,
      }));
    }
  }
  const results = [...worktreeResults, ...refResults];
  return {
    ok: results.every((result) => result.ok) && stateRecords.every((record) => record.ok !== false),
    track_id: track.track_id,
    action: "cleanup",
    execute,
    dry_run: !execute,
    workers,
    skipped,
    already_cleaned: alreadyCleaned,
    commands: worktreeCommands.map((entry) => entry.command),
    ref_commands: refCommands.map((entry) => entry.command),
    results,
    state_records: stateRecords,
  };
}
