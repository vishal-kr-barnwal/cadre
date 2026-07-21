#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const core = require("./cadre-core");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function git(root, args) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function approvalStamp(approval) {
  return {
    approvalStageHash: approval.current_stage_hash,
    approvalStageRevision: approval.current_stage_revision,
  };
}

function projectionBody(file) {
  return fs.readFileSync(file, "utf8").replace(/^<!-- cadre:generated[^\n]*-->\n/, "");
}

const techStack = {
  version: 1,
  schema: "cadre.tech_stack.v1",
  kind: "tech_stack",
  updated_at: "2026-07-18T01:02:03.000Z",
  title: "Runtime Architecture",
  summary: "A typed web service with explicit local validation.",
  languages: ["TypeScript 5.8"],
  frameworks: ["Fastify 5"],
  runtimes: ["Node.js 22"],
  platforms: ["Linux containers"],
  packageManagers: ["pnpm 11"],
  buildCommand: "pnpm build",
  testing: { command: "pnpm test", framework: "node:test" },
  datastores: ["PostgreSQL 17"],
  services: ["OpenTelemetry collector"],
  keyDependencies: ["zod 4"],
  styleGuideIds: ["typescript"],
  customPlatformPolicy: { enabled: false, retryLimit: 0, tags: [] },
  emptyTechnologyNote: "",
  emptyTechnologyOptions: {},
  nullableRuntimeOwner: null,
};

const workflowPolicy = {
  version: 1,
  schema: "cadre.workflow.v1",
  kind: "workflow",
  updated_at: "2026-07-18T04:05:06.000Z",
  title: "Delivery Workflow",
  summary: "Every change moves through an evidence-backed lifecycle.",
  principles: ["Prefer contract tests before implementation"],
  providerMode: "local-first",
  taskLifecycle: ["Select", "Implement", "Verify", "Complete"],
  completeTaskPolicy: ["Record completion only after focused tests pass"],
  commitPolicy: ["One coherent product commit per task"],
  branchPolicy: ["Use the track branch in its integration worktree"],
  topology: "polyrepo",
  repos: ["api", "web"],
  repoCommands: { api: "pnpm --filter api test", web: "pnpm --filter web test" },
  preferredTestCommand: "pnpm test",
  testCommand: "pnpm test -- --runInBand",
  coverageCommand: "pnpm coverage",
  reviewGate: "two-person-review",
  reviewFocus: ["API compatibility"],
  qualityBar: ["No new type errors"],
  phaseCompletion: ["Review phase evidence before advancing"],
  manualVerification: ["Exercise the primary user journey"],
  coveragePolicy: { minimum: 92, required: true },
  formatCommand: "pnpm format:check",
  buildCommand: "pnpm build",
  developmentCommands: ["pnpm lint"],
  changeControl: { enabled: false, owner: "release-captain", retryLimit: 0 },
  emptyPolicy: "",
  emptyOptions: {},
  nullableApprover: null,
  sections: [
    {
      id: "custom_release_check",
      heading: "Custom Release Check",
      purpose: "Capture the release sentinel purpose.",
      expectedFields: ["canaryWindowSentinel"],
      example: { canaryWindowSentinel: "ten minutes" },
      body: "Confirm the canary remains healthy for ten minutes.",
      escalationOwner: "on-call lead",
      emptySectionNote: "",
      emptySectionOptions: {},
      nullableSectionOwner: null,
    },
  ],
};

