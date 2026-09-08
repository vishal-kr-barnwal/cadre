import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCadreServer } from "../src/mcp/server.js";
import { readContext } from "../src/domain/context.js";
import { contentHash, handoffSchema, inspectMemory, MEMORY_START, MEMORY_END, requireFreshTrackMemory } from "../src/domain/memory.js";
import { inspectStagedMemory } from "../src/domain/staged-memory.js";
import { validateStagedState } from "../src/domain/staged-state.js";
import { inspectOnce, inspectionMetrics } from "../src/domain/inspection.js";
import { reachableGitCommits } from "../src/domain/git.js";
import { parsePlanContent, validatePlanGraph } from "../src/domain/plan.js";
import { pageTracks, summarizeGraph } from "../src/domain/status-views.js";
import { validateProject, renderTracksPreview, writeTracks } from "../src/domain/state.js";
import { applyExecutionStart, previewExecutionStart, applyExecutionCheckpoint, previewExecutionCheckpoint, readExecution } from "../src/domain/execution.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(readFileSync(join(root, "test/context-baseline.json"), "utf8")) as { recordedCatalog: { totalBytes: number }; recordedAggregate: { responseBytes: number } };
const metadata = { schemaVersion: 1, specRevision: 1, planRevision: 1, patterns: [] as Array<{ path: string; sha256: string }> };
function learning(value = metadata) {
  return `# Learning\nCarry all dependency constraints.\n<!-- cadre:pattern-seed:start -->\n## Pattern Seed\n${MEMORY_START}\n${JSON.stringify(value)}\n${MEMORY_END}\nNo other pattern applies.\n<!-- cadre:pattern-seed:end -->\n`;
}
function write(path: string, body: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
function git(root: string, ...args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function fixture(t: { after: (fn: () => void) => void }, phases = 1, tasks = 1) {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-memory-"));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  cpSync(join(root, "templates/v4/init"), join(projectRoot, ".cadre"), { recursive: true });
  renameSync(join(projectRoot, ".cadre/gitignore.template"), join(projectRoot, ".cadre/.gitignore"));
  for (const file of ["workflow.md", "product.md", "guidelines.md", "tech-stack.md", "styleguides/general.md"]) write(join(projectRoot, ".cadre", file), `# ${file}\nRequired constraint: preserve approval and evidence.\n`);
  const base = join(projectRoot, ".cadre/tracks/sample");
  const parts = ["# Plan\n- Spec revision: 1\n- Plan revision: 1\n"];
  for (let phase = 1; phase <= phases; phase++) {
    parts.push(`## Phase ${phase}: Deliver ${phase}\n- Phase dependencies: none\n`);
    for (let task = 1; task <= tasks; task++) parts.push(`- [ ] T${phase}.${task} Implement behavior ${task}\n  - Task dependencies: none\n`);
    parts.push(`- [ ] T${phase}.${tasks + 1} User Manual Verification\n- Phase completion commit: pending\n`);
  }
  parts.push(`## Phase ${phases + 1}: Track-level User Manual Verification\n- [ ] T${phases + 1}.1 User Manual Verification\n- Phase completion commit: pending\n`);
  write(join(base, "plan.md"), parts.join("\n"));
  write(join(base, "spec.md"), "# Specification\n## Functional Requirements\nPreserve behavior.\n## Non-Functional Requirements\nPreserve evidence.\n## Acceptance Criteria\nResume correctly.\n## Dependencies\nNone.\n## Additional Information\nNone.\n## Dependent-track impact\nNone.\n");
  write(join(base, "learning.md"), learning() + Array.from({ length: phases }, (_, i) => `\n## Phase ${i + 1}: Deliver ${i + 1}\n${`Phase ${i + 1} decision with evidence.\n`.repeat(160)}`).join(""));
  const state = { schemaVersion: 1, trackId: "sample", title: "Sample", type: "feature", status: "planned", revision: 1,
    checkpoint: "ready", dependencies: [] as string[], commits: { spec: "1111111", plan: "1111111" }, artifactProgress: [], operation: null, lastExecution: null, reviewCycles: [], history: [] };
  const project = { schemaVersion: 1, runtimeVersion: "3.8.0", templateSetVersion: "v4", project: { name: "Memory fixture", context: "brownfield" },
    setup: { status: "completed", checkpoint: "completed", commit: "1111111", artifactProgress: [], operation: null }, lastRefresh: null, history: [] };
  write(join(base, "state.json"), JSON.stringify(state)); write(join(projectRoot, ".cadre/project.json"), JSON.stringify(project));
  git(projectRoot, "init", "-b", "main"); git(projectRoot, "config", "user.name", "Cadre Test"); git(projectRoot, "config", "user.email", "cadre@example.test"); git(projectRoot, "config", "commit.gpgsign", "false");
  git(projectRoot, "add", "."); git(projectRoot, "commit", "-m", "test: initial fixture");
  const head = git(projectRoot, "rev-parse", "HEAD"); state.commits = { spec: head, plan: head }; project.setup.commit = head;
  write(join(base, "state.json"), JSON.stringify(state)); write(join(projectRoot, ".cadre/project.json"), JSON.stringify(project));
  const preview = renderTracksPreview(projectRoot); writeTracks(projectRoot, preview.digest);
  return { projectRoot, base, state, project, head };
}
function archiveFixture(f: ReturnType<typeof fixture>, trackId: string) {
  const base = join(f.projectRoot, ".cadre/archive", trackId), executionId = `${trackId}-run`;
  const plan = `# Plan\n- Spec revision: 1\n- Plan revision: 1\n## Phase 1: Deliver\n- Phase dependencies: none\n- [x] T1.1 Deliver <!-- commit: ${f.head} -->\n  - Task dependencies: none\n- [x] T1.2 User Manual Verification <!-- commit: ${f.head} -->\n- Phase completion commit: \`${f.head}\`\n## Phase 2: Track-level User Manual Verification\n- [x] T2.1 User Manual Verification <!-- commit: ${f.head} -->\n- Phase completion commit: \`${f.head}\`\n`;
  const graph = parsePlanContent(plan, "archive-plan");
  const errors: string[] = []; validatePlanGraph("archive-plan", graph, "archived", errors); assert.deepEqual(errors, []);
  write(join(base, "plan.md"), plan);
  write(join(base, "spec.md"), readFileSync(join(f.base, "spec.md"), "utf8"));
  write(join(base, "learning.md"), learning() + `\n## Phase 1: Deliver\nDependency constraint from ${trackId}: do not repeat the failed polling approach.\n`);
  const journal = { schemaVersion: 1, executionId, trackId, status: "completed", checkpoint: "completed",
    requestedMode: "sequential", effectiveMode: "sequential", approvalMode: "phase", maxWorkers: 1,
    planRevision: 1, planCommit: f.head, graphDigest: graph.digest, baseCommit: f.head, headCommit: f.head,
    startedAt: "2026-09-01T00:00:00Z", completedAt: "2026-09-01T01:00:00Z",
    nodes: Object.fromEntries(graph.phases.flatMap((phase) => [
      { id: phase.id, kind: "phase", phaseId: phase.id, dependencies: phase.dependencies },
      ...phase.tasks.map((task) => ({ id: task.id, kind: task.manualVerification ? "manual-verification" : "task", phaseId: phase.id, dependencies: [...phase.dependencies, ...task.dependencies] }))
    ]).map((node) => [node.id, { ...node, status: "completed", workerId: null, worktreePath: null, branch: null,
      workerCommit: null, mergeCommit: null, verification: "passed", approval: "human verified", blocker: null }])) };
  write(join(base, "executions", `execution-${executionId}.json`), JSON.stringify(journal));
  write(join(base, "state.json"), JSON.stringify({ ...f.state, trackId, title: trackId, status: "archived", checkpoint: "archived",
    lastExecution: { executionId, journal: `executions/execution-${executionId}.json`, planRevision: 1, graphDigest: graph.digest, headCommit: f.head, completedAt: journal.completedAt, approvalMode: "phase" },
    reviewCycles: [{ outcome: "clean", executionId, planRevision: 1, graphDigest: graph.digest, reviewedHead: f.head }] }));
  return base;
}
async function connected(name: string) {
  const server = createCadreServer(), client = new Client({ name, version: "2.1.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function reviewFixture(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t), archived = archiveFixture(f, "reviewed");
  const base = join(f.projectRoot, ".cadre/tracks/reviewed");
  renameSync(archived, base);
  const state = JSON.parse(readFileSync(join(base, "state.json"), "utf8"));
  state.status = state.checkpoint = "ready_for_review"; state.reviewCycles = [];
  write(join(base, "state.json"), JSON.stringify(state));
  const journalPath = join(base, "executions/execution-reviewed-run.json"), journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.nodes["T1.1"].handoff = { decisions: ["Keep the transport boundary"], failedApproaches: [], openQuestions: [], nextAction: "Review integration behavior", sources: [] };
  write(journalPath, JSON.stringify(journal));
  const original = readFileSync(join(base, "plan.md"), "utf8");
  const plan = original.replace("Plan revision: 1", "Plan revision: 2") + `
## Phase 3: Remediate findings
- Phase dependencies: P2
- [ ] T3.1 Fix finding
  - Task dependencies: none
- [ ] T3.2 User Manual Verification
- Phase completion commit: pending
## Phase 4: Track-level User Manual Verification
- [ ] T4.1 User Manual Verification
- Phase completion commit: pending
`;
  git(f.projectRoot, "add", "."); git(f.projectRoot, "commit", "-m", "test: completed review baseline");
  state.commits.plan = git(f.projectRoot, "rev-parse", "HEAD");
  write(join(base, "state.json"), JSON.stringify(state));
  writeTracks(f.projectRoot, renderTracksPreview(f.projectRoot).digest);
  assert.deepEqual(validateProject(f.projectRoot).errors, []);
  const files = [
    { path: "plan.md", content: plan, absolutePath: "unused" },
    { path: "learning.md", content: learning({ ...metadata, planRevision: 2 }), absolutePath: "unused" },
    { path: "bugs/review-001.md", content: "# Finding\nRepair the reproduced defect.\n", absolutePath: "unused" }
  ];
  return { ...f, base, state, original, plan, files };
}

test("review remediation preserves historical gates and starts a replacement execution across MCP adapters", async (t) => {
  const f = reviewFixture(t), candidateId = "review-reviewed";
  const stateBefore = readFileSync(join(f.base, "state.json"), "utf8");
  const journalPath = join(f.base, "executions/execution-reviewed-run.json");
  const journalBefore = readFileSync(journalPath, "utf8");
  let digest: string | undefined;
  for (const name of ["codex_cli_rs", "claude-code", "zed"]) {
    const c = await connected(name);
    try {
      payload(await c.client.callTool({ name: "candidate_stage_prepare", arguments: { projectRoot: f.projectRoot, candidateId, expectedFiles: f.files.map((file) => file.path) } }));
      for (const file of f.files) write(join(f.projectRoot, ".cadre/stage", candidateId, file.path), file.content);
      const args = { projectRoot: f.projectRoot, candidateId, files: f.files.map((file) => file.path), planValidations: [{ path: "plan.md", targetStatus: "in_progress" }] };
      const result = payload(await c.client.callTool({ name: "candidate_inspect", arguments: args }));
      assert.equal(result.plans[0].valid, true); assert.equal(result.learning[0].valid, true);
      assert.deepEqual(result.plans[0].graph.phases[1].dependencies, ["P1"]);
      assert.deepEqual(result.plans[0].graph.phases[3].dependencies, ["P1", "P2", "P3"]);
      if (digest) assert.equal(result.digest, digest); else digest = result.digest;
      assert.equal(payload(await c.client.callTool({ name: "candidate_inspect", arguments: args })).digest, digest);
      const rejected = await c.client.callTool({ name: "candidate_inspect", arguments: { ...args, planValidations: [{ path: "plan.md", targetStatus: "ready_for_review" }] } });
      assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected.content), /pending task/);
    } finally { await c.close(); }
  }
  assert.equal(readFileSync(join(f.base, "state.json"), "utf8"), stateBefore);
  assert.equal(readFileSync(journalPath, "utf8"), journalBefore);
  // Simulate the already approved promotion in this disposable fixture, then exercise runtime start.
  for (const file of f.files) write(join(f.base, file.path), file.content);
  f.state.status = "in_progress"; f.state.checkpoint = "review-changes-requested"; f.state.revision = 2;
  write(join(f.base, "state.json"), JSON.stringify(f.state));
  git(f.projectRoot, "add", "."); git(f.projectRoot, "commit", "-m", "test: approved remediation");
  f.state.commits.plan = git(f.projectRoot, "rev-parse", "HEAD");
  write(join(f.base, "state.json"), JSON.stringify(f.state));
  writeTracks(f.projectRoot, renderTracksPreview(f.projectRoot).digest);
  assert.deepEqual(validateProject(f.projectRoot).errors, []);
  const context = readContext({ projectRoot: f.projectRoot, trackId: "reviewed", nodeId: "T3.1", maxBytes: 65536 });
  assert.equal(context.contextReady, true, JSON.stringify(context.errors));
  const evidence = context.excerpts.find((entry) => entry.format === "handoff" && entry.section === "T1.1")!;
  assert.equal(JSON.parse(evidence.content).historical, true);
  assert.match(evidence.content, /Keep the transport boundary/);
  const corrupted = JSON.parse(journalBefore); corrupted.graphDigest = "a".repeat(64);
  write(journalPath, JSON.stringify(corrupted));
  assert.equal(readContext({ projectRoot: f.projectRoot, trackId: "reviewed", nodeId: "T3.1", maxBytes: 65536 }).contextReady, false);
  write(journalPath, journalBefore);
  const start = { projectRoot: f.projectRoot, trackId: "reviewed", executionId: "remediation-2", requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: f.state.commits.plan, approvedAt: new Date().toISOString() };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  const journal = readExecution(f.projectRoot, "reviewed", "remediation-2");
  assert.equal(journal.nodes.P2!.status, "completed");
  assert.equal(journal.nodes["T2.1"]!.status, "completed");
  assert.equal(journal.nodes.P3!.status, "pending");
  assert.equal(journal.nodes.P4!.status, "pending");
  assert.deepEqual(journal.nodes.P2!.dependencies, ["P1"]);
  assert.equal(readFileSync(journalPath, "utf8"), journalBefore);
  assert.deepEqual(validateProject(f.projectRoot).errors, []);
});

test("staged lifecycle targets support revisions without bypassing state or execution validation", (t) => {
  const f = reviewFixture(t), target = [{ path: "plan.md", targetStatus: "in_progress" }];
  validateStagedState(f.projectRoot, "revise-reviewed", f.files, target);
  validateStagedState(f.projectRoot, "revise-reviewed", f.files, [{ path: "plan.md", targetStatus: "planned" }]);
  const nested = f.files.map((file) => ({ ...file, path: `tracks/reviewed/${file.path}` }));
  validateStagedState(f.projectRoot, "revise-other", nested, [{ path: "tracks/reviewed/plan.md", targetStatus: "in_progress" }]);
  assert.throws(() => validateStagedState(f.projectRoot, "review-reviewed", [...f.files,
    { path: "state.json", content: JSON.stringify(f.state), absolutePath: "unused" }], target), /conflicts with plan targetStatus/);
  assert.throws(() => validateStagedState(f.projectRoot, "review-reviewed", f.files.map((file) => file.path === "plan.md"
    ? { ...file, content: "- [ ] T9.1 Stray task before a phase\n" + file.content } : file), target), /task appears before a phase/);
  const journalPath = join(f.base, "executions/execution-reviewed-run.json"), journal = JSON.parse(readFileSync(journalPath, "utf8"));
  write(journalPath, JSON.stringify({ ...journal, graphDigest: "a".repeat(64) }));
  assert.throws(() => validateStagedState(f.projectRoot, "review-reviewed", f.files, target), /does not match/);
  write(journalPath, JSON.stringify(journal));
  write(join(f.base, "state.json"), JSON.stringify({ ...f.state, status: "completed" }));
  assert.throws(() => validateStagedState(f.projectRoot, "revise-reviewed", [...f.files,
    { path: "state.json", content: JSON.stringify({ ...f.state, status: "in_progress" }), absolutePath: "unused" }], target), /terminal tracks cannot be reopened/);
  const active = fixture(t);
  const start = { projectRoot: active.projectRoot, trackId: "sample", executionId: "active-run", requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: active.head, approvedAt: new Date().toISOString() };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  const changed = readFileSync(join(active.base, "plan.md"), "utf8").replace("Plan revision: 1", "Plan revision: 2");
  assert.throws(() => validateStagedState(active.projectRoot, "revise-sample", [{ path: "plan.md", content: changed, absolutePath: "unused" }], [{ path: "plan.md", targetStatus: "planned" }]), /does not match/);
  const drafting = fixture(t), proposedPlan = readFileSync(join(drafting.base, "plan.md"), "utf8");
  write(join(drafting.base, "state.json"), JSON.stringify({ ...drafting.state, status: "drafting-plan", commits: { ...drafting.state.commits, plan: null } }));
  rmSync(join(drafting.base, "plan.md"));
  const draft = [{ path: "plan.md", content: proposedPlan, absolutePath: "unused" }];
  validateStagedState(drafting.projectRoot, "track-sample", draft, [{ path: "plan.md", targetStatus: "planned" }]);
  write(join(drafting.base, "plan.md"), "- [ ] T9.1 malformed unapproved draft\n");
  validateStagedState(drafting.projectRoot, "track-sample", draft, [{ path: "plan.md", targetStatus: "planned" }]);
});

test("historical verification requires evidence, retains dependencies over repeated review, and rejects empty approved plans", (t) => {
  const f = reviewFixture(t);
  const inspect = (body: string) => { const errors: string[] = []; const graph = parsePlanContent(body, "plan.md", errors); validatePlanGraph("plan.md", graph, "in_progress", errors); return { graph, errors }; };
  assert.match(inspect(f.plan.replace(/- \[x\] T2.1.*\n/, "- [ ] T2.1 User Manual Verification\n")).errors.join(";"), /historical.*completed/);
  assert.match(inspect(f.plan.replace(`- Phase completion commit: \`${f.head}\`\n\n## Phase 3`, "- Phase completion commit: pending\n\n## Phase 3")).errors.join(";"), /historical.*provenance/);
  const completed = f.plan.replace(/- \[ \] (T\d+\.\d+) (.+)/g, `- [x] $1 $2 <!-- commit: ${f.head} -->`).replaceAll("Phase completion commit: pending", `Phase completion commit: \`${f.head}\``);
  const round3 = completed + f.plan.slice(f.plan.indexOf("## Phase 3:")).replaceAll("Phase 3:", "Phase 5:").replaceAll("Phase 4:", "Phase 6:").replaceAll("T3.", "T5.").replaceAll("T4.", "T6.").replace("dependencies: P2", "dependencies: P4");
  const result = inspect(round3); assert.deepEqual(result.errors, []);
  assert.deepEqual(result.graph.phases[1]!.dependencies, ["P1"]);
  assert.deepEqual(result.graph.phases[3]!.dependencies, ["P1", "P2", "P3"]);
  assert.deepEqual(result.graph.phases[5]!.dependencies, ["P1", "P2", "P3", "P4", "P5"]);
  assert.match(inspect("# Empty plan\n").errors.join(";"), /must contain phases/);
});
function payload(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, any> {
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return (result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>).at(-1)!.text)) as Record<string, any>;
}

test("v2 templates remain immutable alongside v4", () => {
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
  const hash = createHash("sha256"), base = join(root, "templates/v2");
  for (const path of files(base).sort()) { hash.update(relative(base, path)); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0"); }
  assert.equal(hash.digest("hex"), "0a7dcd63ec61848e975a20052fa8e66c2d6f8f9c70263e0a13ebd6965b9eb7f3");
});

test("memory distinguishes corruption, drift, and historical evidence", () => {
  const pattern = "Approved guidance", value = { ...metadata, patterns: [{ path: "patterns/safe.md", sha256: contentHash(pattern) }] };
  const input = { trackId: "sample", path: "learning.md", body: learning(value), graph: { specRevision: 1, planRevision: 1 }, required: true, historical: false, readPattern: () => pattern };
  assert.deepEqual(inspectMemory(input).stale, []);
  assert.equal(inspectMemory({ ...input, readPattern: () => "changed" }).stale.length, 1);
  assert.equal(inspectMemory({ ...input, readPattern: () => { throw new Error("missing"); } }).stale.length, 1);
  assert.equal(inspectMemory({ ...input, graph: { specRevision: 2, planRevision: 2 } }).stale.length, 1);
  assert.equal(inspectMemory({ ...input, historical: true, readPattern: () => "changed" }).stale.length, 0);
  assert.equal(inspectMemory({ ...input, body: learning().replace(MEMORY_START, "") }).errors.length, 1);
  assert.equal(inspectMemory({ ...input, body: learning({ ...value, patterns: [{ path: "patterns/../secret.md", sha256: contentHash(pattern) }] }) }).errors.length, 1);
});

test("handoffs persist atomically with checkpoints and do not authorize work", (t) => {
  const f = fixture(t);
  const start = { projectRoot: f.projectRoot, trackId: "sample", executionId: "run-1", requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: f.head, approvedAt: new Date().toISOString() };
  const preview = previewExecutionStart(start); applyExecutionStart(start, preview.digest);
  const checkpoint = (nodeId: string, action: Record<string, unknown>) => {
    const input = { projectRoot: f.projectRoot, trackId: "sample", executionId: "run-1", nodeId, ...action } as Parameters<typeof previewExecutionCheckpoint>[0];
    const p = previewExecutionCheckpoint(input); return applyExecutionCheckpoint(input, p.digest);
  };
  checkpoint("P1", { event: "start" }); checkpoint("T1.1", { event: "start" });
  const handoff = { decisions: ["Preserve API"], failedApproaches: ["Polling missed the event"], openQuestions: ["Retry timing"], nextAction: "Test event-driven retry", sources: [] };
  checkpoint("T1.1", { event: "block", blocker: "Need retry evidence", handoff });
  assert.deepEqual(readExecution(f.projectRoot, "sample", "run-1").nodes["T1.1"]!.handoff, handoff);
  checkpoint("T1.1", { event: "resume" }); checkpoint("T1.1", { event: "start" });
  assert.throws(() => checkpoint("T1.1", { event: "record_commit", commit: f.head, verification: "passed", handoff }), /authorization/);
  assert.throws(() => checkpoint("T1.1", { event: "block", blocker: "oversized", handoff: { ...handoff, nextAction: "x".repeat(8192) } }), /8 KiB/);
  assert.equal(readExecution(f.projectRoot, "sample", "run-1").nodes["T1.1"]!.status, "running");
  checkpoint("T1.1", { event: "record_commit", commit: f.head, verification: "passed", authorization: "approved phase mode", handoff });
  checkpoint("T1.1", { event: "complete" });
  assert.deepEqual(readExecution(f.projectRoot, "sample", "run-1").nodes["T1.1"]!.handoff, handoff);
  const context = readContext({ projectRoot: f.projectRoot, trackId: "sample", nodeId: "T1.1", maxBytes: 65536 });
  assert.ok(context.excerpts.some((excerpt) => excerpt.format === "handoff" && excerpt.content.includes("Polling missed")));
  assert.equal(handoffSchema.safeParse({ ...handoff, sources: [{ path: "../secret", sha256: "a".repeat(64) }] }).success, false);
});

test("context pagination preserves exact content, detects drift, and never reads unrelated archives", (t) => {
  const f = fixture(t, 10, 10), input = { projectRoot: f.projectRoot, trackId: "sample", nodeId: "T1.1", maxBytes: 4096 };
  let page = readContext(input), pages = 1;
  const excerpts = [...page.excerpts];
  while (!page.complete) { page = readContext({ ...input, cursor: page.nextCursor! }); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 4096); excerpts.push(...page.excerpts); pages++; assert.ok(pages < 100); }
  assert.ok(pages > 1);
  assert.equal(excerpts.filter((entry) => entry.path.endsWith("/spec.md")).map((entry) => entry.content).join(""), readFileSync(join(f.base, "spec.md"), "utf8"));
  assert.ok(excerpts.some((entry) => entry.content.includes("Phase 1 decision")));
  assert.ok(!excerpts.some((entry) => entry.content.includes("Phase 2 decision")));
  const before = readContext(input);
  write(join(f.projectRoot, ".cadre/archive/unrelated/spec.md"), "unrelated".repeat(100000));
  assert.deepEqual(readContext(input), before);
  write(join(f.base, "spec.md"), "Changed approved scope");
  assert.throws(() => readContext({ ...input, cursor: before.nextCursor! }), /restart context_read/);
  write(join(f.base, "learning.md"), learning() + "\n## Unclassified constraints\nNever drop me.\n");
  assert.ok(readContext({ ...input, maxBytes: 65536 }).excerpts.some((entry) => entry.content.includes("Never drop me")));
  rmSync(join(f.base, "spec.md")); symlinkSync(join(f.projectRoot, ".cadre/product.md"), join(f.base, "spec.md"));
  assert.throws(() => readContext(input), /symbolic link/);
});

test("staged memory validates the proposed overlay and binds canonical inputs", (t) => {
  const f = fixture(t), pattern = "old guidance", changed = "new guidance";
  write(join(f.projectRoot, ".cadre/patterns/safe.md"), pattern);
  const seed = learning({ ...metadata, patterns: [{ path: "patterns/safe.md", sha256: contentHash(pattern) }] });
  write(join(f.base, "learning.md"), seed);
  const candidate = (path: string, content: string) => ({ path, content, absolutePath: join(f.projectRoot, ".cadre/stage/proposed", path) });
  const inspected = inspectStagedMemory(f.projectRoot, "revise-sample", [candidate("learning.md", seed)]);
  assert.equal(inspected.learning[0]!.valid, true);
  assert.ok(inspected.inputs.some((input) => input.path === "patterns/safe.md"));
  const revised = readFileSync(join(f.base, "plan.md"), "utf8").replace("Plan revision: 1", "Plan revision: 2");
  assert.equal(inspectStagedMemory(f.projectRoot, "revise-sample", [candidate("plan.md", revised)]).learning[0]!.valid, false);
  write(join(f.base, "state.json"), JSON.stringify({ ...f.state, checkpoint: "approved-candidate" }));
  assert.deepEqual(inspectStagedMemory(f.projectRoot, "revise-sample", [candidate("learning.md", seed)]), inspected,
    "deterministic checkpoint bookkeeping must not invalidate an unchanged memory approval");
  assert.equal(inspectStagedMemory(f.projectRoot, "archive-proposed", [candidate("patterns/safe.md", changed)]).learning[0]!.valid, false);
  const updated = learning({ ...metadata, patterns: [{ path: "patterns/safe.md", sha256: contentHash(changed) }] });
  assert.equal(inspectStagedMemory(f.projectRoot, "archive-proposed", [candidate("patterns/safe.md", changed), candidate("tracks/sample/learning.md", updated)]).learning[0]!.valid, true);
  write(join(f.projectRoot, ".cadre/patterns/safe.md"), changed);
  assert.equal(validateProject(f.projectRoot).staleMemory.length, 1);
  assert.throws(() => requireFreshTrackMemory(f.projectRoot, "sample"), /Reassess/);
});

test("declared archived dependencies are retained while unrelated history is excluded and paginated", (t) => {
  const f = fixture(t);
  archiveFixture(f, "dependency");
  for (let index = 0; index < 100; index++) archiveFixture(f, `history-${index}`);
  f.state.dependencies = ["dependency"];
  write(join(f.base, "state.json"), JSON.stringify(f.state));
  const validation = validateProject(f.projectRoot);
  assert.deepEqual(validation.errors, []);
  const first = pageTracks(validation.tracks, { statuses: ["archived"], limit: 20 });
  assert.equal(first.listing.total, 101); assert.equal(first.tracks.length, 20);
  const second = pageTracks(validation.tracks, { statuses: ["archived"], limit: 20, cursor: first.listing.nextCursor! });
  assert.ok(!first.tracks.some((track) => second.tracks.some((other) => other.id === track.id)));
  assert.throws(() => pageTracks(validation.tracks.slice(1), { statuses: ["archived"], limit: 20, cursor: first.listing.nextCursor! }), /restart/);
  const page = readContext({ projectRoot: f.projectRoot, trackId: "sample", nodeId: "T1.1", maxBytes: 65536 });
  assert.ok(page.complete);
  assert.ok(page.excerpts.some((excerpt) => excerpt.content.includes("Dependency constraint from dependency")));
  assert.ok(!page.excerpts.some((excerpt) => excerpt.path.includes("history-")));
});

test("batched provenance preserves reachability and request reads cannot outlive validation", (t) => {
  const f = fixture(t), metrics = inspectionMetrics();
  const dangling = git(f.projectRoot, "commit-tree", `${f.head}^{tree}`, "-m", "unreachable evidence");
  const revisions = [f.head, f.head.slice(0, 7), "f".repeat(40), dangling];
  const found = inspectOnce(() => reachableGitCommits(f.projectRoot, revisions), metrics)!;
  assert.equal(found.get(f.head), true); assert.equal(found.get(f.head.slice(0, 7)), true);
  assert.equal(found.get("f".repeat(40)), false); assert.equal(found.get(dangling), false);
  assert.equal(metrics.gitProcesses, 3);
  const reads = inspectionMetrics(); assert.deepEqual(validateProject(f.projectRoot, reads).errors, []); assert.ok(reads.reusedReads > 0);
  write(join(f.base, "learning.md"), "broken"); assert.ok(validateProject(f.projectRoot).errors.some((error) => error.includes("Pattern Seed")));
});

test("MCP context and status preserve structured/text clients, filtering, and upgrade recovery", async (t) => {
  const f = fixture(t);
  for (const name of ["codex_cli_rs", "claude-code", "zed"]) {
    const c = await connected(name);
    try {
      const summary = payload(await c.client.callTool({ name: "project_status", arguments: { projectRoot: f.projectRoot, view: "implementation", trackId: "sample" } }));
      assert.equal(summary.detail, "summary"); assert.equal(summary.graph.graph.taskCount, 3); assert.equal(summary.state.history, undefined);
      const full = payload(await c.client.callTool({ name: "project_status", arguments: { projectRoot: f.projectRoot, view: "implementation", trackId: "sample", detail: "full" } }));
      assert.equal(full.graph.graph.phases.length, 2); assert.deepEqual(full.state.history, []);
      const listing = payload(await c.client.callTool({ name: "project_status", arguments: { projectRoot: f.projectRoot, statuses: ["archived"] } }));
      assert.equal(listing.counts.planned, 1); assert.equal(listing.listing.total, 0); assert.equal(listing.valid, true);
      assert.equal(payload(await c.client.callTool({ name: "context_read", arguments: { projectRoot: f.projectRoot, trackId: "sample" } })).complete, true);
    } finally { await c.close(); }
  }
  f.project.runtimeVersion = "3.6.0"; f.project.templateSetVersion = "v2";
  write(join(f.projectRoot, ".cadre/project.json"), JSON.stringify(f.project));
  const c = await connected("codex_cli_rs");
  try {
    assert.equal(payload(await c.client.callTool({ name: "project_status", arguments: { projectRoot: f.projectRoot } })).upgradeRequired, true);
    assert.equal((await c.client.callTool({ name: "execution_start", arguments: { projectRoot: f.projectRoot, trackId: "sample" } })).isError, true);
    payload(await c.client.callTool({ name: "candidate_stage_prepare", arguments: { projectRoot: f.projectRoot, candidateId: "refresh-memory" } }));
    payload(await c.client.callTool({ name: "tracks_render", arguments: { projectRoot: f.projectRoot } }));
  } finally { await c.close(); }
});

test("context efficiency benchmark retains constraints with at least 30 percent fewer bytes", async (t) => {
  for (const [phases, tasks] of [[1, 1], [10, 10]] as const) {
    const f = fixture(t, phases, tasks), graph = parsePlanContent(readFileSync(join(f.base, "plan.md"), "utf8"), "plan.md");
    // Baseline 3.6 behavior: implementation preflight graph plus required complete file reads.
    const c = await connected("codex_cli_rs");
    try {
      const args = { projectRoot: f.projectRoot, view: "implementation", trackId: "sample" };
      const full = payload(await c.client.callTool({ name: "project_status", arguments: { ...args, detail: "full" } }));
      const summary = payload(await c.client.callTool({ name: "project_status", arguments: args }));
      let page = readContext({ projectRoot: f.projectRoot, trackId: "sample", nodeId: "T1.1" });
      const excerpts = [...page.excerpts]; let contextBytes = Buffer.byteLength(JSON.stringify(page)), requestBytes = Buffer.byteLength(JSON.stringify(args));
      while (!page.complete) {
        const request = { projectRoot: f.projectRoot, trackId: "sample", nodeId: "T1.1", cursor: page.nextCursor! };
        requestBytes += Buffer.byteLength(JSON.stringify(request)); page = readContext(request); contextBytes += Buffer.byteLength(JSON.stringify(page)); excerpts.push(...page.excerpts);
      }
      const paths = new Set(excerpts.filter((entry) => entry.format === "source").map((entry) => entry.path));
      const baselineBytes = Buffer.byteLength(JSON.stringify(full)) + [...paths].reduce((bytes, path) => bytes + Buffer.byteLength(readFileSync(join(f.projectRoot, path))), 0);
      const optimizedBytes = Buffer.byteLength(JSON.stringify(summary)) + contextBytes + requestBytes;
      const metrics = inspectionMetrics(), started = performance.now(); validateProject(f.projectRoot, metrics);
      const catalog = await c.client.listTools();
      t.diagnostic(JSON.stringify({ phases, tasks: phases * tasks, baselineBytes, optimizedBytes, reduction: 1 - optimizedBytes / baselineBytes,
        graphBytes: Buffer.byteLength(JSON.stringify(graph)), graphSummaryBytes: Buffer.byteLength(JSON.stringify(summarizeGraph(graph))),
        catalogBytes: Buffer.byteLength(JSON.stringify(catalog)), catalogGrowthBytes: Buffer.byteLength(JSON.stringify(catalog)) - baseline.recordedCatalog.totalBytes, requestBytes, ...metrics, validationMs: performance.now() - started, actualTokens: null }));
      if (phases > 1) assert.ok(optimizedBytes <= baselineBytes * 0.7);
      assert.ok(excerpts.some((entry) => entry.content.includes("preserve approval and evidence")));
    } finally { await c.close(); }
  }
});

test("audit: linked pattern constraints cannot disappear and catalog citations are not patterns", (t) => {
  const f = fixture(t);
  for (const reference of ["[Strict](patterns/strict.md)", "[Strict][rule]\n[rule]: patterns/strict.md", "patterns/strict.md"]) {
    write(join(f.base, "learning.md"), learning().replace("No other pattern applies.", reference));
    const page = readContext({ projectRoot: f.projectRoot, trackId: "sample", maxBytes: 65536 });
    assert.ok(page.errors.some((error) => error.includes("patterns/strict.md")));
    assert.equal(page.contextReady, false);
  }
  write(join(f.base, "learning.md"), learning().replace("No other pattern applies.", "Catalog: `.cadre/patterns/index.md`; no applicable patterns."));
  assert.equal(readContext({ projectRoot: f.projectRoot, trackId: "sample", maxBytes: 65536 }).contextReady, true);
});

test("audit: fenced phase examples preserve all required phase text", (t) => {
  const f = fixture(t, 2, 1);
  for (const fence of ["```", "~~~~"]) {
    write(join(f.base, "learning.md"), learning() + `\n## Phase 1: Deliver\n${fence}md\n## Phase 2: EXAMPLE ONLY\n${fence}\nREQUIRED_AFTER_EXAMPLE\n## Phase 2: Deliver\nUNRELATED_PHASE\n`);
    const page = readContext({ projectRoot: f.projectRoot, trackId: "sample", nodeId: "T1.1", maxBytes: 65536 });
    assert.equal(page.contextReady, true);
    assert.ok(page.excerpts.some((entry) => entry.content.includes("REQUIRED_AFTER_EXAMPLE")));
    assert.ok(!page.excerpts.some((entry) => entry.content.includes("UNRELATED_PHASE")));
  }
});

test("audit: staged revert validates canonical learning and prevents lost journal bindings", async (t) => {
  const f = fixture(t), c = await connected("claude-code");
  const start = { projectRoot: f.projectRoot, trackId: "sample", executionId: "binding-test", requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: f.head, approvedAt: new Date().toISOString() };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  try {
    const changedPlan = readFileSync(join(f.base, "plan.md"), "utf8").replace("Plan revision: 1", "Plan revision: 2");
    const check = inspectStagedMemory(f.projectRoot, "revert-sample", [{ path: "plan.md", absolutePath: "unused", content: changedPlan }]);
    assert.equal(check.learning[0]!.valid, false);
    const state = JSON.parse(readFileSync(join(f.base, "state.json"), "utf8"));
    payload(await c.client.callTool({ name: "candidate_stage_prepare", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", expectedFiles: ["state.json"] } }));
    const lost = { ...state, operation: null, lastExecution: null };
    write(join(f.projectRoot, ".cadre/stage/revert-sample/state.json"), JSON.stringify(lost));
    const rejected = await c.client.callTool({ name: "candidate_inspect", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", files: ["state.json"] } });
    assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected.content), /orphaned/);
    write(join(f.base, "state.json"), JSON.stringify(lost));
    assert.ok(validateProject(f.projectRoot).errors.some((error) => error.includes("orphaned")));
    assert.equal(readContext({ projectRoot: f.projectRoot, trackId: "sample", maxBytes: 65536 }).contextReady, false);
    write(join(f.base, "state.json"), JSON.stringify(state));
    assert.deepEqual(validateProject(f.projectRoot).errors, []);
  } finally { await c.close(); }
});

test("audit: revision paths fail before approval and plan commit revision is verified", async (t) => {
  const f = fixture(t), c = await connected("codex_cli_rs");
  try {
    payload(await c.client.callTool({ name: "candidate_stage_prepare", arguments: { projectRoot: f.projectRoot, candidateId: "revise-sample", expectedFiles: ["revisions/invalid.md"] } }));
    write(join(f.projectRoot, ".cadre/stage/revise-sample/revisions/invalid.md"), "# Proposed revision\n");
    const rejected = await c.client.callTool({ name: "candidate_inspect", arguments: { projectRoot: f.projectRoot, candidateId: "revise-sample", files: ["revisions/invalid.md"] } });
    assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected.content), /revision-/);
    write(join(f.base, "plan.md"), readFileSync(join(f.base, "plan.md"), "utf8").replace("Plan revision: 1", "Plan revision: 2"));
    const start = { projectRoot: f.projectRoot, trackId: "sample", executionId: "revision-test", requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: f.head, approvedAt: new Date().toISOString() };
    assert.throws(() => previewExecutionStart(start), /does not match approved plan revision/);
  } finally { await c.close(); }
});

test("audit: archived execution reads and full project detail retain state and graphs", async (t) => {
  const f = fixture(t); archiveFixture(f, "dependency");
  const c = await connected("claude-code");
  try {
    const full = payload(await c.client.callTool({ name: "project_status", arguments: { projectRoot: f.projectRoot, detail: "full" } }));
    assert.equal(full.projectState.schemaVersion, 1);
    assert.ok(full.trackDetails.find((entry: any) => entry.trackId === "dependency").execution.nodes);
    const focused = payload(await c.client.callTool({ name: "project_status", arguments: { projectRoot: f.projectRoot, view: "implementation", trackId: "dependency" } }));
    assert.equal(focused.execution.execution.status, "completed");
  } finally { await c.close(); }
});

test("audit: retained source inventory reduces aggregate retrieval and resets on fresh resume", (t) => {
  const f = fixture(t, 10, 10);
  let known: Array<{ path: string; sha256: string; section: string; contentHash: string }> = [];
  let responseBytes = 0, requestBytes = 0, pages = 0;
  for (let phase = 1; phase <= 10; phase++) for (let task = 1; task <= 10; task++) {
    // A genuinely fresh session halfway through must reacquire every required source.
    if (phase === 6 && task === 1) known = [];
    const input = { projectRoot: f.projectRoot, trackId: "sample", nodeId: `T${phase}.${task}`, knownSources: known };
    let request: typeof input & { cursor?: string } = input;
    let page = readContext(request); const sections = new Map<string, { path: string; sha256: string; section: string; contentHash: string }>();
    for (;;) {
      requestBytes += Buffer.byteLength(JSON.stringify(request)); responseBytes += Buffer.byteLength(JSON.stringify(page)); pages++;
      for (const excerpt of page.excerpts) if (excerpt.sourceComplete) sections.set(`${excerpt.path}:${excerpt.section}`, excerpt);
      if (page.complete) break;
      request = { ...input, cursor: page.nextCursor! }; page = readContext(request);
    }
    assert.equal(page.contextReady, true);
    for (const { path, sha256, section, contentHash } of sections.values()) {
      known = known.filter((entry) => entry.path !== path || entry.section !== section);
      known.push({ path, sha256, section, contentHash });
    }
  }
  // Captured before these fixes using the identical 10x10 fixture and 16 KiB pages.
  const recordedResponseBytes = baseline.recordedAggregate.responseBytes;
  assert.ok(responseBytes + requestBytes < recordedResponseBytes * 0.7);
  t.diagnostic(JSON.stringify({ fixture: "100-node aggregate retrieval with cold resume", recordedResponseBytes, responseBytes, requestBytes, pages, actualTokens: null }));
  const input = { projectRoot: f.projectRoot, trackId: "sample", nodeId: "T10.10", knownSources: known, maxBytes: 4096 };
  const before = readContext(input);
  write(join(f.projectRoot, ".cadre/guidelines.md"), "Changed required instruction\n");
  const changed = readContext({ ...input, maxBytes: 65536 });
  assert.ok(changed.excerpts.some((entry) => entry.path.endsWith("guidelines.md") && !entry.reused && entry.content.includes("Changed required")));
  if (before.nextCursor) assert.throws(() => readContext({ ...input, cursor: before.nextCursor! }), /restart context_read/);
});

test("audit: staged journal-only changes validate against canonical state and plan", async (t) => {
  const f = fixture(t), c = await connected("codex");
  const start = { projectRoot: f.projectRoot, trackId: "sample", executionId: "overlay-run", requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: f.head, approvedAt: new Date().toISOString() };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  assert.throws(() => readExecution(f.projectRoot, "sample", "missing-audit"), /persisted executionId/);
  const path = "executions/execution-overlay-run.json";
  const journal = readExecution(f.projectRoot, "sample", "overlay-run");
  try {
    const prefixed = await c.client.callTool({ name: "candidate_stage_prepare", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", expectedFiles: [".cadre/tracks/sample/state.json"] } });
    assert.equal(prefixed.isError, true); assert.match(JSON.stringify(prefixed.content), /without a .cadre/);
    payload(await c.client.callTool({ name: "candidate_stage_prepare", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", expectedFiles: [path] } }));
    write(join(f.projectRoot, ".cadre/stage/revert-sample", path), JSON.stringify({ ...journal, graphDigest: "a".repeat(64) }));
    const response = await c.client.callTool({ name: "candidate_inspect", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", files: [path] } });
    assert.equal(response.isError, true); assert.match(JSON.stringify(response.content), /does not match/);
    write(join(f.projectRoot, ".cadre/stage/revert-sample", path), JSON.stringify(journal));
    payload(await c.client.callTool({ name: "candidate_inspect", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", files: [path] } }));
    const original = join(f.base, path), saved = `${original}.saved`;
    renameSync(original, saved); symlinkSync(saved, original);
    assert.ok(validateProject(f.projectRoot).errors.some((error) => error.includes("unsafe execution")));
  } finally { await c.close(); }
});

test("audit: completed refresh fingerprints validate committed evidence after later edits", (t) => {
  const f = fixture(t), refreshPath = "refreshes/refresh-audit.md", projectPath = "project.json";
  write(join(f.projectRoot, ".cadre", refreshPath), "# Refresh\nApproved fixture context.\n");
  git(f.projectRoot, "add", ".cadre"); git(f.projectRoot, "commit", "-m", "cadre(refresh): update project context");
  const commit = git(f.projectRoot, "rev-parse", "HEAD");
  const hashes = [refreshPath, projectPath].map((path) => ({ path, sha256: contentHash(readFileSync(join(f.projectRoot, ".cadre", path), "utf8")) }));
  const operation = { schemaVersion: 1, action: "refresh", operationId: "refresh-audit", status: "completed", checkpoint: "completed", baseCommit: f.head, expectedCommit: "cadre(refresh): update project context", refreshPath, approvedArtifacts: [refreshPath, projectPath], approvalDigest: "a".repeat(64), approvedArtifactHashes: hashes, artifactProgress: [refreshPath, projectPath], approvedAt: new Date().toISOString(), refreshCommit: commit };
  const operationPath = join(f.projectRoot, ".cadre/operations/refresh-audit.json");
  write(operationPath, JSON.stringify(operation));
  write(join(f.projectRoot, ".cadre/project.json"), JSON.stringify({ ...f.project, lastRefresh: { refreshPath, commit }, history: [{ action: "refresh", refreshPath, commit }] }));
  assert.deepEqual(validateProject(f.projectRoot).errors, []);
  write(join(f.projectRoot, ".cadre", refreshPath), "# Refresh\nLater approved edit; historical hash still addresses the artifact commit.\n");
  assert.deepEqual(validateProject(f.projectRoot).errors, []);
  operation.approvedArtifactHashes[0]!.sha256 = "b".repeat(64);
  write(operationPath, JSON.stringify(operation));
  assert.ok(validateProject(f.projectRoot).errors.some((error) => error.includes("committed approved artifact differs")));
});

test("audit: revert cannot erase checkpoint evidence without an exact durable snapshot", async (t) => {
  const f = fixture(t), c = await connected("claude-code");
  const start = { projectRoot: f.projectRoot, trackId: "sample", executionId: "preserve-run", requestedMode: "sequential" as const, effectiveMode: "sequential" as const, maxWorkers: 1, baseCommit: f.head, approvedAt: new Date().toISOString() };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  const path = "executions/execution-preserve-run.json", originalPath = join(f.base, path);
  const original = readExecution(f.projectRoot, "sample", "preserve-run");
  original.nodes["T1.1"]!.workerCommit = f.head; original.nodes["T1.1"]!.verification = "Original verified evidence";
  write(originalPath, JSON.stringify(original)); const before = readFileSync(originalPath, "utf8");
  const proposed = structuredClone(original); proposed.nodes["T1.1"]!.workerCommit = null; proposed.nodes["T1.1"]!.verification = null;
  const snapshot = "reverts/revert-task-execution-before.json";
  try {
    payload(await c.client.callTool({ name: "candidate_stage_prepare", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", expectedFiles: [path, snapshot] } }));
    write(join(f.projectRoot, ".cadre/stage/revert-sample", path), JSON.stringify(proposed));
    write(join(f.projectRoot, ".cadre/stage/revert-sample", snapshot), "{}");
    const request = { name: "candidate_inspect", arguments: { projectRoot: f.projectRoot, candidateId: "revert-sample", files: [path, snapshot] } };
    const rejected = await c.client.callTool(request); assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected.content), /exact original journal bytes/);
    write(join(f.projectRoot, ".cadre/stage/revert-sample", snapshot), before);
    payload(await c.client.callTool(request));
    assert.equal(readFileSync(originalPath, "utf8"), before);
  } finally { await c.close(); }
});
