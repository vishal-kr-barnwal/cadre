import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCadreServer } from "../src/mcp/server.js";
import { deriveNextStep, nextStepSchema } from "../src/domain/next-step.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { approvalModeMigrationSchema, EXECUTION_APPROVAL_MODES, resolveApprovalMode, validateTrackApprovalPolicy } from "../src/domain/approval-policy.js";
import { autonomousReviewSchema, requireReviewProgress } from "../src/domain/autonomous-review.js";
import { applyExecutionStart, previewExecutionStart, applyExecutionCheckpoint, previewExecutionCheckpoint,
  applyExecutionFinish, previewExecutionFinish, readExecution, deriveExecutionStartInput, type ExecutionCheckpointInput } from "../src/domain/execution.js";
import { deriveReviewCompleteInput, previewReviewComplete, applyReviewComplete } from "../src/domain/governance.js";
import { validateProject, validateTrackOperation, renderTracksPreview, writeTracks, type TrackState } from "../src/domain/state.js";
import { requireFreshTrackMemory } from "../src/domain/memory.js";
import { validateStagedState } from "../src/domain/staged-state.js";

const harness = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const write = (path: string, body: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n"); };
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "cadre-policy-")), track = join(root, ".cadre/tracks/sample");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(harness, "templates/v4/init"), join(root, ".cadre"), { recursive: true });
  renameSync(join(root, ".cadre/gitignore.template"), join(root, ".cadre/.gitignore"));
  write(join(track, "spec.md"), "# Specification\n## Functional Requirements\nImplement.\n## Non-Functional Requirements\nResume.\n## Acceptance Criteria\nVerify.\n## Dependencies\nNone.\n## Additional Information\nNone.\n## Dependent-track impact\nNone.\n");
  write(join(track, "plan.md"), "# Plan\n- Spec revision: 1\n- Plan revision: 1\n\n## Phase 1: Deliver\n- Phase dependencies: none\n- [ ] T1.1 Implement\n  - Task dependencies: none\n- [ ] T1.2 User Manual Verification\n- Phase completion commit: pending\n\n## Phase 2: Track-level User Manual Verification\n- [ ] T2.1 User Manual Verification\n- Phase completion commit: pending\n");
  write(join(track, "learning.md"), "# Learning\n<!-- cadre:pattern-seed:start -->\n## Pattern Seed\n<!-- cadre:memory:start -->\n{\"schemaVersion\":1,\"specRevision\":1,\"planRevision\":1,\"patterns\":[]}\n<!-- cadre:memory:end -->\nNo relevant patterns.\n<!-- cadre:pattern-seed:end -->\n\n## Phase 1: Deliver\nVerified locally.\n");
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Cadre Test"); git(root, "config", "user.email", "cadre@example.test"); git(root, "config", "commit.gpgsign", "false");
  git(root, "add", "."); git(root, "commit", "-m", "test: approved specification and plan");
  const base = git(root, "rev-parse", "HEAD");
  const state: TrackState = { schemaVersion: 1, trackId: "sample", title: "Sample", type: "feature", status: "planned", checkpoint: "ready", revision: 1,
    dependencies: [], commits: { spec: base, plan: base }, artifactProgress: [], operation: null, lastExecution: null, reviewCycles: [], history: [] };
  write(join(track, "state.json"), state);
  write(join(root, ".cadre/project.json"), { schemaVersion: 1, runtimeVersion: "3.8.0", templateSetVersion: "v4", project: { name: "Policy", context: "brownfield" }, setup: { status: "completed", checkpoint: "completed", commit: base, artifactProgress: [], operation: null }, history: [] });
  const render = () => writeTracks(root, renderTracksPreview(root).digest);
  render(); git(root, "add", ".cadre"); git(root, "commit", "-m", "test: record approved context");
  const load = () => JSON.parse(readFileSync(join(track, "state.json"), "utf8")) as TrackState;
  const save = (value: TrackState) => { write(join(track, "state.json"), value); render(); };
  const start = (executionId: string, mode?: typeof EXECUTION_APPROVAL_MODES[number], scheduling: "parallel" | "sequential" = "parallel") => {
    const input = { projectRoot: root, trackId: "sample", executionId, requestedMode: scheduling, effectiveMode: scheduling,
      ...(mode ? { approvalMode: mode } : {}), maxWorkers: 3, baseCommit: git(root, "rev-parse", "HEAD"), approvedAt: new Date().toISOString() };
    return applyExecutionStart(input, previewExecutionStart(input).digest);
  };
  const finish = (executionId: string) => {
    const checkpoint = (nodeId: string, action: Omit<ExecutionCheckpointInput, "projectRoot" | "trackId" | "executionId" | "nodeId">) => {
      const input = { projectRoot: root, trackId: "sample", executionId, nodeId, ...action };
      applyExecutionCheckpoint(input, previewExecutionCheckpoint(input).digest);
    };
    const journal = readExecution(root, "sample", executionId);
    for (const phase of Object.values(journal.nodes).filter((node) => node.kind === "phase" && node.status !== "completed")) {
      checkpoint(phase.id, { event: "start" });
      for (const task of Object.values(journal.nodes).filter((node) => node.phaseId === phase.id && node.kind !== "phase" && node.status !== "completed")) {
        checkpoint(task.id, { event: "start" });
        if (task.kind === "task") {
          write(join(root, "product.txt"), `${executionId}/${task.id}\n`); git(root, "add", "product.txt"); git(root, "commit", "-m", `feat: implement ${executionId} ${task.id}`);
        }
        checkpoint(task.id, { event: task.kind === "task" ? "record_commit" : "record_verification", commit: git(root, "rev-parse", "HEAD"), verification: "local checks passed", authorization: "persisted mode; no human verification claimed" });
        if (task.kind === "task") checkpoint(task.id, { event: "complete" });
      }
      checkpoint(phase.id, { event: "complete", commit: git(root, "rev-parse", "HEAD"), verification: "combined checks passed", authorization: "persisted mode" });
    }
    const input = { projectRoot: root, trackId: "sample", executionId, headCommit: git(root, "rev-parse", "HEAD"), completedAt: new Date().toISOString() };
    const result = applyExecutionFinish(input, previewExecutionFinish(input).digest);
    git(root, "add", ".cadre"); git(root, "commit", "-m", `cadre(implement): complete sample ${executionId}`);
    assert.deepEqual(validateProject(root).errors, []);
    return result;
  };
  return { root, track, base, load, save, start, finish };
}

