import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCadreServer } from "../../src/mcp/server.js";
import { previewProjectInitCandidate, applyProjectInitCandidate } from "../../src/domain/init.js";
import { previewCandidateApply, applyCandidate } from "../../src/domain/candidate-apply.js";
import { prepareCandidateStage } from "../../src/domain/staging.js";
import { dependencySources } from "../../src/domain/dependency-context.js";
import { reconcileOperation } from "../../src/domain/operation-receipts.js";
import { readExecution } from "../../src/domain/execution.js";

export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
export const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
export function write(root: string, path: string, body: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
export function commit(root: string, receipt: { operationId: string; trailers: string[] }) {
  git(root, "add", ".cadre"); git(root, "commit", "-m", receipt.operationId, "-m", receipt.trailers.join("\n"));
  reconcileOperation(root, receipt.operationId);
}
export function stage(root: string, workflow: "track" | "revise" | "refresh", files: Record<string, string>) {
  const candidate = { projectRoot: root, candidateId: `${workflow}-sample`, workflow, files: Object.keys(files) };
  prepareCandidateStage(root, candidate.candidateId, candidate.files);
  for (const [path, body] of Object.entries(files)) write(root, `.cadre/stage/${candidate.candidateId}/${path}`, body);
  return candidate;
}
export const originalPlan = "# Plan\n- Spec revision: 1\n- Plan revision: 1\n## Phase 1: Deliver\n- Phase dependencies: none\n- [ ] T1.1 First behavior\n  - Task dependencies: none\n  - Commit group: first\n- [ ] T1.2 User Manual Verification\n- Phase completion commit: pending\n## Phase 2: Track-level User Manual Verification\n- [ ] T2.1 User Manual Verification\n- Phase completion commit: pending\n";
export async function fixture(t: { after: (fn: () => void | Promise<void>) => void }, clientName = "codex") {
  const root = mkdtempSync(join(tmpdir(), "cadre-revision-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Revision Fixture"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "commit.gpgsign", "false");
  const stagedFiles = ["product.md", "guidelines.md", "tech-stack.md"];
  prepareCandidateStage(root, "create", stagedFiles);
  for (const file of stagedFiles) write(root, `.cadre/stage/create/${file}`, `# ${file}\nPreserve evidence.\n`);
  const init = { projectRoot: root, projectName: "Revision", context: "greenfield" as const, gitDisposition: "initialize" as const, baseCommit: null, approvedAt: "2026-10-06T00:00:00.000Z", stagedFiles, styleguideIds: ["project/styleguides/general"] };
  commit(root, applyProjectInitCandidate(init, previewProjectInitCandidate(init).digest).receipt!);
  const candidate = stage(root, "track", {
    "spec.md": "# Specification\n## Functional Requirements\nFirst behavior.\n## Non-Functional Requirements\nPreserve evidence.\n## Acceptance Criteria\nChecks pass.\n## Dependencies\nNone.\n## Additional Information\nNone.\n## Dependent-track impact\nNone.\n",
    "plan.md": originalPlan,
    "learning.md": '# Learning\n<!-- cadre:pattern-seed:start -->\n## Pattern Seed\n<!-- cadre:memory:start -->\n{"schemaVersion":1,"specRevision":1,"planRevision":1,"patterns":[]}\n<!-- cadre:memory:end -->\nNo applicable patterns.\n<!-- cadre:pattern-seed:end -->\n',
    "dependency-context.json": json({ schemaVersion: 1, specRevision: 1, planRevision: 1, dependencies: [], ...dependencySources(root, []), constraints: [] }),
    "state.json": json({ schemaVersion: 2, trackId: "sample", title: "Sample", type: "feature", status: "planned", checkpoint: "ready", revision: 1, dependencies: [], commits: {}, artifactProgress: [], operation: null, lastExecution: null, reviewCycles: [], history: [] })
  });
  commit(root, applyCandidate(candidate, previewCandidateApply(candidate).digest));
  const server = createCadreServer(), client = new Client({ name: clientName, version: "2.1.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return (result.structuredContent ?? JSON.parse((result.content as Array<{type: string; text?: string}>).find((item) => item.type === "text")!.text!)) as Record<string, any>;
  };
  return { root, call, load: () => JSON.parse(read(root, ".cadre/tracks/sample/state.json")) };
}
export function revisedFiles(root: string, state: Record<string, unknown>, productHead?: string) {
  const prefix = ".cadre/tracks/sample/";
  return {
    "state.json": json({ ...state, revision: 2 }),
    "spec.md": read(root, prefix + "spec.md").replace("First behavior.", "First and second behaviors."),
    "plan.md": originalPlan.replace("Spec revision: 1", "Spec revision: 2").replace("Plan revision: 1", "Plan revision: 2")
      .replace("- [ ] T1.1 First behavior", productHead ? `- [x] T1.1 First behavior <!-- commit: ${productHead} -->` : "- [ ] T1.1 First behavior")
      .replace("- [ ] T1.2 User Manual Verification", "- [ ] T1.2 Second behavior\n  - Task dependencies: T1.1\n  - Commit group: second\n- [ ] T1.3 User Manual Verification"),
    "learning.md": read(root, prefix + "learning.md").replace('"specRevision":1', '"specRevision":2').replace('"planRevision":1', '"planRevision":2'),
    "dependency-context.json": json({ ...JSON.parse(read(root, prefix + "dependency-context.json")), specRevision: 2, planRevision: 2 }),
    "revisions/revision-2.md": "# Revision 2\n- Previous track revision: 1\n- New track revision: 2\n- Previous spec revision: 1\n- New spec revision: 2\n- Previous plan revision: 1\n- New plan revision: 2\n## Requested change\nAdd second behavior, preserving the first.\n## Approval\nExplicit fixture approval of this exact digest.\n"
  };
}
export async function finishCurrent(root: string, call: (name: string, args: Record<string, unknown>) => Promise<Record<string, any>>, executionId: string, trackId = "sample") {
  const scope = { projectRoot: root, trackId, executionId }, journal = readExecution(root, trackId, executionId);
  const checkpoint = (nodeId: string, event: string, extra = {}) => call("execution_checkpoint", { scope: { ...scope, nodeId }, action: { event, ...extra } });
  for (const phase of Object.values(journal.nodes).filter((node) => node.kind === "phase" && node.status !== "completed")) {
    if (phase.status === "pending") await checkpoint(phase.id, "start");
    for (const node of Object.values(journal.nodes).filter((node) => node.phaseId === phase.id && node.kind !== "phase" && node.status !== "completed")) {
      if (node.kind === "task") {
        write(root, "second.txt", `${node.id}: second behavior\n`); git(root, "add", "second.txt"); git(root, "commit", "-m", "feat: second behavior");
        await checkpoint(node.id, "complete_group", { commit: git(root, "rev-parse", "HEAD"), tasks: [{ nodeId: node.id, verification: "Second behavior checked", authorization: "Explicit fixture approval", handoff: { decisions: [], failedApproaches: [], openQuestions: [], nextAction: "Review", sources: [] } }] });
      } else await checkpoint(node.id, "record_verification", { commit: git(root, "rev-parse", "HEAD"), verification: "Both behaviors checked", authorization: "Explicit fixture approval" });
    }
    await checkpoint(phase.id, "complete", { commit: git(root, "rev-parse", "HEAD"), verification: "Both behaviors checked", authorization: "Explicit fixture approval" });
  }
  commit(root, (await call("execution_finish", scope)).receipt);
}
