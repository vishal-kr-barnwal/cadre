#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const esbuild = require("esbuild");

const harnessRoot = path.resolve(__dirname, "..");
// Keep source bundles below the harness so packaged-template discovery exercises
// the same assets as the generated runtime while leaving no persistent output.
const bundleRoot = fs.mkdtempSync(path.join(harnessRoot, ".phased-contracts-"));

function loadSource(name, entry) {
  const outfile = path.join(bundleRoot, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(harnessRoot, "src", ...entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "silent",
  });
  return require(outfile);
}

const core = loadSource("workflow-packet", ["core", "application", "api.ts"]);
const commitTraceRuntime = loadSource("commit-trace", ["core", "application", "runtime", "commit-trace.ts"]);
const lockingRuntime = loadSource("locking", ["core", "infrastructure", "runtime", "locking.ts"]);
const { trackPacket } = loadSource("track-packet", ["mcp", "application", "packets", "track.ts"]);
const { parseWorkflowToolRequest, workflowRuntimeArgs } = loadSource(
  "workflow-tool-requests",
  ["mcp", "application", "tool-requests.ts"],
);

test.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function git(root, args) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (args[0] === "init") {
    spawnSync("git", ["config", "user.name", "Cadre Contract Tests"], { cwd: root });
    spawnSync("git", ["config", "user.email", "cadre-contracts@example.invalid"], { cwd: root });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  }
  return result;
}

function withRoot(prefix, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    git(root, ["init"]);
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function approvalStamp(approval) {
  assert.match(approval.current_stage_hash, /^[a-f0-9]{64}$/);
  assert.equal(Number.isSafeInteger(approval.current_stage_revision), true);
  return {
    approvalStageHash: approval.current_stage_hash,
    approvalStageRevision: approval.current_stage_revision,
  };
}

function approveCurrent(root, workflow, response) {
  const approval = response.approval;
  const stage = approval.current_stage;
  return core.workflowPacket(root, {
    workflow,
    approvalSessionId: approval.session_id,
    approvalStage: stage,
    ...approvalStamp(approval),
    approvedStages: [...approval.approved_stages, stage],
  });
}

function sampleSpec(trackId, overrides = {}) {
  return {
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: trackId,
    title: `Spec: ${trackId}`,
    description: `Deliver ${trackId} through an ordered, reviewable workflow.`,
    functional_requirements: [{ heading: "Behavior", body: "Implement the reviewed behavior." }],
    non_functional_requirements: [],
    acceptance_criteria: [{ heading: "Verified", body: "Focused tests prove the behavior." }],
    out_of_scope: [{ heading: "Unrelated work", body: "Do not change unrelated behavior." }],
    ...overrides,
  };
}

function samplePlan(trackId) {
  return {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: trackId,
    title: `Plan: ${trackId}`,
    phases: [{
      phase_index: 1,
      title: "Phase 1: Build",
      execution_mode: "sequential",
      depends_on: [],
      tasks: [{
        task_index: 1,
        task_key: "phase1_task1",
        title: "Implement the change",
        status: "pending",
        files: ["src/change.js"],
        depends_on: [],
        commit_shas: [],
        repo_shas: {},
      }],
    }],
  };
}

function setupInput(overrides = {}) {
  return {
    workflow: "setup",
    providerMode: "local",
    syncMode: "local",
    writeLsp: false,
    styleGuideIds: [],
    integrations: {},
    product: {
      title: "Rewind Product",
      summary: "A product whose setup stages can be safely reopened.",
    },
    productGuidelines: {
      title: "Product Guidelines",
      summary: "Preserve explicit evidence and ordered review.",
    },
    techStack: { languages: ["TypeScript"], runtimes: ["Node.js 20"] },
    workflowPolicy: {
      title: "Project Workflow",
      summary: "Review each stage and run focused validation.",
    },
    ...overrides,
  };
}

function advanceSetupToTechnical(root, overrides = {}) {
  let response = core.workflowPacket(root, setupInput(overrides));
  assert.equal(response.ok, true, response.error);
  assert.equal(response.approval.current_stage, "product");
  response = approveCurrent(root, "setup", response);
  assert.equal(response.ok, true, response.error);
  assert.equal(response.approval.current_stage, "product_guidelines");
  response = approveCurrent(root, "setup", response);
  assert.equal(response.ok, true, response.error);
  assert.equal(response.approval.current_stage, "technical");
  return response;
}

function stageRevision(approval, stageId) {
  return approval.stages.find((stage) => stage.id === stageId)?.revision;
}

function stageHash(approval, stageId) {
  return approval.stages.find((stage) => stage.id === stageId)?.hash;
}

function invokeWorkflowCall(root, call) {
  assert.equal(call.tool, "cadre_workflow");
  const parsed = parseWorkflowToolRequest(call.arguments);
  assert.deepEqual(parsed, call.arguments);
  const runtime = workflowRuntimeArgs(parsed);
  assert.equal(runtime.root, root);
  return core.workflowPacketV1(root, runtime);
}

function collisionRestartCall(root, sessionId) {
  return {
    tool: "cadre_workflow",
    arguments: {
      root,
      workflow: "newtrack",
      input: {},
      execute: false,
      approval: { session_id: sessionId, restart: true },
    },
  };
}

function holdLiveLock(root, name) {
  const safe = name.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "lock";
  const directory = path.join(root, "cadre", ".locks", `${safe}.lock`);
  write(path.join(directory, "owner.json"), `${JSON.stringify({
    name,
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`);
  return directory;
}

function treeFingerprint(directory) {
  const digest = crypto.createHash("sha256");
  const visit = (current, relative) => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        digest.update(`D\0${childRelative}\0`);
        visit(child, childRelative);
      } else {
        const content = fs.readFileSync(child);
        digest.update(`F\0${childRelative}\0${content.length}\0`);
        digest.update(content);
      }
    }
  };
  visit(directory, "");
  return digest.digest("hex");
}

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSemanticValues(markdown, values) {
  for (const value of values) assert.match(markdown, new RegExp(escaped(value)));
}

function assertReviewSet(root, packet, stage, expectedPaths = null) {
  assert.equal(packet.decision.kind, "approval");
  assert.equal(packet.decision.stage, stage);
  const reviewSet = packet.decision.review_set;
  assert.equal(reviewSet.version, 1);
  assert.equal(reviewSet.schema, "cadre.review_set.v1");
  assert.equal(reviewSet.workflow, packet.workflow);
  assert.equal(reviewSet.session_id, packet.decision.session_id);
  assert.equal(reviewSet.stage, stage);
  assert.equal(reviewSet.stage_hash, packet.decision.stage_hash);
  assert.equal(reviewSet.stage_revision, packet.decision.stage_revision);
  assert.equal(reviewSet.complete, true);
  assert.equal(reviewSet.truncated, false);
  assert.equal(reviewSet.file_count, reviewSet.files.length);
  assert.equal(new Set(reviewSet.files.map((file) => file.path)).size, reviewSet.files.length);
  if (expectedPaths) assert.deepEqual(reviewSet.files.map((file) => file.path).sort(), [...expectedPaths].sort());
  for (const file of reviewSet.files) {
    const content = fs.readFileSync(path.join(root, file.path), "utf8").replace(/\n*$/, "\n");
    assert.equal(file.bytes, Buffer.byteLength(content, "utf8"), file.path);
    assert.equal(file.lines, content.split("\n").length - 1, file.path);
    assert.equal(file.sha256, crypto.createHash("sha256").update(content).digest("hex"), file.path);
  }
  return reviewSet;
}

test("public workflow parser accepts typed reopen and restart controls outside input", () => {
  const request = {
    root: "/project",
    workflow: "setup",
    input: {},
    execute: false,
    approval: {
      session_id: "0123456789abcdef01234567",
      reopen_stage: "product",
    },
  };
  assert.deepEqual(parseWorkflowToolRequest(request), request);
  assert.equal(workflowRuntimeArgs(request).approvalReopenStage, "product");

  const restart = structuredClone(request);
  restart.workflow = "newtrack";
  restart.approval = { session_id: request.approval.session_id, restart: true };
  assert.deepEqual(parseWorkflowToolRequest(restart), restart);
  assert.equal(workflowRuntimeArgs(restart).approvalRestart, true);

  assert.throws(() => parseWorkflowToolRequest({
    ...request,
    input: { approvalReopenStage: "product" },
  }), /reserved control fields: approvalReopenStage/);
});

test("setup reopens, amends, and reapproves the dependent chain in order", () => withRoot(
  "cadre-setup-reopen-contract-",
  (root) => {
    const technical = advanceSetupToTechnical(root);
    const sessionId = technical.approval.session_id;
    const previousRevisions = Object.fromEntries(
      ["product", "product_guidelines", "technical", "workflow"]
        .map((stage) => [stage, stageRevision(technical.approval, stage)]),
    );
    const packet = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    assert.ok(Array.isArray(packet.decision.reopen), JSON.stringify(packet.decision));
    const productReopen = packet.decision.reopen.find((option) => option.stage === "product");
    assert.deepEqual(productReopen, {
      stage: "product",
      call: {
        tool: "cadre_workflow",
        arguments: {
          root,
          workflow: "setup",
          input: {},
          execute: false,
          approval: { session_id: sessionId, reopen_stage: "product" },
        },
      },
    });

    const reopenedPacket = invokeWorkflowCall(root, productReopen.call);
    assert.equal(reopenedPacket.ok, true, reopenedPacket.errors.join("\n"));
    assert.equal(reopenedPacket.decision.session_id, sessionId);
    assert.equal(reopenedPacket.decision.stage, "product");
    assert.deepEqual(reopenedPacket.decision.approved_stages, []);
    assert.ok(reopenedPacket.decision.stage_revision > previousRevisions.product);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), true);
    for (const file of [
      "product_guidelines.json",
      "product_guidelines.md",
      "tech-stack.json",
      "tech-stack.md",
      "lsp.json",
      "workflow.json",
      "workflow.md",
    ]) assert.equal(fs.existsSync(path.join(root, "cadre", file)), false, file);

    let session = readJson(
      path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`),
    );
    assert.deepEqual(session.approved_stages, []);
    for (const stage of ["product_guidelines", "technical", "workflow"]) {
      assert.deepEqual(session.stage_records[stage].snapshot_files, [], stage);
      assert.deepEqual(session.stage_records[stage].preview_files, [], stage);
    }

    const reopenedStamp = {
      approvalStageHash: reopenedPacket.decision.stage_hash,
      approvalStageRevision: reopenedPacket.decision.stage_revision,
    };
    let response = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      product: {
        title: "Revised Product",
        summary: "The upstream product changed and every dependent stage must be reviewed again.",
      },
    });
    assert.equal(response.ok, true, response.error);
    assert.equal(response.approval.current_stage, "product");
    assert.match(fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8"), /Revised Product/);
    assert.ok(response.approval.current_stage_revision > reopenedStamp.approvalStageRevision);

    const stale = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product",
      ...reopenedStamp,
      approvedStages: ["product"],
    });
    assert.equal(stale.ok, false);
    assert.match(stale.error, /approvalStage(?:Hash|Revision).*reviewed product stage/i);
    assert.deepEqual(stale.approval.approved_stages, []);

    response = approveCurrent(root, "setup", response);
    assert.equal(response.approval.current_stage, "product_guidelines");
    assert.deepEqual(response.approval.approved_stages, ["product"]);
    assert.ok(response.approval.current_stage_revision > previousRevisions.product_guidelines);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.json")), false);

    response = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      productGuidelines: {
        title: "Revised Product Guidelines",
        summary: "Guidelines revised after the product changed.",
      },
    });
    response = approveCurrent(root, "setup", response);
    assert.equal(response.approval.current_stage, "technical");
    assert.deepEqual(response.approval.approved_stages, ["product", "product_guidelines"]);
    assert.ok(response.approval.current_stage_revision > previousRevisions.technical);
    assert.equal(fs.existsSync(path.join(root, "cadre", "workflow.json")), false);

    response = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      techStack: { languages: ["TypeScript revised"], runtimes: ["Node.js revised"] },
    });
    response = approveCurrent(root, "setup", response);
    assert.equal(response.approval.current_stage, "workflow");
    assert.deepEqual(response.approval.approved_stages, ["product", "product_guidelines", "technical"]);
    assert.ok(response.approval.current_stage_revision > previousRevisions.workflow);

    response = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      workflowPolicy: {
        title: "Revised Workflow",
        summary: "Workflow reviewed after product, guidelines, and technical context.",
      },
    });
    response = approveCurrent(root, "setup", response);
    assert.deepEqual(response.approval.approved_stages, ["product", "product_guidelines", "technical", "workflow"]);
    assert.equal(response.approval.current_stage, null);
    const readyPacket = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    assert.equal(readyPacket.decision.kind, "ready");
    assert.equal(readyPacket.decision.review_set.schema, "cadre.review_set.collection.v1");
    assert.equal(readyPacket.decision.review_set.complete, true);
    assert.equal(readyPacket.decision.review_set.truncated, false);
    assert.deepEqual(
      readyPacket.decision.review_set.stages.map((stage) => stage.id),
      ["product", "product_guidelines", "technical", "workflow"],
    );
    assert.ok(readyPacket.decision.review_set.files.some((file) => file.path === "cadre/tech-stack.md"));
    assert.deepEqual(
      readyPacket.decision.reopen.map((option) => option.stage),
      ["product", "product_guidelines", "technical", "workflow"],
    );
    session = readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`));
    assert.deepEqual(session.approved_stages, ["product", "product_guidelines", "technical", "workflow"]);
  },
));

