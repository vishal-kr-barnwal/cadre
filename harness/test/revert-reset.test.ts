import assert from "node:assert/strict";
import test from "node:test";
import { requireRevertReset } from "../src/domain/revert-scope.js";
import { revertFixture } from "./helpers/revert-fixture.js";
import type { ExecutionJournal } from "../src/domain/execution.js";

test("reversal reset is limited to exact target and approved dependency consequences", async (t) => {
  const f = await revertFixture(t), before = JSON.parse(f.files["reverts/revert-task-execution-before.json"]!) as ExecutionJournal;
  const selected = new Set(["T1.1"]);
  requireRevertReset(before, f.reset, selected, "T1.1");
  const kept = structuredClone(f.reset); kept.nodes["T1.1"] = before.nodes["T1.1"]!;
  assert.throws(() => requireRevertReset(before, kept, selected, "T1.1"), /reset all delivered evidence/);
  const contract = {...f.reset, approvalMode: "track" as const};
  assert.throws(() => requireRevertReset(before, contract, selected, "T1.1"), /execution contract/);
  const handoff = structuredClone(f.reset); delete handoff.nodes["T1.1"]!.handoff;
  assert.throws(() => requireRevertReset(before, handoff, selected, "T1.1"), /worker and handoff evidence/);
  const independent = {...before.nodes["T1.1"]!, id: "T3.1", phaseId: "P3", dependencies: []};
  before.nodes[independent.id] = independent;
  const wrong = structuredClone(f.reset); wrong.nodes[independent.id] = {...independent, status: "pending", workerCommit: null, verification: null, approval: null};
  assert.throws(() => requireRevertReset(before, wrong, selected, "T1.1"), /outside its target\/dependency scope/);
  delete before.nodes[independent.id];
  const workerBefore = structuredClone(before); Object.assign(workerBefore.nodes["T1.1"]!, {workerId: "worker-original", workerHistory: ["worker-original"], branch: "cadre/old", worktreePath: "/old/owned/worker"});
  const workerAfter = structuredClone(f.reset); Object.assign(workerAfter.nodes["T1.1"]!, {workerId: null, workerHistory: ["worker-original"], branch: null, worktreePath: null});
  requireRevertReset(workerBefore, workerAfter, selected, "T1.1");
  workerAfter.nodes["T1.1"]!.workerHistory = [];
  assert.throws(() => requireRevertReset(workerBefore, workerAfter, selected, "T1.1"), /worker history/);
});
