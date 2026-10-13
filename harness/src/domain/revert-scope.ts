import { isDeepStrictEqual } from "node:util";
import type { ExecutionNode, ExecutionJournal } from "./execution.js";
import type { OperationState } from "./state.js";
import { resolveGitCommit, isGitAncestor } from "./git.js";
import { spawnSync } from "node:child_process";
import { countGitProcess } from "./inspection.js";

type ScopeNode = Pick<ExecutionNode, "id" | "kind" | "phaseId" | "workerCommit" | "mergeCommit">;
export interface RevertDelivery {trackId: string; nodes: Record<string, ScopeNode>}

export function requireRevertScope(root: string, operation: OperationState, delivery: RevertDelivery, commits: string[]): Set<string> {
  const target = delivery.nodes[String(operation.targetId)];
  if (operation.targetKind === "track" ? operation.targetId !== delivery.trackId
    : !target || target.kind !== operation.targetKind) throw new Error("Revert target must exist in its retained execution");
  const nodes = Object.values(delivery.nodes);
  const selected = nodes.filter((node) => operation.targetKind === "track" || operation.targetKind === "phase"
    ? operation.targetKind === "track" || node.id === target!.id || node.phaseId === target!.id : node.id === target!.id);
  const selectedIds = new Set(selected.map((node) => node.id));
  const commitOf = (value: string | null) => value ? resolveGitCommit(root, value) : null;
  if (operation.targetKind === "task" && target?.workerCommit) {
    const shared = commitOf(target.workerCommit)!;
    const siblings = nodes.filter((node) => node.kind === "task" && commitOf(node.workerCommit) === shared);
    if (siblings.length > 1) {
      if (typeof operation.sharedCommit !== "string" || commitOf(operation.sharedCommit) !== shared
        || !Array.isArray(operation.affectedTaskIds) || !isDeepStrictEqual([...operation.affectedTaskIds].sort(), siblings.map((node) => node.id).sort())) {
        throw new Error("Shared reversal requires explicit approval of every task using the commit");
      }
      for (const sibling of siblings) {selected.push(sibling); selectedIds.add(sibling.id);}
    }
  }
  const eligible = new Set(selected.filter((node) => node.kind !== "manual-verification")
    .flatMap((node) => [node.workerCommit, node.mergeCommit]).filter((value): value is string => Boolean(value)).map((value) => resolveGitCommit(root, value)));
  if (commits.some((commit) => !eligible.has(commit))) throw new Error("Revert commit lies outside its named task/phase scope or retained execution commit provenance");
  // A completion/fast-forward HEAD is not a merge delta covering all its ancestors.
  const covers = (boundary: string, commit: string): boolean => {
    const resolved = resolveGitCommit(root, boundary);
    if (!commits.includes(resolved)) return false;
    countGitProcess();
    const result = spawnSync("git", ["show", "-s", "--format=%P", resolved], {cwd: root, encoding: "utf8"});
    if (result.status !== 0) throw new Error("Cannot inspect reversal integration parents");
    const parents = result.stdout.trim().split(" ").filter(Boolean);
    const choices = operation.mainlineParents as Record<string, number> | undefined;
    const named = Object.entries(choices ?? {}).find(([name]) => resolveGitCommit(root, name) === resolved);
    const mainline = named?.[1];
    return parents.length > 1 && Number.isInteger(mainline) && mainline! > 0 && mainline! <= parents.length
      && isGitAncestor(root, commit, resolved) && !isGitAncestor(root, commit, parents[mainline! - 1]!);
  };
  const required = new Set(selected.filter((node) => node.kind !== "manual-verification").flatMap((node) => {
    const commit = node.mergeCommit ?? node.workerCommit;
    if (!commit) return [];
    const boundary = selected.find((phase) => phase.kind === "phase" && phase.id === node.phaseId && phase.mergeCommit);
    if (node.kind !== "phase" && boundary?.mergeCommit && covers(boundary.mergeCommit, commit)) {
      if (commits.includes(resolveGitCommit(root, commit)) && resolveGitCommit(root, commit) !== resolveGitCommit(root, boundary.mergeCommit)) {
        throw new Error("Revert cannot reverse a task twice through its covering phase merge");
      }
      return [];
    }
    return [resolveGitCommit(root, commit)];
  }));
  if ([...required].some((commit) => !commits.includes(commit))) throw new Error("Revert omits delivered commits from its named target scope");
  return selectedIds;
}

/** Reset only the approved target and its dependent/phase consequences; retain all other evidence. */
export function requireRevertReset(before: ExecutionJournal, after: ExecutionJournal, selected: Set<string>, targetId: string): void {
  const stable = (journal: ExecutionJournal) => Object.fromEntries(Object.entries(journal).filter(([key]) => !["nodes", "checkpoint"].includes(key)));
  if (!isDeepStrictEqual(stable(before), stable(after)) || after.checkpoint !== `reverted:${targetId}`
    || !isDeepStrictEqual(Object.keys(before.nodes).sort(), Object.keys(after.nodes).sort())) throw new Error("Revert must preserve its execution contract and exact target checkpoint");
  const consequences = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(before.nodes)) {
      if (consequences.has(node.id)) continue;
      if (node.dependencies.some((id) => consequences.has(id)) || node.kind === "phase"
        && Object.values(before.nodes).some((child) => child.phaseId === node.id && consequences.has(child.id))) {
        consequences.add(node.id); changed = true;
      }
    }
  }
  const cleared = new Set(["status", "workerCommit", "mergeCommit", "verification", "approval", "blocker", "workerId", "branch", "worktreePath", "workerHistory"]);
  for (const node of Object.values(before.nodes)) {
    const next = after.nodes[node.id]!;
    if (selected.has(node.id) && (node.workerCommit || node.mergeCommit || node.status === "completed")) {
      if (!["pending", "blocked"].includes(next.status) || next.workerCommit !== null || next.mergeCommit !== null
        || next.verification !== null || next.approval !== null) throw new Error(`Revert must reset all delivered evidence for ${node.id}`);
    }
    if (isDeepStrictEqual(node, next)) continue;
    if (!consequences.has(node.id) || !["pending", "blocked"].includes(next.status)) throw new Error(`Revert reset lies outside its target/dependency scope: ${node.id}`);
    if (!selected.has(node.id) && (node.workerCommit || node.mergeCommit) && (next.workerCommit !== node.workerCommit || next.mergeCommit !== node.mergeCommit)) {
      throw new Error(`Dependent product ${node.id} needs its own approved Git reversal`);
    }
    for (const field of ["workerId", "branch", "worktreePath"] as const) {
      if (next[field] !== node[field] && next[field] !== null) throw new Error(`Revert cannot assign a new worker binding to ${node.id}`);
    }
    if (selected.has(node.id) && node.workerId && next.workerId !== null) throw new Error(`Revert must clear quiescent worker ownership for ${node.id}`);
    const history = [...(node.workerHistory ?? [])];
    if (node.workerId && !history.includes(node.workerId)) history.push(node.workerId);
    if (!isDeepStrictEqual(next.workerHistory ?? [], history)) throw new Error(`Revert must retain ${node.id} worker history`);
    const retained = (value: ExecutionNode) => Object.fromEntries(Object.entries(value).filter(([key]) => !cleared.has(key)));
    if (!isDeepStrictEqual(retained(node), retained(next))) throw new Error(`Revert must retain ${node.id} worker and handoff evidence`);
  }
}