test("Track defaults independently of scheduling; explicit four-mode choices persist policy v2", (t) => {
  for (const scheduling of ["parallel", "sequential"] as const) {
    const f = fixture(t); assert.equal(f.start(`default-${scheduling}`, undefined, scheduling).journal.approvalMode, "track");
    for (const mode of EXECUTION_APPROVAL_MODES) {
      const f = fixture(t), execution = f.start(`${mode}-${scheduling}`, mode, scheduling);
      assert.equal(execution.journal.approvalMode, mode); assert.equal(execution.journal.approvalPolicyVersion, 2);
      assert.equal(execution.journal.requestedMode, scheduling); assert.equal(f.load().operation?.approvalPolicyVersion, 2);
      assert.equal(Boolean(f.load().autonomousReview), mode === "autonomous");
    }
  }
});

test("Autonomous finishes verification without completion; clean approval remains a separate digest-bound apply", (t) => {
  const f = fixture(t); f.start("original", "autonomous"); f.finish("original");
  const state = f.load(); assert.equal(state.status, "ready_for_review"); assert.equal(state.autonomousReview?.checkpoint, "reviewing");
  const request = { projectRoot: f.root, trackId: "sample", approval: "checks and independent review passed" };
  assert.throws(() => previewReviewComplete(deriveReviewCompleteInput(request)), /clean review bound/);
  state.autonomousReview = { ...state.autonomousReview!, checkpoint: "awaiting_approval", reviewedExecutionId: "original", reviewedHead: state.lastExecution!.headCommit! };
  f.save(state);
  const input = deriveReviewCompleteInput(request), proposal = previewReviewComplete(input);
  assert.equal(f.load().status, "ready_for_review"); assert.equal(f.load().reviewCycles!.length, 0);
  assert.throws(() => previewReviewComplete({ ...input, acceptedRisks: ["waive unresolved bug"] }), /cannot waive/);
  write(join(f.root, "product.txt"), "unreviewed change\n");
  assert.throws(() => applyReviewComplete(input, proposal.digest), /Product content changed/);
  write(join(f.root, "product.txt"), "original/T1.1\n");
  const workflowPath = join(f.root, ".cadre/workflow.md"), workflow = readFileSync(workflowPath, "utf8");
  write(workflowPath, workflow + "\nChanged verification requirements\n");
  assert.throws(() => applyReviewComplete(input, proposal.digest), /verification policy changed/);
  write(workflowPath, workflow);
  write(join(f.root, ".cadre/review-evidence.md"), "Only bookkeeping\n"); git(f.root, "add", ".cadre"); git(f.root, "commit", "-m", "cadre(review): record clean evidence");
  applyReviewComplete(input, proposal.digest); applyReviewComplete(input, proposal.digest);
  assert.equal(f.load().status, "completed"); assert.equal(f.load().autonomousReview?.checkpoint, "completed");
  assert.equal(f.load().reviewCycles!.length, 1); assert.ok(f.load().reviewCycles![0]!.approvalConfirmation);
});