test("setup reopens its final approved stage without discarding the approved prefix", () => withRoot(
  "cadre-setup-final-reopen-contract-",
  (root) => {
    let response = advanceSetupToTechnical(root);
    const sessionId = response.approval.session_id;
    response = approveCurrent(root, "setup", response);
    response = approveCurrent(root, "setup", response);
    assert.equal(response.approval.current_stage, null);
    const previousWorkflowRevision = stageRevision(response.approval, "workflow");

    const ready = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    const reopen = ready.decision.reopen.find((option) => option.stage === "workflow");
    const reopened = invokeWorkflowCall(root, reopen.call);
    assert.equal(reopened.ok, true, reopened.errors.join("\n"));
    assert.equal(reopened.decision.stage, "workflow");
    assert.deepEqual(reopened.decision.approved_stages, ["product", "product_guidelines", "technical"]);
    assert.ok(reopened.decision.stage_revision > previousWorkflowRevision);
    assertReviewSet(root, reopened, "workflow", ["cadre/workflow.json", "cadre/workflow.md"]);
    for (const file of ["product.json", "product_guidelines.json", "tech-stack.json"]) {
      assert.equal(fs.existsSync(path.join(root, "cadre", file)), true, file);
    }
    const session = readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`));
    assert.equal(session.stage_records.workflow.status, "previewed");
    assert.deepEqual(session.approved_stages, ["product", "product_guidelines", "technical"]);
  },
));

test("setup reopen removes invalidated files from an explicit review bundle and its manifest", () => withRoot(
  "cadre-setup-bundle-reopen-contract-",
  (root) => {
    const reviewDirectory = path.join(root, ".setup-review");
    const technical = advanceSetupToTechnical(root, { reviewBundleDir: reviewDirectory });
    const sessionId = technical.approval.session_id;
    for (const file of ["product.json", "product_guidelines.json", "tech-stack.json"]) {
      assert.equal(fs.existsSync(path.join(reviewDirectory, "cadre", file)), true, file);
    }

    const packet = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    const reopen = packet.decision.reopen.find((option) => option.stage === "product");
    const reopened = invokeWorkflowCall(root, reopen.call);
    assert.equal(reopened.ok, true, reopened.errors.join("\n"));
    assert.equal(reopened.decision.stage, "product");
    assert.equal(fs.existsSync(path.join(reviewDirectory, "cadre", "product.json")), true);
    for (const file of [
      "product_guidelines.json",
      "product_guidelines.md",
      "tech-stack.json",
      "tech-stack.md",
      "styleguides/index.json",
      "styleguides/README.md",
      "workflow.json",
      "workflow.md",
    ]) assert.equal(fs.existsSync(path.join(reviewDirectory, "cadre", file)), false, file);
    const manifestPaths = readJson(path.join(reviewDirectory, "manifest.json")).files.map((file) => file.path);
    assert.ok(manifestPaths.includes("cadre/product.json"));
    assert.equal(manifestPaths.some((file) => file.startsWith("cadre/product_guidelines")), false);
    assert.equal(manifestPaths.some((file) => file.startsWith("cadre/tech-stack")), false);
    assert.equal(manifestPaths.some((file) => file.startsWith("cadre/styleguides/")), false);
  },
));

test("setup keeps prior stages in its default temporary bundle so an earlier stage can reopen", () => withRoot(
  "cadre-setup-temp-bundle-reopen-contract-",
  (root) => {
    const technical = advanceSetupToTechnical(root, { reviewOutputMode: "bundle" });
    const sessionId = technical.approval.session_id;
    const reviewDirectory = technical.review_bundle.directory;
    assert.equal(path.isAbsolute(reviewDirectory), true);
    for (const file of ["product.json", "product_guidelines.json", "tech-stack.json"]) {
      assert.equal(fs.existsSync(path.join(reviewDirectory, "cadre", file)), true, file);
    }

    const packet = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    const reopen = packet.decision.reopen.find((option) => option.stage === "product");
    const reopened = invokeWorkflowCall(root, reopen.call);
    assert.equal(reopened.ok, true, reopened.errors.join("\n"));
    assert.equal(reopened.decision.stage, "product");
    assert.equal(fs.existsSync(path.join(reviewDirectory, "cadre", "product.json")), true);
    for (const file of [
      "product_guidelines.json",
      "product_guidelines.md",
      "tech-stack.json",
      "tech-stack.md",
      "styleguides/index.json",
      "styleguides/README.md",
    ]) assert.equal(fs.existsSync(path.join(reviewDirectory, "cadre", file)), false, file);
    const manifestPaths = readJson(path.join(reviewDirectory, "manifest.json")).files.map((file) => file.path);
    assert.deepEqual(manifestPaths.sort(), ["cadre/product.json", "cadre/product.md"].sort());
  },
));

test("newtrack reopens and reapproves spec before its regenerated plan", () => withRoot(
  "cadre-newtrack-reopen-contract-",
  (root) => {
    const trackId = "rewind-track";
    let response = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    assert.equal(response.ok, true, response.error);
    response = approveCurrent(root, "newtrack", response);
    assert.equal(response.approval.current_stage, "plan");
    const planClarification = core.workflowPacketV1(root, {
      workflow: "newtrack",
      approvalSessionId: response.approval.session_id,
    });
    assert.equal(planClarification.decision.kind, "clarification");
    assert.deepEqual(planClarification.decision.reopen.map((option) => option.stage), ["spec"]);
    response = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: response.approval.session_id,
      plan: samplePlan(trackId),
    });
    assert.equal(response.ok, true, response.error);
    const sessionId = response.approval.session_id;
    const priorSpecRevision = stageRevision(response.approval, "spec");
    const priorPlanRevision = stageRevision(response.approval, "plan");
    const priorPlanStamp = approvalStamp(response.approval);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), true);

    const planPacket = core.workflowPacketV1(root, { workflow: "newtrack", approvalSessionId: sessionId });
    assert.ok(Array.isArray(planPacket.decision.reopen), JSON.stringify(planPacket.decision));
    const specReopen = planPacket.decision.reopen.find((option) => option.stage === "spec");
    const reopenedPacket = invokeWorkflowCall(root, specReopen.call);
    assert.equal(reopenedPacket.ok, true, reopenedPacket.errors.join("\n"));
    assert.equal(reopenedPacket.data.track_id, trackId);
    assert.equal(reopenedPacket.decision.session_id, sessionId);
    assert.equal(reopenedPacket.decision.stage, "spec");
    assert.deepEqual(reopenedPacket.decision.approved_stages, []);
    assert.ok(reopenedPacket.decision.stage_revision > priorSpecRevision);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "spec.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", `${trackId}-revised`)), false);

    const reopenedStamp = {
      approvalStageHash: reopenedPacket.decision.stage_hash,
      approvalStageRevision: reopenedPacket.decision.stage_revision,
    };
    response = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      spec: sampleSpec(trackId, {
        description: "This revised specification invalidates and regenerates the dependent plan.",
      }),
    });
    assert.equal(response.ok, true, response.error);
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "spec.json"), "utf8"), /revised specification/);

    const staleSpec = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalStage: "spec",
      ...reopenedStamp,
      approvedStages: ["spec"],
    });
    assert.equal(staleSpec.ok, false);
    assert.match(staleSpec.error, /approvalStage(?:Hash|Revision).*reviewed spec stage/i);

    response = approveCurrent(root, "newtrack", response);
    assert.equal(response.approval.current_stage, "plan");
    assert.deepEqual(response.approval.approved_stages, ["spec"]);
    assert.ok(response.approval.current_stage_revision > priorPlanRevision);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), true);

    const stalePlan = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalStage: "plan",
      ...priorPlanStamp,
      approvedStages: ["spec", "plan"],
    });
    assert.equal(stalePlan.ok, false);
    assert.match(stalePlan.error, /approvalStage(?:Hash|Revision).*reviewed.*plan/i);
    response = approveCurrent(root, "newtrack", response);
    assert.deepEqual(response.approval.approved_stages, ["spec", "plan"]);
    assert.equal(response.approval.current_stage, null);
  },
));

test("newtrack collision exposes an exact typed restart that resets the owned draft in place", () => withRoot(
  "cadre-newtrack-restart-contract-",
  (root) => {
    const trackId = "bootstrap-foundation";
    let preview = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    preview = approveCurrent(root, "newtrack", preview);
    preview = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: preview.approval.session_id,
      plan: samplePlan(trackId),
    });
    assert.equal(preview.ok, true, preview.error);
    const sessionId = preview.approval.session_id;
    const priorSpecRevision = stageRevision(preview.approval, "spec");
    const priorPlanRevision = stageRevision(preview.approval, "plan");
    write(path.join(root, "cadre", "tracks.json"), `${JSON.stringify({
      version: 1,
      schema: "cadre.tracks_index.v1",
      counts: { new: 1, in_progress: 0, completed: 0, blocked: 0, skipped: 0 },
      tracks: [{ track_id: trackId, status: "new" }],
    }, null, 2)}\n`);
    write(path.join(root, "cadre", "events.jsonl"), [
      JSON.stringify({ schema: "cadre.event.v1", kind: "unrelated", track_id: "other-track" }),
      JSON.stringify({
        schema: "cadre.event.v1",
        kind: "track_created",
        track_id: trackId,
        approval_session_id: sessionId,
      }),
      "",
    ].join("\n"));

    const lockOwner = `${JSON.stringify({
      name: "contract-lock",
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, null, 2)}\n`;
    const indexBeforeBlockedRestart = fs.readFileSync(path.join(root, "cadre", "tracks.json"), "utf8");
    const eventsBeforeBlockedRestart = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8");
    const tracksLock = path.join(root, "cadre", ".locks", "tracks-index.lock");
    write(path.join(tracksLock, "owner.json"), lockOwner);
    const indexLocked = invokeWorkflowCall(root, collisionRestartCall(root, sessionId));
    assert.equal(indexLocked.ok, false);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tracks.json"), "utf8"), indexBeforeBlockedRestart);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8"), eventsBeforeBlockedRestart);
    fs.rmSync(tracksLock, { recursive: true, force: true });
    const eventsLock = path.join(root, "cadre", ".locks", "events-log.lock");
    write(path.join(eventsLock, "owner.json"), lockOwner);
    const eventsLocked = invokeWorkflowCall(root, collisionRestartCall(root, sessionId));
    assert.equal(eventsLocked.ok, false);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tracks.json"), "utf8"), indexBeforeBlockedRestart);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8"), eventsBeforeBlockedRestart);
    fs.rmSync(eventsLock, { recursive: true, force: true });

    const collision = core.workflowPacketV1(root, { workflow: "newtrack", trackId });
    assert.equal(collision.ok, false);
    assert.deepEqual(collision.decision, {
      kind: "draft_exists",
      track_id: trackId,
      session_id: sessionId,
      resume: {
        tool: "cadre_workflow",
        arguments: { root, workflow: "newtrack", input: {}, execute: false, approval: { session_id: sessionId } },
      },
      restart: {
        tool: "cadre_workflow",
        arguments: { root, workflow: "newtrack", input: {}, execute: false, approval: { session_id: sessionId, restart: true } },
      },
      cancel: {
        tool: "cadre_workflow",
        arguments: { root, workflow: "newtrack", input: {}, execute: false, approval: { session_id: sessionId, cancel: true } },
      },
    });

    const restarted = invokeWorkflowCall(root, collision.decision.restart);
    assert.equal(restarted.ok, true, restarted.errors.join("\n"));
    assert.equal(restarted.data.track_id, trackId);
    assert.equal(restarted.decision.session_id, sessionId);
    assert.equal(restarted.decision.stage, "spec");
    assert.deepEqual(restarted.decision.approved_stages, []);
    assert.ok(restarted.decision.stage_revision > priorSpecRevision);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId)), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", `${trackId}-revised`)), false);
    assert.equal(readJson(path.join(root, "cadre", "tracks.json")).tracks.some((track) => track.track_id === trackId), false);
    const restartEvents = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8")
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(restartEvents.some((event) => event.kind === "track_created" && event.track_id === trackId), false);
    assert.equal(restartEvents.some((event) => event.kind === "unrelated"), true);
    assert.equal(restartEvents.some((event) => (
      event.kind === "track_restarted"
      && event.track_id === trackId
      && event.approval_session_id === sessionId
    )), true);

    const changed = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      spec: sampleSpec(trackId, {
        title: "Spec: bootstrap-foundation restarted",
        description: "A genuinely changed specification after an explicit same-id restart.",
      }),
    });
    assert.equal(changed.ok, true, changed.error);
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "spec.json"), "utf8"), /same-id restart/);
    const session = readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`));
    assert.deepEqual(session.approved_stages, []);
    assert.deepEqual(session.stage_records.plan.snapshot_files, []);
    assert.deepEqual(session.stage_records.plan.preview_files, []);
    assert.equal(session.stage_records.plan.status, "pending");
    assert.equal(session.stage_records.plan.revision, priorPlanRevision);
    const regeneratedPlan = approveCurrent(root, "newtrack", changed);
    assert.equal(regeneratedPlan.approval.current_stage, "plan");
    assert.ok(regeneratedPlan.approval.current_stage_revision > priorPlanRevision);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), true);
    const restartedAgain = invokeWorkflowCall(root, collisionRestartCall(root, sessionId));
    assert.equal(restartedAgain.ok, true, restartedAgain.errors.join("\n"));
    assert.equal(restartedAgain.decision.stage, "spec");
    const secondRestartEvents = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8")
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(secondRestartEvents.filter((event) => event.kind === "track_restarted").length, 2);
  },
));

test("closed pristine newtrack restart reuses the exact id and rechecks ownership under lock", () => withRoot(
  "cadre-newtrack-pristine-restart-contract-",
  (root) => {
    const trackId = "bootstrap-foundation";
    writeImplementTrack(root, trackId);
    write(path.join(root, "cadre", "tracks", trackId, "learnings.jsonl"), "");
    assert.equal(core.regenIndex(root).ok, true);

    const collision = core.workflowPacketV1(root, { workflow: "newtrack", trackId });
    assert.equal(collision.ok, false);
    assert.equal(collision.decision.kind, "pristine_track_exists", JSON.stringify(collision));
    assert.deepEqual(collision.decision.restart, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "newtrack",
        input: { trackId },
        execute: false,
        approval: { restart: true },
      },
    });

    const learningsJsonl = path.join(root, "cadre", "tracks", trackId, "learnings.jsonl");
    write(learningsJsonl, `${JSON.stringify({
      schema: "cadre.learning.v1",
      kind: "implementation_note",
      track_id: trackId,
      body: "Retained implementation evidence must never be discarded.",
    })}\n`);
    const retainedCanonical = invokeWorkflowCall(root, collision.decision.restart);
    assert.equal(retainedCanonical.ok, false);
    assert.match(retainedCanonical.errors.join("\n"), /started or retained state/i);
    assert.match(fs.readFileSync(learningsJsonl, "utf8"), /Retained implementation evidence/);
    write(learningsJsonl, "");

    const learningsMarkdown = path.join(root, "cadre", "tracks", trackId, "learnings.md");
    write(learningsMarkdown, `# Learnings: ${trackId}\n\nA retained implementation insight.\n`);
    const retainedProjection = invokeWorkflowCall(root, collision.decision.restart);
    assert.equal(retainedProjection.ok, false);
    assert.match(retainedProjection.errors.join("\n"), /started or retained state/i);
    assert.match(fs.readFileSync(learningsMarkdown, "utf8"), /retained implementation insight/);
    write(learningsMarkdown, `# Learnings: ${trackId}\n`);

    const foreign = path.join(root, "cadre", "tracks", trackId, "reviewer-note.txt");
    write(foreign, "preserve me\n");
    const conflicted = invokeWorkflowCall(root, collision.decision.restart);
    assert.equal(conflicted.ok, false);
    assert.match(
      conflicted.errors.join("\n"),
      /has started or retained state|no longer a proven pristine track|outside the never-started track artifact set/i,
    );
    assert.equal(fs.readFileSync(foreign, "utf8"), "preserve me\n");

    fs.rmSync(foreign);
    const restarted = invokeWorkflowCall(root, collision.decision.restart);
    assert.equal(restarted.data.track_id, trackId);
    assert.deepEqual(restarted.data.restart, {
      ok: true,
      session_id: null,
      track_id: trackId,
      reused_id: true,
    });
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", `${trackId}-revised`)), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId)), false);
    assert.equal(readJson(path.join(root, "cadre", "tracks.json")).tracks.some((track) => track.track_id === trackId), false);
  },
));

