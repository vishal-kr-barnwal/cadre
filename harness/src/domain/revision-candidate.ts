import { join } from "node:path";
import { existsSync } from "node:fs";
import { autonomousReviewSchema, requireUnchangedAutonomousReview } from "./autonomous-review.js";
import { resolveApprovalMode, type ApprovalPolicyReference } from "./approval-policy.js";
import { validateExecutionJournal, type ExecutionJournal } from "./execution.js";
import { parsePlanContent, validatePlanGraph, type PlanGraph } from "./plan.js";
import type { TrackState } from "./state.js";
import { isGitAncestor, readGitFileAtCommit } from "./git.js";
import { requireQuiescentExecution } from "./execution-quiescence.js";
import { deriveDraftRevision } from "./draft-revision.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A scope revision is explicitly approved together with its resulting authority and execution disposition. */
export function deriveRevisionCandidate(root: string, previous: TrackState, proposed: TrackState,
  authored: Map<string, string>, overlay: Map<string, string>, reference: string, read: (path: string) => string): TrackState {
  const parent = `tracks/${previous.trackId}`, statePath = `${parent}/state.json`;
  if (!authored.has(statePath)) throw new Error("Revision requires proposed state.json with the next track revision; include it before approval");
  if (!["drafting-plan", "planned", "in_progress", "ready_for_review"].includes(previous.status)) throw new Error("Revision requires an approved active baseline");
  if (proposed.revision !== Number(previous.revision) + 1) throw new Error("Revision must increment the track revision exactly once");
  const revisions = [...authored.keys()].filter((path) => path.startsWith(`${parent}/revisions/`));
  if (revisions.length !== 1) throw new Error("Revision requires exactly one revisions/revision-<id>.md artifact per revised track");
  const record = authored.get(revisions[0]!)!;
  if (existsSync(join(root, ".cadre", revisions[0]!))) throw new Error("Preserve existing revision records; use a fresh revision artifact for the new approval");
  const authoredState = JSON.parse(authored.get(statePath)!) as TrackState;
  if (!equal(authoredState.commits, previous.commits)) throw new Error("Revision must preserve authored commit references; the runtime binds changed artifacts to the new receipt");
  for (const [label, value] of [["Previous track revision", previous.revision], ["New track revision", proposed.revision]]) {
    if (!record.split(/\r?\n/).includes(`- ${label}: ${value}`)) throw new Error(`Revision record must declare ${label}: ${value}`);
  }
  for (const field of ["operation", "lastExecution", "reviewCycles", "approvalModeMigration"] as const) {
    if (!equal(proposed[field], previous[field])) throw new Error(`Revision must preserve authored ${field}; the runtime derives the approved transition`);
  }
  requireUnchangedAutonomousReview(previous.autonomousReview, proposed.autonomousReview, "Revision");
  if (previous.operation && previous.operation.action !== "implement") throw new Error("Reconcile the pending operation before revising");
  if (previous.status === "drafting-plan") return deriveDraftRevision(root, previous, proposed, authored, reference, read, record);
  const oldGraph = parsePlanContent(read(`${parent}/plan.md`), `${parent}/plan.md`);
  const graph = parsePlanContent(overlay.get(`${parent}/plan.md`) ?? read(`${parent}/plan.md`), `${parent}/plan.md`);
  const graphChanged = graph.digest !== oldGraph.digest;
  const targetStatus = previous.status === "planned" || proposed.status === "planned" ? "planned" : "in_progress";
  if (graphChanged && ![previous.status, "planned", "in_progress"].includes(proposed.status)) throw new Error("Revised delivery must target planned or in_progress");
  const specChanged = authored.has(`${parent}/spec.md`);
  if (specChanged && (!authored.has(`${parent}/plan.md`) || graph.specRevision !== oldGraph.specRevision! + 1)) {
    throw new Error("A revised specification requires its next spec revision in a reassessed plan");
  }
  if (graphChanged) {
    if (graph.planRevision !== oldGraph.planRevision! + 1 || graph.specRevision !== oldGraph.specRevision! + (specChanged ? 1 : 0)) {
      throw new Error("Revision must increment changed plan/spec revisions exactly once");
    }
    for (const file of ["learning.md", "dependency-context.json"]) {
      if (!authored.has(`${parent}/${file}`)) throw new Error(`Revision requires reassessed ${file}`);
    }
  }
  for (const [label, value] of [["Previous spec revision", oldGraph.specRevision], ["New spec revision", graph.specRevision],
      ["Previous plan revision", oldGraph.planRevision], ["New plan revision", graph.planRevision]]) {
    if (!record.split(/\r?\n/).includes(`- ${label}: ${value}`)) throw new Error(`Revision record must declare ${label}: ${value}`);
  }
  const binding = previous.operation?.action === "implement" ? previous.operation : previous.lastExecution;
  const errors: string[] = [];
  validatePlanGraph(`${parent}/plan.md`, oldGraph, previous.status, errors);
  validatePlanGraph(`${parent}/plan.md`, graph, graphChanged ? targetStatus : previous.status, errors);
  // Validate identity/path/binding first, before reading a retained journal.
  validateExecutionJournal(join(root, ".cadre", parent), previous, null, errors);
  if (errors.length) throw new Error(`Reconcile the existing execution before revision: ${errors.join("; ")}`);
  const journal = binding ? JSON.parse(read(`${parent}/${binding.journal}`)) as ExecutionJournal : null;
  let executionGraph = oldGraph;
  if (journal && previous.operation?.action === "implement" && journal.graphDigest !== oldGraph.digest) {
    const proof = [`- Previous execution graph: ${journal.graphDigest}`, `- Previous execution plan commit: ${journal.planCommit}`];
    if (!record.includes("## Recovery evidence") || proof.some((line) => !record.split(/\r?\n/).includes(line))) {
      throw new Error("Revision repair requires Recovery evidence naming the original execution graph and plan commit; preserve the journal and approve the complete repair");
    }
    if (!isGitAncestor(root, journal.planCommit)) throw new Error("Revision repair requires a reachable original execution plan commit");
    executionGraph = parsePlanContent(readGitFileAtCommit(root, journal.planCommit, `.cadre/${parent}/plan.md`), `${parent}/plan.md`, errors);
    validatePlanGraph(`${parent}/plan.md`, executionGraph, "in_progress", errors);
  }
  validateExecutionJournal(join(root, ".cadre", parent), previous, executionGraph, errors);
  if (errors.length) throw new Error(`Reconcile the existing execution before revision: ${errors.join("; ")}`);
  if (journal && authored.has(`${parent}/plan.md`)) preserveCompletedWork(executionGraph, graph, journal);
  const state = { ...proposed };
  const entry = (state.history as Array<Record<string, unknown>>).at(-1)!;
  if (previous.autonomousReview) {
    const loop = autonomousReviewSchema.parse(previous.autonomousReview);
    if (loop.checkpoint === "blocked") throw new Error("Resolve the recorded Autonomous blocker before revising its execution");
    if (resolveApprovalMode(binding as ApprovalPolicyReference, previous.approvalModeMigration) !== "autonomous") throw new Error("Revision cannot invent Autonomous execution authority");
    entry.previousAutonomousReview = loop;
    // Preserve the original authorization, cumulative review baseline, findings, and attempts.
    // The digest includes this changed scope reference before the human approves it.
    state.autonomousReview = { ...loop, specCommit: specChanged ? reference : loop.specCommit,
      checkpoint: graphChanged ? "remediating" : loop.checkpoint };
    if (graphChanged) {
      delete state.autonomousReview.reviewedExecutionId;
      delete state.autonomousReview.reviewedHead;
    }
  }
  if (graphChanged) {
    state.status = targetStatus;
    state.checkpoint = "ready";
    state.operation = null;
    if (journal && previous.operation?.action === "implement") {
      requireQuiescentExecution(root, journal);
      entry.previousExecution = previous.operation;
      if (previous.lastExecution) entry.previousLastExecution = previous.lastExecution;
      // Superseded is historical, never a claim of successful completion. Node evidence stays exact.
      overlay.set(`${parent}/${binding!.journal}`, json({ ...journal, status: "superseded", checkpoint: "superseded-by-revision" }));
      state.lastExecution = { executionId: journal.executionId, journal: String(binding!.journal),
        approvalMode: journal.approvalMode, approvalPolicyVersion: journal.approvalPolicyVersion ?? 1,
        planRevision: journal.planRevision, graphDigest: journal.graphDigest,
        ...(journal.headCommit ? { headCommit: journal.headCommit } : {}),
        ...(journal.completedAt ? { completedAt: journal.completedAt } : {}) };
    }
  } else if (state.status !== previous.status) throw new Error("A revision without a changed graph must preserve lifecycle status");
  return state;
}