test("Legacy Autonomous requires explicit migration; historical journal survives either selected authority", (t) => {
  for (const mode of ["track", "autonomous"] as const) {
    const f = fixture(t); f.start("legacy", "track"); f.finish("legacy");
    const path = join(f.track, "executions/execution-legacy.json"), journal = JSON.parse(readFileSync(path, "utf8"));
    journal.approvalMode = "autonomous"; delete journal.approvalPolicyVersion; write(path, journal);
    const state = f.load(); state.lastExecution!.approvalMode = "autonomous"; delete state.lastExecution!.approvalPolicyVersion; f.save(state);
    const original = readFileSync(path, "utf8");
    assert.ok(validateProject(f.root).warnings.some((warning) => warning.startsWith("APPROVAL_MODE_MIGRATION_REQUIRED")));
    assert.throws(() => resolveApprovalMode(state.lastExecution), /explicit Track or Autonomous/);
    state.approvalModeMigration = approvalModeMigrationSchema.parse({ executionId: "legacy", approvalMode: mode, approvedAt: new Date().toISOString(), refreshPath: "refreshes/refresh-policy.md" });
    if (mode === "autonomous") state.autonomousReview = { policyVersion: 2, originExecutionId: "legacy", authorizedAt: state.approvalModeMigration.approvedAt,
      initialBaseCommit: journal.baseCommit, specCommit: state.commits!.spec!, checkpoint: "reviewing", findings: [] };
    f.save(state); assert.equal(resolveApprovalMode(state.lastExecution, state.approvalModeMigration), mode);
    assert.equal(readFileSync(path, "utf8"), original);
    assert.throws(() => resolveApprovalMode({ ...state.lastExecution, executionId: "different" }, state.approvalModeMigration), /explicit Track or Autonomous/);
  }
  assert.equal(resolveApprovalMode({ approvalMode: "phase" }), "phase"); assert.equal(resolveApprovalMode({}), "governed");
});

test("Autonomous finding identities survive attempts and cannot silently bypass stalls or blockers", () => {
  const loop = autonomousReviewSchema.parse({ policyVersion: 2, originExecutionId: "original", authorizedAt: new Date().toISOString(), initialBaseCommit: "a".repeat(40), specCommit: "b".repeat(40), checkpoint: "remediating",
    findings: [{ id: "stable-cause", summary: "Same cause after rename", status: "open", attemptExecutionIds: ["fix-1"] }] });
  assert.equal(requireReviewProgress(loop).findings[0]!.id, "stable-cause");
  loop.findings[0]!.attemptExecutionIds.push("fix-2"); assert.throws(() => requireReviewProgress(loop), /two remediation attempts/);
  assert.equal(autonomousReviewSchema.safeParse({ ...loop, checkpoint: "awaiting_approval", reviewedHead: "a".repeat(40), reviewedExecutionId: "fix-2" }).success, false);
  loop.findings[0]!.status = "resolved"; assert.doesNotThrow(() => requireReviewProgress(loop));
  assert.throws(() => requireReviewProgress({ ...loop, checkpoint: "blocked", blocker: "Human-only verification unavailable" }), /Human-only verification/);
  loop.findings[0]!.attemptExecutionIds.push("fix-2"); assert.equal(autonomousReviewSchema.safeParse(loop).success, false);
});