test("a completed newtrack exposes no stale reopen action and retained data in its generated seed blocks restart", () => withRoot(
  "cadre-newtrack-generated-seed-contract-",
  (root) => {
    const trackId = "generated-seed";
    let response = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    response = approveCurrent(root, "newtrack", response);
    response = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: response.approval.session_id,
      plan: samplePlan(trackId),
    });
    response = approveCurrent(root, "newtrack", response);
    const completed = core.workflowPacketV1(root, {
      workflow: "newtrack",
      approvalSessionId: response.approval.session_id,
      approvedStages: response.approval.approved_stages,
      approvalComplete: true,
      execute: true,
    });
    assert.equal(completed.ok, true, completed.errors.join("\n"));
    assert.equal(completed.decision.kind, "complete");
    assert.equal(Object.hasOwn(completed.decision, "reopen"), false);

    const collision = core.workflowPacketV1(root, { workflow: "newtrack", trackId });
    assert.equal(collision.decision.kind, "pristine_track_exists");
    const learningsPath = path.join(root, "cadre", "tracks", trackId, "learnings.jsonl");
    const original = fs.readFileSync(learningsPath, "utf8");
    const seed = JSON.parse(original.trim());
    write(learningsPath, `${JSON.stringify({ ...seed, findings: ["Retained implementation evidence"] })}\n`);
    const blocked = invokeWorkflowCall(root, collision.decision.restart);
    assert.equal(blocked.ok, false);
    assert.match(blocked.errors.join("\n"), /started or retained state/i);
    assert.match(fs.readFileSync(learningsPath, "utf8"), /Retained implementation evidence/);

    write(learningsPath, original);
    const restarted = invokeWorkflowCall(root, collision.decision.restart);
    assert.equal(restarted.data.restart.reused_id, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId)), false);
  },
));

test("closed-pristine restart recovery acquires every normal-operation lock before mutation", () => withRoot(
  "cadre-newtrack-restart-recovery-lock-contract-",
  (root) => {
    const trackId = "restart-recovery-locks";
    writeImplementTrack(root, trackId);
    write(path.join(root, "cadre", "tracks", trackId, "learnings.jsonl"), "");
    assert.equal(core.regenIndex(root).ok, true);
    const tracksFile = path.join(root, "cadre", "tracks.json");
    const tracksBefore = fs.readFileSync(tracksFile, "utf8");
    const transactionId = "a".repeat(24);
    const journalFile = path.join(root, "cadre", "local", "newtrack-restarts", `${transactionId}.json`);
    const tracksAfter = `${JSON.stringify({
      version: 1,
      schema: "cadre.tracks_index.v1",
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      counts: { new: 0, in_progress: 0, completed: 0, blocked: 0, skipped: 0 },
      tracks: [],
    }, null, 2)}\n`;
    write(journalFile, `${JSON.stringify({
      version: 1,
      transaction_id: transactionId,
      track_id: trackId,
      state: "prepared",
      live_relative: `cadre/tracks/${trackId}`,
      tombstone_name: `${transactionId}.track`,
      track_fingerprint: treeFingerprint(path.join(root, "cadre", "tracks", trackId)),
      tracks_before: tracksBefore,
      tracks_after: tracksAfter,
    }, null, 2)}\n`);

    for (const lockName of [
      `track:${trackId}`,
      "approval-target-lifecycle",
      "newtrack-restart",
      "tracks-index",
      "events-log",
    ]) {
      const lock = holdLiveLock(root, lockName);
      const blocked = core.workflowPacketV1(root, {
        workflow: "newtrack",
        trackId: "unrelated-track",
      });
      assert.equal(blocked.ok, false, lockName);
      assert.equal(blocked.decision.kind, "recovery_required", lockName);
      assert.equal(fs.readFileSync(tracksFile, "utf8"), tracksBefore, lockName);
      assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId)), true, lockName);
      assert.equal(fs.existsSync(journalFile), true, lockName);
      fs.rmSync(lock, { recursive: true, force: true });
    }

    write(tracksFile, `${tracksBefore}\n`);
    const drifted = core.workflowPacketV1(root, {
      workflow: "newtrack",
      trackId: "unrelated-track",
    });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.decision.kind, "recovery_required");
    assert.match(drifted.errors.join("\n"), /track index changed during restart recovery/i);
    assert.equal(fs.existsSync(journalFile), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId)), true);
    write(tracksFile, tracksBefore);

    const recovered = core.workflowPacketV1(root, {
      workflow: "newtrack",
      trackId: "unrelated-track",
    });
    assert.notEqual(recovered.decision.kind, "recovery_required");
    assert.equal(fs.existsSync(journalFile), false);
    assert.equal(fs.readFileSync(tracksFile, "utf8"), tracksBefore);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId)), true);
  },
));

test("closed-pristine restart recovery rejects forged indexes and changed quarantined trees", () => withRoot(
  "cadre-newtrack-restart-recovery-ownership-contract-",
  (root) => {
    const trackId = "restart-recovery-ownership";
    writeImplementTrack(root, trackId);
    write(path.join(root, "cadre", "tracks", trackId, "learnings.jsonl"), "");
    assert.equal(core.regenIndex(root).ok, true);
    const tracksFile = path.join(root, "cadre", "tracks.json");
    const tracksBefore = fs.readFileSync(tracksFile, "utf8");
    const tracksAfter = `${JSON.stringify({
      version: 1,
      schema: "cadre.tracks_index.v1",
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      counts: { new: 0, in_progress: 0, completed: 0, blocked: 0, skipped: 0 },
      tracks: [],
    }, null, 2)}\n`;
    const live = path.join(root, "cadre", "tracks", trackId);
    const fingerprint = treeFingerprint(live);

    const forgedId = "b".repeat(24);
    const forgedFile = path.join(root, "cadre", "local", "newtrack-restarts", `${forgedId}.json`);
    write(forgedFile, `${JSON.stringify({
      version: 1,
      transaction_id: forgedId,
      track_id: trackId,
      state: "indexed",
      live_relative: `cadre/tracks/${trackId}`,
      tombstone_name: `${forgedId}.track`,
      track_fingerprint: fingerprint,
      tracks_before: tracksBefore,
      tracks_after: "arbitrary index bytes\n",
    }, null, 2)}\n`);
    const forged = core.workflowPacketV1(root, { workflow: "newtrack", trackId: "unrelated-track" });
    assert.equal(forged.ok, false);
    assert.equal(forged.decision.kind, "recovery_required");
    assert.match(forged.errors.join("\n"), /invalid newtrack restart journal/i);
    assert.equal(fs.readFileSync(tracksFile, "utf8"), tracksBefore);
    assert.equal(fs.existsSync(live), true);
    fs.rmSync(forgedFile, { force: true });

    const changedId = "c".repeat(24);
    const changedFile = path.join(root, "cadre", "local", "newtrack-restarts", `${changedId}.json`);
    const parked = path.join(root, "cadre", "local", "newtrack-restarts", `${changedId}.track`);
    write(changedFile, `${JSON.stringify({
      version: 1,
      transaction_id: changedId,
      track_id: trackId,
      state: "quarantined",
      live_relative: `cadre/tracks/${trackId}`,
      tombstone_name: `${changedId}.track`,
      track_fingerprint: fingerprint,
      tracks_before: tracksBefore,
      tracks_after: tracksAfter,
    }, null, 2)}\n`);
    fs.renameSync(live, parked);
    fs.appendFileSync(path.join(parked, "spec.json"), "changed after interruption\n");
    const changed = core.workflowPacketV1(root, { workflow: "newtrack", trackId: "unrelated-track" });
    assert.equal(changed.ok, false);
    assert.equal(changed.decision.kind, "recovery_required");
    assert.match(changed.errors.join("\n"), /quarantined track changed during restart recovery/i);
    assert.equal(fs.readFileSync(tracksFile, "utf8"), tracksBefore);
    assert.equal(fs.existsSync(live), false);
    assert.equal(fs.existsSync(parked), true);
    assert.equal(fs.existsSync(changedFile), true);
  },
));

test("same-session restart recovery acquires track, lifecycle, index, and event locks", () => withRoot(
  "cadre-approval-reopen-recovery-lock-contract-",
  (root) => {
    const trackId = "approval-recovery-locks";
    let preview = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    preview = approveCurrent(root, "newtrack", preview);
    preview = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: preview.approval.session_id,
      plan: samplePlan(trackId),
    });
    const sessionId = preview.approval.session_id;
    const specFile = path.join(root, "cadre", "tracks", trackId, "spec.json");
    const originalRmSync = fs.rmSync;
    const originalRenameSync = fs.renameSync;
    fs.rmSync = function patchedRmSync(target, options) {
      if (path.resolve(String(target)) === specFile) throw new Error("injected reopen restore failure");
      return originalRmSync.call(fs, target, options);
    };
    fs.renameSync = function patchedRenameSync(source, destination) {
      if (path.resolve(String(destination)) === specFile) throw new Error("injected reopen recovery failure");
      return originalRenameSync.call(fs, source, destination);
    };
    let interrupted;
    try {
      interrupted = invokeWorkflowCall(root, collisionRestartCall(root, sessionId));
    } finally {
      fs.rmSync = originalRmSync;
      fs.renameSync = originalRenameSync;
    }
    assert.equal(interrupted.ok, false);
    const journalFile = path.join(
      root,
      "cadre",
      "local",
      "approval-sessions",
      `${sessionId}.reopen-journal.json`,
    );
    assert.equal(fs.existsSync(journalFile), true);
    const guardedFiles = [
      specFile,
      path.join(root, "cadre", "tracks", trackId, "plan.json"),
      path.join(root, "cadre", "tracks", trackId, "metadata.json"),
      path.join(root, "cadre", "tracks.json"),
      path.join(root, "cadre", "events.jsonl"),
    ];
    const before = new Map(guardedFiles.map((file) => [
      file,
      fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null,
    ]));

    for (const lockName of [`track:${trackId}`, "approval-target-lifecycle", "tracks-index", "events-log"]) {
      const lock = holdLiveLock(root, lockName);
      const blocked = core.workflowPacketV1(root, {
        workflow: "newtrack",
        approvalSessionId: sessionId,
      });
      assert.equal(blocked.ok, false, lockName);
      assert.equal(blocked.decision.kind, "recovery_required", lockName);
      if (lockName === `track:${trackId}`) {
        const status = core.workflowPacketV1(root, { workflow: "status" });
        assert.equal(status.ok, false);
        assert.equal(status.decision.kind, "recovery_required");
        const implement = core.workflowPacketV1(root, {
          workflow: "implement",
          trackId,
          agentIdentifier: "recovery-test",
          execute: true,
        });
        assert.equal(implement.ok, false);
        assert.equal(implement.decision.kind, "recovery_required");
        assert.equal(fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", trackId)), false);
      }
      for (const file of guardedFiles) {
        const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
        assert.equal(current, before.get(file), `${lockName}: ${file}`);
      }
      assert.equal(fs.existsSync(journalFile), true, lockName);
      fs.rmSync(lock, { recursive: true, force: true });
    }

    const recovered = core.workflowPacketV1(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
    });
    assert.notEqual(recovered.decision.kind, "recovery_required");
    assert.equal(fs.existsSync(journalFile), false);
    for (const file of guardedFiles) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      assert.equal(current, before.get(file), file);
    }
  },
));

test("an invalid reopen recovery record blocks resume and overlapping setup", () => withRoot(
  "cadre-approval-reopen-recovery-contract-",
  (root) => {
    const preview = core.workflowPacket(root, setupInput());
    const sessionId = preview.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const session = readJson(sessionFile);
    const implementTrackId = "recovery-fenced-implement";
    writeImplementTrack(root, implementTrackId);
    const metadataFile = path.join(root, "cadre", "tracks", implementTrackId, "metadata.json");
    const metadataBefore = fs.readFileSync(metadataFile, "utf8");
    const tracksBefore = fs.readFileSync(path.join(root, "cadre", "tracks.json"), "utf8");
    const eventsFile = path.join(root, "cadre", "events.jsonl");
    const eventsBefore = fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, "utf8") : null;
    write(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.reopen-journal.json`), `${JSON.stringify({
      version: 1,
      session_id: sessionId,
      state: "restored",
      original_session: session,
      updated_session: { ...session, approved_stages: session.stage_order },
      targets: [],
      bundle_targets: [],
      restart_track_id: null,
      side_effect_targets: [],
      intent_to_add_paths: [],
    }, null, 2)}\n`);

    const resumed = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    assert.equal(resumed.ok, false);
    assert.equal(resumed.decision.kind, "recovery_required");
    assert.match(resumed.errors.join("\n"), /reopen journal is invalid or unreadable/i);
    const status = core.workflowPacketV1(root, { workflow: "status" });
    assert.equal(status.ok, false);
    assert.equal(status.decision.kind, "recovery_required");
    const implement = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId: implementTrackId,
      agentIdentifier: "recovery-test",
      execute: true,
    });
    assert.equal(implement.ok, false);
    assert.equal(implement.decision.kind, "recovery_required");
    assert.equal(fs.readFileSync(metadataFile, "utf8"), metadataBefore);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tracks.json"), "utf8"), tracksBefore);
    assert.equal(fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, "utf8") : null, eventsBefore);
    assert.equal(fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", implementTrackId)), false);
    const replacement = core.workflowPacketV1(root, setupInput({
      product: { title: "Replacement", summary: "Must wait for recovery." },
    }));
    assert.equal(replacement.ok, false);
    assert.equal(replacement.decision.kind, "recovery_required");
  },
));

test("an invalid reopen journal is surfaced before newtrack argument validation", () => withRoot(
  "cadre-newtrack-reopen-recovery-contract-",
  (root) => {
    const trackId = "recovery-track";
    const preview = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    const sessionId = preview.approval.session_id;
    const session = readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`));
    write(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.reopen-journal.json`), `${JSON.stringify({
      version: 1,
      session_id: sessionId,
      state: "restored",
      original_session: session,
      updated_session: { ...session, approved_stages: session.stage_order },
      targets: [],
      bundle_targets: [],
      restart_track_id: null,
      side_effect_targets: [],
      intent_to_add_paths: [],
    }, null, 2)}\n`);

    const resumed = core.workflowPacketV1(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
    });
    assert.equal(resumed.ok, false);
    assert.equal(resumed.decision.kind, "recovery_required");
    assert.match(resumed.errors.join("\n"), /reopen journal is invalid or unreadable/i);
  },
));

test("an invalid materialization journal globally fences status and implement", () => withRoot(
  "cadre-approval-materialization-global-recovery-contract-",
  (root) => {
    const preview = core.workflowPacket(root, setupInput());
    const sessionId = preview.approval.session_id;
    const trackId = "materialization-fenced-implement";
    writeImplementTrack(root, trackId);
    const metadataFile = path.join(root, "cadre", "tracks", trackId, "metadata.json");
    const metadataBefore = fs.readFileSync(metadataFile, "utf8");
    const journalFile = path.join(
      root,
      "cadre",
      "local",
      "approval-sessions",
      `${sessionId}.materialize-journal.json`,
    );
    write(journalFile, `${JSON.stringify({
      version: 1,
      session_id: sessionId,
      state: "written",
      original_session: readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`)),
      updated_session: null,
      targets: [],
    }, null, 2)}\n`);

    const status = core.workflowPacketV1(root, { workflow: "status" });
    assert.equal(status.ok, false);
    assert.equal(status.decision.kind, "recovery_required");
    assert.match(status.errors.join("\n"), /materialization journal is invalid or unreadable/i);
    const implement = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId,
      agentIdentifier: "recovery-test",
      execute: true,
    });
    assert.equal(implement.ok, false);
    assert.equal(implement.decision.kind, "recovery_required");
    assert.equal(fs.readFileSync(metadataFile, "utf8"), metadataBefore);
    assert.equal(fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", trackId)), false);
    assert.equal(fs.existsSync(journalFile), true);
  },
));