test("semantic renderers produce readable complete TechStack and Workflow projections", () => {
  const techMarkdown = core.renderTechStackMarkdown(techStack);
  assert.match(techMarkdown, /^# Runtime Architecture/m);
  assert.match(techMarkdown, /^## Languages and Frameworks/m);
  assert.match(techMarkdown, /^## Document Metadata/m);
  assert.match(techMarkdown, /cadre\.tech_stack\.v1/);
  assert.match(techMarkdown, /2026-07-18T01:02:03\.000Z/);
  assert.match(techMarkdown, /TypeScript 5\.8/);
  assert.match(techMarkdown, /pnpm build/);
  assert.match(techMarkdown, /PostgreSQL 17/);
  assert.match(techMarkdown, /^## Additional Details/m);
  assert.match(techMarkdown, /Custom Platform Policy/);
  assert.match(techMarkdown, /\*\*Enabled:\*\* false/);
  assert.match(techMarkdown, /\*\*Retry Limit:\*\* 0/);
  assert.match(techMarkdown, /^### Empty Technology Note/m);
  assert.match(techMarkdown, /^### Empty Technology Options/m);
  assert.match(techMarkdown, /^### Nullable Runtime Owner/m);
  assert.match(techMarkdown, /_Empty\._/);
  assert.match(techMarkdown, /_Not specified\._/);
  assert.match(techMarkdown, /_None configured\._/);
  assert.doesNotMatch(techMarkdown, /```json/);

  const workflowMarkdown = core.renderWorkflowMarkdown(workflowPolicy);
  for (const expected of [
    "Prefer contract tests before implementation",
    "local-first",
    "Select",
    "Implement",
    "Verify",
    "Complete",
    "Record completion only after focused tests pass",
    "One coherent product commit per task",
    "Use the track branch in its integration worktree",
    "polyrepo",
    "api",
    "web",
    "pnpm --filter api test",
    "pnpm --filter web test",
    "pnpm test",
    "pnpm test -- --runInBand",
    "pnpm coverage",
    "two-person-review",
    "API compatibility",
    "No new type errors",
    "Review phase evidence before advancing",
    "Exercise the primary user journey",
    "pnpm format:check",
    "pnpm build",
    "pnpm lint",
    "Confirm the canary remains healthy for ten minutes.",
    "Capture the release sentinel purpose.",
    "canaryWindowSentinel",
    "ten minutes",
    "on-call lead",
    "release-captain",
  ]) assert.match(workflowMarkdown, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workflowMarkdown, /^## Additional Details/m);
  assert.match(workflowMarkdown, /^## Document Metadata/m);
  assert.match(workflowMarkdown, /cadre\.workflow\.v1/);
  assert.match(workflowMarkdown, /2026-07-18T04:05:06\.000Z/);
  assert.match(workflowMarkdown, /^#### ID/m);
  assert.match(workflowMarkdown, /^#### Heading/m);
  assert.match(workflowMarkdown, /^#### Purpose/m);
  assert.match(workflowMarkdown, /^#### Expected Fields/m);
  assert.match(workflowMarkdown, /^#### Example/m);
  assert.match(workflowMarkdown, /^### Change Control/m);
  assert.match(workflowMarkdown, /^### Empty Policy/m);
  assert.match(workflowMarkdown, /^### Empty Options/m);
  assert.match(workflowMarkdown, /^### Nullable Approver/m);
  assert.match(workflowMarkdown, /^#### Empty Section Note/m);
  assert.match(workflowMarkdown, /^#### Empty Section Options/m);
  assert.match(workflowMarkdown, /^#### Nullable Section Owner/m);
  assert.match(workflowMarkdown, /\*\*Enabled:\*\* false/);
  assert.match(workflowMarkdown, /\*\*Minimum:\*\* 92/);
  assert.match(workflowMarkdown, /_Empty\._/);
  assert.match(workflowMarkdown, /_None configured\._/);
  assert.match(workflowMarkdown, /_Not specified\._/);
  assert.doesNotMatch(workflowMarkdown, /```json/);
  assert.equal(
    core.renderSemanticProjection("cadre.workflow.v1", workflowPolicy, "Fallback", "cadre/workflow.json"),
    workflowMarkdown,
  );

  const invalidStructuralValues = core.renderWorkflowMarkdown({
    version: 1,
    schema: "cadre.workflow.v1",
    title: "",
    summary: "",
    sections: null,
  }, "Fallback Workflow");
  assert.match(invalidStructuralValues, /^# Fallback Workflow/m);
  assert.match(invalidStructuralValues, /^### Title/m);
  assert.match(invalidStructuralValues, /^### Summary/m);
  assert.match(invalidStructuralValues, /^### Sections/m);
  assert.match(invalidStructuralValues, /_Empty\._/);
  assert.match(invalidStructuralValues, /_Not specified\._/);
});

test("artifact render and sync use the semantic projection registry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-semantic-artifact-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "tech-stack.json"), `${JSON.stringify(techStack, null, 2)}\n`);
    write(path.join(root, "cadre", "workflow.json"), `${JSON.stringify(workflowPolicy, null, 2)}\n`);
    const synced = core.artifactSync(root, { execute: true, commitMode: "off" });
    assert.equal(synced.ok, true, synced.errors && synced.errors.join("\n"));
    assert.ok(synced.written.includes("cadre/tech-stack.md"));
    assert.ok(synced.written.includes("cadre/workflow.md"));
    assert.equal(projectionBody(path.join(root, "cadre", "tech-stack.md")), core.renderTechStackMarkdown(techStack));
    assert.equal(projectionBody(path.join(root, "cadre", "workflow.md")), core.renderWorkflowMarkdown(workflowPolicy, "Workflow policy"));
    assert.equal(core.artifactRender(root, { artifact: "tech-stack" }).content, fs.readFileSync(path.join(root, "cadre", "tech-stack.md"), "utf8"));
    assert.equal(core.artifactRender(root, { artifact: "workflow" }).content, fs.readFileSync(path.join(root, "cadre", "workflow.md"), "utf8"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup and refresh review files share the semantic renderers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-semantic-workflow-test-"));
  try {
    git(root, ["init"]);
    const setupInput = {
      workflow: "setup",
      execute: false,
      providerMode: "local",
      syncMode: "local",
      writeLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Projection Product", summary: "Keep human review projections complete and deterministic." },
      productGuidelines: { title: "Projection Guidelines", summary: "Review every semantic field before approval." },
      techStack,
      workflowPolicy,
    };
    let preview = core.workflowPacket(root, setupInput);
    for (const stage of ["product", "product_guidelines"]) {
      assert.equal(preview.approval.current_stage, stage);
      preview = core.workflowPacket(root, {
        workflow: "setup",
        approvalSessionId: preview.approval.session_id,
        approvalStage: stage,
        ...approvalStamp(preview.approval),
        approvedStages: [...preview.approval.approved_stages, stage],
      });
    }
    assert.equal(preview.approval.current_stage, "technical");
    const sessionId = preview.approval.session_id;
    assert.equal(preview.approval.current_review_set.complete, true);
    assert.equal(preview.approval.current_review_set.truncated, false);
    const compactPacket = core.workflowPacketV1(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      responseMode: "compact",
    });
    assert.equal(compactPacket.ok, true, compactPacket.errors && compactPacket.errors.join("\n"));
    assert.equal(compactPacket.decision.review_set.complete, true);
    assert.equal(compactPacket.decision.review_set.truncated, false);
    assert.equal(compactPacket.decision.review_set.file_count, compactPacket.decision.review_set.files.length);
    assert.equal(
      projectionBody(path.join(root, "cadre", "tech-stack.md")),
      core.renderTechStackMarkdown(readJson(path.join(root, "cadre", "tech-stack.json"))),
    );
    preview = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "technical",
      ...approvalStamp(preview.approval),
      approvedStages: [...preview.approval.approved_stages, "technical"],
    });
    assert.equal(preview.approval.current_stage, "workflow");
    const reviewedWorkflow = fs.readFileSync(path.join(root, "cadre", "workflow.md"), "utf8");
    assert.equal(
      projectionBody(path.join(root, "cadre", "workflow.md")),
      core.renderWorkflowMarkdown(readJson(path.join(root, "cadre", "workflow.json")), "Project Workflow"),
    );
    preview = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "workflow",
      ...approvalStamp(preview.approval),
      approvedStages: [...preview.approval.approved_stages, "workflow"],
    });
    const executed = core.workflowPacket(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["product", "product_guidelines", "technical", "workflow"],
    });
    assert.equal(executed.ok, true, executed.error);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "workflow.md"), "utf8"), reviewedWorkflow);

    const refreshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-semantic-refresh-test-"));
    try {
      git(refreshRoot, ["init"]);
      write(path.join(refreshRoot, "cadre", "setup_state.json"), "{\"version\":1}\n");
      let refreshed = core.workflowPacket(refreshRoot, {
        workflow: "refresh",
        refreshLevels: ["tech-stack", "workflow"],
        commitMode: "off",
        techStack,
        workflowPolicy,
      });
      assert.equal(refreshed.ok, true, refreshed.error);
      assert.equal(refreshed.approval.current_stage, "technical");
      assert.equal(
        projectionBody(path.join(refreshRoot, "cadre", "tech-stack.md")),
        core.renderTechStackMarkdown(readJson(path.join(refreshRoot, "cadre", "tech-stack.json"))),
      );
      refreshed = core.workflowPacket(refreshRoot, {
        workflow: "refresh",
        approvalSessionId: refreshed.approval.session_id,
        approvalStage: "technical",
        ...approvalStamp(refreshed.approval),
        approvedStages: ["technical"],
      });
      assert.equal(refreshed.approval.current_stage, "workflow");
      assert.equal(
        projectionBody(path.join(refreshRoot, "cadre", "workflow.md")),
        core.renderWorkflowMarkdown(readJson(path.join(refreshRoot, "cadre", "workflow.json")), "Project Workflow"),
      );
    } finally {
      fs.rmSync(refreshRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