test("Autonomous remediation resumes across new execution graphs and reviews the cumulative baseline", (t) => {
  const f = fixture(t); f.start("original", "autonomous", "sequential"); f.finish("original");
  const originalPlan = readFileSync(join(f.track, "plan.md"), "utf8"), originalLoop = f.load().autonomousReview!;
  for (let round = 1; round <= 2; round++) {
    const state = f.load(), prior = state.lastExecution!, delivery = round * 2 + 1, final = delivery + 1;
    const loop = state.autonomousReview!;
    const finding = loop.findings[0] ?? { id: "stable-bug", summary: "Retains identity across moved code", status: "open" as const, attemptExecutionIds: [] };
    if (round > 1) finding.attemptExecutionIds.push(prior.executionId!);
    loop.findings = [finding]; loop.checkpoint = "remediating";
    loop.reviewedExecutionId = prior.executionId; loop.reviewedHead = prior.headCommit;
    const plan = readFileSync(join(f.track, "plan.md"), "utf8").replace(`Plan revision: ${round}`, `Plan revision: ${round + 1}`)
      + `\n## Phase ${delivery}: Fix stable-bug\n- Phase dependencies: P${delivery - 1}\n- [ ] T${delivery}.1 Fix the cause\n  - Task dependencies: none\n- [ ] T${delivery}.2 User Manual Verification\n- Phase completion commit: pending\n\n## Phase ${final}: Track-level User Manual Verification\n- [ ] T${final}.1 User Manual Verification\n- Phase completion commit: pending\n`;
    const seed = readFileSync(join(f.track, "learning.md"), "utf8").replace(`"planRevision":${round}`, `"planRevision":${round + 1}`);
    const candidates = [{ path: "plan.md", content: plan, absolutePath: "unused" },
      { path: "learning.md", content: seed, absolutePath: "unused" },
      { path: `reviews/loop-${round}.json`, content: JSON.stringify(loop), absolutePath: "unused" }];
    assert.doesNotThrow(() => validateStagedState(f.root, "review-sample", candidates, [{ path: "plan.md", targetStatus: "in_progress" }]));
    assert.throws(() => validateStagedState(f.root, "review-sample", [{ ...candidates[2]!, content: JSON.stringify({ ...loop, originExecutionId: "changed-authority" }) }]), /cannot change originExecutionId/);
    write(join(f.track, "plan.md"), plan); write(join(f.track, "learning.md"), seed);
    state.status = "in_progress"; state.revision = round + 1;
    state.reviewCycles!.push({ outcome: "changes_requested", executionId: prior.executionId!, reviewedHead: prior.headCommit!, attemptedFindingIds: ["stable-bug"], authorization: { kind: "persisted-mode", originExecutionId: originalLoop.originExecutionId, proposalDigest: "a".repeat(64) } });
    f.save(state); git(f.root, "add", ".cadre"); git(f.root, "commit", "-m", `cadre(review): request changes round ${round}`);
    state.commits!.plan = git(f.root, "rev-parse", "HEAD"); f.save(state);
    // Re-reading after a simulated session interruption preserves both authority and history.
    assert.equal(f.load().autonomousReview!.originExecutionId, originalLoop.originExecutionId);
    assert.equal(f.load().autonomousReview!.initialBaseCommit, originalLoop.initialBaseCommit);
    const inherited = deriveExecutionStartInput({ projectRoot: f.root, trackId: "sample" });
    assert.equal(inherited.requestedMode, "sequential");
    const execution = f.start(`fix-${round}`, undefined, inherited.requestedMode);
    assert.equal(execution.journal.approvalMode, "autonomous");
    assert.equal(execution.journal.nodes["T2.1"]!.status, "completed");
    assert.equal(execution.journal.nodes["T2.1"]!.workerCommit, readExecution(f.root, "sample", "original").nodes["T2.1"]!.workerCommit);
    f.finish(`fix-${round}`);
    assert.ok(readFileSync(join(f.track, "plan.md"), "utf8").includes(originalPlan.slice(originalPlan.indexOf("## Phase 1"))));
  }
  const state = f.load(), loop = state.autonomousReview!;
  loop.findings[0]!.attemptExecutionIds.push("fix-2"); loop.findings[0]!.status = "resolved";
  loop.checkpoint = "awaiting_approval"; loop.reviewedExecutionId = "fix-2"; loop.reviewedHead = state.lastExecution!.headCommit;
  f.save(state);
  const input = deriveReviewCompleteInput({ projectRoot: f.root, trackId: "sample", approval: "Cumulative review and verification passed" });
  assert.equal(input.commitRange, `${originalLoop.initialBaseCommit}..${state.lastExecution!.headCommit}`);
  assert.notEqual(input.commitRange.split("..")[0], readExecution(f.root, "sample", "fix-2").baseCommit);
  const proposal = previewReviewComplete(input);
  const changed = f.load(); changed.autonomousReview!.findings[0]!.summary = "Updated review evidence"; f.save(changed);
  assert.throws(() => applyReviewComplete(input, proposal.digest), /stale/);
  const fresh = previewReviewComplete(input); applyReviewComplete(input, fresh.digest);
  assert.equal(f.load().reviewCycles!.length, 3);
  assert.deepEqual(f.load().autonomousReview!.findings[0]!.attemptExecutionIds, ["fix-1", "fix-2"]);
});