test("bundle-mode skill deletion can reopen its missing-file review stage", () => withRoot(
  "cadre-skill-delete-reopen-contract-",
  (root) => {
    let created = core.workflowPacket(root, {
      workflow: "skill",
      operation: "create",
      skillId: "deletion-review",
      changes: [
        { type: "metadata.set", name: "Deletion Review", description: "Exercises deletion review recovery." },
        { type: "selectors.set", workflows: ["review"] },
        { type: "rule.upsert", id: "preserve-evidence", text: "Preserve review evidence.", required: true },
      ],
    });
    assert.equal(created.ok, true, created.error);
    const createSessionId = created.approval.session_id;
    while (created.approval.current_stage) created = approveCurrent(root, "skill", created);
    created = core.workflowPacket(root, {
      workflow: "skill",
      execute: true,
      approvalComplete: true,
      approvalSessionId: createSessionId,
      approvedStages: created.approval.approved_stages,
    });
    assert.equal(created.ok, true, created.error);

    const reviewDirectory = path.join(root, ".skill-delete-review");
    let removal = core.workflowPacket(root, {
      workflow: "skill",
      operation: "remove",
      skillId: "deletion-review",
      changes: [],
      reviewBundleDir: reviewDirectory,
    });
    assert.equal(removal.ok, true, removal.error);
    const removalSessionId = removal.approval.session_id;
    const removalManifest = readJson(path.join(reviewDirectory, "manifest.json"));
    const deletionFiles = removalManifest.files.filter((file) => file.missing === true);
    assert.ok(deletionFiles.length > 0, JSON.stringify(removal.review_bundle));
    const deletionContents = new Map(
      deletionFiles.map((file) => [file.path, fs.readFileSync(file.review_path, "utf8")]),
    );

    removal = approveCurrent(root, "skill", removal);
    assert.equal(removal.approval.current_stage, null);
    const reopened = core.workflowPacket(root, {
      workflow: "skill",
      approvalSessionId: removalSessionId,
      approvalReopenStage: "mutation",
    });
    assert.equal(reopened.ok, true, reopened.error);
    assert.equal(reopened.approval.current_stage, "mutation");
    assert.equal(reopened.review_bundle.directory, reviewDirectory);
    const reopenedManifest = readJson(path.join(reviewDirectory, "manifest.json"));
    const reopenedDeletionFiles = reopenedManifest.files.filter((file) => file.missing === true);
    assert.equal(reopenedDeletionFiles.length, deletionFiles.length);
    for (const file of reopenedDeletionFiles) {
      assert.equal(fs.readFileSync(file.review_path, "utf8"), deletionContents.get(file.path));
    }
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "deletion-review", "skill.json")), true);
  },
));

test("newtrack refuses to restart an established track", () => withRoot(
  "cadre-newtrack-established-restart-contract-",
  (root) => {
    const trackId = "established-track";
    writeImplementTrack(root, trackId);
    const originalSpec = fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "spec.json"), "utf8");
    const blocked = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId, { description: "This must not overwrite established state." }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.target_ownership.kind, "established_track");
    assert.deepEqual(blocked.decision, {
      kind: "track_exists",
      track_id: trackId,
      revise: {
        tool: "cadre_workflow",
        arguments: {
          root,
          workflow: "revise",
          input: { trackId },
          execute: false,
        },
      },
    });
    assert.deepEqual(parseWorkflowToolRequest(blocked.decision.revise.arguments), blocked.decision.revise.arguments);
    assert.match(blocked.error, /outside the never-started track artifact set/i);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "spec.json"), "utf8"), originalSpec);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", `${trackId}-revised`)), false);
  },
));

test("every setup approval stage exposes a complete digest-verified review set", () => withRoot(
  "cadre-all-stage-review-set-contract-",
  (root) => {
    let response = core.workflowPacket(root, setupInput());
    const sessionId = response.approval.session_id;
    let packet = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    assertReviewSet(root, packet, "product", ["cadre/product.json", "cadre/product.md"]);

    response = approveCurrent(root, "setup", response);
    packet = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    assertReviewSet(root, packet, "product_guidelines", [
      "cadre/product_guidelines.json",
      "cadre/product_guidelines.md",
    ]);

    response = approveCurrent(root, "setup", response);
    packet = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    const technical = assertReviewSet(root, packet, "technical", [
      "cadre/styleguides/README.md",
      "cadre/styleguides/index.json",
      "cadre/tech-stack.json",
      "cadre/tech-stack.md",
    ]);
    assert.deepEqual(technical.selected_components, ["tech_stack", "style_guides"]);
    assert.deepEqual(technical.omitted_components.map((entry) => entry.component).sort(), ["lsp", "repository_topology"]);

    response = approveCurrent(root, "setup", response);
    packet = core.workflowPacketV1(root, { workflow: "setup", approvalSessionId: sessionId });
    assertReviewSet(root, packet, "workflow", ["cadre/workflow.json", "cadre/workflow.md"]);
  },
));

test("technical setup exposes style-guide and LSP choices before review", () => withRoot(
  "cadre-technical-selection-contract-",
  (root) => {
    write(path.join(root, "package.json"), `${JSON.stringify({ devDependencies: { typescript: "5.8.0" } }, null, 2)}\n`);
    write(path.join(root, "tsconfig.json"), "{}\n");
    const input = setupInput();
    delete input.styleGuideIds;
    delete input.writeLsp;
    let response = core.workflowPacket(root, input);
    response = approveCurrent(root, "setup", response);
    response = approveCurrent(root, "setup", response);
    assert.equal(response.approval.current_stage, "technical");
    assert.equal(response.phase_state, "awaiting_clarification");

    const selection = core.workflowPacketV1(root, {
      workflow: "setup",
      approvalSessionId: response.approval.session_id,
    });
    assert.equal(selection.decision.kind, "clarification");
    assert.deepEqual(selection.decision.prompts.map((prompt) => prompt.id).sort(), ["setup-lsp", "setup-style-guides"]);
    assert.deepEqual(selection.decision.writable_paths.sort(), [
      "/arguments/input/styleGuideIds",
      "/arguments/input/writeLsp",
    ].sort());

    const answeredCall = structuredClone(selection.decision.resume);
    answeredCall.arguments.input = { styleGuideIds: ["general", "typescript"], writeLsp: true };
    const reviewed = invokeWorkflowCall(root, answeredCall);
    assert.equal(reviewed.decision.kind, "approval");
    const reviewSet = assertReviewSet(root, reviewed, "technical");
    assert.deepEqual(reviewSet.selected_components, ["tech_stack", "style_guides", "lsp"]);
    assert.equal(reviewSet.files.some((file) => file.path === "cadre/lsp.json"), true);
    assert.equal(reviewSet.files.some((file) => file.path === "cadre/styleguides/general.md"), true);
    assert.equal(reviewSet.files.some((file) => file.path === "cadre/styleguides/typescript.md"), true);
  },
));

test("technical review_set is never truncated when every bundled guide is selected", () => withRoot(
  "cadre-technical-review-set-nontruncation-contract-",
  (root) => {
    const guideIds = fs.readdirSync(path.join(harnessRoot, "templates", "styleguides"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.basename(name, ".json"))
      .sort();
    const technical = advanceSetupToTechnical(root, { styleGuideIds: guideIds, writeLsp: true });
    const packet = core.workflowPacketV1(root, {
      workflow: "setup",
      approvalSessionId: technical.approval.session_id,
    });
    const expectedPaths = [
      "cadre/tech-stack.json",
      "cadre/tech-stack.md",
      "cadre/styleguides/index.json",
      "cadre/styleguides/README.md",
      "cadre/lsp.json",
      ...guideIds.flatMap((id) => [`cadre/styleguides/${id}.json`, `cadre/styleguides/${id}.md`]),
    ];
    const reviewSet = assertReviewSet(root, packet, "technical", expectedPaths);
    assert.ok(reviewSet.file_count > 30);
    assert.equal(reviewSet.file_count, expectedPaths.length);
    assert.ok(packet.artifacts.length <= 30);
    assert.deepEqual(reviewSet.selected_components, ["tech_stack", "style_guides", "lsp"]);
    assert.deepEqual(reviewSet.omitted_components.map((entry) => entry.component), ["repository_topology"]);
  },
));

test("setup renders TechStack as complete semantic Markdown", () => withRoot(
  "cadre-tech-stack-projection-contract-",
  (root) => {
    const techStack = {
      version: 1,
      schema: "cadre.tech_stack.v1",
      title: "Runtime Architecture Sentinel",
      summary: "Typed service summary sentinel",
      languages: ["TypeScript language sentinel"],
      frameworks: ["Fastify framework sentinel"],
      runtimes: ["Node runtime sentinel"],
      platforms: ["Linux platform sentinel"],
      packageManagers: ["pnpm package-manager sentinel"],
      buildCommand: "pnpm build-command-sentinel",
      testing: { command: "pnpm test-command-sentinel", framework: "node:test framework sentinel" },
      datastores: ["PostgreSQL datastore sentinel"],
      services: ["OpenTelemetry service sentinel"],
      keyDependencies: ["zod dependency sentinel"],
      styleGuideIds: ["typescript"],
      customPlatformPolicy: { enabled: false, retryLimit: 0, tags: [] },
    };
    advanceSetupToTechnical(root, {
      techStack,
      styleGuideIds: ["typescript"],
    });
    const markdown = fs.readFileSync(path.join(root, "cadre", "tech-stack.md"), "utf8");
    assert.doesNotMatch(markdown, /```json/);
    assert.match(markdown, /^# Runtime Architecture Sentinel/m);
    assertSemanticValues(markdown, [
      "Typed service summary sentinel",
      "TypeScript language sentinel",
      "Fastify framework sentinel",
      "Node runtime sentinel",
      "Linux platform sentinel",
      "pnpm package-manager sentinel",
      "pnpm build-command-sentinel",
      "pnpm test-command-sentinel",
      "node:test framework sentinel",
      "PostgreSQL datastore sentinel",
      "OpenTelemetry service sentinel",
      "zod dependency sentinel",
      "typescript",
      "Custom Platform Policy",
    ]);
    assert.match(markdown, /\*\*Enabled:\*\* false/);
    assert.match(markdown, /\*\*Retry Limit:\*\* 0/);
    assert.match(markdown, /\*\*Tags:\*\*[\s\S]*?_None configured\._/);
    assert.equal(
      markdown.replace(/^<!-- cadre:generated[^\n]*-->\n/, ""),
      core.renderTechStackMarkdown(techStack, "cadre/tech-stack.json"),
    );
  },
));

test("setup renders every Workflow policy field as semantic Markdown", () => withRoot(
  "cadre-workflow-projection-contract-",
  (root) => {
    const workflowPolicy = {
      version: 1,
      schema: "cadre.workflow.v1",
      kind: "workflow",
      title: "Delivery Workflow Sentinel",
      summary: "Evidence-backed lifecycle sentinel",
      principles: ["principle sentinel"],
      providerMode: "provider-mode sentinel",
      taskLifecycle: ["claim sentinel", "verify sentinel"],
      completeTaskPolicy: ["completion sentinel"],
      commitPolicy: ["commit sentinel"],
      branchPolicy: ["branch sentinel"],
      topology: "polyrepo topology sentinel",
      repos: ["api repo sentinel", "web repo sentinel"],
      repoCommands: { api: "api-command sentinel", web: "web-command sentinel" },
      preferredTestCommand: "preferred-test sentinel",
      testCommand: "test-command sentinel",
      coverageCommand: "coverage-command sentinel",
      reviewGate: "review-gate sentinel",
      reviewFocus: ["review-focus sentinel"],
      qualityBar: ["quality-bar sentinel"],
      phaseCompletion: ["phase-completion sentinel"],
      manualVerification: ["manual-verification sentinel"],
      coveragePolicy: { minimum: 0, required: false, exclusions: [] },
      formatCommand: "format-command sentinel",
      buildCommand: "workflow-build-command sentinel",
      developmentCommands: ["development-command sentinel"],
      changeControl: { enabled: false, retryLimit: 0, owners: [] },
      sections: [{
        id: "custom_release_check",
        heading: "Custom Release Check Sentinel",
        body: "custom-section-body sentinel",
        escalationOwner: "escalation-owner sentinel",
      }],
    };
    let response = advanceSetupToTechnical(root, {
      techStack: {
        languages: ["TypeScript"],
      },
      workflowPolicy,
    });
    response = approveCurrent(root, "setup", response);
    assert.equal(response.approval.current_stage, "workflow");
    const markdown = fs.readFileSync(path.join(root, "cadre", "workflow.md"), "utf8");
    assert.doesNotMatch(markdown, /```json/);
    assert.match(markdown, /^# Delivery Workflow Sentinel/m);
    assertSemanticValues(markdown, [
      "Evidence-backed lifecycle sentinel",
      "principle sentinel",
      "provider-mode sentinel",
      "claim sentinel",
      "verify sentinel",
      "completion sentinel",
      "commit sentinel",
      "branch sentinel",
      "polyrepo topology sentinel",
      "api repo sentinel",
      "web repo sentinel",
      "api-command sentinel",
      "web-command sentinel",
      "preferred-test sentinel",
      "test-command sentinel",
      "coverage-command sentinel",
      "review-gate sentinel",
      "review-focus sentinel",
      "quality-bar sentinel",
      "phase-completion sentinel",
      "manual-verification sentinel",
      "format-command sentinel",
      "workflow-build-command sentinel",
      "development-command sentinel",
      "Custom Release Check Sentinel",
      "custom-section-body sentinel",
      "escalation-owner sentinel",
      "Change Control",
    ]);
    assert.match(markdown, /\*\*Minimum:\*\* 0/);
    assert.match(markdown, /\*\*Required:\*\* false/);
    assert.match(markdown, /\*\*Enabled:\*\* false/);
    assert.match(markdown, /\*\*Retry Limit:\*\* 0/);
    assert.match(markdown, /_None configured\._/);
    const canonical = readJson(path.join(root, "cadre", "workflow.json"));
    assert.equal(markdown.replace(/^<!-- cadre:generated[^\n]*-->\n/, ""), core.renderWorkflowMarkdown(
      canonical,
      "Project Workflow",
      "cadre/workflow.json",
    ));
  },
));

test("newtrack canonicalizes descriptive phase and task aliases before review", () => withRoot(
  "cadre-plan-canonicalization-contract-",
  (root) => {
    const trackId = "canonical-plan-identities";
    let response = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    response = approveCurrent(root, "newtrack", response);
    const authoredPlan = {
      version: 1,
      schema: "cadre.plan.v1",
      track_id: trackId,
      title: `Plan: ${trackId}`,
      phases: [
        {
          phase_index: 10,
          phase_id: "foundation",
          title: "Foundation",
          execution_mode: "sequential",
          depends_on: [],
          tasks: [{
            task_index: 7,
            task_key: "workspace-manifests",
            title: "Create workspace manifests",
            status: "pending",
            files: ["package.json"],
            depends_on: [],
          }],
        },
        {
          phase_index: 20,
          phase_id: "delivery",
          title: "Delivery",
          execution_mode: "sequential",
          depends_on: ["foundation"],
          tasks: [{
            task_index: 4,
            task_key: "native-just-recipes",
            title: "Add native recipes",
            status: "pending",
            files: ["justfile"],
            depends_on: ["workspace-manifests"],
          }],
        },
      ],
    };
    const preview = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: response.approval.session_id,
      plan: authoredPlan,
    });
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.approval.current_stage, "plan");
    const canonical = readJson(path.join(root, "cadre", "tracks", trackId, "plan.json"));
    assert.equal(canonical.phases[0].phase_id, "phase1");
    assert.equal(canonical.phases[0].phase_index, 1);
    assert.equal(canonical.phases[0].tasks[0].task_key, "phase1_task1");
    assert.equal(canonical.phases[0].tasks[0].task_index, 1);
    assert.equal(canonical.phases[1].phase_id, "phase2");
    assert.equal(canonical.phases[1].phase_index, 2);
    assert.deepEqual(canonical.phases[1].depends_on, ["phase1"]);
    assert.equal(canonical.phases[1].tasks[0].task_key, "phase2_task1");
    assert.equal(canonical.phases[1].tasks[0].task_index, 1);
    assert.deepEqual(canonical.phases[1].tasks[0].depends_on, ["phase1_task1"]);
    assert.equal(canonical.phases[0].tasks.at(-1).task_key, "phase1_manual_verification");
    assert.equal(canonical.phases[1].tasks.at(-1).task_key, "phase2_manual_verification");
    assert.equal(canonical.phases.at(-1).tasks[0].task_key, "track_manual_verification");
  },
));

