import { prepareCandidateStage } from "../../src/domain/staging.js";
import { readExecution } from "../../src/domain/execution.js";
import { fixture, read, write, json, git } from "./revision-fixture.js";

export async function revertFixture(t: Parameters<typeof fixture>[0], clientName = "codex", requestedMode = "sequential",
  options: {empty?: boolean; blocked?: boolean; dirty?: "tracked" | "untracked"; nested?: boolean} = {}) {
  const f = await fixture(t, clientName), {root, call, load} = f;
  if (options.dirty === "tracked") {
    write(root, "user.txt", "Initial unrelated user file\n"); git(root, "add", "user.txt"); git(root, "commit", "-m", "unrelated user baseline");
  }
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "autonomous", requestedMode});
  const id = load().operation.executionId, scope = {projectRoot: root, trackId: "sample", executionId: id};
  await call("execution_checkpoint", {scope: {...scope, nodeId: "P1"}, action: {event: "start"}});
  write(root, "first.txt", "First product\n"); git(root, "add", "first.txt"); git(root, "commit", "-m", "feat: first product");
  const product = git(root, "rev-parse", "HEAD");
  await call("execution_checkpoint", {scope: {...scope, nodeId: "T1.1"}, action: {event: "complete_group", commit: product,
    tasks: [{nodeId: "T1.1", verification: "Checked", authorization: "Fixture approval", handoff: {
      decisions: [], failedApproaches: [], openQuestions: [], nextAction: "Continue", sources: []}}]}});
  if (options.blocked) {
    const state = load(); state.autonomousReview = {...state.autonomousReview, checkpoint: "blocked", blocker: "Retain prerequisite"};
    write(root, ".cadre/tracks/sample/state.json", json(state));
  }
  const original = load(), path = original.operation.journal as string;
  const before = read(root, `.cadre/tracks/sample/${path}`), journal = readExecution(root, "sample", id);
  const reset = structuredClone(journal);
  Object.assign(reset.nodes["T1.1"]!, {status: "pending", workerCommit: null, mergeCommit: null, verification: null, approval: null, blocker: null});
  reset.checkpoint = "reverted:T1.1";
  const files: Record<string, string> = {"state.json": json(original), [path]: json(reset),
    "reverts/revert-task-execution-before.json": before, "reverts/revert-task.md": "# Approved reversal\nReverse T1.1 only, preserve other nodes and original authority.\n"};
  if (options.dirty) {
    write(root, "user.txt", "Retain original user edit\n");
    const prepared = await call("candidate_stage_prepare", {projectRoot: root, candidateId: "revert-sample"});
    files["reverts/revert-task-baseline.json"] = json(prepared.revertBaseline);
  }
  if (options.nested) for (const [path, body] of Object.entries(files)) {
    delete files[path]; files[`tracks/sample/${path}`] = body;
  }
  const stage = () => {
    prepareCandidateStage(root, "revert-sample", Object.keys(files));
    for (const [file, body] of Object.entries(files)) write(root, `.cadre/stage/revert-sample/${file}`, body);
    return {projectRoot: root, candidateId: "revert-sample", workflow: "revert" as const, files: Object.keys(files)};
  };
  stage();
  const inspected = await call("candidate_inspect", {projectRoot: root, candidateId: "revert-sample", files: Object.keys(files)});
  const operation = {action: "revert", checkpoint: "approved", targetKind: "task", targetId: "T1.1", baseCommit: product,
    expectedCommit: "cadre(revert): reconcile sample", commits: [product], revertCommits: [] as string[],
    originalExecutionPath: "reverts/revert-task-execution-before.json", approvedArtifacts: Object.keys(files),
    approvedArtifactHashes: inspected.files as Array<{path: string; sha256: string}>, artifactProgress: [],
    approvalDigest: inspected.digest as string, approvedAt: new Date().toISOString(),
    ...(options.dirty ? {repositoryBaselinePath: "reverts/revert-task-baseline.json"} : {})};
  const temporary = {...original, operation, lastExecution: {executionId: id, journal: path, planRevision: journal.planRevision,
    graphDigest: journal.graphDigest, headCommit: journal.headCommit, completedAt: journal.completedAt,
    approvalMode: journal.approvalMode, approvalPolicyVersion: journal.approvalPolicyVersion}};
  write(root, ".cadre/tracks/sample/state.json", json(temporary));
  if (options.empty) git(root, "commit", "--allow-empty", "-m", "chore: unrelated"); else git(root, "revert", "--no-edit", product);
  operation.revertCommits.push(git(root, "rev-parse", "HEAD"));
  write(root, ".cadre/tracks/sample/state.json", json(temporary));
  files["reverts/revert-task.json"] = json({...operation, reconciliationCommit: null}); stage();
  return {...f, id, path, files, operation, original, reset, stage};
}