test("Active legacy authority blocks progress until the staged migration upgrades journal and operation together", (t) => {
  const f = fixture(t); f.start("legacy", "track");
  const path = join(f.track, "executions/execution-legacy.json"), journal = JSON.parse(readFileSync(path, "utf8"));
  journal.approvalMode = "autonomous"; delete journal.approvalPolicyVersion; write(path, journal);
  const state = f.load(); state.operation!.approvalMode = "autonomous"; delete state.operation!.approvalPolicyVersion; f.save(state);
  const start: ExecutionCheckpointInput = { projectRoot: f.root, trackId: "sample", executionId: "legacy", nodeId: "P1", event: "start" };
  assert.throws(() => previewExecutionCheckpoint(start), /explicit Track or Autonomous/);
  const block = { ...start, event: "block" as const, blocker: "Waiting for migration" };
  applyExecutionCheckpoint(block, previewExecutionCheckpoint(block).digest);
  const migrated = readExecution(f.root, "sample", "legacy"); migrated.approvalMode = "track"; migrated.approvalPolicyVersion = 2;
  state.operation!.approvalMode = "track"; state.operation!.approvalPolicyVersion = 2;
  state.approvalModeMigration = { executionId: "legacy", approvalMode: "track", approvedAt: new Date().toISOString(), refreshPath: "refreshes/refresh-policy.md" };
  const candidates = [{ path: "tracks/sample/state.json", content: JSON.stringify(state), absolutePath: "unused" },
    { path: "tracks/sample/executions/execution-legacy.json", content: JSON.stringify(migrated), absolutePath: "unused" }];
  assert.doesNotThrow(() => validateStagedState(f.root, "refresh-policy", candidates));
  assert.throws(() => validateStagedState(f.root, "refresh-policy", candidates.slice(0, 1)), /does not match/);
  write(path, migrated); f.save(state);
  applyExecutionCheckpoint(start, previewExecutionCheckpoint(start).digest);
  assert.equal(readExecution(f.root, "sample", "legacy").nodes.P1!.status, "running");
});

test("v3 and v4 both require fresh memory and reject malformed staged loop state", (t) => {
  const f = fixture(t);
  for (const version of ["v3", "v4"]) {
    const path = join(f.root, ".cadre/project.json"), project = JSON.parse(readFileSync(path, "utf8")); project.templateSetVersion = version; write(path, project);
    assert.doesNotThrow(() => requireFreshTrackMemory(f.root, "sample"));
  }
  const state = { ...f.load(), autonomousReview: { checkpoint: "awaiting_approval" } };
  assert.throws(() => validateStagedState(f.root, "refresh-policy", [{ path: "tracks/sample/state.json", absolutePath: "unused", content: JSON.stringify(state) }]), /invalid autonomousReview/);
  const seed = join(f.track, "learning.md"); write(seed, "# Missing metadata\n");
  for (const version of ["v3", "v4"]) {
    const path = join(f.root, ".cadre/project.json"), project = JSON.parse(readFileSync(path, "utf8")); project.templateSetVersion = version; write(path, project);
    assert.throws(() => requireFreshTrackMemory(f.root, "sample"), /memory|metadata|learning/i);
  }
});