test("newtrack rejects mixed dependency levels before plan approval", () => withRoot(
  "cadre-plan-graph-contract-",
  (root) => {
    const trackId = "invalid-dependency-levels";
    let response = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    response = approveCurrent(root, "newtrack", response);
    const invalidPlan = samplePlan(trackId);
    invalidPlan.phases.push({
      phase_index: 2,
      title: "Phase 2: Integrate",
      execution_mode: "sequential",
      depends_on: ["phase1_task1"],
      tasks: [{
        task_index: 1,
        task_key: "phase2_task1",
        title: "Integrate",
        status: "pending",
        files: ["src/integrate.js"],
        depends_on: ["phase1"],
      }],
    });
    const blocked = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: response.approval.session_id,
      plan: invalidPlan,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.approval.current_stage, "plan");
    assert.equal(blocked.stage, "schema_validation");
    const issues = blocked.schema_errors;
    assert.ok(issues.some((issue) => (
      issue.path === "plan.phases[1].depends_on[0]"
      && /phase dependency phase1_task1 is not a canonical phase id/i.test(issue.message)
      && issue.expected === "phaseN"
    )), JSON.stringify(issues));
    assert.ok(issues.some((issue) => (
      issue.path === "plan.phases[1].tasks[0].depends_on[0]"
      && /unknown task dependency phase1/i.test(issue.message)
      && issue.expected === "existing canonical task key"
    )), JSON.stringify(issues));
    assert.deepEqual(blocked.missing_payload, ["plan"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), false);
  },
));

test("newtrack validates the post-manual-verification graph before preview persistence", () => withRoot(
  "cadre-post-normalization-plan-graph-contract-",
  (root) => {
    const trackId = "post-normalization-cycle";
    let response = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      commitMode: "off",
    });
    response = approveCurrent(root, "newtrack", response);
    const plan = samplePlan(trackId);
    plan.phases[0].phase_index = 3;
    plan.phases.push({
      phase_index: 2,
      title: "Phase 2: Delivery",
      execution_mode: "sequential",
      depends_on: ["phase3"],
      tasks: [{
        task_index: 1,
        task_key: "phase2_task1",
        title: "Deliver the foundation",
        status: "pending",
        files: ["src/delivery.js"],
        depends_on: ["phase1_task1"],
      }],
    });
    const blocked = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: response.approval.session_id,
      plan,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "schema_validation");
    assert.ok(blocked.schema_errors.some((entry) => /phase dependency cycle/i.test(entry.message)));
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), false);
  },
));