function preserveCompletedWork(before: PlanGraph, after: PlanGraph, journal: ExecutionJournal): void {
  const tasks = new Map(after.phases.flatMap((phase) => phase.tasks.map((task) => [task.id, task] as const)));
  for (const phase of before.phases) {
    const nextPhase = after.phases.find((candidate) => candidate.id === phase.id);
    const completed = journal.nodes[phase.id]?.status === "completed";
    const structure = (value: typeof phase) => ({ id: value.id, title: value.title, dependencies: value.dependencies,
      tasks: value.tasks.map(({ line: _line, checked: _checked, commit: _commit, ...task }) => task) });
    if (completed && (!nextPhase || !equal(structure(phase), structure(nextPhase))
      || nextPhase.completionCommit !== (journal.nodes[phase.id]?.mergeCommit ?? journal.nodes[phase.id]?.workerCommit))) {
      throw new Error(`Revision must preserve completed phase ${phase.id}; approve an additive revert before invalidating its work`);
    }
    for (const task of phase.tasks) {
      const node = journal.nodes[task.id];
      if (node?.status !== "completed") continue;
      const next = tasks.get(task.id), commit = node.workerCommit ?? node.mergeCommit;
      if (task.commitGroup && !equal(phase.tasks.filter((item) => item.commitGroup === task.commitGroup).map((item) => item.id),
        nextPhase?.tasks.filter((item) => item.commitGroup === task.commitGroup).map((item) => item.id))) {
        throw new Error(`Revision cannot add tasks to a completed commit group ${task.commitGroup}; assign new delivery a fresh group`);
      }
      if (!next || !next.checked || next.commit !== commit || next.title !== task.title || next.phaseId !== task.phaseId
        || next.commitGroup !== task.commitGroup || !equal(next.dependencies, task.dependencies)
        || !equal(nextPhase?.dependencies, phase.dependencies)) {
        throw new Error(`Revision must preserve completed task ${task.id} and its commit; approve an additive revert before invalidating its work`);
      }
    }
  }
}