test("published v3 template bytes remain immutable alongside v4", () => {
  const root = join(harness, "templates/v3"), hash = createHash("sha256");
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
  for (const path of files(root).sort()) { hash.update(relative(root, path)); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0"); }
  assert.equal(hash.digest("hex"), "2c94b0c74dd5ab9819b832c44427604f4ceab49ff292d6a3442a21c150414cb9");
});


test("Autonomous next steps route persisted recovery and block unsafe continuation", (t) => {
  const f = fixture(t);
  assert.equal(deriveNextStep(f.root, f.load()), null);
  f.start("routing", "autonomous");
  const active = f.load();
  assert.equal(deriveNextStep(f.root, active)?.skill, "implement");
  f.finish("routing");
  const reviewed = f.load();
  const route = deriveNextStep(f.root, reviewed)!;
  assert.deepEqual(nextStepSchema.parse(route), {
    action: "invoke_skill", plugin: "cadre", skill: "review", projectRoot: f.root, trackId: "sample",
    executionId: "routing", prerequisite: "implementation_bookkeeping_commit",
    reason: "Review the complete accumulated implementation in the same task."
  });
  for (const readiness of [{ errors: ["invalid graph"] }, { upgradeRequired: true }, { staleMemory: true }]) {
    assert.equal(deriveNextStep(f.root, reviewed, readiness)?.action, "blocked");
  }
  const remediation = structuredClone(reviewed);
  remediation.status = "in_progress";
  remediation.autonomousReview!.checkpoint = "remediating";
  remediation.autonomousReview!.findings = [{ id: "same-finding", summary: "Same cause across moved code", status: "open", attemptExecutionIds: ["fix-one"] }];
  assert.equal(deriveNextStep(f.root, remediation)?.skill, "implement");
  assert.equal(deriveNextStep(f.root, remediation)?.prerequisite, "review_bookkeeping_commit");
  remediation.operation = { action: "review", checkpoint: "promoting" };
  assert.equal(deriveNextStep(f.root, remediation)?.skill, "review", "partial promotion must finish in review");
  remediation.operation = null;
  remediation.autonomousReview!.findings[0]!.attemptExecutionIds.push("fix-two");
  assert.match(deriveNextStep(f.root, remediation)!.reason, /two remediation attempts/);
  remediation.autonomousReview!.checkpoint = "blocked";
  remediation.autonomousReview!.blocker = "Human-only verification unavailable";
  assert.match(deriveNextStep(f.root, remediation)!.reason, /Human-only verification unavailable/);
  const clean = structuredClone(reviewed);
  Object.assign(clean.autonomousReview!, { checkpoint: "awaiting_approval", reviewedExecutionId: "routing", reviewedHead: clean.lastExecution!.headCommit });
  assert.equal(deriveNextStep(f.root, clean)?.action, "await_approval");
  assert.equal(clean.status, "ready_for_review");
  clean.autonomousReview!.reviewedExecutionId = "stale";
  assert.equal(deriveNextStep(f.root, clean)?.action, "blocked");
  clean.status = "completed";
  assert.equal(deriveNextStep(f.root, clean), null);
  const altered = structuredClone(reviewed);
  altered.commits!.spec = "abcdef1";
  assert.equal(deriveNextStep(f.root, altered)?.action, "blocked");
  const legacy = structuredClone(reviewed);
  delete legacy.autonomousReview; delete legacy.lastExecution!.approvalPolicyVersion;
  assert.match(deriveNextStep(f.root, legacy)!.reason, /explicit Track or Autonomous choice/);
  const migration = { executionId: "routing", approvalMode: "track" as const, approvedAt: new Date().toISOString(), refreshPath: "refreshes/refresh-policy.md" };
  legacy.approvalModeMigration = migration;
  assert.equal(deriveNextStep(f.root, legacy), null);
  legacy.approvalModeMigration = { ...migration, approvalMode: "autonomous" };
  legacy.autonomousReview = reviewed.autonomousReview!;
  assert.equal(deriveNextStep(f.root, legacy)?.skill, "review");
  for (const mode of ["governed", "phase", "track"] as const) {
    const ordinary = structuredClone(reviewed);
    delete ordinary.autonomousReview; ordinary.lastExecution!.approvalMode = mode;
    assert.equal(deriveNextStep(f.root, ordinary), null, `${mode} retains its ordinary gates`);
  }
});

for (const name of ["codex", "claude-code", "zed"]) {
  test(`MCP next steps survive ${name} transport and resume without performing dispatch or completion`, async (t) => {
    const f = fixture(t);
    const server = createCadreServer(), client = new Client({ name, version: "2.1.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st); await client.connect(ct);
    t.after(async () => { await client.close(); await server.close(); });
    const call = async (tool: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name: tool, arguments: { projectRoot: f.root, trackId: "sample", ...args } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.equal(Boolean(result.structuredContent), name !== "zed");
      return (result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>).at(-1)!.text)) as Record<string, any>;
    };
    const planned = await call("project_status", { view: "implementation" });
    assert.equal(planned.execution, null);
    assert.deepEqual(await call("project_status", { view: "implementation", executionId: null }), planned);
    const invented = await client.callTool({ name: "project_status", arguments: { projectRoot: f.root, trackId: "sample", view: "implementation", executionId: "sample" } });
    assert.equal(invented.isError, true);
    f.start("handoff", "autonomous"); f.finish("handoff");
    const receipt = await call("execution_finish", { executionId: "handoff" });
    assert.equal(receipt.nextStep.skill, "review");
    assert.deepEqual((await call("project_status", { view: "implementation", executionId: null })).nextStep, receipt.nextStep);
    assert.equal(receipt.nextStep.prerequisite, "implementation_bookkeeping_commit");
    for (const view of ["track", "implementation"]) {
      for (const detail of ["summary", "full"]) {
        const status = await call("project_status", { view, detail });
        assert.deepEqual(status.nextStep, receipt.nextStep);
      }
    }
    assert.equal(f.load().reviewCycles!.length, 0);
    const clean = f.load();
    Object.assign(clean.autonomousReview!, { checkpoint: "awaiting_approval", reviewedExecutionId: "handoff", reviewedHead: clean.lastExecution!.headCommit });
    f.save(clean);
    const first = await call("project_status", { view: "track" });
    const resumed = await call("project_status", { view: "implementation" });
    assert.equal(first.nextStep.action, "await_approval");
    assert.deepEqual(resumed.nextStep, first.nextStep);
    assert.equal(f.load().status, "ready_for_review", "routing cannot supply final approval");
    const unchanged = readFileSync(join(f.track, "state.json"), "utf8");
    await call("project_status", { view: "track" });
    assert.equal(readFileSync(join(f.track, "state.json"), "utf8"), unchanged);
  });
}


test("Autonomous review journals reject native-client field drift before promotion", (t) => {
  const f = fixture(t); f.start("journal-shape", "autonomous"); f.finish("journal-shape");
  const state = f.load(), digest = "a".repeat(64);
  state.operation = { action: "review", checkpoint: "approved", baseCommit: state.lastExecution!.headCommit!,
    expectedCommit: "cadre(review): request changes for sample", approvedArtifacts: ["plan.md"],
    approvedArtifactHashes: [{ path: "plan.md", sha256: "b".repeat(64) }], artifactProgress: [],
    approvedAt: new Date().toISOString(), approvalDigest: digest,
    authorization: { kind: "persisted-mode", originExecutionId: "journal-shape", proposalDigest: digest } };
  const check = () => { const errors: string[] = []; validateTrackOperation(state, "sample", errors); validateTrackApprovalPolicy(state, errors); return errors; };
  assert.deepEqual(check(), []);
  assert.equal(deriveNextStep(f.root, state)?.skill, "review");
  state.operation.kind = "review"; state.operation.action = "request_changes";
  (state.operation as Record<string, unknown>).approvedArtifacts = [{ path: "plan.md", sha256: "b".repeat(64) }];
  const errors = check();
  assert.match(errors.join(";"), /relative path strings/);
  assert.match(errors.join(";"), /operation must use action/);
  assert.equal(deriveNextStep(f.root, state, { errors })?.action, "blocked");
  state.operation.action = "review"; state.operation.approvedArtifacts = ["plan.md"];
  assert.deepEqual(check(), []);
  assert.equal(deriveNextStep(f.root, state)?.skill, "review", "correcting metadata preserves the original review handoff");
});