test("revise rejects an invalid plan graph before plan approval or persistence", () => withRoot(
  "cadre-revise-plan-graph-contract-",
  (root) => {
    const trackId = "revise-invalid-graph";
    seedImplementTrack(root, trackId);
    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const baseline = fs.readFileSync(planPath, "utf8");
    const invalidPlan = samplePlan(trackId);
    invalidPlan.phases.push({
      phase_index: 2,
      title: "Phase 2: Invalid revision",
      execution_mode: "sequential",
      depends_on: ["phase1_task1"],
      tasks: [{
        task_index: 1,
        task_key: "phase2_task1",
        title: "Invalid revised dependency",
        status: "pending",
        files: ["src/revised.js"],
        depends_on: ["phase1"],
      }],
    });
    const blocked = core.workflowPacket(root, {
      workflow: "revise",
      trackId,
      reason: "The implementation plan dependency graph needs revision.",
      intent: { revisionScope: "plan" },
      plan: invalidPlan,
      commitMode: "off",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "schema_validation");
    assert.equal(blocked.approval.current_stage, "plan_changes");
    assert.ok(blocked.schema_errors.some((entry) => /phase dependency phase1_task1/i.test(entry.message)));
    assert.equal(fs.readFileSync(planPath, "utf8"), baseline);
  },
));

test("malformed dependency values and cross-level deadlocks fail canonical parsing", () => {
  const empty = samplePlan("empty-plan");
  empty.phases = [];
  const emptyParsed = core.parsePlanJson(empty);
  assert.equal(emptyParsed.ok, false);
  assert.ok(emptyParsed.errors.some((message) => /at least one phase/i.test(message)));

  const malformed = samplePlan("malformed-dependencies");
  malformed.phases[0].depends_on = "phase9";
  malformed.phases[0].tasks[0].depends_on = [42];
  const malformedParsed = core.parsePlanJson(malformed);
  assert.equal(malformedParsed.ok, false);
  assert.ok(malformedParsed.errors.some((message) => /dependencies must be an array of strings/i.test(message)));
  assert.ok(malformedParsed.errors.some((message) => /dependency must be a non-empty string/i.test(message)));

  const deadlocked = samplePlan("cross-level-deadlock");
  deadlocked.phases[0].tasks[0].depends_on = ["phase2_task1"];
  deadlocked.phases.push({
    phase_index: 2,
    title: "Phase 2: Downstream",
    execution_mode: "sequential",
    depends_on: ["phase1"],
    tasks: [{
      task_index: 1,
      task_key: "phase2_task1",
      title: "Downstream task",
      status: "pending",
      files: ["src/downstream.js"],
      depends_on: [],
    }],
  });
  const deadlockedParsed = core.parsePlanJson(deadlocked);
  assert.equal(deadlockedParsed.ok, false);
  assert.ok(deadlockedParsed.errors.some((message) => /is not a phase dependency ancestor/i.test(message)));

  const ambiguous = samplePlan("ambiguous-task-alias");
  ambiguous.phases[0].tasks = [
    { ...ambiguous.phases[0].tasks[0], task_index: 1, task_key: "foo", depends_on: [] },
    { ...ambiguous.phases[0].tasks[0], task_index: 2, task_key: "phase1_task1", depends_on: [] },
    { ...ambiguous.phases[0].tasks[0], task_index: 3, task_key: "bar", depends_on: ["phase1_task1"] },
  ];
  const ambiguousParsed = core.parsePlanJson(ambiguous);
  assert.equal(ambiguousParsed.ok, false);
  assert.ok(ambiguousParsed.errors.some((message) => /ambiguous task alias phase1_task1/i.test(message)));
});

test("empty persisted plans block implementation before claim or worktree setup", () => withRoot(
  "cadre-empty-plan-implementation-contract-",
  (root) => {
    const trackId = "empty-persisted-plan";
    writeImplementTrack(root, trackId);
    const plan = samplePlan(trackId);
    plan.phases = [];
    write(path.join(root, "cadre", "tracks", trackId, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

    assert.equal(core.planIntegrity(root, trackId).ok, false);
    assert.equal(core.phaseSchedule(root, { trackId }).ok, false);
    const blocked = core.workflowPacketV1(root, { workflow: "implement", trackId, execute: true });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.next, null);
    const metadata = readJson(path.join(root, "cadre", "tracks", trackId, "metadata.json"));
    assert.equal(metadata.status, "new");
    assert.equal(metadata.owner, undefined);
    assert.equal(fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", trackId)), false);
  },
));

function writeImplementTrack(root, trackId, options = {}) {
  const plan = samplePlan(trackId);
  plan.phases[0].execution_mode = options.executionMode || "sequential";
  if (options.tasks) plan.phases[0].tasks = options.tasks;
  write(path.join(root, "cadre", "tracks", trackId, "metadata.json"), `${JSON.stringify({
    track_id: trackId,
    type: "feature",
    status: "new",
    priority: "medium",
    depends_on: [],
    git_branch: `track/${trackId}`,
    ...(options.polyrepo ? {} : { worktree_path: `.worktrees/cadre/tracks/${trackId}/integrate/root` }),
    ...(options.metadata || {}),
  }, null, 2)}\n`);
  write(path.join(root, "cadre", "tracks", trackId, "spec.json"), `${JSON.stringify(sampleSpec(trackId), null, 2)}\n`);
  write(path.join(root, "cadre", "tracks", trackId, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  write(path.join(root, "cadre", "tracks", trackId, "spec.md"), `# Spec: ${trackId}\n`);
  write(path.join(root, "cadre", "tracks", trackId, "plan.md"), `# Plan: ${trackId}\n\n## Phase 1: Build\n\n- [ ] Task 1: Implement the change\n`);
  write(path.join(root, "cadre", "tracks", trackId, "learnings.md"), `# Learnings: ${trackId}\n`);
  const regenerated = core.regenIndex(root);
  assert.equal(regenerated.ok, true);
  const index = readJson(path.join(root, "cadre", "tracks.json"));
  assert.equal(index.schema, "cadre.tracks_index.v1");
  const expectedTrackIds = options.expectedTrackIds || [trackId];
  assert.equal(index.counts.new, expectedTrackIds.length);
  assert.deepEqual(index.tracks.map((track) => track.track_id), [...expectedTrackIds].sort());
}

function seedImplementTrack(root, trackId, options = {}) {
  write(path.join(root, "README.md"), "# Worktree contract\n");
  writeImplementTrack(root, trackId, options);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", `seed ${trackId}`]);
}

test("expired local locks remain live while their owner process is alive", () => {
  const expired = {
    pid: process.pid,
    hostname: os.hostname(),
    acquired_at: new Date(Date.now() - 60_000).toISOString(),
    updated_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() - 1_000).toISOString(),
  };
  assert.equal(lockingRuntime.lockIsStale(expired), false);
  assert.equal(lockingRuntime.lockIsStale({ ...expired, hostname: "foreign.invalid" }), true);
});

test("stale lock takeover quarantines the observed owner and preserves the successor", () => withRoot(
  "cadre-stale-lock-takeover-contract-",
  (root) => {
    const lockDir = path.join(root, "cadre", ".locks", "takeover.lock");
    write(path.join(lockDir, "owner.json"), `${JSON.stringify({
      name: "takeover",
      token: "expired-owner",
      pid: 99999999,
      hostname: os.hostname(),
      acquired_at: new Date(Date.now() - 60_000).toISOString(),
      updated_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    }, null, 2)}\n`);
    const acquired = lockingRuntime.acquireLock(root, "takeover", { retries: 3 });
    assert.equal(acquired.ok, true, JSON.stringify(acquired));
    assert.notEqual(acquired.info.token, "expired-owner");
    assert.equal(fs.readdirSync(path.dirname(lockDir)).some((name) => name.includes(".stale-")), false);
    const contender = lockingRuntime.acquireLock(root, "takeover", { retries: 1 });
    assert.equal(contender.ok, false);
    assert.equal(contender.conflict, true);
    assert.equal(lockingRuntime.releaseLock(acquired).ok, true);
  },
));

test("fresh ownerless lock directories receive initialization grace before orphan recovery", () => withRoot(
  "cadre-lock-initialization-grace-contract-",
  (root) => {
    const lockDir = path.join(root, "cadre", ".locks", "initialization.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    const fresh = lockingRuntime.acquireLock(root, "initialization", { retries: 1 });
    assert.equal(fresh.ok, false);
    assert.equal(fresh.stale, false);
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(lockDir, old, old);
    const recovered = lockingRuntime.acquireLock(root, "initialization", { retries: 2 });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(lockingRuntime.releaseLock(recovered).ok, true);
  },
));

test("commit trace restores a pre-staged version when the worktree reverted to HEAD", () => withRoot(
  "cadre-index-restore-no-change-contract-",
  (root) => {
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    write(path.join(root, "tracked.txt"), "head\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed staged reversal"]);
    write(path.join(root, "tracked.txt"), "staged\n");
    git(root, ["add", "tracked.txt"]);
    write(path.join(root, "tracked.txt"), "head\n");
    const baselineSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    const traced = commitTraceRuntime.commitTrace(root, {}, {
      kind: "product",
      workflow: "index_restore_test",
      subject: "preserve staged reversal",
      files: ["tracked.txt"],
      allowDirty: true,
    });
    assert.equal(traced.ok, true, JSON.stringify(traced));
    assert.equal(traced.skipped, true);
    assert.equal(traced.index_restore.ok, true);
    assert.equal(git(root, ["show", ":tracked.txt"]).stdout, "staged\n");
    assert.equal(git(root, ["rev-parse", "HEAD"]).stdout.trim(), baselineSha);
  },
));

test("commit trace accepts root commits and safely rolls back expanded unborn commits", () => withRoot(
  "cadre-unborn-commit-integrity-contract-",
  (root) => {
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    write(path.join(root, "claimed.txt"), "claimed\n");
    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    write(hookPath, "#!/bin/sh\nprintf 'expanded\\n' > expanded.txt\ngit add expanded.txt\n");
    fs.chmodSync(hookPath, 0o755);
    const rejected = commitTraceRuntime.commitTrace(root, {}, {
      kind: "product",
      workflow: "unborn_integrity_test",
      subject: "reject expanded root commit",
      files: ["claimed.txt"],
      allowDirty: true,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.stage, "git_commit_integrity");
    assert.equal(rejected.rollback.ok, true, JSON.stringify(rejected));
    assert.equal(spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }).status, 128);
    assert.equal(fs.readFileSync(path.join(root, "claimed.txt"), "utf8"), "claimed\n");
    assert.equal(fs.readFileSync(path.join(root, "expanded.txt"), "utf8"), "expanded\n");
    assert.equal(git(root, ["diff", "--cached", "--name-only"]).stdout, "");

    fs.rmSync(hookPath);
    fs.rmSync(path.join(root, "expanded.txt"));
    const accepted = commitTraceRuntime.commitTrace(root, {}, {
      kind: "product",
      workflow: "unborn_integrity_test",
      subject: "accept exact root commit",
      files: ["claimed.txt"],
      allowDirty: true,
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(git(root, ["rev-list", "--parents", "-n", "1", accepted.commit_sha]).stdout.trim().split(/\s+/).length, 1);
  },
));

test("commit trace rolls back a clean post-commit HEAD advance", () => withRoot(
  "cadre-post-commit-head-advance-contract-",
  (root) => {
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    write(path.join(root, "claimed.txt"), "baseline\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed post-commit advance"]);
    const baselineSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    write(path.join(root, "claimed.txt"), "validated\n");
    const hookPath = path.join(root, ".git", "hooks", "post-commit");
    write(hookPath, "#!/bin/sh\nrm -f \"$0\"\nprintf 'advanced\\n' > advanced.txt\ngit add advanced.txt\ngit -c commit.gpgsign=false -c user.name=Hook -c user.email=hook@example.invalid commit -m 'hook: advance HEAD'\n");
    fs.chmodSync(hookPath, 0o755);
    const rejected = commitTraceRuntime.commitTrace(root, {}, {
      kind: "product",
      workflow: "post_commit_advance_test",
      subject: "reject post-commit advance",
      files: ["claimed.txt"],
      allowDirty: true,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.stage, "git_commit_integrity");
    assert.equal(rejected.rollback.ok, true, JSON.stringify(rejected));
    assert.equal(git(root, ["rev-parse", "HEAD"]).stdout.trim(), baselineSha);
    assert.equal(git(root, ["diff", "--cached", "--name-only"]).stdout, "");
    assert.deepEqual(git(root, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim().split(/\n/).sort(), ["?? advanced.txt", "M claimed.txt"]);
  },
));

test("invalid persisted plan graphs block integrity and every scheduler before worktree setup", () => withRoot(
  "cadre-invalid-persisted-plan-contract-",
  (root) => {
    const trackId = "invalid-persisted-graph";
    writeImplementTrack(root, trackId);
    const invalidPlan = samplePlan(trackId);
    invalidPlan.phases.push({
      phase_index: 2,
      title: "Phase 2: Invalid",
      execution_mode: "parallel",
      depends_on: ["phase1_task1"],
      tasks: [{
        task_index: 1,
        task_key: "phase2_task1",
        title: "Invalid dependency",
        status: "pending",
        files: ["src/invalid.js"],
        depends_on: ["phase1"],
      }],
    });
    write(path.join(root, "cadre", "tracks", trackId, "plan.json"), `${JSON.stringify(invalidPlan, null, 2)}\n`);

    const integrity = core.planIntegrity(root, trackId);
    assert.equal(integrity.ok, false);
    assert.ok(integrity.errors.some((entry) => /phase dependency phase1_task1/i.test(entry.message)));
    const schedule = core.phaseSchedule(root, { trackId });
    assert.equal(schedule.ok, false);
    assert.deepEqual(schedule.ready_phases, []);
    assert.deepEqual(schedule.ready_groups, []);
    const parallel = core.parallelWorkflow(root, { action: "plan", trackId });
    assert.equal(parallel.ok, false);
    const record = core.parallelWorkflow(root, {
      action: "record_finish",
      trackId,
      workerId: `${trackId}_phase1_task1`,
      status: "awaiting_merge",
      execute: true,
    });
    assert.equal(record.ok, false);
    assert.equal(record.stage, "plan_graph");
    const merge = core.parallelWorkflow(root, { action: "merge_back", trackId, execute: true });
    assert.equal(merge.ok, false);
    assert.equal(merge.stage, "plan_graph");
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "parallel_state.json")), false);
    const completion = core.completeTask(root, { trackId, phaseIndex: 1, taskIndex: 1, execute: true });
    assert.equal(completion.ok, false);
    assert.equal(completion.stage, "plan_graph");
    const worktrees = core.worktreePlan(root, { trackId, execute: true });
    assert.equal(worktrees.ok, false);
    assert.equal(worktrees.stage, "plan_graph");
    const implement = core.workflowPacketV1(root, { workflow: "implement", trackId, agentIdentifier: "codex" });
    assert.equal(implement.ok, false);
    assert.equal(implement.next, null);
    assert.equal(implement.data.integration_worktrees, null);
    const executeAttempt = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId,
      agentIdentifier: "codex",
      execute: true,
    });
    assert.equal(executeAttempt.ok, false);
    const metadata = readJson(path.join(root, "cadre", "tracks", trackId, "metadata.json"));
    assert.equal(metadata.status, "new");
    assert.equal(metadata.owner, undefined);
    assert.equal(fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", trackId)), false);
  },
));

test("sequential and parallel schedulers share canonical task dependency readiness", () => withRoot(
  "cadre-shared-task-readiness-contract-",
  (root) => {
    const trackId = "shared-task-readiness";
    const baseTask = samplePlan(trackId).phases[0].tasks[0];
    writeImplementTrack(root, trackId, {
      executionMode: "parallel",
      tasks: [
        { ...baseTask, task_index: 1, task_key: "phase1_task1", title: "Foundation", depends_on: [] },
        { ...baseTask, task_index: 2, task_key: "phase1_task2", title: "Dependent", depends_on: ["phase1_task1"] },
      ],
    });
    let schedule = core.phaseSchedule(root, { trackId });
    assert.deepEqual(schedule.phases[0].ready_tasks, ["phase1_task1"]);
    let wave = core.parallelWorkflow(root, { action: "next_wave", trackId });
    assert.deepEqual(wave.workers.map((worker) => worker.task_key), ["phase1_task1"]);

    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const plan = readJson(planPath);
    plan.phases[0].tasks[0].status = "completed";
    write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    schedule = core.phaseSchedule(root, { trackId });
    assert.deepEqual(schedule.phases[0].ready_tasks, ["phase1_task2"]);
    wave = core.parallelWorkflow(root, { action: "next_wave", trackId });
    assert.deepEqual(wave.workers.map((worker) => worker.task_key), ["phase1_task2"]);

    plan.phases[0].execution_mode = "sequential";
    plan.phases[0].tasks[0].status = "pending";
    write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    schedule = core.phaseSchedule(root, { trackId });
    assert.deepEqual(schedule.phases[0].ready_tasks, ["phase1_task1"]);
    assert.equal(schedule.phases[0].tasks[1].ready, false);
    assert.deepEqual(schedule.phases[0].tasks[1].blocked_by, ["phase1_task1"]);
  },
));

test("sequential implement returns an executable integration-worktree continuation", () => withRoot(
  "cadre-implement-auto-worktree-contract-",
  (root) => {
    const trackId = "automatic-worktree";
    seedImplementTrack(root, trackId);

    const missing = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.deepEqual(missing.next, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "track.worktree_plan",
        input: { trackId, repo: "root" },
        execute: true,
      },
    });
    assert.equal(fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root")), false);
  },
));

test("automatic worktree setup persists the first clean dispatch for dependency-owned continuation", () => withRoot(
  "cadre-auto-worktree-dispatch-contract-",
  (root) => {
    const trackId = "auto-worktree-dispatch";
    write(path.join(root, "Cargo.toml"), "[workspace]\n");
    seedImplementTrack(root, trackId, {
      tasks: [
        {
          task_index: 1,
          task_key: "phase1_task1",
          title: "Create workspace manifest",
          status: "completed",
          files: ["Cargo.toml"],
          depends_on: [],
          commit_shas: [],
        },
        {
          task_index: 2,
          task_key: "phase1_task2",
          title: "Create contracts",
          status: "pending",
          files: ["contracts"],
          depends_on: ["phase1_task1"],
          commit_shas: [],
        },
      ],
    });
    const missing = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(missing.next.tool, "cadre_action");
    const setup = trackPacket({
      rootResolver: { requireCadreRoot: () => root },
      core: { worktreePlan: core.worktreePlan },
    }, {
      root,
      action: "worktree_plan",
      ...missing.next.arguments.input,
      execute: true,
    });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    assert.equal(setup.next.arguments.execute, true);
    const dispatched = invokeWorkflowCall(root, setup.next);
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
    const state = readJson(path.join(root, "cadre", "tracks", trackId, "implement_state.json"));
    assert.equal(state.sequential_dispatch.task_key, "phase1_task2");
    assert.equal(state.sequential_dispatch.dispatch_clean, true);

    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    write(path.join(integration, "Cargo.toml"), "[workspace]\nmembers = [\"contracts\"]\n");
    write(path.join(integration, "contracts", "schema.json"), "{}\n");
    const resumed = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.data.implementation_guard.continuation, true);
    assert.equal(resumed.data.implementation_guard.dispatch_clean, true);
    assert.equal(resumed.data.task.complete_packet.arguments.input.dispatchClean, true);
  },
));

test("ready sequential implement returns deferred completion only after work", () => withRoot(
  "cadre-implement-deferred-completion-contract-",
  (root) => {
    const trackId = "deferred-completion";
    seedImplementTrack(root, trackId);
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    assert.equal(fs.existsSync(integration), true);
    assert.equal(git(integration, ["branch", "--show-current"]).stdout.trim(), `track/${trackId}`);
    const baselineSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();

    const ready = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(ready.next, null);
    assert.deepEqual(ready.required, ["data.task.complete_packet"]);
    assert.deepEqual(ready.data.task.complete_packet, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "task.complete",
        input: {
          trackId,
          phaseIndex: 1,
          taskIndex: 1,
          workingRoot: integration,
          baselineSha,
          dispatchClean: true,
        },
        execute: true,
      },
    });
  },
));

test("interrupted pending tasks retain completed-dependency authorization from their clean dispatch", () => withRoot(
  "cadre-pending-dependency-dispatch-contract-",
  (root) => {
    const trackId = "pending-dependency-dispatch";
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      tasks: [
        {
          task_index: 1,
          task_key: "phase1_task1",
          title: "Create workspace manifests",
          status: "completed",
          files: ["Cargo.toml", "Cargo.lock"],
          depends_on: [],
          commit_shas: [],
        },
        {
          task_index: 2,
          task_key: "phase1_task2",
          title: "Create contracts",
          status: "pending",
          files: ["contracts"],
          depends_on: ["phase1_task1"],
          commit_shas: [],
        },
      ],
    });
    write(path.join(root, "Cargo.toml"), "[workspace]\n");
    write(path.join(root, "Cargo.lock"), "# initial lock\n");
    git(root, ["add", "Cargo.toml", "Cargo.lock", "cadre/config.json"]);
    git(root, ["commit", "-m", "feat: seed completed workspace manifests"]);
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    const baselineSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();

    const dispatched = core.workflowPacketV1(root, { workflow: "implement", trackId, execute: true });
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
    const state = readJson(path.join(root, "cadre", "tracks", trackId, "implement_state.json"));
    assert.equal(state.sequential_dispatch.task_key, "phase1_task2");
    assert.equal(state.sequential_dispatch.baseline_sha, baselineSha);
    assert.equal(state.sequential_dispatch.dispatch_clean, true);

    write(path.join(integration, "Cargo.toml"), "[workspace]\nmembers = [\"crates/shared-contracts\"]\n");
    write(path.join(integration, "contracts", "openapi", "v1", "openapi.yaml"), "openapi: 3.1.0\n");
    const resumed = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.data.implementation_guard.dispatch_clean, true);
    const completeInput = resumed.data.task.complete_packet.arguments.input;
    assert.equal(completeInput.dispatchClean, true);
    assert.equal(completeInput.baselineSha, baselineSha);
    const completed = core.completeTask(root, {
      ...completeInput,
      filesChanged: ["Cargo.toml", "contracts/openapi/v1/openapi.yaml"],
      command: "printf 'Statements : 95%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.deepEqual(completed.product_commit.files, ["Cargo.toml", "contracts/openapi/v1/openapi.yaml"]);
    assert.equal(git(integration, ["status", "--porcelain"]).stdout.trim(), "");
  },
));

test("implement returns a state-only retry after the product commit succeeds but task-state recording fails", () => withRoot(
  "cadre-product-commit-state-recovery-contract-",
  (root) => {
    const trackId = "product-commit-state-recovery";
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      tasks: [{
        task_index: 1,
        task_key: "phase1_task1",
        title: "Create recoverable product",
        status: "pending",
        files: ["src/recoverable.js"],
        depends_on: [],
        commit_shas: [],
      }],
    });
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    const baselineSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();
    write(path.join(integration, "src", "recoverable.js"), "export const recoverable = true;\n");
    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const planBefore = fs.readFileSync(planPath, "utf8");
    const counter = path.join(root, "cadre", "local", "coverage-count.txt");
    const coverageScript = [
      "const fs=require('fs')",
      "fs.mkdirSync(require('path').dirname(process.argv[2]),{recursive:true})",
      "fs.appendFileSync(process.argv[2],'run\\n')",
      "fs.unlinkSync(process.argv[1])",
      "console.log('Statements : 96%')",
    ].join(";");
    const failed = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: integration,
      baselineSha,
      dispatchClean: true,
      filesChanged: ["src/recoverable.js"],
      command: `node -e ${JSON.stringify(coverageScript)} ${JSON.stringify(planPath)} ${JSON.stringify(counter)}`,
      coverageThreshold: 80,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.stage, "record_task_result");
    const productSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();
    assert.notEqual(productSha, baselineSha);
    assert.equal(git(integration, ["status", "--porcelain"]).stdout.trim(), "");
    assert.equal(fs.readFileSync(counter, "utf8"), "run\n");
    const journalPath = path.join(root, "cadre", "tracks", trackId, "completion_journal.json");
    let journal = readJson(journalPath);
    const intent = Object.entries(journal.entries).find(([key]) => key.startsWith("intent:"));
    assert.ok(intent);
    assert.equal(intent[1].stage, "record_task_result_failed");
    assert.equal(intent[1].commit_sha, productSha);
    assert.deepEqual(intent[1].dirty_files, ["src/recoverable.js"]);

    write(planPath, planBefore);
    const recovery = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(recovery.ok, true, JSON.stringify(recovery));
    assert.equal(recovery.phase, "state_recovery_ready");
    assert.equal(recovery.decision.kind, "task_state_recovery");
    assert.equal(recovery.next.arguments.input.stateRecovery, true);
    assert.equal(recovery.next.arguments.input.completionJournalKey, intent[0]);
    assert.equal(recovery.next.arguments.input.command, undefined);

    const recovered = core.completeTask(root, recovery.next.arguments.input);
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(git(integration, ["rev-parse", "HEAD"]).stdout.trim(), productSha);
    assert.equal(fs.readFileSync(counter, "utf8"), "run\n", "state-only recovery must not rerun coverage");
    const repairedPlan = readJson(planPath);
    assert.equal(repairedPlan.phases[0].tasks[0].status, "completed");
    assert.deepEqual(repairedPlan.phases[0].tasks[0].commit_shas, [productSha.slice(0, 12)]);
    journal = readJson(journalPath);
    assert.equal(journal.entries[intent[0]].stage, "completed");
    assert.equal(git(root, ["status", "--porcelain", "--untracked-files=no"]).stdout.trim(), "");
  },
));

test("a commit hook cannot smuggle an unclaimed path into a task product commit", () => withRoot(
  "cadre-product-commit-membership-contract-",
  (root) => {
    const trackId = "product-commit-membership";
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      tasks: [{
        task_index: 1,
        task_key: "phase1_task1",
        title: "Create claimed product",
        status: "pending",
        files: ["src/claimed.js"],
        depends_on: [],
        commit_shas: [],
      }],
    });
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    const baselineSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();
    write(path.join(integration, "src", "claimed.js"), "export const claimed = true;\n");
    const hookRelative = git(integration, ["rev-parse", "--git-path", "hooks/pre-commit"]).stdout.trim();
    const hookPath = path.resolve(integration, hookRelative);
    write(hookPath, "#!/bin/sh\nprintf 'smuggled\\n' > unclaimed.txt\ngit add unclaimed.txt\n");
    fs.chmodSync(hookPath, 0o755);
    const blocked = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: integration,
      baselineSha,
      dispatchClean: true,
      filesChanged: ["src/claimed.js"],
      command: "printf 'Statements : 98%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "product_commit_integrity");
    assert.equal(blocked.recovery_required, false);
    assert.equal(blocked.retry_ready, true);
    assert.equal(blocked.rollback.ok, true, JSON.stringify(blocked));
    assert.deepEqual(blocked.expected_files, ["src/claimed.js"]);
    assert.deepEqual(blocked.actual_files, ["src/claimed.js", "unclaimed.txt"]);
    assert.equal(git(integration, ["rev-parse", "HEAD"]).stdout.trim(), baselineSha);
    assert.equal(git(integration, ["diff", "--cached", "--name-only"]).stdout, "");
    assert.deepEqual(git(integration, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim().split(/\n/).sort(), ["?? src/claimed.js", "?? unclaimed.txt"]);
    const plan = readJson(path.join(root, "cadre", "tracks", trackId, "plan.json"));
    assert.equal(plan.phases[0].tasks[0].status, "pending");
    const journal = readJson(path.join(root, "cadre", "tracks", trackId, "completion_journal.json"));
    const intent = Object.entries(journal.entries).find(([key]) => key.startsWith("intent:"));
    assert.ok(intent);
    assert.equal(intent[1].stage, "commit_pending");
    const rerun = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(rerun.ok, false);
    assert.equal(rerun.next, null);
    fs.rmSync(hookPath);
    fs.rmSync(path.join(integration, "unclaimed.txt"), { force: true });
    const retried = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: integration,
      baselineSha,
      dispatchClean: true,
      filesChanged: ["src/claimed.js"],
      command: "printf 'Statements : 98%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
  },
));

test("state-only recovery resumes at the failed control-commit stage without duplicating task events", () => withRoot(
  "cadre-control-commit-stage-recovery-contract-",
  (root) => {
    const trackId = "control-commit-stage-recovery";
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      tasks: [{
        task_index: 1,
        task_key: "phase1_task1",
        title: "Create stage-aware recovery",
        status: "pending",
        files: ["src/stage-aware.js"],
        depends_on: [],
        commit_shas: [],
      }],
    });
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    const baselineSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();
    write(path.join(integration, "src", "stage-aware.js"), "export const stageAware = true;\n");
    const hookRelative = git(root, ["rev-parse", "--git-path", "hooks/commit-msg"]).stdout.trim();
    const hookPath = path.resolve(root, hookRelative);
    write(hookPath, "#!/bin/sh\nif grep -q '^cadre(complete):' \"$1\"; then exit 19; fi\nexit 0\n");
    fs.chmodSync(hookPath, 0o755);

    const failed = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: integration,
      baselineSha,
      dispatchClean: true,
      filesChanged: ["src/stage-aware.js"],
      command: "printf 'Statements : 97%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.control_commit.stage, "git_commit");
    const journalPath = path.join(root, "cadre", "tracks", trackId, "completion_journal.json");
    const failedJournal = readJson(journalPath);
    const intent = Object.entries(failedJournal.entries).find(([key]) => key.startsWith("intent:"));
    assert.ok(intent);
    assert.equal(intent[1].stage, "control_commit_failed");
    const eventPath = path.join(root, "cadre", "events.jsonl");
    const taskEventsBefore = fs.readFileSync(eventPath, "utf8").trim().split(/\n/).map(JSON.parse)
      .filter((event) => event.track_id === trackId && ["task_result_recorded", "task_completed"].includes(event.kind));
    assert.deepEqual(taskEventsBefore.map((event) => event.kind).sort(), ["task_completed", "task_result_recorded"]);

    fs.rmSync(hookPath);
    const recovery = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(recovery.ok, true, JSON.stringify(recovery));
    assert.equal(recovery.phase, "state_recovery_ready");
    const recovered = core.completeTask(root, recovery.next.arguments.input);
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    const taskEventsAfter = fs.readFileSync(eventPath, "utf8").trim().split(/\n/).map(JSON.parse)
      .filter((event) => event.track_id === trackId && ["task_result_recorded", "task_completed"].includes(event.kind));
    assert.equal(taskEventsAfter.length, taskEventsBefore.length);
    assert.equal(git(root, ["status", "--porcelain", "--untracked-files=no"]).stdout.trim(), "");
  },
));

test("manual verification state recovery does not rerun the approved verification command", () => withRoot(
  "cadre-manual-state-recovery-contract-",
  (root) => {
    const trackId = "manual-state-recovery";
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: { enabled: true, auto_product_commits: true, auto_control_commits: true, git_notes: false },
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      tasks: [{
        task_index: 1,
        task_key: "phase1_manual_verification",
        title: "User Manual Verification",
        status: "pending",
        task_type: "user_manual_verification",
        files: [],
        depends_on: [],
        manual_verification: { scope: "phase", suggested_checks: [] },
      }],
    });
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const planBefore = fs.readFileSync(planPath, "utf8");
    const counter = path.join(root, "cadre", "local", "manual-count.txt");
    const commandScript = [
      "const fs=require('fs')",
      "fs.mkdirSync(require('path').dirname(process.argv[2]),{recursive:true})",
      "fs.appendFileSync(process.argv[2],'run\\n')",
      "fs.unlinkSync(process.argv[1])",
      "console.log('manual ok')",
    ].join(";");
    const failed = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: integration,
      approvalComplete: true,
      manualVerificationMode: "autorun",
      manualVerificationCommand: `node -e ${JSON.stringify(commandScript)} ${JSON.stringify(planPath)} ${JSON.stringify(counter)}`,
      manualVerificationSummary: "Approved manual verification.",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.stage, "record_task_result");
    assert.equal(fs.readFileSync(counter, "utf8"), "run\n");
    write(planPath, planBefore);

    const recovery = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(recovery.ok, true, JSON.stringify(recovery));
    assert.equal(recovery.phase, "state_recovery_ready");
    assert.equal(recovery.next.arguments.input.stateRecovery, true);
    const recovered = core.completeTask(root, recovery.next.arguments.input);
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(fs.readFileSync(counter, "utf8"), "run\n");
    const repairedPlan = readJson(planPath);
    assert.equal(repairedPlan.phases[0].tasks[0].status, "completed");
    assert.equal(repairedPlan.phases[0].tasks[0].completion_evidence.manual_verification.summary, "Approved manual verification.");
  },
));

test("manual verification cannot change HEAD even when it leaves the worktree clean", () => withRoot(
  "cadre-manual-head-drift-contract-",
  (root) => {
    const trackId = "manual-head-drift";
    seedImplementTrack(root, trackId, {
      tasks: [{
        task_index: 1,
        task_key: "phase1_manual_verification",
        title: "User Manual Verification",
        status: "pending",
        task_type: "user_manual_verification",
        files: [],
        depends_on: [],
        manual_verification: { scope: "phase", suggested_checks: [] },
      }],
    });
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    const baselineSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();
    const command = "printf 'verified\\n' > manual-proof.txt && git add manual-proof.txt && git -c commit.gpgsign=false -c user.name=Verifier -c user.email=verifier@example.invalid commit -m 'test: verification drift'";
    const blocked = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: integration,
      approvalComplete: true,
      manualVerificationMode: "autorun",
      manualVerificationCommand: command,
      manualVerificationSummary: "Approved a command that must not move HEAD.",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "implementation_baseline");
    assert.equal(blocked.expected_head, baselineSha);
    assert.notEqual(blocked.actual_head, baselineSha);
    assert.equal(git(integration, ["status", "--porcelain"]).stdout.trim(), "");
    const plan = readJson(path.join(root, "cadre", "tracks", trackId, "plan.json"));
    assert.equal(plan.phases[0].tasks[0].status, "pending");
  },
));

test("trace-disabled completion markers remain isolated between tracks", () => withRoot(
  "cadre-completion-marker-track-isolation-contract-",
  (root) => {
    const firstTrack = "marker-isolation-first";
    const secondTrack = "marker-isolation-second";
    const manualTask = {
      task_index: 1,
      task_key: "phase1_manual_verification",
      title: "User Manual Verification",
      status: "pending",
      task_type: "user_manual_verification",
      files: [],
      depends_on: [],
      manual_verification: { scope: "phase", suggested_checks: [] },
    };
    write(path.join(root, "README.md"), "# Completion marker isolation\n");
    writeImplementTrack(root, firstTrack, { tasks: [manualTask] });
    writeImplementTrack(root, secondTrack, {
      tasks: [manualTask],
      expectedTrackIds: [firstTrack, secondTrack],
    });
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed marker-isolation tracks"]);
    for (const trackId of [firstTrack, secondTrack]) {
      const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
      assert.equal(setup.ok, true, JSON.stringify(setup));
    }
    for (const trackId of [firstTrack, secondTrack]) {
      const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
      const completed = core.completeTask(root, {
        trackId,
        phaseIndex: 1,
        taskIndex: 1,
        workingRoot: integration,
        approvalComplete: true,
        manualVerificationMode: "autorun",
        manualVerificationCommand: "true",
        manualVerificationSummary: `Approved ${trackId}.`,
      });
      assert.equal(completed.ok, true, JSON.stringify(completed));
      assert.equal(completed.control_commit.skipped, true);
    }
    const markerDirectory = path.join(root, "cadre", "local", "completion-intents");
    assert.equal(fs.readdirSync(markerDirectory).filter((file) => file.endsWith(".json")).length, 2);
    const firstResume = core.workflowPacketV1(root, { workflow: "implement", trackId: firstTrack });
    assert.notEqual(firstResume.phase, "state_recovery_ready", JSON.stringify(firstResume));
    assert.notEqual(firstResume.decision?.kind, "task_state_recovery", JSON.stringify(firstResume));
  },
));

test("a corrupt completion journal blocks implementation and task completion", () => withRoot(
  "cadre-corrupt-completion-journal-contract-",
  (root) => {
    const trackId = "corrupt-completion-journal";
    seedImplementTrack(root, trackId);
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    write(path.join(root, "cadre", "tracks", trackId, "completion_journal.json"), "{not-json\n");

    const implement = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(implement.ok, false);
    assert.equal(implement.data.stage, "completion_journal");
    assert.equal(implement.next, null);
    const completion = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: integration,
      allowNoCommit: true,
    });
    assert.equal(completion.ok, false);
    assert.equal(completion.stage, "completion_journal");
  },
));

test("implement returns and completes a HEAD-pinned repair for a partially staged task", () => withRoot(
  "cadre-implement-partial-task-repair-contract-",
  (root) => {
    const trackId = "partial-task-repair";
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      traceability: {
        enabled: true,
        auto_product_commits: true,
        auto_control_commits: true,
        git_notes: false,
      },
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      tasks: [
        {
          task_index: 1,
          task_key: "phase1_task1",
          title: "Create workspace manifests",
          status: "completed",
          files: ["Cargo.toml", "Cargo.lock"],
          depends_on: [],
          commit_shas: [],
        },
        {
          task_index: 2,
          task_key: "phase1_task2",
          title: "Create native recipes",
          status: "completed",
          files: ["justfile"],
          depends_on: [],
          commit_shas: [],
        },
        {
          task_index: 3,
          task_key: "phase1_task3",
          title: "Create shared contracts",
          status: "pending",
          files: [
            ".env.example",
            "infra/.env.example",
            "contracts/event-schema",
            "contracts/openapi",
            "contracts/proto",
            "crates/shared-contracts",
            "packages/shared-types",
          ],
          depends_on: ["phase1_task1"],
          commit_shas: [],
        },
        {
          task_index: 4,
          task_key: "phase1_manual_verification",
          title: "User Manual Verification",
          status: "pending",
          task_type: "user_manual_verification",
          files: [],
          depends_on: ["phase1_task3"],
          manual_verification: { scope: "phase", suggested_checks: [] },
        },
      ],
    });
    write(path.join(root, "Cargo.toml"), "[workspace]\n");
    write(path.join(root, "Cargo.lock"), "# initial lock\n");
    git(root, ["add", "Cargo.toml", "Cargo.lock"]);
    git(root, ["commit", "-m", "feat: create workspace manifests"]);
    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");

    write(path.join(integration, ".env.example"), "DATABASE_URL=\n");
    write(path.join(integration, "infra", ".env.example"), "REDIS_URL=\n");
    git(integration, ["add", ".env.example", "infra/.env.example"]);
    git(integration, ["commit", "-m", "feat: partial shared contracts"]);
    const partialSha = git(integration, ["rev-parse", "HEAD"]).stdout.trim();
    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const plan = readJson(planPath);
    plan.phases[0].tasks[2].status = "completed";
    plan.phases[0].tasks[2].commit_shas = [partialSha.slice(0, 12)];
    write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const metadataPath = path.join(root, "cadre", "tracks", trackId, "metadata.json");
    const metadata = readJson(metadataPath);
    metadata.last_task_result = { task_key: "phase1_task3", commit_sha: partialSha.slice(0, 12) };
    metadata.last_test_run = {
      command: "printf 'Statements : 94%%\\n'",
      ok: true,
      status: 0,
      coverage: 94,
      threshold: 80,
      allow_missing_coverage: false,
      allow_low_coverage: false,
    };
    write(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    const residual = [
      "Cargo.lock",
      "Cargo.toml",
      "contracts/event-schema/v1/event-envelope.schema.json",
      "contracts/openapi/v1/openapi.yaml",
      "contracts/proto/v1/common.proto",
      "crates/shared-contracts/Cargo.toml",
      "crates/shared-contracts/src/lib.rs",
      "packages/shared-types/package.json",
      "packages/shared-types/src/index.ts",
    ];
    for (const file of residual) write(path.join(integration, file), `${file}\n`);
    const manifestStatus = git(integration, ["status", "--porcelain=v1", "--", "Cargo.toml", "Cargo.lock"]).stdout;
    assert.match(manifestStatus, / M Cargo\.lock/);
    assert.match(manifestStatus, / M Cargo\.toml/);

    write(path.join(integration, "unclaimed.txt"), "must block\n");
    const unclaimed = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(unclaimed.ok, false);
    assert.equal(unclaimed.phase, "blocked");
    assert.equal(unclaimed.next, null);
    assert.match(unclaimed.errors[0], /outside the completed task scope/i);
    fs.rmSync(path.join(integration, "unclaimed.txt"));

    const ambiguousPlan = readJson(planPath);
    ambiguousPlan.phases[0].tasks[1].commit_shas = [partialSha.slice(0, 12)];
    write(planPath, `${JSON.stringify(ambiguousPlan, null, 2)}\n`);
    const ambiguous = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.next, null);
    assert.match(ambiguous.errors[0], /multiple completed tasks/i);
    ambiguousPlan.phases[0].tasks[1].commit_shas = [];
    write(planPath, `${JSON.stringify(ambiguousPlan, null, 2)}\n`);

    const repair = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(repair.ok, true, JSON.stringify(repair));
    assert.equal(repair.phase, "reconciliation_ready");
    assert.equal(repair.decision.kind, "task_reconciliation");
    assert.equal(repair.next.arguments.action, "task.complete");
    const repairInput = repair.next.arguments.input;
    assert.equal(repairInput.trackId, trackId);
    assert.equal(repairInput.phaseIndex, 1);
    assert.equal(repairInput.taskIndex, 3);
    assert.equal(repairInput.workingRoot, integration);
    assert.equal(repairInput.baselineSha, partialSha);
    assert.match(repairInput.changeSetFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(repairInput.reconcileCommit, true);
    assert.deepEqual(repairInput.filesChanged, residual);
    assert.equal(repairInput.command, metadata.last_test_run.command);
    assert.equal(repairInput.coverageThreshold, 80);
    assert.equal(repairInput.allowMissingCoverage, false);
    assert.equal(repairInput.allowLowCoverage, false);
    assert.equal(repair.required.length, 0);

    const driftFile = path.join(integration, residual[2]);
    const originalDriftContent = fs.readFileSync(driftFile, "utf8");
    write(driftFile, "changed after packet\n");
    const drifted = core.completeTask(root, repairInput);
    assert.equal(drifted.ok, false);
    assert.equal(drifted.stage, "implementation_baseline");
    assert.equal(git(integration, ["rev-parse", "HEAD"]).stdout.trim(), partialSha);
    write(driftFile, originalDriftContent);

    const reconciled = core.completeTask(root, repairInput);
    assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    assert.deepEqual(reconciled.product_commit.files, residual);
    assert.equal(git(integration, ["status", "--porcelain"]).stdout.trim(), "");
    const repairedPlan = readJson(planPath);
    assert.deepEqual(repairedPlan.phases[0].tasks[2].commit_shas, [
      partialSha.slice(0, 12),
      reconciled.product_commit.commit_sha.slice(0, 12),
    ]);

    const manual = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(manual.ok, true, JSON.stringify(manual));
    assert.equal(manual.phase, "implementation_ready");
    assert.equal(manual.data.task.task_key, "phase1_manual_verification");
    assert.equal(manual.data.implementation_guard.clean, true);
  },
));

test("implement fails closed when the integration path is not the expected checked-out worktree", () => withRoot(
  "cadre-implement-unhealthy-worktree-contract-",
  (root) => {
    const trackId = "unhealthy-worktree";
    seedImplementTrack(root, trackId);
    git(root, ["branch", "-M", `track/${trackId}`]);
    const integration = path.join(root, ".worktrees", "cadre", "tracks", trackId, "integrate", "root");
    fs.mkdirSync(integration, { recursive: true });
    write(path.join(integration, "not-a-worktree.txt"), "unsafe placeholder\n");

    const blocked = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.next, null);
    assert.equal(blocked.data.integration_worktrees.branch_set[0].health, "wrong_repo");
    assert.equal(blocked.data.task, undefined);
  },
));

test("parallel implement provisions integration before scheduling a worker wave", () => withRoot(
  "cadre-parallel-implement-worktree-contract-",
  (root) => {
    const trackId = "parallel-worktree";
    seedImplementTrack(root, trackId, {
      executionMode: "parallel",
      tasks: [
        { ...samplePlan(trackId).phases[0].tasks[0], task_index: 1, task_key: "phase1_task1", title: "Build API", files: ["src/api.js"] },
        { ...samplePlan(trackId).phases[0].tasks[0], task_index: 2, task_key: "phase1_task2", title: "Build UI", files: ["src/ui.js"] },
      ],
    });
    const missing = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId,
      agentIdentifier: "codex",
      maxWorkers: 2,
    });
    assert.deepEqual(missing.next, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "track.worktree_plan",
        input: { trackId, repo: "root", agentIdentifier: "codex", maxWorkers: 2 },
        execute: true,
      },
    });

    const setup = core.worktreePlan(root, { trackId, repo: "root", execute: true });
    assert.equal(setup.ok, true, setup.error);
    const ready = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId,
      agentIdentifier: "codex",
      maxWorkers: 2,
    });
    assert.deepEqual(ready.next, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "parallel.next_wave",
        input: { trackId, groupIndex: 0, agentIdentifier: "codex", maxWorkers: 2 },
      },
    });
  },
));

test("polyrepo implement provisions every affected integration worktree", () => withRoot(
  "cadre-polyrepo-implement-worktree-contract-",
  (root) => {
    const trackId = "polyrepo-worktrees";
    for (const repo of ["api", "web"]) {
      const repoRoot = path.join(root, "repos", repo);
      fs.mkdirSync(repoRoot, { recursive: true });
      git(repoRoot, ["init", "-b", "master"]);
      write(path.join(repoRoot, "README.md"), `# ${repo}\n`);
      git(repoRoot, ["add", "."]);
      git(repoRoot, ["commit", "-m", `seed ${repo}`]);
    }
    write(path.join(root, "cadre", "repos.json"), `${JSON.stringify({
      mode: "polyrepo",
      default_repo: "api",
      repos: ["api", "web"].map((repo) => ({
        name: repo,
        submodule_path: `repos/${repo}`,
        default_branch: "master",
      })),
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      polyrepo: true,
      executionMode: "parallel",
      tasks: [
        { ...samplePlan(trackId).phases[0].tasks[0], task_index: 1, task_key: "phase1_task1", title: "Build API", repo: "api", files: ["src/api.js"] },
        { ...samplePlan(trackId).phases[0].tasks[0], task_index: 2, task_key: "phase1_task2", title: "Build Web", repo: "web", files: ["src/web.js"] },
      ],
    });
    const missing = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId,
      agentIdentifier: "codex",
    });
    assert.deepEqual(missing.next, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "track.worktree_plan",
        input: { trackId, agentIdentifier: "codex" },
        execute: true,
      },
    });

    const setup = core.worktreePlan(root, { trackId, execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    assert.deepEqual(setup.branch_set.map((entry) => entry.repo).sort(), ["api", "web"]);
    for (const entry of setup.branch_set) {
      assert.equal(entry.health, "ready", entry.repo);
      assert.equal(fs.existsSync(entry.integration_worktree), true, entry.repo);
      assert.equal(git(entry.integration_worktree, ["branch", "--show-current"]).stdout.trim(), `track/${trackId}`);
    }
  },
));

test("polyrepo omitted repos resolve only to the configured default during continuation and dependency scoping", () => withRoot(
  "cadre-polyrepo-default-repo-scope-contract-",
  (root) => {
    const trackId = "polyrepo-default-repo-scope";
    for (const repo of ["api", "web"]) {
      const repoRoot = path.join(root, "repos", repo);
      fs.mkdirSync(repoRoot, { recursive: true });
      git(repoRoot, ["init", "-b", "master"]);
      write(path.join(repoRoot, "README.md"), `# ${repo}\n`);
      git(repoRoot, ["add", "."]);
      git(repoRoot, ["commit", "-m", `seed ${repo}`]);
    }
    write(path.join(root, "cadre", "repos.json"), `${JSON.stringify({
      mode: "polyrepo",
      default_repo: "api",
      repos: ["api", "web"].map((repo) => ({
        name: repo,
        submodule_path: `repos/${repo}`,
        default_branch: "master",
      })),
    }, null, 2)}\n`);
    seedImplementTrack(root, trackId, {
      polyrepo: true,
      tasks: [
        {
          task_index: 1,
          task_key: "phase1_task1",
          title: "Default API dependency",
          status: "completed",
          files: ["shared.txt"],
          depends_on: [],
          commit_shas: [],
        },
        {
          task_index: 2,
          task_key: "phase1_task2",
          title: "Explicit web task",
          status: "pending",
          repo: "web",
          files: ["src/web.js"],
          depends_on: ["phase1_task1"],
          commit_shas: [],
        },
        {
          task_index: 3,
          task_key: "phase1_task3",
          title: "Default API continuation",
          status: "pending",
          files: ["src/default.js"],
          depends_on: ["phase1_task2"],
          commit_shas: [],
        },
      ],
    });
    const setup = core.worktreePlan(root, { trackId, execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const api = setup.branch_set.find((entry) => entry.repo === "api").integration_worktree;
    const web = setup.branch_set.find((entry) => entry.repo === "web").integration_worktree;
    const webPacket = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(webPacket.data.task.task_key, "phase1_task2");
    write(path.join(web, "src", "web.js"), "export const web = true;\n");
    write(path.join(web, "shared.txt"), "must stay in default api\n");
    const crossRepo = core.completeTask(root, {
      ...webPacket.data.task.complete_packet.arguments.input,
      command: "printf 'Statements : 92%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(crossRepo.ok, false);
    assert.equal(crossRepo.stage, "product_change_set");
    assert.deepEqual(crossRepo.change_set.unclaimed_files, ["shared.txt"]);
    fs.rmSync(path.join(web, "src"), { recursive: true, force: true });
    fs.rmSync(path.join(web, "shared.txt"));

    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const plan = readJson(planPath);
    plan.phases[0].tasks[1].status = "completed";
    write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    write(path.join(api, "src", "default.js"), "export const api = true;\n");
    const continuation = core.workflowPacketV1(root, { workflow: "implement", trackId });
    assert.equal(continuation.ok, true, JSON.stringify(continuation));
    assert.equal(continuation.phase, "implementation_ready");
    assert.equal(continuation.data.task.task_key, "phase1_task3");
    assert.equal(continuation.data.task.complete_packet.arguments.input.dispatchClean, false);
    assert.equal(continuation.data.task.complete_packet.arguments.input.workingRoot, api);
  },
));

test("parallel worker setup blocks the whole wave when any affected repo drifts unhealthy", () => withRoot(
  "cadre-polyrepo-parallel-readiness-race-contract-",
  (root) => {
    const trackId = "polyrepo-readiness-race";
    for (const repo of ["api", "web"]) {
      const repoRoot = path.join(root, "repos", repo);
      fs.mkdirSync(repoRoot, { recursive: true });
      git(repoRoot, ["init", "-b", "master"]);
      write(path.join(repoRoot, "README.md"), `# ${repo}\n`);
      git(repoRoot, ["add", "."]);
      git(repoRoot, ["commit", "-m", `seed ${repo}`]);
    }
    write(path.join(root, "cadre", "repos.json"), `${JSON.stringify({
      mode: "polyrepo",
      default_repo: "api",
      repos: ["api", "web"].map((repo) => ({
        name: repo,
        submodule_path: `repos/${repo}`,
        default_branch: "master",
      })),
    }, null, 2)}\n`);
    const baseTask = samplePlan(trackId).phases[0].tasks[0];
    writeImplementTrack(root, trackId, {
      polyrepo: true,
      executionMode: "parallel",
      tasks: [{ ...baseTask, repo: "api", files: ["src/api.js"] }],
    });
    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const plan = readJson(planPath);
    plan.phases.push({
      phase_index: 2,
      title: "Phase 2: Web",
      execution_mode: "sequential",
      depends_on: ["phase1"],
      tasks: [{
        ...baseTask,
        task_index: 1,
        task_key: "phase2_task1",
        title: "Build Web",
        repo: "web",
        files: ["src/web.js"],
        depends_on: ["phase1_task1"],
      }],
    });
    write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed readiness race track"]);

    const setup = core.worktreePlan(root, { trackId, execute: true });
    assert.equal(setup.ok, true, JSON.stringify(setup));
    const webIntegration = setup.branch_set.find((entry) => entry.repo === "web").integration_worktree;
    git(webIntegration, ["checkout", "-b", "wrong/future-web"]);

    const blocked = core.parallelWorkflow(root, {
      action: "setup_workers",
      trackId,
      groupIndex: 0,
      agentIdentifier: "codex",
      execute: true,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "integration_worktree_health");
    assert.deepEqual(blocked.workers, []);
    assert.equal(
      fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", trackId, "workers", "api", "phase1_task1")),
      false,
    );
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "parallel_state.json")), false);
  },
));
