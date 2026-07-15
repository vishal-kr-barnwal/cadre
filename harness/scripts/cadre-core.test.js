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

function writeProjectSkill(root, id, { description = `${id} guidance`, workflows = ["implement"], repos = [], references = [], instructions = `# ${id}\n\nApply ${id}.` } = {}) {
  const refs = references.map((reference, index) => ({ id: `ref-${index + 1}`, path: reference }));
  write(path.join(root, "cadre", "skills", id, "skill.json"), JSON.stringify({
    version: 1,
    schema: "cadre.project-skill.v1",
    id,
    name: id,
    description,
    selectors: { workflows, repos },
    rules: [{ id: "core", text: instructions, priority: 100, required: true, references: refs.map((reference) => reference.id) }],
    references: refs,
  }, null, 2));
  write(path.join(root, "cadre", "skills", id, "SKILL.md"), `${instructions}\n`);
}

function git(root, args) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (args[0] === "init") {
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "tag.gpgsign", "false"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "Cadre Test"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "cadre-test@example.invalid"], { cwd: root, encoding: "utf8" });
  }
  return result;
}

function sampleSpec(id, overrides = {}) {
  return {
    version: 1,
    schema: "cadre.spec.v1",
    kind: "spec",
    track_id: id,
    title: `Spec: ${id}`,
    description: `Deliver the reviewed ${id} behavior with explicit acceptance and scope.`,
    functional_requirements: [{ heading: "Reviewed behavior", body: `Implement the ${id} behavior described by the track plan and review bundle.` }],
    non_functional_requirements: [],
    acceptance_criteria: [{ heading: "Verified behavior", body: `Tests or manual verification confirm the ${id} behavior is complete.` }],
    out_of_scope: [{ heading: "Unplanned changes", body: `Changes outside ${id} behavior remain out of scope.` }],
    ...overrides,
  };
}

function samplePlan(id, overrides = {}) {
  return {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: id,
    title: `Plan: ${id}`,
    phases: [
      {
        phase_index: 1,
        title: "Phase 1: Build",
        execution_mode: "parallel",
        depends_on: [],
        tasks: [
          {
            task_index: 1,
            task_key: "phase1_task1",
            title: "Implement core",
            status: "pending",
            files: ["src/core.js"],
            depends_on: [],
            commit_shas: [],
            repo_shas: {},
          },
          {
            task_index: 2,
            task_key: "phase1_task2",
            title: "Add tests",
            status: "pending",
            files: ["test/core.test.js"],
            depends_on: ["phase1_task1"],
            commit_shas: [],
            repo_shas: {},
          },
        ],
      },
      {
        phase_index: 2,
        title: "Phase 2: Finish",
        execution_mode: "sequential",
        depends_on: [],
        tasks: [
          {
            task_index: 1,
            task_key: "phase2_task1",
            title: "Verify",
            status: "pending",
            files: ["src/core.js"],
            depends_on: [],
            commit_shas: [],
            repo_shas: {},
          },
        ],
      },
      {
        phase_index: 3,
        title: "Phase 3: User Manual Verification",
        execution_mode: "sequential",
        depends_on: ["phase1", "phase2"],
        tasks: [
          {
            task_index: 1,
            task_key: "track_manual_verification",
            title: "Track-Level User Manual Verification",
            status: "pending",
            task_type: "user_manual_verification",
            files: [],
            depends_on: ["phase1_manual_verification", "phase2_manual_verification"],
            manual_verification: { scope: "track", suggested_checks: [] },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function planFromPhases(id, phases) {
  return {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: id,
    title: `Plan: ${id}`,
    phases,
  };
}

function planTask(phaseIndex, taskIndex, title, files = [], extra = {}) {
  return {
    task_index: taskIndex,
    task_key: `phase${phaseIndex}_task${taskIndex}`,
    title,
    status: "pending",
    files,
    depends_on: [],
    commit_shas: [],
    repo_shas: {},
    ...extra,
  };
}

function renderPlanProjection(plan) {
  const markerFor = (status) => status === "completed" ? "x" : status === "in_progress" ? "~" : status === "blocked" ? "!" : status === "skipped" ? "-" : " ";
  const lines = [`<!-- cadre:generated from="cadre/tracks/${plan.track_id}/plan.json" schema="cadre.plan.v1" hash="test" -->`, `# Plan: ${plan.track_id}`, ""];
  for (const phase of plan.phases || []) {
    lines.push(`## ${phase.title}`, "");
    for (const task of phase.tasks || []) {
      lines.push(`- [${markerFor(task.status)}] Task ${task.task_index}: ${task.title}`);
      if (task.files?.length) lines.push(`  <!-- files: ${task.files.join(", ")} -->`);
      if (task.task_type) lines.push(`  <!-- task-type: ${task.task_type} -->`);
      if (task.manual_verification?.scope) lines.push(`  <!-- manual-verification-scope: ${task.manual_verification.scope} -->`);
      lines.push("");
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function renderSpecProjection(spec) {
  return `<!-- cadre:generated from="cadre/tracks/${spec.track_id}/spec.json" schema="cadre.spec.v1" hash="test" -->\n# ${spec.title || `Spec: ${spec.track_id}`}\n\n## Description\n\n${spec.description || ""}\n`;
}

function writeTrack(root, id, plan, metadata = {}) {
  write(path.join(root, "cadre", "tracks.json"), JSON.stringify({
    version: 1,
    schema: "cadre.tracks_index.v1",
    generated_at: "2026-06-17T00:00:00.000Z",
    counts: { new: 1, in_progress: 0, completed: 0, blocked: 0, skipped: 0 },
    tracks: [],
  }, null, 2));
  const dir = path.join(root, "cadre", "tracks", id);
  write(path.join(dir, "metadata.json"), JSON.stringify({
    track_id: id,
    type: "feature",
    status: "new",
    priority: "medium",
    depends_on: [],
    description: id,
    git_branch: `track/${id}`,
    worktree_path: `.worktrees/cadre/tracks/${id}/integrate/root`,
    ...metadata,
  }, null, 2));
  const planJson = typeof plan === "string" ? samplePlan(id) : plan;
  const specJson = sampleSpec(id);
  write(path.join(dir, "plan.json"), JSON.stringify(planJson, null, 2));
  write(path.join(dir, "spec.json"), JSON.stringify(specJson, null, 2));
  write(path.join(dir, "plan.md"), renderPlanProjection(planJson));
  write(path.join(dir, "spec.md"), renderSpecProjection(specJson));
  write(path.join(dir, "learnings.md"), `# Learnings: ${id}\n`);
}

function manualVerificationPlanJson(id) {
  return {
    version: 1,
    schema: "cadre.plan.v1",
    track_id: id,
    title: `Plan: ${id}`,
    phases: [
      {
        phase_index: 1,
        title: "Phase 1: Build",
        execution_mode: "sequential",
        depends_on: [],
        tasks: [
          {
            task_index: 1,
            task_key: "phase1_task1",
            title: "Implement core",
            status: "completed",
            files: ["src/core.js"],
            depends_on: [],
          },
          {
            task_index: 2,
            task_key: "phase1_manual_verification",
            title: "User Manual Verification",
            status: "pending",
            task_type: "user_manual_verification",
            files: [],
            depends_on: ["phase1_task1"],
            manual_verification: {
              scope: "phase",
              suggested_checks: [
                {
                  id: "phase1-check-1",
                  heading: "Exercise changed behavior",
                  body: "Verify the implemented core behavior works through the user-facing flow.",
                  source: "phase",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function writeManualVerificationTrack(root, id) {
  writeTrack(root, id, "# Plan\n");
  const planJson = manualVerificationPlanJson(id);
  write(path.join(root, "cadre", "tracks", id, "plan.json"), JSON.stringify(planJson, null, 2));
  write(path.join(root, "cadre", "tracks", id, "plan.md"), renderPlanProjection(planJson));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonLines(file) {
  const content = fs.readFileSync(file, "utf8").trim();
  return content ? content.split(/\n/).map((line) => JSON.parse(line)) : [];
}

function seedLegacySetupPlaceholder(root, { tracked = false } = {}) {
  const originalJson = `${JSON.stringify({
    version: 1,
    schema: "cadre.product.v1",
    kind: "product",
    title: "Original Product",
    summary: "Product context committed before the legacy preview.",
    sections: [],
  }, null, 2)}\n`;
  const originalMarkdown = "# Original Product\n\nProduct context committed before the legacy preview.\n";
  const placeholderJson = `${JSON.stringify({
    version: 1,
    schema: "cadre.product.v1",
    kind: "product",
    title: "Product Context",
    summary: "Structured product context for agents. Fill sections from repo evidence and user intent; do not leave examples as final content.",
    sections: [],
  }, null, 2)}\n`;
  const placeholderMarkdown = "# Product Context\n\nStructured product context placeholder.\n";
  const evidenceJson = `${JSON.stringify({
    version: 1,
    schema: "cadre.product.v1",
    kind: "product",
    title: "Evidence Product",
    summary: "Repository-grounded product context.",
    sections: [],
  }, null, 2)}\n`;
  const evidenceMarkdown = "# Evidence Product\n\nRepository-grounded product context.\n";
  const files = [
    { path: "cadre/product.json", title: "Product context canonical", kind: "json", source: "product", content: placeholderJson },
    { path: "cadre/product.md", title: "Product context", kind: "markdown", source: "cadre/product.json", content: placeholderMarkdown },
  ];
  const failedFiles = [
    { ...files[0], content: evidenceJson },
    { ...files[1], content: evidenceMarkdown },
  ];
  const originalFiles = [
    { ...files[0], content: originalJson },
    { ...files[1], content: originalMarkdown },
  ];
  if (tracked) {
    for (const file of originalFiles) write(path.join(root, file.path), file.content);
    git(root, ["add", "--", ...originalFiles.map((file) => file.path)]);
    git(root, ["commit", "-m", "seed original product context"]);
  }
  for (const file of files) write(path.join(root, file.path), file.content);
  if (!tracked) git(root, ["add", "-N", "--", ...files.map((file) => file.path)]);
  const sessionDirectory = path.join(root, "cadre", "local", "approval-sessions");
  const placeholderSessionId = "111111111111111111111111";
  const failedSessionId = "222222222222222222222222";
  write(path.join(sessionDirectory, `${placeholderSessionId}.json`), `${JSON.stringify({
    session_id: placeholderSessionId,
    workflow: "setup",
    payload_hash: "legacy-placeholder",
    payload: { product: {}, techStack: {} },
    approved_stages: [],
    snapshot_files: files,
    before_files: files.map((file, index) => tracked
      ? { path: file.path, existed: true, content: originalFiles[index].content }
      : { path: file.path, existed: false, content: null }),
    preview_files: files.map((file) => ({ path: file.path })),
    intent_to_add_paths: tracked ? [] : files.map((file) => file.path),
    updated_at: "2026-07-14T00:00:00.000Z",
  }, null, 2)}\n`);
  write(path.join(sessionDirectory, `${failedSessionId}.json`), `${JSON.stringify({
    session_id: failedSessionId,
    workflow: "setup",
    payload_hash: "legacy-evidence",
    payload: { product: { title: "Evidence Product" }, techStack: { languages: ["TypeScript"] } },
    approved_stages: [],
    snapshot_files: failedFiles,
    before_files: files.map((file) => ({ path: file.path, existed: true, content: file.content })),
    preview_files: [],
    intent_to_add_paths: [],
    updated_at: "2026-07-14T00:01:00.000Z",
  }, null, 2)}\n`);
  return { files, placeholderSessionId, failedSessionId };
}

function gitSubject(root, ref = "HEAD") {
  return git(root, ["log", "-1", "--pretty=%s", ref]).stdout.trim();
}

function gitNote(root, sha) {
  return JSON.parse(git(root, ["notes", "--ref", "refs/notes/cadre", "show", sha]).stdout);
}

function withSetupTestEvidence(args) {
  const resolved = JSON.parse(JSON.stringify(args));
  if (resolved.productGuidelines == null && resolved.product_guidelines == null) {
    resolved.productGuidelines = {
      title: "Product Guidelines",
      summary: "Preserve explicit user intent, evidence, and safe review boundaries.",
    };
  }
  if (resolved.workflowPolicy == null && resolved.workflow_policy == null) {
    resolved.workflowPolicy = {
      title: "Project Workflow",
      summary: "Review each Cadre stage explicitly and run focused validation before completion.",
    };
  }
  return resolved;
}

function applyRecommendedSetupPromptAnswers(target, prompts) {
  for (const prompt of prompts) {
    const recommended = (prompt.choices || []).filter((choice) => choice.recommended).map((choice) => choice.id);
    if (prompt.id === "setup-provider-mode") target.providerMode = recommended[0] || "local";
    else if (prompt.id === "setup-sync-mode") target.syncMode = recommended[0] || "local";
    else if (prompt.id === "setup-style-guides") target.styleGuideIds = recommended;
    else if (prompt.id === "setup-lsp") target.writeLsp = recommended[0] !== "skip-lsp";
    else if (prompt.id === "setup-optional-mcps") target.integrations = {};
    else assert.fail(`setup test payload left unresolved prompt ${prompt.id}`);
  }
}

function resolveSetupPrompts(root, args) {
  const resolved = withSetupTestEvidence(args);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const preview = core.workflowPacket(root, resolved);
    assert.deepEqual(preview.intent_prompts || [], [], "setup test payload must include current-stage evidence");
    const prompts = preview.native_prompts || [];
    if (prompts.length === 0) return { args: resolved, preview };
    applyRecommendedSetupPromptAnswers(resolved, prompts);
  }
  assert.fail("setup native prompts did not resolve after explicit test answers");
}

function approvalStamp(approval) {
  assert.match(approval.current_stage_hash, /^[a-f0-9]{64}$/);
  assert.equal(Number.isSafeInteger(approval.current_stage_revision), true);
  return {
    approvalStageHash: approval.current_stage_hash,
    approvalStageRevision: approval.current_stage_revision,
  };
}

function advanceSetupToTechnical(root, args) {
  const base = withSetupTestEvidence({ ...args, workflow: "setup", execute: false });
  delete base.approvalComplete;
  delete base.approval_complete;
  let preview = core.workflowPacket(root, base);
  for (const stage of ["product", "product_guidelines"]) {
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.approval.current_stage, stage);
    preview = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalStage: stage,
      ...approvalStamp(preview.approval),
      approvedStages: [...(preview.approval.approved_stages || []), stage],
    });
  }
  return preview;
}

function approveWorkflow(root, args) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let base = { ...clone(args), execute: false };
  delete base.approvalComplete;
  delete base.approval_complete;
  delete base.approvedStages;
  delete base.approved_stages;
  delete base.approvalStage;
  delete base.approval_stage;
  delete base.approvalSessionId;
  delete base.approval_session_id;
  const responseControls = Object.fromEntries(
    ["responseMode", "response_mode", "detail", "compact"]
      .filter((key) => base[key] !== undefined)
      .map((key) => [key, base[key]]),
  );
  if (base.workflow === "setup") base = withSetupTestEvidence(base);
  let preview = core.workflowPacket(root, base);
  let sessionId = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(preview.ok, true, preview.error || JSON.stringify(preview.errors || preview.warnings || {}));
    const approval = preview.approval || {};
    sessionId = approval.session_id || sessionId;
    const intentPrompts = preview.intent_prompts || [];
    if (intentPrompts.length > 0) assert.fail(`setup test payload left unresolved intent prompt ${intentPrompts[0].id}`);
    const nativePrompts = preview.native_prompts || [];
    if (nativePrompts.length > 0) {
      assert.equal(base.workflow, "setup", `unexpected native prompt for ${base.workflow}`);
      const answers = {};
      applyRecommendedSetupPromptAnswers(answers, nativePrompts);
      Object.assign(base, answers);
      preview = core.workflowPacket(root, {
        workflow: "setup",
        ...responseControls,
        ...(sessionId ? { approvalSessionId: sessionId } : {}),
        ...answers,
      });
      continue;
    }
    if (approval.required !== true) return core.workflowPacket(root, { ...clone(base), ...clone(args), execute: true });
    if (approval.current_stage) {
      const approved = [...(approval.approved_stages || []), approval.current_stage];
      preview = core.workflowPacket(root, {
        workflow: base.workflow,
        ...responseControls,
        approvalSessionId: sessionId,
        approvalStage: approval.current_stage,
        ...approvalStamp(approval),
        approvedStages: approved,
      });
      continue;
    }
    const approved = approval.approved_stages || [];
    return core.workflowPacket(root, {
      workflow: base.workflow,
      ...responseControls,
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: approved,
    });
  }
  assert.fail(`approval loop did not complete for ${base.workflow}`);
}

function setupTraceableProject(root) {
  git(root, ["init"]);
  git(root, ["config", "user.email", "trace@example.com"]);
  git(root, ["config", "user.name", "Trace Test"]);
  const setup = approveWorkflow(root, {
    workflow: "setup",
    responseMode: "detail",
    providerMode: "local",
    product: { title: "Trace Product", summary: "Traceable workflow test." },
    productGuidelines: { title: "Guidelines", summary: "Keep state traceable." },
    workflowPolicy: { title: "Workflow", summary: "Use Cadre trace commits." },
    techStack: { languages: ["javascript"] },
  });
  assert.equal(setup.ok, true);
  assert.equal(gitSubject(root, setup.control_commit.commit_sha), "cadre(setup): initialize control plane");
  assert.equal(gitNote(root, setup.control_commit.commit_sha).schema, "cadre.commit_trace.v1");
  return setup;
}

test("repoMap filters generated bundles and local variable noise", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-core-test-"));
  try {
    git(root, ["init"]);
    write(
      path.join(root, "scripts", "source.js"),
      [
        "function canonicalFunction() { return true; }",
        "const localNoise = 1;",
        "export const exportedSignal = 2;",
        "",
      ].join("\n")
    );
    write(
      path.join(root, ".agents", "skills", "cadre", "templates", "scripts", "generated.js"),
      "function generatedFunction() { return false; }\n"
    );
    write(
      path.join(root, "plugins", "cadre", "scripts", "plugin.js"),
      "function pluginFunction() { return false; }\n"
    );
    git(root, ["add", "."]);

    const map = core.repoMap(root, { limit: 20 });
    const names = map.symbols.map((symbol) => symbol.name);
    assert.equal(map.ok, true);
    assert.ok(names.includes("canonicalFunction"));
    assert.ok(names.includes("exportedSignal"));
    assert.equal(names.includes("localNoise"), false);
    assert.equal(names.includes("generatedFunction"), false);
    assert.equal(names.includes("pluginFunction"), false);

    const matches = core.repoMap(root, { symbol: "generatedFunction" });
    assert.deepEqual(matches.matches, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commit trace records setup, newtrack, and task completion commits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-trace-task-test-"));
  try {
    setupTraceableProject(root);
    const trackId = "trace_task_20260623";
    const plan = planFromPhases(trackId, [
      { phase_index: 1, title: "Phase 1: Traceable task execution", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Implement traceable core", ["src/core.js"])] },
    ]);
    const created = approveWorkflow(root, {
      workflow: "newtrack",
      execute: true,
      approvalComplete: true,
      responseMode: "detail",
      trackId,
      spec: sampleSpec(trackId),
      plan,
    });
    assert.equal(created.ok, true);
    assert.equal(gitSubject(root, created.control_commit.commit_sha), `cadre(newtrack): create ${trackId}`);
    assert.equal(gitNote(root, created.control_commit.commit_sha).track_id, trackId);

    write(path.join(root, "src", "core.js"), "module.exports = function core() { return 'trace'; };\n");
    const completed = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: root,
      command: "printf '%s\\n' 'Statements : 91%'",
      coverageThreshold: 80,
    });
    assert.equal(completed.ok, true);
    assert.ok(completed.product_commit.commit_sha);
    assert.ok(completed.control_commit.commit_sha);
    assert.equal(gitSubject(root, completed.product_commit.commit_sha), "feat(root): Implement traceable core");
    assert.equal(gitSubject(root, completed.control_commit.commit_sha), `cadre(complete): record ${trackId} phase 1 task 1`);
    assert.equal(gitNote(root, completed.product_commit.commit_sha).kind, "product");
    assert.equal(gitNote(root, completed.control_commit.commit_sha).product_commit_sha, completed.product_commit.commit_sha);
    assert.equal(git(root, ["status", "--porcelain"]).stdout.trim(), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commit trace records ship publication evidence without git publication actions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-trace-ship-test-"));
  try {
    setupTraceableProject(root);
    const trackId = "trace_ship_20260623";
    writeTrack(root, trackId, planFromPhases(trackId, [
      { phase_index: 1, title: "Phase 1: Ship", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Already done", ["src/ship.js"], { status: "completed", commit_shas: ["abc1234"] })] },
    ]), {
      status: "completed",
      review: {
        verdict: "approved",
        blocking_count: 0,
        reviewed_sha: git(root, ["rev-parse", "HEAD"]).stdout.trim(),
      },
    });
    git(root, ["add", "cadre/tracks.json", "cadre/tracks"]);
    git(root, ["commit", "-m", "cadre(test): seed shipped track"]);

    const shipped = core.workflowPacket(root, {
      workflow: "ship",
      execute: true,
      responseMode: "detail",
      trackId,
      evidence: { provider: "local", url: "local://trace-ship", status: "ready" },
    });
    assert.equal(shipped.ok, true);
    assert.equal(shipped.publication.entry.workflow, "ship");
    assert.equal(gitSubject(root, shipped.publication.control_commit.commit_sha), `cadre(ship): publish ${trackId}`);
    assert.equal(gitNote(root, shipped.publication.control_commit.commit_sha).workflow, "ship");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commit trace keeps local wisps uncommitted until squash", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-trace-wisp-test-"));
  try {
    setupTraceableProject(root);
    write(path.join(root, "cadre", "formulas", "sample.json"), JSON.stringify({
      id: "sample",
      title: "Sample",
      steps: [{ id: "step_one", title: "Do one thing", files: ["src/one.js"] }],
    }, null, 2));
    git(root, ["add", "cadre/formulas/sample.json"]);
    git(root, ["commit", "-m", "cadre(formula): add sample"]);
    const before = git(root, ["rev-parse", "HEAD"]).stdout.trim();

    const created = core.workflowPacket(root, { workflow: "formula", action: "wisp_create", execute: true, responseMode: "detail", id: "sample" });
    assert.equal(created.ok, true);
    assert.equal(git(root, ["rev-parse", "HEAD"]).stdout.trim(), before);

    const squashed = core.workflowPacket(root, {
      workflow: "formula",
      action: "wisp_squash",
      execute: true,
      responseMode: "detail",
      wispId: created.wisp_id,
      summary: "ready",
    });
    assert.equal(squashed.ok, true);
    assert.equal(gitSubject(root, squashed.control_commit.commit_sha), `cadre(wisp): squash ${created.wisp_id}`);
    assert.equal(gitNote(root, squashed.control_commit.commit_sha).wisp_id, created.wisp_id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo workspace intelligence spans TS, Python, and Rust roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-core-test-"));
  try {
    write(path.join(root, "cadre", "setup_state.json"), "{}\n");
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "app",
      repos: [
        { name: "app", submodule_path: "apps/app", default_branch: "main" },
        { name: "py", submodule_path: "services/py", default_branch: "main" },
        { name: "rust", submodule_path: "libs/rust", default_branch: "main" },
      ],
    }, null, 2));
    write(path.join(root, "apps", "app", "src", "app.ts"), "export function appFn() { return true; }\n");
    write(path.join(root, "services", "py", "app.py"), "def py_fn():\n    return True\n");
    write(path.join(root, "libs", "rust", "src", "lib.rs"), "pub fn rust_fn() -> bool { true }\n");

    const setup = core.lspSetup(root, { execute: false });
    assert.equal(setup.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(setup, "helper"), false);
    assert.ok(Array.isArray(setup.recommended));
    for (const id of ["typescript", "python", "rust"]) {
      assert.ok(setup.recommended.some((entry) => entry.id === id), `expected ${id} recommendation`);
    }
    assert.equal(setup.workspaceFolders.length, 4);

    const map = core.repoMap(root, { limit: 50 });
    assert.equal(map.ok, true);
    assert.equal(map.repos.length, 4);
    assert.ok(map.by_language.typescript >= 1);
    assert.ok(map.by_language.python >= 1);
    assert.ok(map.by_language.rust >= 1);

    const appRepo = map.repos.find((entry) => entry.repo === "app");
    const pyRepo = map.repos.find((entry) => entry.repo === "py");
    const rustRepo = map.repos.find((entry) => entry.repo === "rust");
    assert.ok(appRepo);
    assert.ok(pyRepo);
    assert.ok(rustRepo);
    assert.ok(appRepo.symbols.some((symbol) => symbol.name === "appFn"));
    assert.ok(pyRepo.symbols.some((symbol) => symbol.name === "py_fn"));
    assert.ok(rustRepo.symbols.some((symbol) => symbol.name === "rust_fn"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("isCadreProjectRoot requires real Cadre state markers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-root-test-"));
  try {
    fs.mkdirSync(path.join(root, "skills", "cadre"), { recursive: true });
    assert.equal(core.isCadreProjectRoot(path.join(root, "skills")), false);

    write(path.join(root, "project", "cadre", "setup_state.json"), "{}\n");
    assert.equal(core.isCadreProjectRoot(path.join(root, "project")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parsePlanJson captures execution, repo ownership, dependencies, and commit refs", () => {
  const plan = core.parsePlanJson({
    version: 1,
    schema: "cadre.plan.v1",
    track_id: "typed",
    phases: [{
      phase_index: 1,
      title: "Phase 1: Typed Work",
      execution_mode: "parallel",
      depends_on: ["phase0"],
      tasks: [{
        task_index: 1,
        task_key: "phase1_task1",
        title: "Touch runtime",
        status: "in_progress",
        files: ["src/runtime.ts", "tests/runtime.test.ts"],
        repo: "app",
        depends_on: ["task0"],
        commit_shas: ["abc1234"],
        repo_shas: { app: "deadbeef" },
      }],
    }],
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.phases[0].annotations.execution, "parallel");
  assert.equal(plan.phases[0].annotations.depends, "phase0");
  assert.equal(plan.tasks[0].task_key, "phase1_task1");
  assert.deepEqual(plan.tasks[0].files, ["src/runtime.ts", "tests/runtime.test.ts"]);
  assert.equal(plan.tasks[0].repo, "app");
  assert.deepEqual(plan.tasks[0].depends, ["task0"]);
  assert.ok(plan.tasks[0].commit_shas.includes("abc1234"));
  assert.equal(plan.tasks[0].repo_shas.app, "deadbeef");
});

test("build emits required runtime bundles without obsolete standalone helpers", () => {
  for (const file of [
    "scripts/cadre-cli.js",
    "scripts/cadre-core.js",
    "scripts/cadre-lsp-setup.js",
    "scripts/cadre-lsp-review.js",
    "scripts/mcp/cadre-server.js",
  ]) {
    assert.equal(fs.existsSync(path.join(__dirname, "..", file)), true, `missing ${file}`);
  }
  for (const file of [
    "scripts/cadre-job-runner.js",
    "scripts/cadre-lsp-daemon.js",
    "scripts/mcp/cadre-server.external.js",
    "plugins/cadre/assets",
    "plugins/cadre/agents",
    "plugins/cadre/scripts",
    "plugins/cadre-claude/assets",
    "plugins/cadre-claude/agents",
    "plugins/cadre-claude/scripts",
    "plugins/cadre-copilot/assets",
    "plugins/cadre-copilot/agents",
    "plugins/cadre-copilot/scripts",
    "plugins/cadre-antigravity/assets",
    "plugins/cadre-antigravity/agents",
    "plugins/cadre-antigravity/scripts",
    "plugins/cadre/scripts/cadre-core.js",
    "plugins/cadre/scripts/cadre-job-runner.js",
    "plugins/cadre/scripts/cadre-lsp-setup.js",
    "plugins/cadre/scripts/cadre-lsp-review.js",
    "plugins/cadre/scripts/cadre-lsp-daemon.js",
    "plugins/cadre-claude/scripts/cadre-core.js",
    "plugins/cadre-claude/scripts/cadre-job-runner.js",
    "plugins/cadre-claude/scripts/cadre-lsp-setup.js",
    "plugins/cadre-claude/scripts/cadre-lsp-review.js",
    "plugins/cadre-claude/scripts/cadre-lsp-daemon.js",
    "plugins/cadre-copilot/scripts/cadre-core.js",
    "plugins/cadre-copilot/scripts/cadre-job-runner.js",
    "plugins/cadre-copilot/scripts/cadre-lsp-setup.js",
    "plugins/cadre-copilot/scripts/cadre-lsp-review.js",
    "plugins/cadre-copilot/scripts/cadre-lsp-daemon.js",
    "plugins/cadre-antigravity/scripts/cadre-core.js",
    "plugins/cadre-antigravity/scripts/cadre-job-runner.js",
    "plugins/cadre-antigravity/scripts/cadre-lsp-setup.js",
    "plugins/cadre-antigravity/scripts/cadre-lsp-review.js",
    "plugins/cadre-antigravity/scripts/cadre-lsp-daemon.js",
    "plugins/cadre/references",
    "plugins/cadre/templates",
    "plugins/cadre-claude/references",
    "plugins/cadre-claude/templates",
    "plugins/cadre-copilot/references",
    "plugins/cadre-copilot/templates",
    "plugins/cadre-antigravity/references",
    "plugins/cadre-antigravity/templates",
    "templates/scripts/cadre-lsp-setup.js",
    "templates/scripts/cadre-lsp-review.js",
    "templates/scripts/cadre-lsp-daemon.js",
    "plugins/cadre/templates/scripts/cadre-lsp-setup.js",
    "plugins/cadre-claude/templates/scripts/cadre-lsp-review.js",
    "plugins/cadre-copilot/templates/scripts/cadre-lsp-setup.js",
    "plugins/cadre-antigravity/templates/scripts/cadre-lsp-review.js",
    "plugins/cadre/skills/cadre/templates/scripts/cadre-lsp-setup.js",
    "plugins/cadre-claude/skills/cadre/templates/scripts/cadre-lsp-review.js",
    "plugins/cadre-copilot/skills/cadre/templates/scripts/cadre-lsp-setup.js",
    "plugins/cadre-antigravity/skills/cadre/templates/scripts/cadre-lsp-review.js",
  ]) {
    assert.equal(fs.existsSync(path.join(__dirname, "..", file)), false, `obsolete or duplicate helper should not be bundled: ${file}`);
  }

  const server = fs.readFileSync(path.join(__dirname, "mcp", "cadre-server.js"), "utf8");
  assert.match(server, /--cadre-job-runner/, "MCP bundle should retain its hidden job-runner mode");
  assert.match(server, /--cadre-lsp-daemon/, "MCP bundle should retain its hidden LSP-daemon mode");
});

test("implementationPrep returns bounded candidate context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-prep-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "prep_20260617", samplePlan("prep_20260617"));

    const prep = core.implementationPrep(root, { identity: "dev@example.com" });
    assert.equal(prep.ok, true);
    assert.equal(prep.selected_track, "prep_20260617");
    assert.equal(prep.context.task_counts.total, 4);
    assert.equal(prep.integrity.ok, true);
    assert.equal(prep.team_summary.total_tracks, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("planAssist and worktreePlan return bounded planning evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-plan-assist-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "assist_20260617", samplePlan("assist_20260617"));
    write(path.join(root, "src", "core.js"), "function core() { return true; }\n");
    write(path.join(root, "src", "core.test.js"), "test('core', () => {});\n");

    const assist = core.planAssist(root, { trackId: "assist_20260617", limit: 20 });
    assert.equal(assist.ok, true);
    assert.ok(assist.file_claims["."].includes("src/core.js"));
    assert.ok(assist.likely_tests.includes("src/core.test.js"));
    assert.ok(assist.phases.some((phase) => phase.phase_index === 1 && phase.parallel_candidate === true));
    assert.equal(assist.semantic_impact.ok, true);

    const worktrees = core.worktreePlan(root, { trackId: "assist_20260617" });
    assert.equal(worktrees.ok, true);
    assert.equal(worktrees.execute, false);
    assert.equal(worktrees.plans[0].repo, "root");
    assert.ok(worktrees.plans[0].commands[0].args.includes(path.join(root, ".worktrees", "cadre", "tracks", "assist_20260617", "integrate", "root")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("worktreePlan uses branch-set paths and preserves existing track branches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-worktree-branch-set-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "owner@example.com"]);
    git(root, ["config", "user.name", "Owner"]);
    write(path.join(root, "README.md"), "base\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    git(root, ["branch", "track/branch_set_20260626"]);
    const before = git(root, ["rev-parse", "track/branch_set_20260626"]).stdout.trim();
    writeTrack(root, "branch_set_20260626", samplePlan("branch_set_20260626"));

    const planned = core.worktreePlan(root, { trackId: "branch_set_20260626" });
    assert.equal(planned.ok, true);
    assert.equal(planned.branch_set[0].repo, "root");
    assert.equal(planned.branch_set[0].track_branch, "track/branch_set_20260626");
    assert.equal(planned.branch_set[0].integration_worktree_path, ".worktrees/cadre/tracks/branch_set_20260626/integrate/root");
    assert.equal(planned.plans[0].commands[0].args.includes("-B"), false);

    const created = core.worktreePlan(root, { trackId: "branch_set_20260626", execute: true });
    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(path.join(root, ".worktrees", "cadre", "tracks", "branch_set_20260626", "integrate", "root")), true);
    assert.equal(git(root, ["rev-parse", "track/branch_set_20260626"]).stdout.trim(), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("worker worktrees must be siblings of integration worktrees", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-worker-sibling-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "owner@example.com"]);
    git(root, ["config", "user.name", "Owner"]);
    write(path.join(root, "file.txt"), "base\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    const integrate = path.join(root, ".worktrees", "cadre", "tracks", "nested_demo", "integrate", "root");
    const nestedWorker = path.join(integrate, "workers", "root", "task-a");
    git(root, ["worktree", "add", "-b", "track/nested_demo", integrate, "HEAD"]);
    fs.mkdirSync(path.dirname(nestedWorker), { recursive: true });
    git(root, ["worktree", "add", "-b", "worker/nested_demo", nestedWorker, "HEAD"]);
    write(path.join(nestedWorker, "worker.txt"), "worker\n");
    assert.match(git(integrate, ["status", "--porcelain", "--untracked-files=all"]).stdout, /\?\? workers\/root\/task-a\//);

    const siblingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-worker-sibling-clean-test-"));
    git(siblingRoot, ["init"]);
    git(siblingRoot, ["config", "user.email", "owner@example.com"]);
    git(siblingRoot, ["config", "user.name", "Owner"]);
    write(path.join(siblingRoot, "file.txt"), "base\n");
    git(siblingRoot, ["add", "."]);
    git(siblingRoot, ["commit", "-m", "base"]);
    const siblingIntegrate = path.join(siblingRoot, ".worktrees", "cadre", "tracks", "sibling_demo", "integrate", "root");
    const siblingWorker = path.join(siblingRoot, ".worktrees", "cadre", "tracks", "sibling_demo", "workers", "root", "task-a");
    fs.mkdirSync(path.dirname(siblingIntegrate), { recursive: true });
    fs.mkdirSync(path.dirname(siblingWorker), { recursive: true });
    git(siblingRoot, ["worktree", "add", "-b", "track/sibling_demo", siblingIntegrate, "HEAD"]);
    git(siblingRoot, ["worktree", "add", "-b", "worker/sibling_demo", siblingWorker, "HEAD"]);
    write(path.join(siblingWorker, "worker.txt"), "worker\n");
    assert.equal(git(siblingIntegrate, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim(), "");
    fs.rmSync(siblingRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo branch-set planning includes only affected repos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-branch-set-test-"));
  try {
    git(root, ["init"]);
    const repos = ["web", "api", "mobile"];
    for (const repo of repos) {
      const repoRoot = path.join(root, "repos", repo);
      fs.mkdirSync(repoRoot, { recursive: true });
      git(repoRoot, ["init"]);
      git(repoRoot, ["config", "user.email", `${repo}@example.com`]);
      git(repoRoot, ["config", "user.name", repo]);
      write(path.join(repoRoot, "README.md"), repo);
      git(repoRoot, ["add", "."]);
      git(repoRoot, ["commit", "-m", `init ${repo}`]);
    }
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "web",
      repos: repos.map((repo) => ({ name: repo, submodule_path: `repos/${repo}`, default_branch: "master" })),
    }, null, 2));
    const plan = planFromPhases("poly_branch_set_20260626", [
      { phase_index: 1, title: "Phase 1", execution_mode: "parallel", depends_on: [], tasks: [
        planTask(1, 1, "Web", ["src/web.js"], { repo: "web" }),
        planTask(1, 2, "API", ["src/api.js"], { repo: "api" }),
      ] },
    ]);
    writeTrack(root, "poly_branch_set_20260626", plan, { worktree_path: undefined });
    const planned = core.worktreePlan(root, { trackId: "poly_branch_set_20260626" });
    assert.deepEqual(planned.branch_set.map((entry) => entry.repo).sort(), ["api", "web"]);
    assert.equal(planned.branch_set.some((entry) => entry.repo === "mobile"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parallelWorkflow plans waves and keeps mutating actions dry-run by default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-parallel-packet-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "parallel_20260617", samplePlan("parallel_20260617"));

    const next = core.parallelWorkflow(root, { action: "next_wave", trackId: "parallel_20260617" });
    assert.equal(next.ok, true);
    assert.deepEqual(next.phase_ids, ["phase1"]);
    assert.equal(next.workers.length, 1);
    assert.equal(next.workers[0].task_key, "phase1_task1");

    const missingAgent = core.parallelWorkflow(root, { action: "setup_workers", trackId: "parallel_20260617" });
    assert.equal(missingAgent.ok, false);
    assert.match(missingAgent.error, /agentIdentifier/);
    assert.deepEqual(missingAgent.accepted_agent_identifiers, ["claude", "codex", "copilot", "antigravity"]);

    const setup = core.parallelWorkflow(root, { action: "setup_workers", trackId: "parallel_20260617", agentIdentifier: "codex" });
    assert.equal(setup.ok, true);
    assert.equal(setup.dry_run, true);
    assert.equal(setup.commands.length, 1);
    assert.equal(setup.results.length, 0);
    assert.equal(typeof setup.workers[0].dispatch.prompt, "string");
    assert.ok(setup.workers[0].dispatch.prompt.includes("parallel_20260617"));
    assert.equal(setup.workers[0].dispatch.canonical_worker_contract, "cadre.parallel-dispatch.v1");
    assert.deepEqual(setup.workers[0].dispatch.owned_files, ["src/core.js"]);
    assert.equal(setup.workers[0].dispatch.agent_identifier, "codex");
    assert.equal(setup.workers[0].dispatch.selected_dispatch.agent_identifier, "codex");
    assert.equal(setup.workers[0].dispatch.selected_dispatch.mechanism, "multi_agent_v1.spawn_agent");
    assert.equal(Object.prototype.hasOwnProperty.call(setup.workers[0].dispatch, "platform_dispatch"), false);
    assert.ok(setup.workers[0].dispatch.expected_result_schema.required.includes("commit_sha"));
    assert.equal(setup.workers[0].dispatch.record_finish_packet.tool, "cadre_action");
    assert.equal(setup.workers[0].dispatch.record_finish_packet.arguments.action, "parallel.record_finish");
    assert.equal(setup.workers[0].dispatch.record_finish_packet.arguments.input.trackId, "parallel_20260617");
    assert.equal(setup.workers[0].dispatch.record_finish_packet.arguments.input.status, "<awaiting_merge-or-blocked>");
    assert.match(setup.workers[0].dispatch.evidence_requirements.status, /awaiting_merge or blocked/);
    assert.ok(setup.workers[0].dispatch.finish_evidence_fields.includes("filesChanged"));

    const claudeSetup = core.parallelWorkflow(root, { action: "setup_workers", trackId: "parallel_20260617", agentIdentifier: "claude" });
    assert.equal(claudeSetup.workers[0].dispatch.selected_dispatch.agent_identifier, "claude");
    assert.equal(claudeSetup.workers[0].dispatch.selected_dispatch.mechanism, "Task");

    const copilotSetup = core.parallelWorkflow(root, { action: "setup_workers", trackId: "parallel_20260617", agentIdentifier: "copilot" });
    assert.equal(copilotSetup.workers[0].dispatch.selected_dispatch.agent_identifier, "copilot");
    assert.equal(copilotSetup.workers[0].dispatch.selected_dispatch.mechanism, "copilot_cli.custom_agent");

    const antigravitySetup = core.parallelWorkflow(root, { action: "setup_workers", trackId: "parallel_20260617", agentIdentifier: "antigravity" });
    assert.equal(antigravitySetup.workers[0].dispatch.selected_dispatch.agent_identifier, "antigravity");
    assert.equal(antigravitySetup.workers[0].dispatch.selected_dispatch.mechanism, "invoke_subagent");

    const dryRecord = core.parallelWorkflow(root, {
      action: "record_finish",
      trackId: "parallel_20260617",
      workerId: "worker-one",
      phaseIndex: 1,
      taskIndex: 1,
    });
    assert.equal(dryRecord.ok, true);
    assert.equal(dryRecord.dry_run, true);
    assert.equal(dryRecord.evidence_validation.checked, false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "parallel_20260617", "parallel_state.json")), false);

    const rejected = core.parallelWorkflow(root, {
      action: "record_finish",
      execute: true,
      trackId: "parallel_20260617",
      workerId: "worker-bad",
      status: "awaiting_merge",
      phaseIndex: 1,
      taskIndex: 1,
      commitSha: "bad1234",
      filesChanged: ["src/unowned.js"],
    });
    assert.equal(rejected.ok, false);
    assert.deepEqual(rejected.unowned_files_changed, ["src/unowned.js"]);

    const recorded = core.parallelWorkflow(root, {
      action: "record_finish",
      execute: true,
      trackId: "parallel_20260617",
      workerId: "worker-one",
      status: "awaiting_merge",
      phaseIndex: 1,
      taskIndex: 1,
      commitSha: "abc1234",
      branch: "track/parallel-worker-one",
      worktree: ".worktrees/parallel_20260617/worker-one",
      repo: ".",
      filesChanged: ["src/core.js"],
      tests: [{ command: "node --test", cwd: ".", ok: true, status: 0 }],
      summary: "Updated core worker path",
      blockers: [],
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.summary.completed_workers, 1);
    assert.deepEqual(recorded.worker.files_changed, ["src/core.js"]);
    assert.equal(recorded.worker.tests[0].command, "node --test");
    assert.equal(recorded.worker.summary, "Updated core worker path");

    const merge = core.parallelWorkflow(root, { action: "merge_back", trackId: "parallel_20260617" });
    assert.equal(merge.ok, true);
    assert.equal(merge.dry_run, true);
    assert.ok(merge.commands[0].args.includes("abc1234"));

    const cleanup = core.parallelWorkflow(root, { action: "cleanup", trackId: "parallel_20260617" });
    assert.equal(cleanup.ok, true);
    assert.equal(cleanup.commands.length, 0);
    assert.equal(cleanup.skipped[0].status, "awaiting_merge");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parallel merge completes canonical tasks before cleanup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-parallel-merge-test-"));
  try {
    git(root, ["init", "--initial-branch=master"]);
    git(root, ["config", "user.email", "owner@example.com"]);
    git(root, ["config", "user.name", "Owner"]);
    write(path.join(root, "src", "core.js"), "export const value = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    const trackId = "parallel_merge_20260714";
    writeTrack(root, trackId, samplePlan(trackId));

    const integration = core.worktreePlan(root, { trackId, execute: true });
    assert.equal(integration.ok, true);
    assert.equal(integration.plans[0].base, "master");
    const setup = core.parallelWorkflow(root, {
      action: "setup_workers",
      trackId,
      agentIdentifier: "codex",
      execute: true,
    });
    assert.equal(setup.ok, true);
    assert.equal(setup.workers.length, 1);
    const worker = setup.workers[0];
    write(path.join(worker.worktree, "src", "core.js"), "export const value = 2;\n");
    git(worker.worktree, ["add", "src/core.js"]);
    git(worker.worktree, ["commit", "-m", "parallel worker"]);
    const commitSha = git(worker.worktree, ["rev-parse", "HEAD"]).stdout.trim();

    const recorded = core.parallelWorkflow(root, {
      action: "record_finish",
      trackId,
      workerId: worker.worker_id,
      phaseIndex: worker.phase_index,
      taskIndex: worker.task_index,
      repo: worker.repo,
      workerRef: worker.worker_ref,
      commitSha,
      filesChanged: ["src/core.js"],
      tests: [{ command: "node --test", cwd: worker.worktree, ok: true, status: 0 }],
      summary: "Updated the parallel task",
      execute: true,
    });
    assert.equal(recorded.ok, true);

    const merged = core.parallelWorkflow(root, {
      action: "merge_back",
      trackId,
      command: "printf 'Statements : 91%%\\n'",
      coverageThreshold: 80,
      execute: true,
    });
    assert.equal(merged.ok, true, JSON.stringify(merged));
    const plan = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "plan.json"), "utf8"));
    assert.equal(plan.phases[0].tasks[0].status, "completed");
    assert.equal(merged.state_records[0].completion.ok, true);

    const cleanup = core.parallelWorkflow(root, { action: "cleanup", trackId, execute: true });
    assert.equal(cleanup.ok, true);
    assert.equal(fs.existsSync(worker.worktree), false);
    const cleanedState = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "parallel_state.json"), "utf8"));
    assert.equal(cleanedState.workers[0].status, "merged");
    assert.equal(cleanedState.workers[0].worktree, null);
    assert.equal(cleanedState.workers[0].worker_ref, null);
    assert.equal(cleanedState.workers[0].cleaned_worktree, worker.worktree);
    assert.equal(cleanedState.workers[0].cleaned_worker_ref, worker.worker_ref);
    assert.match(cleanedState.workers[0].cleaned_at, /^\d{4}-\d{2}-\d{2}T/);

    const idempotentCleanup = core.parallelWorkflow(root, { action: "cleanup", trackId, execute: true });
    assert.equal(idempotentCleanup.ok, true);
    assert.equal(idempotentCleanup.commands.length, 0);
    assert.equal(idempotentCleanup.ref_commands.length, 0);
    assert.equal(idempotentCleanup.already_cleaned[0].worker_id, worker.worker_id);

    const nextWave = core.parallelWorkflow(root, { action: "next_wave", trackId });
    assert.equal(nextWave.ok, true);
    assert.equal(nextWave.workers[0].task_key, "phase1_task2");
    const nextSetup = core.parallelWorkflow(root, {
      action: "setup_workers",
      trackId,
      agentIdentifier: "codex",
      execute: true,
    });
    assert.equal(nextSetup.ok, true, JSON.stringify(nextSetup));
    const laterCleanupPlan = core.parallelWorkflow(root, { action: "cleanup", trackId });
    assert.equal(laterCleanupPlan.commands.some((command) => command.args.includes(worker.worktree)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP readiness records provider capability evidence without making optional MCPs mandatory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-mcp-readiness-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), JSON.stringify({ provider_mode: "github" }, null, 2));

    const missing = core.mcpReadiness(root, { providerMode: "github" });
    assert.equal(missing.ok, false);
    assert.equal(missing.provider.required, true);
    assert.ok(missing.provider.missing_evidence_fields.includes("mcpCapabilities"));
    assert.equal(missing.summary.optional_recommended_count > 0, true);

    const ready = core.mcpReadiness(root, {
      providerMode: "github",
      mcpCapabilities: { github: { available: true, server: "github" }, sourcegraph: { available: true } },
    });
    assert.equal(ready.ok, true);
    assert.equal(ready.provider.available, true);
    assert.equal(ready.optional_mcps.find((entry) => entry.kind === "code_search").available, true);

    const ci = core.prCiStatus(root, {
      providerMode: "github",
      mcpCapabilities: { github: { available: true } },
    });
    assert.equal(ci.ok, false);
    assert.deepEqual(ci.missing_evidence_fields, []);
    assert.equal(ci.required_evidence.write_back.tool, "cadre_action");
    assert.equal(ci.required_evidence.write_back.arguments.action, "review.provider_evidence");
    assert.equal(ci.required_evidence.write_back.arguments.execute, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("metadataPatch preserves unrelated metadata while patching selected keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-metadata-patch-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "patch_20260617", samplePlan("patch_20260617"), {
      owner: "old@example.com",
      review: { verdict: "changes_requested", blocking_count: 1 },
    });

    const patched = core.metadataPatch(root, {
      trackId: "patch_20260617",
      patch: { owner: "new@example.com" },
    });

    assert.equal(patched.ok, true);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "patch_20260617", "metadata.json"), "utf8"));
    assert.equal(metadata.owner, "new@example.com");
    assert.equal(metadata.review.verdict, "changes_requested");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("regenIndex writes JSON track index and removes generated legacy Markdown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-regen-json-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "new_track", samplePlan("new_track"), { status: "new" });
    writeTrack(root, "progress_track", samplePlan("progress_track"), {
      status: "in_progress",
      priority: "high",
      owner: "dev@example.com",
      reviewer: "reviewer@example.com",
      review: { verdict: "changes_requested", blocking_count: 2 },
    });
    writeTrack(root, "completed_track", samplePlan("completed_track"), { status: "completed" });
    writeTrack(root, "blocked_track", samplePlan("blocked_track"), { status: "blocked" });
    writeTrack(root, "skipped_track", samplePlan("skipped_track"), { status: "skipped" });
    write(path.join(root, "cadre", "tracks.md"), "# Tracks\n\n<!-- cadre:index:start -->\n<!-- cadre:index:end -->\n");

    const result = core.regenIndex(root);
    assert.equal(result.ok, true);
    assert.equal(result.tracks, 5);
    assert.equal(result.removed_legacy_markdown, "cadre/tracks.md");
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks.md")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks.json")), true);
    const index = readJson(path.join(root, "cadre", "tracks.json"));
    assert.equal(index.schema, "cadre.tracks_index.v1");
    assert.deepEqual(index.counts, { new: 1, in_progress: 1, completed: 1, blocked: 1, skipped: 1 });
    const progress = index.tracks.find((track) => track.track_id === "progress_track");
    assert.equal(progress.status, "in_progress");
    assert.equal(progress.priority, "high");
    assert.equal(progress.owner, "dev@example.com");
    assert.equal(progress.reviewer, "reviewer@example.com");
    assert.equal(progress.metadata_path, "cadre/tracks/progress_track/metadata.json");
    assert.equal(progress.spec_path, "cadre/tracks/progress_track/spec.json");
    assert.equal(progress.plan_path, "cadre/tracks/progress_track/plan.json");
    assert.equal(progress.review.verdict, "changes_requested");
    const catalog = core.artifactCatalog(root, { scope: "project" });
    const tracksIndex = catalog.artifacts.find((artifact) => artifact.id === "tracks-index");
    assert.equal(tracksIndex.canonical, "cadre/tracks.json");
    assert.equal(tracksIndex.projectionFormat, "none");
    assert.equal(tracksIndex.canonical_exists, true);
    assert.equal(tracksIndex.projection_exists, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("regenIndex preserves unmarked user-authored tracks Markdown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-regen-preserve-md-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "preserve_track", samplePlan("preserve_track"));
    const userMarkdown = "# Personal Track Notes\n\nDo not delete this file.\n";
    write(path.join(root, "cadre", "tracks.md"), userMarkdown);

    const result = core.regenIndex(root);
    assert.equal(result.ok, true);
    assert.equal(result.removed_legacy_markdown, null);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tracks.md"), "utf8"), userMarkdown);
    assert.equal(readJson(path.join(root, "cadre", "tracks.json")).tracks.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("phaseSchedule returns conflict-free ready phase groups", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-phase-schedule-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "phase_20260617", planFromPhases("phase_20260617", [
      { phase_index: 1, title: "Phase 1: Foundation", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Done", ["src/foundation.js"], { status: "completed" })] },
      { phase_index: 2, title: "Phase 2: API", execution_mode: "sequential", depends_on: [], tasks: [planTask(2, 1, "Build API", ["src/api.js"])] },
      { phase_index: 3, title: "Phase 3: UI", execution_mode: "sequential", depends_on: [], tasks: [planTask(3, 1, "Build UI", ["src/ui.js"])] },
      { phase_index: 4, title: "Phase 4: Wire", execution_mode: "sequential", depends_on: ["phase2", "phase3"], tasks: [planTask(4, 1, "Integrate", ["src/app.js"])] },
    ]));

    const schedule = core.phaseSchedule(root, { trackId: "phase_20260617" });

    assert.equal(schedule.ok, true);
    assert.deepEqual(schedule.ready_phases, ["phase2", "phase3"]);
    assert.deepEqual(schedule.ready_groups, [["phase2", "phase3"]]);
    assert.deepEqual(schedule.conflict_splits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("phaseSchedule splits ready phases with file ownership conflicts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-phase-conflict-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "phase_conflict_20260617", planFromPhases("phase_conflict_20260617", [
      { phase_index: 1, title: "Phase 1: Foundation", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Done", ["src/foundation.js"], { status: "completed" })] },
      { phase_index: 2, title: "Phase 2: API", execution_mode: "sequential", depends_on: [], tasks: [planTask(2, 1, "Update shared model", ["src/shared.js"])] },
      { phase_index: 3, title: "Phase 3: UI", execution_mode: "sequential", depends_on: [], tasks: [planTask(3, 1, "Update shared model", ["src/shared.js"])] },
    ]));

    const schedule = core.phaseSchedule(root, { trackId: "phase_conflict_20260617" });

    assert.equal(schedule.ok, true);
    assert.deepEqual(schedule.ready_phases, ["phase2", "phase3"]);
    assert.deepEqual(schedule.ready_groups, [["phase2"], ["phase3"]]);
    assert.equal(schedule.conflict_splits.length, 1);
    assert.equal(schedule.conflict_splits[0].file, "src/shared.js");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflowPacketV1 emits executable sequential and parallel continuations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-workflow-next-test-"));
  try {
    git(root, ["init"]);
    const sequentialTrack = "next_sequential_20260617";
    writeTrack(root, sequentialTrack, planFromPhases(sequentialTrack, [{
      phase_index: 1,
      title: "Phase 1: Sequential",
      execution_mode: "sequential",
      depends_on: [],
      tasks: [
        planTask(1, 1, "Continue active work", ["src/sequential.js"], { status: "in_progress" }),
        planTask(1, 2, "Start later work", ["src/later.js"]),
      ],
    }]));

    const sequential = core.workflowPacketV1(root, { workflow: "implement", trackId: sequentialTrack });
    assert.equal(sequential.ok, true);
    assert.deepEqual(sequential.next, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "task.complete",
        input: { trackId: sequentialTrack, phaseIndex: 1, taskIndex: 1 },
        execute: true,
      },
    });

    const parallelTrack = "next_parallel_20260617";
    writeTrack(root, parallelTrack, planFromPhases(parallelTrack, [{
      phase_index: 1,
      title: "Phase 1: Parallel",
      execution_mode: "parallel",
      depends_on: [],
      tasks: [
        planTask(1, 1, "Build API", ["src/api.js"]),
        planTask(1, 2, "Build UI", ["src/ui.js"]),
      ],
    }]));

    const parallelWithoutIdentity = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId: parallelTrack,
    });
    assert.equal(parallelWithoutIdentity.next, null);
    assert.deepEqual(parallelWithoutIdentity.required, ["agentIdentifier"]);

    const parallel = core.workflowPacketV1(root, {
      workflow: "implement",
      trackId: parallelTrack,
      agentIdentifier: "codex",
      maxWorkers: 2,
    });
    assert.equal(parallel.ok, true);
    assert.deepEqual(parallel.next, {
      tool: "cadre_action",
      arguments: {
        root,
        action: "parallel.next_wave",
        input: { trackId: parallelTrack, groupIndex: 0, maxWorkers: 2, agentIdentifier: "codex" },
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflowPacketEnvelopeV1 retains bounded workflow data, artifacts, resources, and errors", () => {
  const root = "/tmp/cadre-workflow-envelope-v1";
  const packet = core.workflowPacketEnvelopeV1(root, { workflow: "release" }, {
    ok: false,
    workflow: "release",
    phase_state: "blocked",
    error: "primary failure",
    errors: ["primary failure", "secondary failure"],
    release_version: "v".repeat(5_000),
    completed_tracks: Array.from({ length: 80 }, (_, index) => ({ track_id: `track-${index + 1}` })),
    review_artifacts: [
      { path: "cadre/review.json", title: "Canonical review", kind: "json" },
      { title: "Release approval", kind: "packet", source: "workflow:release", release_version: "v1" },
    ],
    review_bundle: {
      files: [
        { path: "cadre/review.json", review_path: ".cadre-review/review.json", kind: "json" },
        { path: "cadre/release.md", review_path: ".cadre-review/release.md", kind: "markdown" },
      ],
    },
    written: ["cadre/written.json"],
    release_artifacts: ["cadre/release.md", "cadre/release.json"],
    resource_uris: ["cadre://template-inventory", "cadre://workspace-diagnostics"],
    schema_resources: ["cadre://artifact-schema?artifact=release"],
    detail_resources: ["cadre://workspace-diagnostics"],
  });

  assert.deepEqual(packet.errors, ["primary failure", "secondary failure"]);
  assert.equal(packet.resources[0], "cadre://template-inventory");
  assert.equal(packet.resources[1], `cadre://workspace-diagnostics?root=${encodeURIComponent(root)}`);
  assert.equal(packet.data.completed_tracks.length, 30);
  assert.ok(packet.data.release_version.length < 5_000);
  assert.deepEqual(packet.artifacts.map((artifact) => artifact.path).filter(Boolean), [
    "cadre/review.json",
    "cadre/release.md",
    "cadre/written.json",
    "cadre/release.json",
  ]);
  assert.equal(packet.artifacts.some((artifact) => artifact.title === "Release approval" && artifact.kind === "packet"), true);

  const unsafeContinuation = core.workflowPacketEnvelopeV1(root, { workflow: "setup" }, {
    ok: true,
    workflow: "setup",
    phase_state: "awaiting_clarification",
    intent_prompts: [{
      id: "unsafe-target",
      choices: [{ id: "value" }],
      responseTarget: { tool: "cadre_workflow", workflow: "setup", argument: "__proto__.value" },
    }],
  });
  assert.equal(unsafeContinuation.decision.kind, "blocked");
  assert.match(unsafeContinuation.decision.reason, /Invalid clarification response target.*unsafe/i);

  const invalidTargets = [
    { id: "reserved-argument", argument: "root" },
    { id: "reserved-custom", argument: "providerMode", customArgument: "approval" },
    { id: "scalar-map", argument: "providerMode", valueMap: { local: "local" } },
    { id: "reserved-map", argument: "providerMode", valueMap: { local: { root: "/escape" } } },
    { id: "cross-target-map", argument: "providerMode", valueMap: { local: { syncMode: "local" } } },
  ];
  for (const target of invalidTargets) {
    const blocked = core.workflowPacketEnvelopeV1(root, { workflow: "setup" }, {
      ok: true,
      workflow: "setup",
      phase_state: "awaiting_clarification",
      intent_prompts: [{
        id: target.id,
        choices: [{ id: "local" }],
        responseTarget: { tool: "cadre_workflow", workflow: "setup", ...target },
      }],
    });
    assert.equal(blocked.decision.kind, "blocked", target.id);
    assert.match(blocked.decision.reason, /Invalid clarification response target/i, target.id);
  }

  const outsideActiveStage = core.workflowPacketEnvelopeV1(root, { workflow: "setup" }, {
    ok: true,
    workflow: "setup",
    phase_state: "awaiting_clarification",
    approval: {
      session_id: "0123456789abcdef01234567",
      session_resumable: true,
      current_stage: "product",
      stages: [{ id: "product", input_keys: ["product"] }],
    },
    intent_prompts: [{
      id: "future-stage-target",
      choices: [{ id: "workflow" }],
      responseTarget: { tool: "cadre_workflow", workflow: "setup", argument: "workflowPolicy" },
    }],
  });
  assert.equal(outsideActiveStage.decision.kind, "blocked");
  assert.match(outsideActiveStage.decision.reason, /outside the active stage: workflowPolicy/i);

  const workflowFields = [
    ["setup", "scaffolded"],
    ["setup_assist", "scaffolded"],
    ["setup_scaffold", "scaffolded"],
    ["newtrack", "track_id"],
    ["new_track", "track_id"],
    ["implement", "prepare_implementation"],
    ["status", "status"],
    ["review", "gate"],
    ["validate", "projection_validation"],
    ["debug", "snapshot"],
    ["archive", "archived"],
    ["handoff", "message"],
    ["ship", "publication"],
    ["land", "preflight"],
    ["release", "release_version"],
    ["revise", "write"],
    ["refresh", "patterns"],
    ["artifacts", "artifacts"],
    ["artifact_sync", "written"],
    ["flag", "status_result"],
    ["revert", "git_results"],
    ["formula", "formula"],
    ["skill", "manifest"],
  ];
  for (const [workflow, field] of workflowFields) {
    const shaped = core.workflowPacketEnvelopeV1(root, { workflow }, {
      ok: true,
      workflow,
      [field]: { sentinel: workflow },
      next_actions: ["legacy prose continuation"],
    });
    assert.deepEqual(shaped.data[field], { sentinel: workflow }, `${workflow} should preserve ${field}`);
    assert.equal(shaped.data.next_actions, undefined, `${workflow} should not expose legacy prose continuations`);
  }
});

test("completeTask gates plan mutation on measured coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-complete-task-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "complete_20260617", samplePlan("complete_20260617"));

    const blocked = core.completeTask(root, {
      trackId: "complete_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 86%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "worktree_setup");
    assert.equal(blocked.worktree_plan.branch_set[0].repo, "root");

    const low = core.completeTask(root, {
      trackId: "complete_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: root,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 72%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(low.ok, false);
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", "complete_20260617", "plan.md"), "utf8"), /- \[ \] Task 1/);

    const ok = core.completeTask(root, {
      trackId: "complete_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: root,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 86%%\\n'",
      coverageThreshold: 80,
    });
    assert.equal(ok.ok, true);
    const plan = fs.readFileSync(path.join(root, "cadre", "tracks", "complete_20260617", "plan.md"), "utf8");
    assert.match(plan, /- \[x\] Task 1: Implement core \(abcdef123456\)/);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "complete_20260617", "metadata.json"), "utf8"));
    assert.equal(metadata.last_coverage, 86);
    assert.equal(metadata.last_task_result.task_key, "phase1_task1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask requires explicit approval for manual verification tasks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-manual-approval-test-"));
  try {
    git(root, ["init"]);
    writeManualVerificationTrack(root, "manual_approval_20260619");

    const result = core.completeTask(root, {
      trackId: "manual_approval_20260619",
      phaseIndex: 1,
      taskIndex: 2,
      workingRoot: root,
      manualVerificationSummary: "User verified the changed behavior.",
      manualVerificationChecks: [{ id: "phase1-check-1", status: "passed" }],
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "manual_verification_approval");
    const planJson = readJson(path.join(root, "cadre", "tracks", "manual_approval_20260619", "plan.json"));
    assert.equal(planJson.phases[0].tasks[1].status, "pending");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask records approved offline manual verification evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-manual-offline-test-"));
  try {
    git(root, ["init"]);
    writeManualVerificationTrack(root, "manual_offline_20260619");

    const result = core.completeTask(root, {
      trackId: "manual_offline_20260619",
      phaseIndex: 1,
      taskIndex: 2,
      workingRoot: root,
      approvalComplete: true,
      manualVerificationMode: "offline",
      manualVerificationSummary: "Ran the checkout flow by hand and confirmed the new behavior.",
      manualVerificationChecks: [
        { id: "phase1-check-1", heading: "Exercise changed behavior", status: "passed" },
      ],
    });

    assert.equal(result.ok, true);
    const planJson = readJson(path.join(root, "cadre", "tracks", "manual_offline_20260619", "plan.json"));
    const task = planJson.phases[0].tasks[1];
    assert.equal(task.status, "completed");
    assert.equal(task.completion_evidence.manual_verification.mode, "offline");
    assert.equal(task.completion_evidence.manual_verification.summary, "Ran the checkout flow by hand and confirmed the new behavior.");
    assert.equal(task.completion_evidence.manual_verification.checks[0].status, "passed");
    const metadata = readJson(path.join(root, "cadre", "tracks", "manual_offline_20260619", "metadata.json"));
    assert.equal(metadata.last_manual_verification_result.summary, "Ran the checkout flow by hand and confirmed the new behavior.");
    assert.equal(metadata.last_test_run, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask autorun manual verification returns approval evidence without mutating plan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-manual-autorun-preview-test-"));
  try {
    git(root, ["init"]);
    writeManualVerificationTrack(root, "manual_autorun_preview_20260619");

    const result = core.completeTask(root, {
      trackId: "manual_autorun_preview_20260619",
      phaseIndex: 1,
      taskIndex: 2,
      workingRoot: root,
      manualVerificationMode: "autorun",
      manualVerificationCommand: "node -e \"require('fs').writeFileSync('manual-autorun.txt','ok')\"",
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "manual_verification_approval");
    assert.equal(result.manual_verification.result.ok, true);
    assert.equal(fs.existsSync(path.join(root, "manual-autorun.txt")), true);
    const planJson = readJson(path.join(root, "cadre", "tracks", "manual_autorun_preview_20260619", "plan.json"));
    assert.equal(planJson.phases[0].tasks[1].status, "pending");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask records approved autorun manual verification evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-manual-autorun-approve-test-"));
  try {
    git(root, ["init"]);
    writeManualVerificationTrack(root, "manual_autorun_approve_20260619");

    const preview = core.completeTask(root, {
      trackId: "manual_autorun_approve_20260619",
      phaseIndex: 1,
      taskIndex: 2,
      workingRoot: root,
      manualVerificationMode: "autorun",
      manualVerificationCommand: "printf 'manual ok\\n'",
    });
    assert.equal(preview.ok, false);

    const result = core.completeTask(root, {
      trackId: "manual_autorun_approve_20260619",
      phaseIndex: 1,
      taskIndex: 2,
      workingRoot: root,
      approvalComplete: true,
      manualVerificationMode: "autorun",
      manualVerificationCommand: "printf 'manual ok\\n'",
      manualVerificationResult: preview.manual_verification,
      manualVerificationChecks: [{ id: "phase1-check-1", status: "passed" }],
    });

    assert.equal(result.ok, true);
    const planJson = readJson(path.join(root, "cadre", "tracks", "manual_autorun_approve_20260619", "plan.json"));
    const evidence = planJson.phases[0].tasks[1].completion_evidence.manual_verification;
    assert.equal(planJson.phases[0].tasks[1].status, "completed");
    assert.equal(evidence.mode, "autorun");
    assert.equal(evidence.result.ok, true);
    assert.match(evidence.result.stdout_tail, /manual ok/);
    const metadata = readJson(path.join(root, "cadre", "tracks", "manual_autorun_approve_20260619", "metadata.json"));
    assert.equal(metadata.last_manual_verification_result.mode, "autorun");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask writes completion journal and native events on retry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-complete-journal-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "journal_20260617", samplePlan("journal_20260617"));

    const args = {
      trackId: "journal_20260617",
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: root,
      commitSha: "abcdef123456",
      command: "printf 'Statements : 87%%\\n'",
      coverageThreshold: 80,
    };
    const first = core.completeTask(root, args);
    assert.equal(first.ok, true);
    const second = core.completeTask(root, args);
    assert.equal(second.ok, true);

    const journal = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "journal_20260617", "completion_journal.json"), "utf8"));
    const entries = Object.values(journal.entries);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].stage, "completed");
    const events = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8")
      .trim()
      .split(/\n/)
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.kind === "task_result_recorded"));
    assert.ok(events.some((event) => event.kind === "task_completed"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("completeTask commits explicit control-plane files when an active claim is dirty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-complete-claim-dirty-test-"));
  try {
    setupTraceableProject(root);
    const trackId = "claim_dirty_complete_20260625";
    const plan = planFromPhases(trackId, [
      { phase_index: 1, title: "Phase 1: Claimed task completion", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Implement claim dirty core", ["src/core.js"])] },
    ]);
    const created = approveWorkflow(root, {
      workflow: "newtrack",
      execute: true,
      approvalComplete: true,
      responseMode: "detail",
      trackId,
      spec: sampleSpec(trackId),
      plan,
    });
    assert.equal(created.ok, true);

    const claimed = core.claimTrack(root, trackId, { identity: "claimant@example.invalid", takeover: true });
    assert.equal(claimed.ok, true);
    assert.match(git(root, ["status", "--porcelain"]).stdout, new RegExp(`cadre/tracks/${trackId}/metadata.json`));

    write(path.join(root, "src", "core.js"), "module.exports = function core() { return 'claim-dirty'; };\n");
    const completed = core.completeTask(root, {
      trackId,
      phaseIndex: 1,
      taskIndex: 1,
      workingRoot: root,
      command: "printf '%s\\n' 'Statements : 92%'",
      coverageThreshold: 80,
    });
    assert.equal(completed.ok, true);
    assert.ok(completed.control_commit.commit_sha);
    assert.equal(completed.control_commit.stage, undefined);
    assert.equal(git(root, ["status", "--porcelain"]).stdout.trim(), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shared control-plane post sync fails closed when remote verification fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-sync-fail-closed-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), JSON.stringify({
      sync_mode: "shared",
      control_remote: "origin",
      control_branch: "main",
    }, null, 2));

    const result = core.syncControlPlane(root, { mode: "post" });
    assert.equal(result.ok, false);
    assert.match(result.safety.reason, /Unable to verify origin\/main/);
    assert.equal(result.commands.some((cmd) => cmd.command.includes("git push")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("teamBoard returns WIP, review queue, blockers, and native state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-team-board-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "active_20260617", samplePlan("active_20260617"), {
      status: "in_progress",
      owner: "dev@example.com",
      review: { verdict: "changes_requested", blocking_count: 1 },
    });
    writeTrack(root, "blocked_20260617", samplePlan("blocked_20260617"), {
      depends_on: ["missing_20260617"],
    });

    const board = core.teamBoard(root);
    assert.equal(board.ok, true);
    assert.ok(board.wip.some((item) => item.track_id === "active_20260617"));
    assert.ok(board.review_queue.some((item) => item.track_id === "active_20260617"));
    assert.ok(board.blockers.some((item) => item.track_id === "blocked_20260617"));
    assert.equal(board.native_state.ok, true);
    assert.equal(typeof board.native_state.counts.events, "number");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fleetStatus degrades cleanly for missing product repos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-fleet-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "app",
      repos: [
        { name: "app", submodule_path: "repos/app" },
        { name: "missing", submodule_path: "repos/missing" },
      ],
    }, null, 2));
    fs.mkdirSync(path.join(root, "repos", "app"), { recursive: true });
    git(path.join(root, "repos", "app"), ["init"]);

    const fleet = core.fleetStatus(root);
    assert.equal(fleet.ok, true);
    assert.equal(fleet.topology, "polyrepo");
    assert.ok(fleet.repos.some((repo) => repo.name === "." && repo.role === "control"));
    assert.ok(fleet.repos.some((repo) => repo.name === "missing" && repo.exists === false));
    assert.equal(fleet.provider.provider_mode, "local");
    assert.equal(fleet.provider.available, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow formula supports native formulas, wisps, squash, burn, and pour", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-formula-native-test-"));
  try {
    git(root, ["init"]);
    const executePouredTrack = (preview) => {
      const sessionId = preview.approval.session_id;
      const planPreview = core.workflowPacket(root, {
        workflow: "newtrack",
        approvalSessionId: sessionId,
        approvalStage: "spec",
        ...approvalStamp(preview.approval),
        approvedStages: ["spec"],
      });
      assert.equal(planPreview.ok, true, planPreview.error);
      assert.equal(planPreview.approval.current_stage, "plan");
      const ready = core.workflowPacket(root, {
        workflow: "newtrack",
        approvalSessionId: sessionId,
        approvalStage: "plan",
        ...approvalStamp(planPreview.approval),
        approvedStages: ["spec", "plan"],
      });
      assert.equal(ready.ok, true, ready.error);
      const executed = core.workflowPacket(root, {
        workflow: "newtrack",
        execute: true,
        approvalComplete: true,
        approvalSessionId: sessionId,
        approvedStages: ["spec", "plan"],
      });
      assert.equal(executed.ok, true, executed.error);
      return executed;
    };
    write(path.join(root, "cadre", "formulas", "sample.json"), JSON.stringify({
      version: 1,
      schema: "cadre.formula.v1",
      id: "sample",
      title: "Sample Formula",
      phase_title: "OAuth delivery and verification",
      defaults: { track: "formula_track" },
      steps: [
        { id: "build", title: "Build {{track}}", labels: ["formula"], files: ["src/{{track}}.ts"] },
        { id: "verify", title: "Verify {{track}}", depends_on: ["build"] },
      ],
    }, null, 2));

    const list = core.workflowPacket(root, { workflow: "formula", action: "list" });
    assert.equal(list.ok, true);
    assert.equal(list.count, 1);
    const show = core.workflowPacket(root, { workflow: "formula", action: "show", id: "sample" });
    assert.equal(show.ok, true);
    assert.equal(show.formula.title, "Sample Formula");
    const cook = core.workflowPacket(root, { workflow: "formula", action: "cook", id: "sample", variables: { track: "oauth" }, trackId: "oauth_track", responseMode: "detail" });
    assert.equal(cook.ok, true);
    assert.equal(cook.plan.phases[0].tasks[0].title, "Build oauth");
    assert.deepEqual(cook.plan.phases[0].tasks[0].labels, ["formula"]);

    const created = core.workflowPacket(root, { workflow: "formula", action: "wisp_create", execute: true, id: "sample", variables: { track: "oauth" } });
    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "wisps", `${created.wisp_id}.json`)), true);
    const updated = core.workflowPacket(root, {
      workflow: "formula",
      action: "wisp_update_step",
      execute: true,
      wispId: created.wisp_id,
      stepId: "build",
      status: "completed",
      evidence: { tests: "ok" },
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.step.status, "completed");
    const wisps = core.workflowPacket(root, { workflow: "formula", action: "wisp_list" });
    assert.equal(wisps.count, 1);
    const squash = core.workflowPacket(root, { workflow: "formula", action: "wisp_squash", execute: true, wispId: created.wisp_id, summary: "ready" });
    assert.equal(squash.ok, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "operations", "wisp-digests.jsonl")), true);

    const wispPour = core.workflowPacket(root, {
      workflow: "formula",
      action: "pour",
      wispId: created.wisp_id,
      trackId: "oauth_wisp_track",
      reviewBundleDir: ".wisp-formula-review",
      responseMode: "detail",
    });
    assert.equal(wispPour.ok, true, wispPour.error);
    assert.equal(wispPour.wisp_id, created.wisp_id);
    const wispExecuted = executePouredTrack(wispPour);
    assert.equal(wispExecuted.formula_event.event.wisp_id, created.wisp_id);

    const burn = core.workflowPacket(root, { workflow: "formula", action: "wisp_burn", execute: true, wispId: created.wisp_id });
    assert.equal(burn.ok, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "wisps", `${created.wisp_id}.json`)), false);

    const pour = core.workflowPacket(root, {
      workflow: "formula",
      action: "pour",
      id: "sample",
      variables: { track: "oauth" },
      trackId: "oauth_formula_track",
      reviewBundleDir: ".formula-review",
      responseMode: "detail",
    });
    assert.equal(pour.ok, true);
    assert.equal(pour.dry_run, true);
    assert.equal(pour.metadata.tags.includes("formula:sample"), true);
    assert.equal(pour.metadata_state, "proposed");
    assert.equal(pour.wisp_id, null);
    assert.equal(pour.pour_event, null);
    assert.equal(readJsonLines(path.join(root, "cadre", "events.jsonl")).some((event) => (
      event.kind === "formula_poured" && event.track_id === "oauth_formula_track"
    )), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "oauth_formula_track")), false);

    const sessionId = pour.approval.session_id;
    const executed = executePouredTrack(pour);
    assert.equal(executed.formula_event.event.kind, "formula_poured");
    assert.equal(executed.formula_event.event.approval_session_id, sessionId);
    assert.equal(executed.formula_event.event.wisp_id, null);
    assert.equal(readJson(path.join(root, "cadre", "tracks", "oauth_formula_track", "metadata.json")).tags.includes("formula:sample"), true);
    assert.equal(readJsonLines(path.join(root, "cadre", "events.jsonl")).filter((event) => (
      event.kind === "formula_poured" && event.track_id === "oauth_formula_track"
    )).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup requires staged approval before writing reviewed artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-human-review-test-"));
  try {
    git(root, ["init"]);
    const resolved = resolveSetupPrompts(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: true,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Product", summary: "Test product" },
      productGuidelines: { title: "Product Guidelines", summary: "Keep setup review evidence explicit." },
      techStack: { languages: ["TypeScript"] },
      workflowPolicy: { title: "Workflow", summary: "Review each setup stage before execution." },
      reviewBundleDir: ".cadre-review",
    });
    const args = resolved.args;
    const preview = resolved.preview;
    assert.equal(preview.ok, true);
    assert.equal(preview.approval.required, true);
    assert.equal(preview.approval.approval_complete, false);
    assert.equal(preview.approval.explicit_user_approval_required, true);
    assert.equal(preview.approval.manual_approval_required, true);
    assert.match(preview.approval.manual_approval_prompt, /approve product/);
    assert.equal(preview.approval.current_stage, "product");
    assert.deepEqual(preview.styleGuides.detected, ["typescript"]);
    assert.deepEqual(preview.styleGuides.selected, []);
    const productArtifact = preview.review_artifacts.find((artifact) => artifact.path === "cadre/product.md");
    assert.ok(productArtifact);
    assert.equal(Object.prototype.hasOwnProperty.call(productArtifact, "content"), false);
    assert.equal(preview.review_bundle.content_in_response, false);
    assert.equal(Object.prototype.hasOwnProperty.call(preview.review_bundle, "commands"), false);
    assert.ok(fs.existsSync(path.join(preview.review_bundle.directory, "cadre", "product.md")));
    assert.ok(fs.existsSync(preview.review_bundle.manifest_path));
    const manifest = readJson(preview.review_bundle.manifest_path);
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, "commands"), false);
    assert.deepEqual(manifest.files.map((file) => file.path).sort(), ["cadre/product.json", "cadre/product.md"]);

    const blocked = core.workflowPacket(root, {
      ...args,
      execute: true,
      approvalComplete: true,
      approvalSessionId: preview.approval.session_id,
      approvedStages: [],
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "staged_approval");
    assert.equal(blocked.phase_state, "awaiting_staged_approval");
    assert.equal(fs.existsSync(path.join(root, "cadre", "config.json")), false);

    const approvedMinimal = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "product",
      ...approvalStamp(preview.approval),
      approvedStages: ["product"],
    });
    assert.equal(approvedMinimal.ok, true, approvedMinimal.error || JSON.stringify(approvedMinimal.approval || {}));
    assert.equal(approvedMinimal.approval.current_stage, "product_guidelines");
    assert.deepEqual(approvedMinimal.approval.approved_stages, ["product"]);
    const guidelinesManifest = readJson(approvedMinimal.review_bundle.manifest_path);
    assert.deepEqual(guidelinesManifest.files.map((file) => file.path).sort(), ["cadre/product_guidelines.json", "cadre/product_guidelines.md"]);
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${preview.approval.session_id}.json`);
    const persistedSession = readJson(sessionFile);
    assert.equal(persistedSession.schema_version, 2);
    assert.deepEqual(persistedSession.stage_order, ["product", "product_guidelines", "technical", "workflow"]);
    assert.equal(persistedSession.stage_records.product.status, "approved");
    assert.equal(persistedSession.stage_records.product_guidelines.status, "previewed");
    assert.deepEqual(persistedSession.stage_records.technical.snapshot_files, []);
    assert.deepEqual(persistedSession.stage_records.workflow.snapshot_files, []);
    assert.deepEqual(persistedSession.final_snapshot_files, []);

    const approvedWithAccidentalPayload = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "product_guidelines",
      ...approvalStamp(approvedMinimal.approval),
      approvedStages: ["product", "product_guidelines"],
      product: { name: "Accidental payload drift should not replace reviewed session payload" },
      providerMode: "github",
    });
    assert.equal(approvedWithAccidentalPayload.ok, false);
    assert.match(approvedWithAccidentalPayload.error, /cannot amend staged input/i);
    assert.equal(approvedWithAccidentalPayload.approval.current_stage, "product_guidelines");

    const guidelinesApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "product_guidelines",
      ...approvalStamp(approvedMinimal.approval),
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(guidelinesApproved.ok, true, guidelinesApproved.error);
    assert.equal(guidelinesApproved.approval.current_stage, "technical");
    const technicalManifest = readJson(guidelinesApproved.review_bundle.manifest_path);
    assert.deepEqual(technicalManifest.files.map((file) => file.path).sort(), [
      "cadre/lsp.json",
      "cadre/styleguides/README.md",
      "cadre/styleguides/index.json",
      "cadre/tech-stack.json",
      "cadre/tech-stack.md",
    ]);
    const technicalSession = readJson(sessionFile);
    assert.deepEqual(technicalSession.final_snapshot_files, []);

    const technicalApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "technical",
      ...approvalStamp(guidelinesApproved.approval),
      approvedStages: ["product", "product_guidelines", "technical"],
    });
    assert.equal(technicalApproved.ok, true, technicalApproved.error);
    assert.equal(technicalApproved.approval.current_stage, "workflow");
    const workflowManifest = readJson(technicalApproved.review_bundle.manifest_path);
    assert.deepEqual(workflowManifest.files.map((file) => file.path).sort(), ["cadre/workflow.json", "cadre/workflow.md"]);
    const workflowSession = readJson(sessionFile);
    assert.ok(workflowSession.final_snapshot_files.some((file) => file.path === "cadre/config.json"));
    assert.ok(workflowSession.final_snapshot_files.some((file) => file.path === "cadre/patterns.jsonl"));

    const workflowApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "workflow",
      ...approvalStamp(technicalApproved.approval),
      approvedStages: ["product", "product_guidelines", "technical", "workflow"],
    });
    assert.equal(workflowApproved.ok, true, workflowApproved.error);
    assert.equal(workflowApproved.approval.current_stage, null);
    assert.deepEqual(workflowApproved.approval.pending_stages, []);
    const approvedSession = readJson(sessionFile);
    const approvedSnapshots = approvedSession.snapshot_files.filter((file) => file.missing !== true);
    const executed = core.workflowPacket(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      approvalSessionId: preview.approval.session_id,
      approvedStages: ["product", "product_guidelines", "technical", "workflow"],
    });
    assert.equal(executed.ok, true, executed.error);
    for (const snapshot of approvedSnapshots) {
      assert.equal(fs.readFileSync(path.join(root, snapshot.path), "utf8"), snapshot.content, snapshot.path);
    }
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("review-heavy workflows expose staged approval bundles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-staged-review-test-"));
  try {
    setupTraceableProject(root);
    const trackId = "staged_review_20260625";
    const created = approveWorkflow(root, {
      workflow: "newtrack",
      execute: true,
      approvalComplete: true,
      trackId,
      spec: sampleSpec(trackId),
      plan: samplePlan(trackId),
    });
    assert.equal(created.ok, true);

    const revised = core.workflowPacket(root, {
      workflow: "revise",
      trackId,
      reason: "Exercise staged approval for revised spec and plan artifacts.",
      spec: sampleSpec(trackId, {
        acceptance_criteria: [{ heading: "Revised acceptance", body: "Staged approval exposes spec changes first." }],
      }),
      plan: samplePlan(trackId),
    });
    assert.equal(revised.ok, true);
    assert.equal(revised.approval.current_stage, "spec_changes");
    assert.ok(fs.existsSync(path.join(revised.review_bundle.directory, "cadre", "tracks", trackId, "spec.json")));

    const handoff = core.workflowPacket(root, {
      workflow: "handoff",
      trackId,
      handoffText: "# Handoff\n\nThe revised spec and plan are ready for review. Resume by checking the staged artifacts, then run the focused workflow tests before implementation.",
    });
    assert.equal(handoff.ok, true);
    assert.equal(handoff.approval.current_stage, "handoff");
    const amendedHandoff = core.workflowPacket(root, {
      workflow: "handoff",
      approvalSessionId: handoff.approval.session_id,
      handoff_text: "# Corrected handoff\n\nResume by validating the authoritative replacement and then run focused workflow tests.",
    });
    assert.equal(amendedHandoff.ok, true, amendedHandoff.error);
    assert.equal(amendedHandoff.approval.session_id, handoff.approval.session_id);
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "HANDOFF.md"), "utf8"), /authoritative replacement/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "HANDOFF.md"), "utf8"), /revised spec and plan are ready/);
    const handoffPayload = readJson(path.join(root, "cadre", "local", "approval-sessions", `${handoff.approval.session_id}.json`)).payload;
    assert.equal(handoffPayload.handoffText, "# Corrected handoff\n\nResume by validating the authoritative replacement and then run focused workflow tests.");
    assert.equal(Object.prototype.hasOwnProperty.call(handoffPayload, "handoff_text"), false);

    const refresh = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: ["patterns"],
      proposedContext: {
        patterns: {
          text: "# Codebase Patterns\n\n## Review lifecycle\n\nUnapproved staged previews are replaced only after checking their target files for drift.",
        },
      },
    });
    assert.equal(refresh.ok, true, refresh.error);
    assert.equal(refresh.approval.current_stage, "patterns");

    const artifacts = core.artifactPacket(root, { action: "sync", scope: `track:${trackId}` });
    assert.equal(artifacts.ok, true);
    assert.equal(artifacts.approval.required, false);

    const patched = core.metadataPatch(root, { trackId, patch: { status: "completed" } });
    assert.equal(patched.ok, true);
    const release = core.workflowPacket(root, { workflow: "release", releaseVersion: "v0.0.1" });
    assert.equal(release.ok, true);
    assert.equal(release.approval.current_stage, "release_notes");
    assert.deepEqual(release.resource_uris, [], "release previews are not recomputed through read resources");
    const amendedRelease = core.workflowPacket(root, {
      workflow: "release",
      approvalSessionId: release.approval.session_id,
      release_notes: "Corrected release notes: authoritative staged evidence replaces the earlier generated summary.",
    });
    assert.equal(amendedRelease.ok, true, amendedRelease.error);
    assert.equal(amendedRelease.approval.session_id, release.approval.session_id);
    const releasePayload = readJson(path.join(root, "cadre", "local", "approval-sessions", `${release.approval.session_id}.json`)).payload;
    assert.match(releasePayload.releaseNotes, /authoritative staged evidence/);
    assert.equal(Object.prototype.hasOwnProperty.call(releasePayload, "release_notes"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup dry-run returns native recommendation prompts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-native-prompts-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");

    const args = withSetupTestEvidence({
      workflow: "setup",
      teamSize: 3,
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"], frameworks: ["React"] },
      responseMode: "detail",
    });
    const productPreview = core.workflowPacket(root, args);
    assert.equal(productPreview.approval.current_stage, "product");
    assert.deepEqual(productPreview.native_prompts || [], []);
    const guidelinePreview = core.workflowPacket(root, {
      workflow: "setup",
      responseMode: "detail",
      approvalSessionId: productPreview.approval.session_id,
      approvalStage: "product",
      ...approvalStamp(productPreview.approval),
      approvedStages: ["product"],
    });
    assert.equal(guidelinePreview.approval.current_stage, "product_guidelines");
    assert.deepEqual(guidelinePreview.native_prompts || [], []);
    const preview = core.workflowPacket(root, {
      workflow: "setup",
      responseMode: "detail",
      approvalSessionId: productPreview.approval.session_id,
      approvalStage: "product_guidelines",
      ...approvalStamp(guidelinePreview.approval),
      approvedStages: ["product", "product_guidelines"],
    });

    assert.equal(preview.ok, true);
    assert.equal(preview.phase_state, "awaiting_clarification");
    assert.equal(preview.approval.required, true);
    assert.equal(preview.approval.current_stage, "technical");
    assert.equal(preview.approval.session_id, productPreview.approval.session_id);
    assert.equal(preview.review_bundle ?? null, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.json")), false);
    assert.deepEqual(preview.native_prompts.map((prompt) => prompt.id), [
      "setup-provider-mode",
      "setup-sync-mode",
      "setup-style-guides",
      "setup-lsp",
      "setup-optional-mcps",
    ]);
    for (const prompt of preview.native_prompts) {
      assert.equal(prompt.schema, "cadre.native_prompt.v1");
      assert.equal(prompt.responseTarget.tool, "cadre_workflow");
      assert.equal(prompt.responseTarget.workflow, "setup");
      assert.ok(prompt.choices.length > 0);
    }

    const provider = preview.native_prompts.find((prompt) => prompt.id === "setup-provider-mode");
    assert.equal(provider.selectionMode, "single");
    assert.equal(provider.allowCustom, false);
    assert.equal(provider.customArgument, undefined);
    assert.equal(provider.responseTarget.argument, "providerMode");
    assert.equal(provider.choices.find((choice) => choice.id === "local").recommended, true);

    const sync = preview.native_prompts.find((prompt) => prompt.id === "setup-sync-mode");
    assert.equal(sync.selectionMode, "single");
    assert.equal(sync.allowCustom, false);
    assert.equal(sync.customArgument, undefined);
    assert.equal(sync.responseTarget.argument, "syncMode");
    assert.equal(sync.choices.find((choice) => choice.id === "shared").recommended, true);

    const styleGuides = preview.native_prompts.find((prompt) => prompt.id === "setup-style-guides");
    assert.equal(styleGuides.selectionMode, "multi");
    assert.equal(styleGuides.allowCustom, false);
    assert.equal(styleGuides.customArgument, undefined);
    assert.equal(styleGuides.responseTarget.argument, "styleGuideIds");
    assert.ok(styleGuides.choices.some((choice) => choice.id === "general" && choice.recommended === true));
    assert.ok(styleGuides.choices.some((choice) => choice.id === "typescript" && choice.recommended === true));

    const lsp = preview.native_prompts.find((prompt) => prompt.id === "setup-lsp");
    assert.equal(lsp.selectionMode, "single");
    assert.equal(lsp.allowCustom, false);
    assert.equal(lsp.customArgument, undefined);
    assert.equal(lsp.responseTarget.argument, "writeLsp");
    assert.deepEqual(lsp.responseTarget.valueMap["write-lsp"], { writeLsp: true });
    assert.deepEqual(lsp.responseTarget.valueMap["skip-lsp"], { writeLsp: false });
    assert.equal(lsp.responseTarget.valueMode, "value_map");
    assert.ok(lsp.choices.some((choice) => choice.id === "write-lsp" && choice.recommended === true));

    const optionalMcps = preview.native_prompts.find((prompt) => prompt.id === "setup-optional-mcps");
    assert.equal(optionalMcps.selectionMode, "multi");
    assert.equal(optionalMcps.allowCustom, true);
    assert.equal(optionalMcps.customArgument, "integrations.other");
    assert.equal(optionalMcps.responseTarget.argument, "integrations.optional_mcps");
    assert.equal(optionalMcps.responseTarget.customArgument, "integrations.other");
    assert.ok(optionalMcps.choices.some((choice) => choice.id === "code_search"));

    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${productPreview.approval.session_id}.json`);
    const sessionBeforeInvalid = fs.readFileSync(sessionFile, "utf8");
    const invalidOverrides = core.workflowPacket(root, {
      workflow: "setup",
      responseMode: "detail",
      approvalSessionId: productPreview.approval.session_id,
      providerMode: "bitbucket",
      syncMode: "remote",
      styleGuideIds: ["unknown-guide"],
      writeLsp: "skip-lsp",
    });
    assert.equal(invalidOverrides.phase_state, "awaiting_clarification");
    assert.equal(invalidOverrides.approval.session_id, productPreview.approval.session_id);
    assert.deepEqual(invalidOverrides.native_prompts.map((prompt) => prompt.id), [
      "setup-provider-mode",
      "setup-sync-mode",
      "setup-style-guides",
      "setup-lsp",
      "setup-optional-mcps",
    ]);
    assert.equal(invalidOverrides.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.json")), false);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBeforeInvalid);

    const sessionAfterInvalid = fs.readFileSync(sessionFile, "utf8");
    const repeatedInvalid = core.workflowPacket(root, {
      workflow: "setup",
      responseMode: "detail",
      approvalSessionId: productPreview.approval.session_id,
      provider_mode: ["github"],
      tech_stack: { languages: ["Swift"], notes: "This valid-looking edit is rejected atomically with the invalid provider." },
    });
    assert.equal(repeatedInvalid.phase_state, "awaiting_clarification");
    assert.ok(repeatedInvalid.native_prompts.some((prompt) => prompt.id === "setup-provider-mode"));
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionAfterInvalid);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.json")), false);

    const compact = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: productPreview.approval.session_id,
      responseMode: "compact",
    });
    const compactProvider = compact.native_prompts.find((prompt) => prompt.id === "setup-provider-mode");
    assert.equal(compactProvider.selectionMode, "single");
    assert.equal(compactProvider.argument, "providerMode");
    assert.deepEqual(compactProvider.responseTarget.valueMap.local, { providerMode: "local" });
    assert.ok(compactProvider.choices.some((choice) => choice.id === "local" && choice.label === "Local" && choice.recommended === true));
    assert.equal(compactProvider.allowCustom, false);
    assert.equal(compactProvider.customArgument, null);
    assert.equal(compactProvider.responseTarget.customArgument, null);
    assert.deepEqual(compactProvider.responseTarget.selectedIds, []);
    assert.equal(compactProvider.responseTarget.valueMode, "value_map");
    assert.equal(compactProvider.responseTarget.customMode, "replace");
    assert.ok(compact.native_prompts.find((prompt) => prompt.id === "setup-style-guides").choices.some((choice) => choice.id === "typescript" && choice.recommended === true));
    const compactLsp = compact.native_prompts.find((prompt) => prompt.id === "setup-lsp");
    assert.deepEqual(compactLsp.responseTarget.valueMap["write-lsp"], { writeLsp: true });
    assert.deepEqual(compactLsp.responseTarget.valueMap["skip-lsp"], { writeLsp: false });
    assert.equal(compactLsp.responseTarget.valueMode, "value_map");
    assert.equal(compactLsp.responseTarget.customMode, "replace");
    const compactOptionalMcps = compact.native_prompts.find((prompt) => prompt.id === "setup-optional-mcps");
    assert.equal(compactOptionalMcps.customArgument, "integrations.other");
    assert.equal(compactOptionalMcps.responseTarget.customArgument, "integrations.other");
    assert.deepEqual(compactOptionalMcps.responseTarget.selectedIds, []);
    assert.equal(compactOptionalMcps.responseTarget.valueMode, "selected_ids");
    assert.equal(compactOptionalMcps.responseTarget.customMode, "replace");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid initial setup choices create no approval session or preview artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-invalid-initial-choice-test-"));
  try {
    git(root, ["init"]);
    const result = core.workflowPacket(root, withSetupTestEvidence({
      workflow: "setup",
      providerMode: "bitbucket",
      syncMode: "local",
      writeLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Atomic setup", summary: "Reject invalid choices before creating staged state." },
      techStack: { languages: ["TypeScript"] },
    }));
    assert.equal(result.ok, true, result.error);
    assert.equal(result.phase_state, "awaiting_clarification");
    assert.deepEqual(result.native_prompts.map((prompt) => prompt.id), ["setup-provider-mode"]);
    assert.equal(result.approval.session_id, null);
    assert.equal(result.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions")), false);
    for (const file of ["product.json", "product.md", "product_guidelines.json", "tech-stack.json", "workflow.json"]) {
      assert.equal(fs.existsSync(path.join(root, "cadre", file)), false, file);
    }

    for (const invalidStyleGuides of [42, ""]) {
      const malformedStyle = core.workflowPacket(root, withSetupTestEvidence({
        workflow: "setup",
        providerMode: "local",
        syncMode: "local",
        writeLsp: false,
        styleGuideIds: invalidStyleGuides,
        integrations: {},
        product: { title: "Atomic setup", summary: "Reject malformed style selections before staged state." },
        techStack: { languages: ["TypeScript"] },
      }));
      assert.equal(malformedStyle.phase_state, "awaiting_clarification");
      assert.deepEqual(malformedStyle.native_prompts.map((prompt) => prompt.id), ["setup-style-guides"]);
      assert.equal(malformedStyle.approval.session_id, null);
      assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions")), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup dry-run exposes clarification prompts before approval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-intent-prompts-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");

    const preview = core.workflowPacket(root, { workflow: "setup" });
    assert.equal(preview.ok, true);
    assert.equal(preview.phase_state, "awaiting_clarification");
    assert.equal(preview.stage, "intent_clarification");
    assert.ok(preview.intent_prompts.some((prompt) => prompt.id === "setup-product-intent"));
    assert.deepEqual(preview.native_prompts || [], []);
    assert.match(preview.next_actions[0], /Answer returned intent_prompts\/native_prompts/);
    assert.equal(preview.approval.required, true);
    assert.equal(preview.approval.session_id, null);
    assert.equal(preview.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.md")), false);
    assert.equal(git(root, ["status", "--porcelain", "--", "cadre"]).stdout.trim(), "");

    const publicPreview = core.workflowPacketV1(root, {
      workflow: "setup",
      providerMode: "local",
      styleGuideIds: [],
      writeLsp: false,
      integrations: {},
    });
    assert.equal(publicPreview.decision.kind, "clarification");
    assert.deepEqual(publicPreview.decision.resume, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "setup",
        input: { providerMode: "local", styleGuideIds: [], writeLsp: false, integrations: {} },
        execute: false,
      },
    });
    assert.ok(publicPreview.decision.writable_paths.every((value) => value.startsWith("/arguments/input/")));

    const emptyPayload = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: {},
      techStack: {},
    });
    assert.equal(emptyPayload.phase_state, "awaiting_clarification");
    assert.deepEqual(emptyPayload.missing_payload, ["product"]);
    assert.deepEqual(emptyPayload.intent_prompts.map((prompt) => prompt.id), ["setup-product-intent"]);
    assert.equal(emptyPayload.approval.required, true);
    assert.equal(emptyPayload.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), false);

    const blankPayload = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "   ", summary: "", users: [] },
      techStack: { languages: [], frameworks: [] },
    });
    assert.deepEqual(blankPayload.missing_payload, ["product"]);
    assert.equal(blankPayload.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), false);

    const placeholderPayload = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Product", summary: "TODO: inspect README" },
      techStack: { summary: "TBD after manifest audit" },
    });
    assert.deepEqual(placeholderPayload.missing_payload, ["product"]);
    assert.equal(placeholderPayload.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), false);

    const selectedIntent = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      intent: { product: "use-readme", techStack: "detect" },
    });
    assert.equal(selectedIntent.phase_state, "awaiting_clarification");
    assert.deepEqual(selectedIntent.intent_prompts, []);
    assert.deepEqual(selectedIntent.missing_payload, ["product"]);
    assert.match(selectedIntent.next_actions[0], /structured evidence for: product/);
    assert.equal(selectedIntent.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), false);

    const packet = core.workflowPacketV1(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      intent: { product: "use-readme", techStack: "detect" },
    });
    assert.equal(packet.decision.kind, "clarification");
    assert.deepEqual(packet.decision.prompts, []);
    assert.deepEqual(packet.decision.required, ["product"]);
    assert.deepEqual(packet.required, ["product"]);

    const evidencePreview = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: ["general"],
      integrations: {},
      product: {
        title: "Brownfield Product",
        summary: "Repository-grounded product context collected before review.",
      },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(evidencePreview.ok, true, evidencePreview.error);
    assert.equal(evidencePreview.approval.current_stage, "product");
    assert.equal(evidencePreview.review_bundle.mode, "target");
    assert.equal(readJson(path.join(root, "cadre", "product.json")).title, "Brownfield Product");
    assert.match(fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8"), /# Brownfield Product/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup rejects bundled guideline and workflow scaffolds until same-session evidence replaces them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-policy-template-evidence-test-"));
  try {
    git(root, ["init"]);
    const productGuidelinesTemplate = readJson(path.join(__dirname, "..", "templates", "product_guidelines.json"));
    const workflowTemplate = readJson(path.join(__dirname, "..", "templates", "workflow.json"));
    const productPreview = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Brownfield Product", summary: "Repository-grounded product behavior." },
      productGuidelines: productGuidelinesTemplate,
      techStack: { languages: ["TypeScript"] },
      workflowPolicy: workflowTemplate,
    });
    const sessionId = productPreview.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const guidelineClarification = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product",
      ...approvalStamp(productPreview.approval),
      approvedStages: ["product"],
    });
    assert.equal(guidelineClarification.ok, true, guidelineClarification.error);
    assert.equal(guidelineClarification.phase_state, "awaiting_clarification");
    assert.equal(guidelineClarification.approval.session_id, sessionId);
    assert.equal(guidelineClarification.approval.current_stage, "product_guidelines");
    assert.deepEqual(guidelineClarification.missing_payload, ["productGuidelines"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product_guidelines.json")), false);
    let session = readJson(sessionFile);
    assert.deepEqual(session.stage_records.product_guidelines.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);

    const guidelinePreview = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      productGuidelines: {
        title: "Product Guidelines",
        summary: "Preserve tenant isolation and make failed operations recoverable.",
      },
    });
    assert.equal(guidelinePreview.approval.current_stage, "product_guidelines");
    assert.deepEqual(guidelinePreview.review_artifacts.map((file) => file.path).sort(), [
      "cadre/product_guidelines.json",
      "cadre/product_guidelines.md",
    ]);
    const technicalPreview = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product_guidelines",
      ...approvalStamp(guidelinePreview.approval),
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(technicalPreview.approval.current_stage, "technical");
    const workflowClarification = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "technical",
      ...approvalStamp(technicalPreview.approval),
      approvedStages: ["product", "product_guidelines", "technical"],
    });
    assert.equal(workflowClarification.approval.current_stage, "workflow");
    assert.deepEqual(workflowClarification.missing_payload, ["workflowPolicy"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "workflow.json")), false);
    session = readJson(sessionFile);
    assert.deepEqual(session.stage_records.workflow.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);

    const decoratedTemplate = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      workflowPolicy: { ...workflowTemplate, generated_at: "2026-07-14T00:00:00.000Z" },
    });
    assert.equal(decoratedTemplate.phase_state, "awaiting_clarification");
    assert.deepEqual(decoratedTemplate.missing_payload, ["workflowPolicy"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "workflow.json")), false);
    assert.deepEqual(readJson(sessionFile).final_snapshot_files, []);

    const workflowPreview = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      workflowPolicy: {
        title: "Project Workflow",
        summary: "Run focused tests, preserve review evidence, and record explicit stage approval.",
      },
    });
    assert.equal(workflowPreview.approval.current_stage, "workflow");
    assert.deepEqual(workflowPreview.review_artifacts.map((file) => file.path).sort(), [
      "cadre/workflow.json",
      "cadre/workflow.md",
    ]);
    assert.ok(readJson(sessionFile).final_snapshot_files.some((file) => file.path === "cadre/config.json"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup rejects technical placeholders without materializing technical artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-technical-placeholder-test-"));
  try {
    git(root, ["init"]);
    const technical = advanceSetupToTechnical(root, {
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      topology: "polyrepo",
      product: {
        title: "Brownfield Product",
        summary: "Repository-grounded behavior must be approved before technical analysis.",
      },
      productGuidelines: {
        title: "Product Guidelines",
        summary: "Preserve evidence and review boundaries while initializing existing repositories.",
      },
    });
    const sessionId = technical.approval.session_id;
    const reposTemplate = readJson(path.join(__dirname, "..", "templates", "repos.json"));
    const placeholder = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      topology: "polyrepo",
      techStack: { summary: "TBD after manifest audit" },
      repos: reposTemplate,
    });

    assert.equal(placeholder.ok, true, placeholder.error);
    assert.equal(placeholder.phase_state, "awaiting_clarification");
    assert.equal(placeholder.approval.session_id, sessionId);
    assert.equal(placeholder.approval.current_stage, "technical");
    assert.deepEqual(placeholder.missing_payload, ["techStack", "repos"]);
    assert.deepEqual(placeholder.review_artifacts || [], []);
    assert.equal(placeholder.review_bundle ?? null, null);

    const session = readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`));
    assert.deepEqual(session.stage_records.technical.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);
    for (const relativePath of [
      "cadre/tech-stack.json",
      "cadre/tech-stack.md",
      "cadre/repos.json",
      "cadre/repos.md",
    ]) {
      assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} must stay absent`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup approval drift is blocked instead of masquerading as next-stage clarification", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-approval-error-envelope-test-"));
  try {
    git(root, ["init"]);
    const preview = core.workflowPacket(root, {
      workflow: "setup",
      product: { title: "Drift Product", summary: "Exercise public approval error precedence." },
    });
    const productPath = path.join(root, "cadre", "product.md");
    const original = fs.readFileSync(productPath, "utf8");
    fs.writeFileSync(productPath, `${original}\nmanual drift\n`);
    const packet = core.workflowPacketV1(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "product",
      ...approvalStamp(preview.approval),
      approvedStages: ["product"],
    });
    assert.equal(packet.ok, false);
    assert.equal(packet.decision.kind, "blocked");
    assert.match(packet.decision.reason, /changed after .*preview|drift/i);
    assert.deepEqual(packet.required, []);
    assert.equal(packet.next, null);
    fs.writeFileSync(productPath, original);
    const cancelled = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup accepts Unicode evidence and renderer-supported product fields", () => {
  const cases = [
    {
      product: { title: "既存製品", summary: "既存の利用者向けワークフローを管理します。" },
      techStack: { summary: "実装スタックはリポジトリの証拠から確認済みです。" },
    },
    {
      product: { title: "CLI Product", operatingModel: ["ローカル CLI"] },
      techStack: { languages: ["日本語 DSL"] },
    },
  ];
  for (const [index, setupCase] of cases.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `cadre-setup-unicode-evidence-${index}-`));
    try {
      git(root, ["init"]);
      const preview = core.workflowPacket(root, {
        workflow: "setup",
        providerMode: "local",
        syncMode: "local",
        setupLsp: false,
        styleGuideIds: [],
        integrations: {},
        ...setupCase,
      });
      assert.equal(preview.ok, true, preview.error);
      assert.deepEqual(preview.missing_payload || [], []);
      assert.equal(preview.approval.current_stage, "product");
      assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("workflow setup writes detected and requested style guides from templates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-style-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    write(path.join(root, "tsconfig.json"), "{}\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.css"), ".app { color: black; }\n");

    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      product: { title: "Product", summary: "Test product" },
      techStack: {
        languages: ["TypeScript"],
        frameworks: ["React"],
        platforms: ["web"],
        styleGuideIds: ["html-css"],
      },
      styleGuideIds: ["python"],
    });

    assert.equal(setup.ok, true);
    assert.ok(setup.templates.templates.some((template) => template.id === "product"));
    assert.ok(setup.templates.templates.some((template) => template.id === "target-monorepo-ci"));
    assert.equal(setup.templates.templates.some((template) => template.scope === "harness-only"), false);
    assert.equal(setup.styleGuides.source, "tech-stack.json");
    assert.ok(setup.styleGuides.detected.includes("typescript"));
    assert.ok(setup.styleGuides.detected.includes("html-css"));
    assert.deepEqual(setup.styleGuides.selected, ["python"]);
    assert.deepEqual(setup.styleGuides.missing, []);
    assert.equal(setup.approval.approval_complete, true);
    assert.ok(setup.styleGuides.written.includes("cadre/styleguides/python.md"));
    assert.equal(fs.existsSync(path.join(root, "cadre", "styleguides", "index.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "styleguides", "README.md")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "styleguides", "general.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "styleguides", "typescript.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "code_styleguides")), false);
    assert.equal(setup.lsp_setup.written, true);
    assert.ok(setup.lsp_setup.added.includes("typescript"));
    assert.equal(fs.existsSync(path.join(root, "cadre", "lsp.json")), true);
    assert.ok(setup.written.includes("cadre/product_guidelines.md"));
    assert.ok(setup.written.includes("cadre/product.md"));
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product_guidelines.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "workflow.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "patterns.jsonl")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product_guidelines.md")), true);
    const product = fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8");
    assert.match(product, /cadre:generated from="cadre\/product\.json"/);
    assert.match(product, /## Product Summary/);
    assert.match(product, /## Core Workflows/);
    assert.match(product, /## Product Invariants/);
    assert.match(product, /## Project-Specific Product Notes/);
    const guidelines = fs.readFileSync(path.join(root, "cadre", "product_guidelines.md"), "utf8");
    assert.match(guidelines, /## Trust And Safety Boundaries/);
    assert.match(guidelines, /## Domain And Workflow Rules/);
    assert.match(guidelines, /## Review Checklist/);
    const patterns = fs.readFileSync(path.join(root, "cadre", "patterns.md"), "utf8");
    assert.match(patterns, /cadre:generated from="cadre\/patterns\.jsonl"/);
    assert.match(patterns, /# Codebase Patterns/);
    assert.match(patterns, /## Code Conventions/);
    assert.match(patterns, /## Architecture/);
    assert.match(patterns, /## Gotchas/);
    assert.match(patterns, /## Testing/);
    assert.match(patterns, /## Context/);
    assert.match(patterns, /Last refreshed: YYYY-MM-DD/);
    assert.doesNotMatch(patterns, /Example:/);
    assert.equal(fs.existsSync(path.join(root, "cadre", "learnings.md")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.md")), true);
    assert.match(fs.readFileSync(path.join(root, "cadre", "tech-stack.md"), "utf8"), /cadre:generated from="cadre\/tech-stack\.json"/);
    const techStack = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"));
    assert.deepEqual(techStack.languages, ["TypeScript"]);
    assert.match(setup.techStackSummary.summary, /languages: TypeScript/);
    assert.equal(setup.workspace_health.response_mode, "compact");
    assert.ok(Array.isArray(setup.detail_resources));
    assert.ok(setup.detail_resources.some((uri) => uri.includes("workspace-diagnostics")));
    assert.equal(fs.existsSync(path.join(root, "cadre", "events.jsonl")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "messages")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "formulas")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "wisps")), true);
    assert.match(fs.readFileSync(path.join(root, "cadre", ".gitignore"), "utf8"), /\/local\//);
    const events = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8").trim().split(/\n/).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.kind === "setup_completed"));
    assert.equal(fs.existsSync(path.join(root, "cadre", "native-prompts.jsonl")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "prompt-responses.jsonl")), false);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow clarity gates ask before generating vague newtrack, revise, and refresh artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-clarity-gates-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "clarify_20260625", samplePlan("clarify_20260625"));

    const vagueTrack = core.workflowPacket(root, {
      workflow: "newtrack",
      description: "do auth",
    });
    assert.equal(vagueTrack.ok, false);
    assert.equal(vagueTrack.phase_state, "awaiting_clarification");
    assert.equal(vagueTrack.stage, "intent_clarification");
    assert.ok(vagueTrack.intent_prompts.some((prompt) => prompt.id === "newtrack-goal"));
    assert.equal(Object.prototype.hasOwnProperty.call(vagueTrack, "review_bundle"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(vagueTrack, "review_artifacts"), false);

    const emptyStructuredTrack = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "empty_structured_20260625",
      spec: {},
      plan: {},
    });
    assert.equal(emptyStructuredTrack.ok, false);
    assert.equal(emptyStructuredTrack.phase_state, "awaiting_clarification");
    assert.equal(emptyStructuredTrack.stage, "schema_validation");
    assert.equal(Object.prototype.hasOwnProperty.call(emptyStructuredTrack, "review_bundle"), false);

    const schemaOnlyTrack = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "schema_only_20260625",
      spec: {
        version: 1,
        schema: "cadre.spec.v1",
        kind: "spec",
        track_id: "schema_only_20260625",
        title: "Spec: schema_only_20260625",
      },
      plan: {
        version: 1,
        schema: "cadre.plan.v1",
        track_id: "schema_only_20260625",
        title: "Plan: schema_only_20260625",
      },
    });
    assert.equal(schemaOnlyTrack.ok, false);
    assert.equal(schemaOnlyTrack.phase_state, "awaiting_clarification");
    assert.equal(schemaOnlyTrack.stage, "intent_clarification");
    assert.ok(schemaOnlyTrack.intent_prompts.some((prompt) => prompt.id === "newtrack-goal"));
    assert.ok(schemaOnlyTrack.intent_prompts.some((prompt) => prompt.id === "newtrack-scope"));
    assert.equal(Object.prototype.hasOwnProperty.call(schemaOnlyTrack, "review_bundle"), false);

    const detailedPlanWeakSpec = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "oauth_drift_20260625",
      spec: {
        version: 1,
        schema: "cadre.spec.v1",
        track_id: "oauth_drift_20260625",
        title: "Spec: oauth_drift_20260625",
        description: "Spec for oauth_drift_20260625",
        functional_requirements: [{ heading: "Deliver behavior", body: "Implement the requested behavior." }],
        acceptance_criteria: [{ heading: "Works", body: "The planned work is complete and verified." }],
        out_of_scope: [],
      },
      plan: planFromPhases("oauth_drift_20260625", [
        {
          phase_index: 1,
          title: "Phase 1: OAuth Login",
          execution_mode: "sequential",
          depends_on: [],
          tasks: [
            planTask(1, 1, "Add OAuth callback route and token exchange", ["src/auth/oauth.ts"]),
            planTask(1, 2, "Persist OAuth account mapping and session state", ["src/auth/session.ts"]),
          ],
        },
      ]),
    });
    assert.equal(detailedPlanWeakSpec.ok, false);
    assert.equal(detailedPlanWeakSpec.phase_state, "awaiting_clarification");
    assert.equal(detailedPlanWeakSpec.stage, "intent_clarification");
    assert.ok(detailedPlanWeakSpec.intent_prompts.some((prompt) => prompt.id === "newtrack-goal"));
    assert.ok(detailedPlanWeakSpec.intent_prompts.some((prompt) => prompt.id === "newtrack-outcome"));
    assert.ok(detailedPlanWeakSpec.intent_prompts.some((prompt) => prompt.id === "newtrack-acceptance"));
    assert.ok(detailedPlanWeakSpec.intent_prompts.some((prompt) => prompt.id === "newtrack-scope"));
    assert.equal(Object.prototype.hasOwnProperty.call(detailedPlanWeakSpec, "review_bundle"), false);

    const schemaDrift = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "schema_drift_20260625",
      spec: {
        version: 1,
        schema: "cadre.spec.v1",
        track_id: "schema_drift_20260625",
        title: "OAuth Login",
        description: "Allow users to sign in with the configured OAuth provider.",
        functionalRequirements: [{ heading: "OAuth callback", body: "Exchange the OAuth code and create a session." }],
        acceptanceCriteria: [{ heading: "Successful login", body: "A user can complete OAuth login and land in the app." }],
        outOfScope: [{ heading: "Provider admin setup", body: "Creating the OAuth app in the provider console is out of scope." }],
      },
      plan: {
        version: 1,
        schema: "cadre.plan.v1",
        track_id: "schema_drift_20260625",
        title: "Plan: schema_drift_20260625",
        tasks: [
          planTask(1, 1, "Add OAuth callback route and token exchange", ["src/auth/oauth.ts"]),
        ],
      },
    });
    assert.equal(schemaDrift.ok, false);
    assert.equal(schemaDrift.stage, "schema_validation");
    assert.equal(schemaDrift.phase_state, "awaiting_clarification");
    assert.ok(schemaDrift.schema_errors.some((entry) => entry.field === "spec.functionalRequirements"));
    assert.ok(schemaDrift.schema_errors.some((entry) => entry.field === "spec.acceptanceCriteria"));
    assert.equal(schemaDrift.schema_errors.some((entry) => entry.field === "plan.tasks"), false);
    assert.ok(schemaDrift.schema_resources.some((uri) => uri.includes("artifact=spec")));
    assert.equal(schemaDrift.schema_resources.some((uri) => uri.includes("artifact=plan")), false);
    assert.equal(Object.prototype.hasOwnProperty.call(schemaDrift, "review_bundle"), false);

    const specSchema = core.artifactPacket(root, { action: "schema", artifact: "spec" });
    assert.equal(specSchema.ok, true);
    assert.equal(specSchema.schema_id, "cadre.spec.v1");
    assert.ok(specSchema.schema.required.includes("schema"));
    assert.equal(specSchema.schema.properties.schema.const, "cadre.spec.v1");
    assert.equal(specSchema.example.schema, "cadre.spec.v1");
    assert.ok(specSchema.guidance.some((entry) => entry.includes("snake_case")));

    const planSchema = core.artifactPacket(root, { action: "schema", artifact: "plan" });
    assert.equal(planSchema.ok, true);
    assert.equal(planSchema.schema_id, "cadre.plan.v1");
    assert.ok(planSchema.schema.required.includes("schema"));
    assert.equal(planSchema.schema.properties.schema.const, "cadre.plan.v1");
    assert.equal(planSchema.schema.properties.phases.items.properties.tasks.items.properties.task_key.type, "string");
    assert.equal(planSchema.example.phases[0].tasks[0].task_key, "phase1_task1");
    assert.ok(planSchema.guidance.some((entry) => entry.includes("top-level plan.tasks")));

    const schemaGuidedTrack = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "schema_guided_20260625",
      spec: {
        ...specSchema.example,
        track_id: "schema_guided_20260625",
        title: "Schema Guided Track",
        description: "Create a new Cadre track from the published artifact schema without a corrective retry.",
        functional_requirements: [{ heading: "Schema-shaped first draft", body: "The first draft uses canonical spec fields from the schema response." }],
        acceptance_criteria: [{ heading: "Review bundle generated", body: "The dry run returns review artifacts without schema validation errors." }],
        out_of_scope: [{ heading: "No runtime behavior changes", body: "This track only verifies the newtrack payload shape." }],
      },
      plan: {
        ...planSchema.example,
        track_id: "schema_guided_20260625",
        title: "Plan: schema_guided_20260625",
        phases: [
          {
            phase_index: 1,
            title: "Phase 1: Verify Schema Flow",
            execution_mode: "sequential",
            depends_on: [],
            tasks: [
              planTask(1, 1, "Submit schema-shaped newtrack dry run", ["cadre/tracks/schema_guided_20260625/spec.json"]),
            ],
          },
        ],
      },
    });
    assert.equal(schemaGuidedTrack.ok, true);
    assert.equal(schemaGuidedTrack.dry_run, true);
    assert.equal(schemaGuidedTrack.phase_state, "awaiting_staged_approval");
    assert.equal(schemaGuidedTrack.stage, "staged_approval");
    assert.ok(schemaGuidedTrack.review_bundle);
    assert.equal(schemaGuidedTrack.approval.current_stage, "spec");
    assert.ok(schemaGuidedTrack.approval.pending_stages.includes("plan"));

    const vagueRevise = core.workflowPacket(root, {
      workflow: "revise",
      trackId: "clarify_20260625",
    });
    assert.equal(vagueRevise.ok, false);
    assert.equal(vagueRevise.phase_state, "awaiting_clarification");
    assert.ok(vagueRevise.intent_prompts.some((prompt) => prompt.id === "revise-reason"));
    assert.ok(vagueRevise.intent_prompts.some((prompt) => prompt.id === "revise-scope"));
    assert.equal(Object.prototype.hasOwnProperty.call(vagueRevise, "review_bundle"), false);

    const emptyRevision = core.workflowPacket(root, {
      workflow: "revise",
      trackId: "clarify_20260625",
      reason: "Repository evidence invalidated the existing requirements and execution plan.",
      spec: {},
      plan: {},
    });
    assert.equal(emptyRevision.ok, false);
    assert.equal(emptyRevision.phase_state, "awaiting_clarification");
    assert.equal(emptyRevision.stage, "intent_clarification");
    assert.deepEqual(emptyRevision.intent_prompts.map((prompt) => prompt.id), ["revise-scope"]);
    assert.equal(Object.prototype.hasOwnProperty.call(emptyRevision, "review_bundle"), false);

    const missingHandoff = core.workflowPacket(root, {
      workflow: "handoff",
      trackId: "clarify_20260625",
    });
    assert.equal(missingHandoff.ok, false);
    assert.equal(missingHandoff.phase_state, "awaiting_clarification");
    assert.deepEqual(missingHandoff.intent_prompts.map((prompt) => prompt.id), ["handoff-content"]);
    assert.deepEqual(missingHandoff.missing_payload, ["handoffText"]);
    assert.equal(Object.prototype.hasOwnProperty.call(missingHandoff, "review_bundle"), false);

    const genericHandoff = core.workflowPacket(root, {
      workflow: "handoff",
      trackId: "clarify_20260625",
      handoffText: "# Handoff\n\nContinue with the next task.\n",
    });
    assert.equal(genericHandoff.ok, false);
    assert.equal(genericHandoff.phase_state, "awaiting_clarification");
    assert.deepEqual(genericHandoff.missing_payload, ["handoffText"]);
    assert.equal(Object.prototype.hasOwnProperty.call(genericHandoff, "review_bundle"), false);

    const emptyRelease = core.workflowPacket(root, {
      workflow: "release",
      releaseVersion: "v0.0.0-empty",
    });
    assert.equal(emptyRelease.ok, false);
    assert.equal(emptyRelease.phase_state, "awaiting_clarification");
    assert.deepEqual(emptyRelease.intent_prompts.map((prompt) => prompt.id), ["release-evidence"]);
    assert.deepEqual(emptyRelease.missing_payload, ["releaseNotes"]);
    assert.equal(Object.prototype.hasOwnProperty.call(emptyRelease, "review_bundle"), false);

    const sessionsDir = path.join(root, "cadre", "local", "approval-sessions");
    const sessionsBeforeRefresh = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).sort() : [];
    const statusBeforeRefresh = git(root, ["status", "--porcelain=v1"]).stdout;
    const vagueRefresh = core.workflowPacket(root, { workflow: "refresh" });
    assert.equal(vagueRefresh.ok, false);
    assert.equal(vagueRefresh.phase_state, "awaiting_clarification");
    assert.equal(vagueRefresh.stage, "refresh_analysis");
    assert.equal(vagueRefresh.refresh_analysis.kind, "cadre.refresh_analysis.v1");
    assert.deepEqual(vagueRefresh.intent_prompts.map((prompt) => prompt.id), ["refresh-levels"]);
    assert.equal(vagueRefresh.intent_prompts[0].selectionMode, "multi");
    assert.equal(Object.prototype.hasOwnProperty.call(vagueRefresh, "review_bundle"), false);
    assert.deepEqual(fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).sort() : [], sessionsBeforeRefresh);
    assert.equal(git(root, ["status", "--porcelain=v1"]).stdout, statusBeforeRefresh);

    const missingProductEvidence = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: ["product"],
    });
    assert.equal(missingProductEvidence.ok, false);
    assert.equal(missingProductEvidence.phase_state, "awaiting_clarification");
    assert.equal(missingProductEvidence.stage, "refresh_evidence");
    assert.deepEqual(missingProductEvidence.selected_levels, ["product"]);
    assert.deepEqual(missingProductEvidence.missing_payload, ["proposedContext.product"]);
    assert.equal(Object.prototype.hasOwnProperty.call(missingProductEvidence, "review_bundle"), false);
    const refreshSessionId = missingProductEvidence.approval.session_id;
    assert.equal(missingProductEvidence.approval.current_stage, "product");
    assert.deepEqual(
      fs.readdirSync(sessionsDir).sort(),
      [...sessionsBeforeRefresh, `${refreshSessionId}.json`].sort(),
    );
    assert.deepEqual(readJson(path.join(sessionsDir, `${refreshSessionId}.json`)).stage_records.product.snapshot_files, []);
    assert.equal(git(root, ["status", "--porcelain=v1"]).stdout, statusBeforeRefresh);

    const templateOnlyRefresh = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: refreshSessionId,
      proposedContext: {
        product: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "templates", "product.json"), "utf8")),
      },
    });
    assert.equal(templateOnlyRefresh.ok, false);
    assert.equal(templateOnlyRefresh.stage, "refresh_evidence");
    assert.deepEqual(templateOnlyRefresh.missing_payload, ["proposedContext.product"]);
    assert.equal(templateOnlyRefresh.approval.session_id, refreshSessionId);
    assert.equal(Object.prototype.hasOwnProperty.call(templateOnlyRefresh, "review_bundle"), false);
    assert.deepEqual(fs.readdirSync(sessionsDir).sort(), [...sessionsBeforeRefresh, `${refreshSessionId}.json`].sort());
    assert.equal(git(root, ["status", "--porcelain=v1"]).stdout, statusBeforeRefresh);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup resolves bundled templates and writes default LSP config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-plugin-template-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    write(path.join(root, "src", "lib.rs"), "pub fn plugin_template_smoke() -> bool { true }\n");

    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["Rust"], styleGuideIds: ["rust"] },
    });

    assert.equal(setup.ok, true);
    assert.ok(setup.styleGuides.written.includes("cadre/styleguides/rust.md"));
    assert.match(fs.readFileSync(path.join(root, "cadre", "workflow.md"), "utf8"), /Guiding Principles/);
    const patterns = fs.readFileSync(path.join(root, "cadre", "patterns.md"), "utf8");
    assert.match(patterns, /# Codebase Patterns/);
    assert.match(patterns, /## Code Conventions/);
    assert.match(patterns, /## Architecture/);
    assert.match(patterns, /## Gotchas/);
    assert.match(patterns, /## Testing/);
    assert.match(patterns, /## Context/);
    assert.doesNotMatch(patterns, /Example:/);
    assert.match(fs.readFileSync(path.join(root, "cadre", "styleguides", "rust.md"), "utf8"), /Effective Rust/);
    assert.equal(setup.lsp_setup.written, true);
    assert.ok(setup.lsp_setup.added.includes("rust"));
    assert.equal(fs.existsSync(path.join(root, "cadre", "lsp.json")), true);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup preserves baseline workflow quality gates with custom notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-workflow-template-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);

    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      product: { title: "Product", summary: "Test product" },
      workflowPolicy: { title: "Project Workflow", summary: "Run `cargo test` before broad validation." },
      techStack: { languages: ["Rust"] },
    });

    assert.equal(setup.ok, true);
    const workflow = fs.readFileSync(path.join(root, "cadre", "workflow.md"), "utf8");
    assert.match(workflow, /## Guiding Principles/);
    assert.match(workflow, /Test-Driven Development/);
    assert.match(workflow, /## Task Lifecycle/);
    assert.match(workflow, /## Commit Discipline/);
    assert.match(workflow, /## Quality Gates/);
    assert.match(workflow, /## Phase Completion/);
    assert.match(workflow, /## Development Commands/);
    assert.match(workflow, /## Project-Specific Workflow Notes/);
    assert.match(workflow, /Run `cargo test` before broad validation\./);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup preserves baseline product context with custom notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-product-template-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);

    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      product: { title: "Product Context", summary: "A self-hosted feature flag platform for internal teams." },
      productGuidelines: { title: "Product Guidelines", summary: "Preserve tenant isolation and audit trails." },
      techStack: { languages: ["Rust"] },
    });

    assert.equal(setup.ok, true);
    const product = fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8");
    assert.match(product, /## Users And Personas/);
    assert.match(product, /## Domain Model/);
    assert.match(product, /## Data And Integrations/);
    assert.match(product, /## Project-Specific Product Notes/);
    assert.match(product, /self-hosted feature flag platform/);
    assert.match(product, /## Canonical Source/);
    assert.match(product, /Canonical data lives in `cadre\/product\.json`/);
    assert.doesNotMatch(product, /"schema": "cadre\.product\.v1"/);
    const guidelines = fs.readFileSync(path.join(root, "cadre", "product_guidelines.md"), "utf8");
    assert.match(guidelines, /## Trust And Safety Boundaries/);
    assert.match(guidelines, /## Data Ownership/);
    assert.match(guidelines, /## Project-Specific Product Guideline Notes/);
    assert.match(guidelines, /tenant isolation and audit trails/);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup hydrates template JSON sections with structured setup details", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-structured-details-test-"));
  try {
    git(root, ["init"]);

    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      product: {
        name: "Stitchd Event / Message Queue",
        summary: "A Rust-based PostgreSQL-backed event buffering and message queue library.",
        users: [
          "Rust services that need buffered event ingestion into PostgreSQL",
          "Developers integrating asynchronous queue consumers and retry processing",
        ],
        goals: [
          "Provide efficient buffered event insertion with size-based and time-based flush triggers",
          "Persist queue data and jobs into PostgreSQL dataset tables using transactional binary COPY",
        ],
        nonGoals: ["Full hosted queue service operations"],
      },
      productGuidelines: {
        principles: [
          "Prefer correctness and explicit error handling around queue persistence",
          "Keep database interactions transactional where queue consistency depends on paired writes",
        ],
        qualityBar: [
          "Run Rust formatting and compile/test checks before shipping behavioral changes",
          "Treat SQL schema/function contracts as part of the product surface",
        ],
      },
      workflowPolicy: {
        preferredTestCommand: "cargo test",
        reviewGate: "Run cargo fmt/check/test as appropriate for the change scope.",
        providerMode: "github",
      },
      techStack: {
        language: "Rust",
        edition: "2024",
        packageManager: "cargo",
        runtime: ["tokio"],
        database: ["PostgreSQL"],
        majorDependencies: ["deadpool-postgres", "tokio-postgres", "cbor-data"],
        artifacts: ["Cargo.toml", "queue.sql", "src/lib.rs"],
        testCommand: "cargo test",
      },
      writeLsp: false,
    });

    assert.equal(setup.ok, true);
    const productJson = JSON.parse(fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8"));
    assert.equal(productJson.title, "Stitchd Event / Message Queue");
    assert.match(productJson.sections.find((section) => section.heading === "Product Summary").body, /Stitchd Event \/ Message Queue/);
    assert.match(productJson.sections.find((section) => section.heading === "Users And Personas").body, /Rust services that need buffered event ingestion/);
    assert.match(productJson.sections.find((section) => section.heading === "Core Workflows").body, /transactional binary COPY/);
    assert.match(productJson.sections.find((section) => section.heading === "Product Invariants").body, /Full hosted queue service operations/);

    const guidelinesJson = JSON.parse(fs.readFileSync(path.join(root, "cadre", "product_guidelines.json"), "utf8"));
    assert.match(guidelinesJson.sections.find((section) => section.heading === "Product Principles").body, /explicit error handling around queue persistence/);
    assert.match(guidelinesJson.sections.find((section) => section.heading === "Review Checklist").body, /SQL schema\/function contracts/);

    const workflowJson = JSON.parse(fs.readFileSync(path.join(root, "cadre", "workflow.json"), "utf8"));
    assert.match(workflowJson.sections.find((section) => section.heading === "Quality Gates").body, /cargo test/);
    assert.match(workflowJson.sections.find((section) => section.heading === "Development Commands").body, /cargo test/);

    const product = fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8");
    assert.match(product, /## Users And Personas/);
    assert.match(product, /Rust services that need buffered event ingestion/);
    assert.match(product, /## Core Workflows/);
    assert.match(product, /transactional binary COPY/);
    assert.match(product, /## Product Invariants/);

    const guidelines = fs.readFileSync(path.join(root, "cadre", "product_guidelines.md"), "utf8");
    assert.match(guidelines, /## Product Principles/);
    assert.match(guidelines, /explicit error handling around queue persistence/);
    assert.match(guidelines, /## Review Checklist/);
    assert.match(guidelines, /SQL schema\/function contracts/);

    const workflow = fs.readFileSync(path.join(root, "cadre", "workflow.md"), "utf8");
    assert.match(workflow, /## Development Commands/);
    assert.match(workflow, /cargo test/);
    assert.match(workflow, /## Quality Gates/);

    const techStack = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"));
    assert.equal(techStack.language, "Rust");
    assert.deepEqual(techStack.majorDependencies, ["deadpool-postgres", "tokio-postgres", "cbor-data"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace health defaults to compact summaries and detail mode exposes full inventory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-workspace-health-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "package.json"), JSON.stringify({
      name: "health",
      private: true,
      scripts: { test: "node --test" },
    }, null, 2));
    write(path.join(root, "src", "index.ts"), "export const value = 1;\n");
    write(path.join(root, "cadre", "config.json"), JSON.stringify({
      integrations: {
        code_search: { server: "sourcegraph", available: true },
        issue_tracker: "linear",
      },
    }, null, 2));

    const compact = core.workspaceHealth(root);
    assert.equal(compact.response_mode, "compact");
    assert.equal(compact.detail_available, true);
    assert.equal(compact.workspace.repo_count, 1);
    assert.ok(Array.isArray(compact.detail_resources));
    assert.ok(compact.detail_resources.some((uri) => uri.includes("integrations")));
    assert.ok(compact.integrations.optional_mcps.some((entry) => entry.kind === "code_search"));
    assert.ok(typeof compact.lsp.coverage === "number" || compact.lsp.coverage === null);

    const detail = core.workspaceHealth(root, { responseMode: "detail" });
    assert.equal(detail.response_mode, "detail");
    assert.ok(Array.isArray(detail.workspace.adapters));
    assert.ok(Array.isArray(detail.dependency_graph.manifests));
    assert.ok(Array.isArray(detail.integrations.optional_mcps));
    assert.equal(detail.integrations.summary.optional_configured_count >= 1, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup records provider mode from remotes or local intent", () => {
  const githubRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-github-provider-test-"));
  const gitlabRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-gitlab-provider-test-"));
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-local-provider-test-"));
  const oldPath = process.env.PATH;
  try {
    git(githubRoot, ["init"]);
    git(githubRoot, ["remote", "add", "origin", "git@github.com:org/app.git"]);
    const githubSetup = approveWorkflow(githubRoot, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(githubSetup.ok, true);
    assert.equal(githubSetup.provider.provider_mode, "github");
    const githubConfig = JSON.parse(fs.readFileSync(path.join(githubRoot, "cadre", "config.json"), "utf8"));
    assert.equal(githubConfig.provider_mode, "github");
    assert.equal(githubConfig.provider_mcp_required, true);
    assert.equal(githubConfig.remote_host, "github.com");

    git(gitlabRoot, ["init"]);
    git(gitlabRoot, ["remote", "add", "origin", "https://gitlab.com/org/app.git"]);
    const gitlabSetup = approveWorkflow(gitlabRoot, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["Go"] },
    });
    assert.equal(gitlabSetup.ok, true);
    assert.equal(gitlabSetup.provider.provider_mode, "gitlab");
    const gitlabConfig = JSON.parse(fs.readFileSync(path.join(gitlabRoot, "cadre", "config.json"), "utf8"));
    assert.equal(gitlabConfig.provider_mode, "gitlab");
    assert.equal(gitlabConfig.provider_mcp_required, true);

    git(localRoot, ["init"]);
    const localSetup = approveWorkflow(localRoot, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["Python"] },
    });
    assert.equal(localSetup.ok, true);
    assert.equal(localSetup.provider.provider_mode, "local");
    const localConfig = JSON.parse(fs.readFileSync(path.join(localRoot, "cadre", "config.json"), "utf8"));
    assert.equal(localConfig.provider_mode, "local");
    assert.equal(localConfig.provider_mcp_required, false);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(githubRoot, { recursive: true, force: true });
    fs.rmSync(gitlabRoot, { recursive: true, force: true });
    fs.rmSync(localRoot, { recursive: true, force: true });
  }
});

test("workflow setup scaffolds polyrepo control-plane assets and LSP config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-polyrepo-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    write(path.join(root, "repos", "app", "src", "index.ts"), "export const app = true;\n");

    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      topology: "polyrepo",
      providerMode: "github",
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
      lsp: true,
      repos: {
        mode: "polyrepo",
        control_repo: { name: "control", path: "." },
        default_repo: "app",
        repos: [
          { name: "app", submodule_path: "repos/app", url: "git@github.com:org/app.git", default_branch: "main", enabled: true },
        ],
      },
    });

    assert.equal(setup.ok, true);
    assert.equal(setup.topology, "polyrepo");
    assert.equal(setup.polyrepo_setup.gitattributes.ok, true);
    assert.equal(setup.polyrepo_setup.ci.path, ".github/workflows/cadre-merge-train.yml");
    assert.equal(setup.polyrepo_setup.submodules.dry_run, true);
    assert.equal(fs.existsSync(path.join(root, ".github", "workflows", "cadre-merge-train.yml")), true);
    assert.match(fs.readFileSync(path.join(root, ".gitattributes"), "utf8"), /cadre\/tracks\/\*\*\/parallel_state\.json/);
    assert.equal(fs.existsSync(path.join(root, "cadre", "repos.json")), true);
    assert.equal(setup.lsp_setup.written, true);
    assert.ok(setup.lsp_setup.added.includes("typescript"));
    assert.equal(fs.existsSync(path.join(root, "cadre", "lsp.json")), true);
    assert.deepEqual(readJson(path.join(root, "cadre", "lsp.json")).workspaceFolders, [
      { name: ".", path: "." },
      { name: "app", path: "repos/app" },
    ]);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup asks for provider mode when remotes are ambiguous", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-ambiguous-provider-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    git(root, ["remote", "add", "origin", "git@github.com:org/app.git"]);
    git(root, ["remote", "add", "mirror", "git@gitlab.com:org/app.git"]);

    const dryRun = advanceSetupToTechnical(root, {
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.provider.requires_confirmation, true);
    assert.ok(dryRun.next_actions.some((action) => action.includes("providerMode")));
    assert.equal(dryRun.phase_state, "awaiting_clarification");
    assert.ok(dryRun.native_prompts.some((prompt) => prompt.id === "setup-provider-mode"));
    assert.equal(dryRun.review_bundle, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "config.json")), false);
    const cancelled = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: dryRun.approval.session_id,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);

    const local = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      force: true,
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(local.ok, true);
    const config = JSON.parse(fs.readFileSync(path.join(root, "cadre", "config.json"), "utf8"));
    assert.equal(config.provider_mode, "local");
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup asks for provider mode when hosted remote is unknown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-unknown-provider-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    git(root, ["remote", "add", "origin", "git@example.internal:org/app.git"]);

    const blocked = advanceSetupToTechnical(root, {
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(blocked.ok, true);
    assert.equal(blocked.phase_state, "awaiting_clarification");
    assert.ok(blocked.native_prompts.some((prompt) => prompt.id === "setup-provider-mode"));
    assert.equal(blocked.review_bundle, null);
    assert.equal(blocked.provider.detected.source, "unknown_remote");
    const cancelled = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: blocked.approval.session_id,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);

    const local = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      force: true,
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(local.ok, true);
    assert.equal(local.provider.provider_mode, "local");
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow setup rejects unknown style guide ids before accepting a corrected selection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-style-missing-test-"));
  try {
    git(root, ["init"]);
    const base = withSetupTestEvidence({
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      writeLsp: false,
      integrations: {},
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    const rejected = core.workflowPacket(root, {
      ...base,
      styleGuideIds: "typescript not-a-guide",
    });
    assert.equal(rejected.ok, true, rejected.error);
    assert.equal(rejected.phase_state, "awaiting_clarification");
    assert.deepEqual(rejected.native_prompts.map((prompt) => prompt.id), ["setup-style-guides"]);
    assert.ok(rejected.native_prompts[0].choices.some((choice) => choice.id === "typescript" && choice.recommended === true));
    assert.equal(rejected.approval.session_id, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), false);

    const setup = core.workflowPacket(root, { ...base, styleGuideIds: ["typescript"] });
    assert.equal(setup.ok, true);
    assert.deepEqual(setup.styleGuides.missing, []);
    assert.deepEqual(setup.styleGuides.selected, ["typescript"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("implementationPrep returns packet-selected style guides", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-implement-style-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    write(path.join(root, "tsconfig.json"), "{}\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.css"), ".app { color: black; }\n");
    write(path.join(root, "src", "worker.py"), "print('not in tech stack')\n");
    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      product: { title: "Product", summary: "Test product" },
      techStack: {
        languages: ["TypeScript"],
        frameworks: ["React"],
        platforms: ["web"],
        styleGuideIds: ["html-css"],
      },
    });
    assert.equal(setup.ok, true);
    writeTrack(root, "style_20260618", planFromPhases("style_20260618", [
      { phase_index: 1, title: "Phase 1: Build", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Update app", ["src/app.ts", "src/app.css"])] },
    ]));

    const prep = core.implementationPrep(root, {
      trackId: "style_20260618",
      identity: "dev@example.com",
      styleGuideMaxChars: 1200,
    });

    assert.equal(prep.ok, true);
    assert.equal(prep.styleGuides.available, true);
    assert.ok(prep.styleGuides.selected.includes("general"));
    assert.ok(prep.styleGuides.selected.includes("typescript"));
    assert.ok(prep.styleGuides.selected.includes("html-css"));
    assert.equal(prep.styleGuides.selected.includes("python"), false);
    assert.ok(prep.styleGuides.tech_stack_ids.includes("typescript"));
    assert.ok(prep.styleGuides.tech_stack_ids.includes("html-css"));
    assert.ok(prep.styleGuides.task_file_ids.includes("typescript"));
    const typeGuide = prep.styleGuides.guides.find((guide) => guide.id === "typescript");
    assert.ok(typeGuide);
    assert.equal(typeGuide.path, "cadre/styleguides/typescript.json");
    assert.ok(typeGuide.content.includes("TypeScript"));
    assert.ok(typeGuide.content.length <= 1200);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack collects spec then plan in one lazy approval session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-lazy-stages-test-"));
  try {
    git(root, ["init"]);
    const trackId = "lazy_newtrack_20260714";
    const spec = sampleSpec(trackId, {
      description: "Create a track by reviewing requirements before collecting its dependent plan.",
      acceptance_criteria: [{
        heading: "Ordered artifact review",
        body: "Cadre requests and materializes the plan only after explicit spec approval.",
      }],
    });
    const plan = samplePlan(trackId);
    plan.phases[0].tasks[0].title = "Implement the approved track specification";
    const base = path.join(root, "cadre", "tracks", trackId);

    const specPreview = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec,
      commitMode: "off",
    });
    assert.equal(specPreview.ok, true, specPreview.error);
    assert.equal(specPreview.approval.current_stage, "spec");
    assert.deepEqual(specPreview.review_artifacts.map((artifact) => artifact.path).sort(), [
      `cadre/tracks/${trackId}/spec.json`,
      `cadre/tracks/${trackId}/spec.md`,
    ]);
    const sessionId = specPreview.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    let session = readJson(sessionFile);
    assert.deepEqual(session.stage_order, ["spec", "plan"]);
    assert.equal(session.stage_records.spec.snapshot_files.length, 2);
    assert.deepEqual(session.stage_records.plan.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);
    assert.equal(fs.existsSync(path.join(base, "spec.json")), true);
    for (const name of ["plan.json", "plan.md", "metadata.json", "learnings.jsonl", "learnings.md"]) {
      assert.equal(fs.existsSync(path.join(base, name)), false, `${name} must stay deferred`);
    }

    const missingPlan = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalStage: "spec",
      ...approvalStamp(specPreview.approval),
      approvedStages: ["spec"],
    });
    assert.equal(missingPlan.ok, false);
    assert.equal(missingPlan.phase_state, "awaiting_clarification");
    assert.equal(missingPlan.approval.session_id, sessionId);
    assert.equal(missingPlan.approval.current_stage, "plan");
    assert.deepEqual(missingPlan.approval.approved_stages, ["spec"]);
    assert.deepEqual(missingPlan.missing_payload, ["plan"]);
    assert.deepEqual(missingPlan.intent_prompts, []);
    session = readJson(sessionFile);
    assert.deepEqual(session.stage_records.plan.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);
    assert.equal(fs.existsSync(path.join(base, "plan.json")), false);

    const planPreview = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      plan,
    });
    assert.equal(planPreview.ok, true, planPreview.error);
    assert.equal(planPreview.approval.current_stage, "plan");
    assert.deepEqual(planPreview.review_artifacts.map((artifact) => artifact.path).sort(), [
      `cadre/tracks/${trackId}/plan.json`,
      `cadre/tracks/${trackId}/plan.md`,
    ]);
    session = readJson(sessionFile);
    assert.equal(session.stage_records.plan.snapshot_files.length, 2);
    assert.deepEqual(session.final_snapshot_files.map((file) => file.path).sort(), [
      `cadre/tracks/${trackId}/learnings.jsonl`,
      `cadre/tracks/${trackId}/learnings.md`,
      `cadre/tracks/${trackId}/metadata.json`,
    ]);
    assert.equal(fs.existsSync(path.join(base, "plan.json")), true);
    for (const name of ["metadata.json", "learnings.jsonl", "learnings.md"]) {
      assert.equal(fs.existsSync(path.join(base, name)), false, `${name} is final-only`);
    }
    const approvedSnapshots = session.snapshot_files
      .filter((file) => file.missing !== true)
      .map((file) => ({ path: file.path, content: file.content }));

    const complete = core.workflowPacketV1(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalStage: "plan",
      ...approvalStamp(planPreview.approval),
      approvedStages: ["spec", "plan"],
    });
    assert.equal(complete.decision.kind, "ready");
    assert.deepEqual(complete.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "newtrack",
        input: {},
        execute: true,
        approval: {
          session_id: sessionId,
          approved_stages: ["spec", "plan"],
          complete: true,
        },
      },
    });
    const executed = core.workflowPacket(root, {
      workflow: "newtrack",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["spec", "plan"],
    });
    assert.equal(executed.ok, true, executed.error);
    assert.equal(executed.phase_state, "executed");
    for (const snapshot of approvedSnapshots) {
      assert.equal(fs.readFileSync(path.join(root, snapshot.path), "utf8"), snapshot.content, snapshot.path);
    }
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack defers malformed future plan validation until plan activation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-future-schema-test-"));
  try {
    git(root, ["init"]);
    const trackId = "future_plan_20260714";
    const preview = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      plan: {},
      commitMode: "off",
    });
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.approval.current_stage, "spec");
    assert.deepEqual(preview.review_artifacts.map((artifact) => artifact.path).sort(), [
      `cadre/tracks/${trackId}/spec.json`,
      `cadre/tracks/${trackId}/spec.md`,
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(preview, "schema_errors"), false);
    const sessionId = preview.approval.session_id;

    const planSchema = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalStage: "spec",
      ...approvalStamp(preview.approval),
      approvedStages: ["spec"],
    });
    assert.equal(planSchema.ok, false);
    assert.equal(planSchema.phase_state, "awaiting_clarification");
    assert.equal(planSchema.stage, "schema_validation");
    assert.equal(planSchema.approval.session_id, sessionId);
    assert.equal(planSchema.approval.current_stage, "plan");
    assert.ok(planSchema.schema_errors.some((entry) => entry.field === "plan.schema"));
    assert.ok(planSchema.schema_resources.every((uri) => uri.includes("artifact=plan")));
    const session = readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`));
    assert.deepEqual(session.stage_records.plan.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", trackId, "plan.json")), false);

    const cancelled = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);
    assert.equal(cancelled.phase_state, "cancelled");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack keeps spec intent clarification inside its approval session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-intent-session-test-"));
  try {
    git(root, ["init"]);
    const trackId = "intent_session_20260714";
    const intent = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      commitMode: "off",
    });
    assert.equal(intent.ok, false);
    assert.equal(intent.phase_state, "awaiting_clarification");
    assert.equal(intent.approval.current_stage, "spec");
    assert.deepEqual(intent.missing_payload, ["spec"]);
    assert.deepEqual(intent.intent_prompts.map((prompt) => prompt.id).sort(), [
      "newtrack-acceptance",
      "newtrack-goal",
      "newtrack-outcome",
      "newtrack-scope",
    ]);
    const sessionId = intent.approval.session_id;

    const answered = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      intent: {
        goal: "feature",
        outcome: "developer-experience",
        acceptanceCriteria: ["automated-tests", "manual-check"],
        scope: "single-module",
      },
    });
    assert.equal(answered.ok, false);
    assert.equal(answered.approval.session_id, sessionId);
    assert.equal(answered.approval.current_stage, "spec");
    assert.deepEqual(answered.intent_prompts, []);
    assert.deepEqual(answered.missing_payload, ["spec"]);

    const specPreview = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      spec: sampleSpec(trackId),
    });
    assert.equal(specPreview.ok, true, specPreview.error);
    assert.equal(specPreview.approval.session_id, sessionId);
    assert.equal(specPreview.approval.current_stage, "spec");
    assert.deepEqual(specPreview.review_artifacts.map((artifact) => artifact.path).sort(), [
      `cadre/tracks/${trackId}/spec.json`,
      `cadre/tracks/${trackId}/spec.md`,
    ]);

    const cancelled = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);
    assert.equal(cancelled.phase_state, "cancelled");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack rejects an existing track before materializing a preview", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-existing-track-test-"));
  try {
    git(root, ["init"]);
    const trackId = "existing_track_20260714";
    writeTrack(root, trackId, samplePlan(trackId));
    const specPath = path.join(root, "cadre", "tracks", trackId, "spec.json");
    const baseline = fs.readFileSync(specPath, "utf8");
    const blocked = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId, { description: "This must not replace an existing track." }),
      plan: samplePlan(trackId),
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /Track target already exists/);
    assert.equal(fs.readFileSync(specPath, "utf8"), baseline);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack rejects normalized target collisions without changing bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-path-collision-test-"));
  try {
    git(root, ["init"]);
    const targetName = "foo_bar";
    writeTrack(root, targetName, samplePlan("foo/bar"));
    const metadataPath = path.join(root, "cadre", "tracks", targetName, "metadata.json");
    write(metadataPath, `${JSON.stringify({ ...readJson(metadataPath), track_id: "foo/bar" }, null, 2)}\n`);
    const specPath = path.join(root, "cadre", "tracks", targetName, "spec.json");
    const baseline = fs.readFileSync(specPath, "utf8");

    const blocked = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: targetName,
      spec: sampleSpec(targetName, { description: "Do not overwrite a normalized path collision." }),
      plan: samplePlan(targetName),
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /collides after path normalization/);
    assert.deepEqual(blocked.occupied_targets.sort(), [
      `cadre/tracks/${targetName}/learnings.md`,
      `cadre/tracks/${targetName}/metadata.json`,
      `cadre/tracks/${targetName}/plan.json`,
      `cadre/tracks/${targetName}/plan.md`,
      `cadre/tracks/${targetName}/spec.json`,
      `cadre/tracks/${targetName}/spec.md`,
    ]);
    assert.equal(fs.readFileSync(specPath, "utf8"), baseline);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack cannot overwrite a competing normalized approval session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-session-collision-test-"));
  try {
    git(root, ["init"]);
    const firstTrackId = "foo/bar";
    const targetName = "foo_bar";
    const first = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: firstTrackId,
      spec: sampleSpec(firstTrackId, { title: "First normalized session" }),
      commitMode: "off",
    });
    assert.equal(first.ok, true, first.error);
    const firstSessionId = first.approval.session_id;
    const specPath = path.join(root, "cadre", "tracks", targetName, "spec.json");
    const firstBytes = fs.readFileSync(specPath, "utf8");

    const competing = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: targetName,
      spec: sampleSpec(targetName, { title: "Competing normalized session" }),
      commitMode: "off",
    });
    assert.equal(competing.ok, false);
    assert.match(competing.error, /collides after path normalization/);
    assert.equal(fs.readFileSync(specPath, "utf8"), firstBytes);
    const sessionDirectory = path.join(root, "cadre", "local", "approval-sessions");
    assert.deepEqual(fs.readdirSync(sessionDirectory).filter((file) => file.endsWith(".json")), [`${firstSessionId}.json`]);

    const cancelled = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: firstSessionId,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack restores the Git index and retries exact execution after a hook failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-commit-retry-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      sync_mode: "local",
      traceability: {
        auto_control_commits: true,
        git_notes: false,
      },
    }, null, 2)}\n`);
    write(path.join(root, "cadre", ".gitignore"), "/local/\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed traceable project"]);
    const trackId = "retry_commit_20260714";
    const preview = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId,
      spec: sampleSpec(trackId),
      plan: samplePlan(trackId),
    });
    const specApproved = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "spec",
      ...approvalStamp(preview.approval),
      approvedStages: ["spec"],
    });
    const sessionId = specApproved.approval.session_id;
    const complete = core.workflowPacketV1(root, {
      workflow: "newtrack",
      approvalSessionId: sessionId,
      approvalStage: "plan",
      ...approvalStamp(specApproved.approval),
      approvedStages: ["spec", "plan"],
    });
    assert.equal(complete.next.arguments.approval.session_id, sessionId);
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const hook = path.join(root, ".git", "hooks", "pre-commit");
    write(hook, "#!/bin/sh\nexit 1\n");
    fs.chmodSync(hook, 0o755);
    const indexBeforeExecute = git(root, ["diff", "--cached", "--name-status"]).stdout;
    const executeArgs = {
      workflow: "newtrack",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["spec", "plan"],
    };

    const failed = core.workflowPacket(root, executeArgs);
    assert.equal(failed.ok, false);
    assert.equal(failed.phase_state, "recovery_required");
    assert.equal(failed.control_commit.stage, "git_commit");
    assert.equal(failed.control_commit.index_restore.ok, true);
    assert.equal(fs.existsSync(sessionFile), true);
    assert.equal(git(root, ["diff", "--cached", "--name-status"]).stdout, indexBeforeExecute);
    const failedEvents = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8")
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(failedEvents.filter((event) => event.kind === "track_created" && event.approval_session_id === sessionId).length, 1);
    assert.equal(failedEvents.filter((event) => event.kind === "approval.completed" && event.approval_session_id === sessionId).length, 1);

    fs.rmSync(hook, { force: true });
    const retried = core.workflowPacket(root, executeArgs);
    assert.equal(retried.ok, true, retried.error || JSON.stringify(retried.control_commit));
    assert.equal(retried.phase_state, "executed");
    assert.equal(retried.event.reused, true);
    assert.equal(retried.approval_audit.reused, true);
    assert.equal(fs.existsSync(sessionFile), false);
    const finalEvents = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8")
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(finalEvents.filter((event) => event.kind === "track_created" && event.approval_session_id === sessionId).length, 1);
    assert.equal(finalEvents.filter((event) => event.kind === "approval.completed" && event.approval_session_id === sessionId).length, 1);
    const committed = git(root, ["show", "--pretty=", "--name-only", "HEAD"]).stdout.split(/\r?\n/).filter(Boolean);
    assert.ok(committed.includes("cadre/events.jsonl"));
    assert.ok(committed.includes("cadre/tracks.json"));
    assert.equal(git(root, ["status", "--porcelain"]).stdout.trim(), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack completes after commit when only the trace note fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-note-failure-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), `${JSON.stringify({
      sync_mode: "local",
      traceability: {
        auto_control_commits: true,
        git_notes: true,
        notes_ref: "invalid trace ref",
      },
    }, null, 2)}\n`);
    write(path.join(root, "cadre", ".gitignore"), "/local/\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed invalid note ref"]);
    const trackId = "note_failure_20260714";
    const created = approveWorkflow(root, {
      workflow: "newtrack",
      execute: true,
      approvalComplete: true,
      trackId,
      spec: sampleSpec(trackId),
      plan: samplePlan(trackId),
    });
    assert.equal(created.ok, true, created.error);
    assert.equal(created.phase_state, "executed");
    assert.equal(created.control_commit.ok, true);
    assert.equal(created.control_commit.trace_complete, false);
    assert.equal(created.control_commit.note.ok, false);
    assert.ok(created.control_commit.warnings.some((warning) => /trace note could not be written/i.test(warning)));
    assert.equal(created.approval_session_close.ok, true);
    assert.equal(gitSubject(root), `cadre(newtrack): create ${trackId}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow newtrack writes template-backed track learnings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-newtrack-template-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    const setup = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(setup.ok, true);

    const specPreview = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "blocked_20260618",
      spec: sampleSpec("spec"),
      plan: samplePlan("blocked_20260618"),
      reviewBundleDir: ".newtrack-review",
    });
    assert.equal(specPreview.ok, true, specPreview.error);
    assert.equal(specPreview.approval.current_stage, "spec");
    assert.deepEqual(readJson(specPreview.review_bundle.manifest_path).files.map((file) => file.path).sort(), [
      "cadre/tracks/blocked_20260618/spec.json",
      "cadre/tracks/blocked_20260618/spec.md",
    ]);
    const blocked = core.workflowPacket(root, {
      workflow: "newtrack",
      approvalSessionId: specPreview.approval.session_id,
      approvalStage: "spec",
      ...approvalStamp(specPreview.approval),
      approvedStages: ["spec"],
    });
    assert.equal(blocked.ok, true, blocked.error);
    assert.equal(blocked.approval.approval_complete, false);
    assert.equal(blocked.approval.current_stage, "plan");
    assert.deepEqual(readJson(blocked.review_bundle.manifest_path).files.map((file) => file.path).sort(), [
      "cadre/tracks/blocked_20260618/plan.json",
      "cadre/tracks/blocked_20260618/plan.md",
    ]);
    const blockedPlanArtifact = blocked.review_artifacts.find((artifact) => artifact.path === "cadre/tracks/blocked_20260618/plan.md");
    assert.ok(blockedPlanArtifact);
    assert.equal(Object.prototype.hasOwnProperty.call(blockedPlanArtifact, "content"), false);
    assert.equal(blocked.review_bundle.content_in_response, false);
    assert.ok(fs.existsSync(path.join(blocked.review_bundle.directory, "cadre", "tracks", "blocked_20260618", "plan.md")));
    const blockedPlanJson = readJson(path.join(blocked.review_bundle.directory, "cadre", "tracks", "blocked_20260618", "plan.json"));
    assert.equal(blockedPlanJson.phases.length, 3);
    assert.equal(blockedPlanJson.phases[0].tasks.at(-1).task_key, "phase1_manual_verification");
    assert.equal(blockedPlanJson.phases.at(-1).tasks[0].task_key, "track_manual_verification");
    const blockedPlanMarkdown = fs.readFileSync(path.join(blocked.review_bundle.directory, "cadre", "tracks", "blocked_20260618", "plan.md"), "utf8");
    assert.match(blockedPlanMarkdown, /Task 3: User Manual Verification/);
    assert.match(blockedPlanMarkdown, /manual-verification-scope: track/);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "blocked_20260618")), false);

    const spec = sampleSpec("tmpl_20260618", {
      title: "Login Rate Limit",
      description: "Protect account login from repeated password guessing without blocking normal users.",
      functional_requirements: [
        { heading: "Throttle failed attempts", body: "Count failed login attempts per account and source." },
        { heading: "Show lockout message", body: "Tell users when they can retry." },
      ],
      non_functional_requirements: [
        { heading: "No secret storage", body: "Do not store raw passwords or secrets in rate-limit records." },
        { heading: "Low latency", body: "Keep successful login latency effectively unchanged." },
      ],
      acceptance_criteria: [
        { heading: "Throttled path", body: "Tests cover blocked login attempts." },
        { heading: "Cooldown expiry", body: "Lockout state expires after the configured cooldown." },
      ],
      out_of_scope: [
        { heading: "MFA changes", body: "Multi-factor authentication behavior is unchanged." },
      ],
    });

    const created = approveWorkflow(root, {
      workflow: "newtrack",
      execute: true,
      approvalComplete: true,
      trackId: "tmpl_20260618",
      spec,
      plan: samplePlan("tmpl_20260618"),
    });

    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "spec.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "plan.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "learnings.jsonl")), true);
    const specJson = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "spec.json"), "utf8"));
    const planJson = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "plan.json"), "utf8"));
    assert.equal(specJson.track_id, "tmpl_20260618");
    assert.equal(specJson.title, "Login Rate Limit");
    assert.equal(specJson.description, "Protect account login from repeated password guessing without blocking normal users.");
    assert.deepEqual(specJson.functional_requirements[0], {
      heading: "Throttle failed attempts",
      body: "Count failed login attempts per account and source.",
    });
    assert.deepEqual(specJson.non_functional_requirements[0], {
      heading: "No secret storage",
      body: "Do not store raw passwords or secrets in rate-limit records.",
    });
    assert.deepEqual(specJson.acceptance_criteria[0], {
      heading: "Throttled path",
      body: "Tests cover blocked login attempts.",
    });
    assert.deepEqual(specJson.out_of_scope[0], {
      heading: "MFA changes",
      body: "Multi-factor authentication behavior is unchanged.",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(specJson, "goals"), false);
    assert.equal(planJson.track_id, "tmpl_20260618");
    assert.equal(planJson.phases.length, 3);
    assert.equal(planJson.phases[0].tasks.length, 3);
    assert.equal(planJson.phases[0].tasks[2].task_key, "phase1_manual_verification");
    assert.equal(planJson.phases[0].tasks[2].task_type, "user_manual_verification");
    assert.equal(planJson.phases[0].tasks[2].manual_verification.scope, "phase");
    assert.deepEqual(planJson.phases[0].tasks[2].depends_on, ["phase1_task1", "phase1_task2"]);
    assert.equal(planJson.phases[2].tasks[0].task_key, "track_manual_verification");
    assert.equal(planJson.phases[2].tasks[0].task_type, "user_manual_verification");
    assert.equal(planJson.phases[2].tasks[0].manual_verification.scope, "track");
    assert.ok(planJson.phases[2].tasks[0].manual_verification.suggested_checks.some((check) => check.source === "acceptance_criteria"));
    const specProjection = fs.readFileSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "spec.md"), "utf8");
    assert.match(specProjection, /cadre:generated from="cadre\/tracks\/tmpl_20260618\/spec\.json"/);
    assert.match(specProjection, /## Functional Requirements/);
    assert.match(specProjection, /- \*\*Throttle failed attempts\*\*: Count failed login attempts per account and source\./);
    assert.match(specProjection, /## Non-Functional Requirements/);
    assert.match(specProjection, /## Out Of Scope/);
    assert.match(specProjection, /## Canonical Source/);
    assert.match(specProjection, /Canonical data lives in `cadre\/tracks\/tmpl_20260618\/spec\.json`/);
    assert.doesNotMatch(specProjection, /"functional_requirements"/);
    assert.doesNotMatch(specProjection, /"acceptance_criteria"/);
    const plan = fs.readFileSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "plan.md"), "utf8");
    assert.match(plan, /cadre:generated from="cadre\/tracks\/tmpl_20260618\/plan\.json"/);
    assert.match(plan, /Track-Level User Manual Verification/);
    assert.match(plan, /manual-verification-scope: phase/);
    assert.match(plan, /Track-Level User Manual Verification/);
    assert.match(plan, /## Canonical Source/);
    assert.match(plan, /Canonical data lives in `cadre\/tracks\/tmpl_20260618\/plan\.json`/);
    assert.doesNotMatch(plan, /"manual_verification"/);
    assert.doesNotMatch(plan, /"suggested_checks"/);
    const idempotent = approveWorkflow(root, {
      workflow: "revise",
      execute: true,
      approvalComplete: true,
      trackId: "tmpl_20260618",
      reason: "Re-apply normalized plan to confirm manual verification remains idempotent.",
      plan: planJson,
    });
    assert.equal(idempotent.ok, true);
    const revisedPlanJson = readJson(path.join(root, "cadre", "tracks", "tmpl_20260618", "plan.json"));
    const manualTasks = revisedPlanJson.phases.flatMap((phase) => phase.tasks).filter((task) => task.task_type === "user_manual_verification");
    assert.equal(manualTasks.filter((task) => task.task_key === "phase1_manual_verification").length, 1);
    assert.equal(manualTasks.filter((task) => task.task_key === "phase2_manual_verification").length, 1);
    assert.equal(manualTasks.filter((task) => task.task_key === "track_manual_verification").length, 1);
    const learnings = fs.readFileSync(path.join(root, "cadre", "tracks", "tmpl_20260618", "learnings.md"), "utf8");
    assert.match(learnings, /cadre:generated from="cadre\/tracks\/tmpl_20260618\/learnings\.jsonl"/);
    assert.match(learnings, /# Track Learnings: tmpl_20260618/);
    assert.equal(learnings.includes("{{track_id}}"), false);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("artifact sync rejects legacy import and regenerates projections from canonicals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-artifact-sync-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "legacy_20260618", samplePlan("legacy_20260618"));

    const legacyImport = core.artifactPacket(root, {
      action: "import",
      scope: "track:legacy_20260618",
    });
    assert.equal(legacyImport.ok, false);
    assert.match(legacyImport.error, /Legacy Markdown import is not supported/);

    const preview = core.artifactPacket(root, { action: "sync", scope: "track:legacy_20260618" });
    assert.equal(preview.ok, true);
    assert.equal(preview.dry_run, true);
    assert.equal(preview.approval.required, false);
    assert.ok(preview.artifacts.some((artifact) => artifact.artifact_id === "track:legacy_20260618:spec" && artifact.legacy_import_available === false));
    assert.ok(preview.artifacts.some((artifact) => artifact.artifact_id === "track:legacy_20260618:plan" && artifact.legacy_import_available === false));
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "legacy_20260618", "plan.json")), true);

    const written = core.artifactPacket(root, {
      action: "sync",
      scope: "track:legacy_20260618",
      execute: true,
    });
    assert.equal(written.ok, true);
    assert.equal(written.phase_state, "executed");
    assert.ok(written.written.includes("cadre/tracks/legacy_20260618/spec.md"));
    assert.ok(written.written.includes("cadre/tracks/legacy_20260618/plan.md"));

    const planJson = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "legacy_20260618", "plan.json"), "utf8"));
    assert.equal(planJson.track_id, "legacy_20260618");
    assert.equal(planJson.phases.length, 3);
    assert.equal(planJson.phases.at(-1).tasks[0].task_key, "track_manual_verification");
    const plan = fs.readFileSync(path.join(root, "cadre", "tracks", "legacy_20260618", "plan.md"), "utf8");
    assert.match(plan, /cadre:generated from="cadre\/tracks\/legacy_20260618\/plan\.json"/);
    assert.match(plan, /Task 1: Implement core/);
    assert.match(plan, /Track-Level User Manual Verification/);

    const render = core.artifactPacket(root, { action: "render", artifact: "track:legacy_20260618:plan" });
    assert.equal(render.ok, true);
    assert.equal(render.changed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("artifact validation reports legacy styleguide projections without moving or deleting them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-legacy-styleguide-test-"));
  try {
    git(root, ["init"]);
    const legacy = path.join(root, "cadre", "code_styleguides", "general.md");
    write(legacy, "# Legacy style guide\n");
    const validation = core.artifactPacket(root, { action: "validate", scope: "styleguides" });
    assert.equal(validation.ok, false);
    assert.equal(validation.legacy_styleguide_path, "cadre/code_styleguides");
    assert.ok(validation.results.some((result) => result.artifact_id === "legacy-styleguide-projections" && /Deprecated/.test(result.error)));
    const sync = core.artifactPacket(root, { action: "sync", scope: "styleguides", execute: true, commitMode: "off" });
    assert.equal(sync.ok, true);
    assert.ok(sync.warnings.some((warning) => /remove the legacy directory manually/.test(warning)));
    assert.equal(fs.readFileSync(legacy, "utf8"), "# Legacy style guide\n");
    assert.equal(fs.existsSync(path.join(root, "cadre", "styleguides")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow revise reviews proposed track files before writing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-revise-review-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "revise_20260618", samplePlan("revise_20260618"));
    const revisedPlan = samplePlan("revise_20260618");
    revisedPlan.phases.splice(2, 0, {
      phase_index: 3,
      title: "Phase 3: Follow-up",
      execution_mode: "sequential",
      depends_on: [],
      tasks: [planTask(3, 1, "Recheck", [])],
    });

    const preview = core.workflowPacket(root, {
      workflow: "revise",
      trackId: "revise_20260618",
      reason: "Implementation discovery requires an extra follow-up task.",
      plan: revisedPlan,
      reviewBundleDir: ".revise-review",
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.dry_run, true);
    const planArtifact = preview.review_artifacts.find((artifact) => artifact.path === "cadre/tracks/revise_20260618/plan.md");
    assert.ok(planArtifact);
    assert.equal(Object.prototype.hasOwnProperty.call(planArtifact, "content"), false);
    assert.ok(fs.existsSync(path.join(preview.review_bundle.directory, "cadre", "tracks", "revise_20260618", "plan.md")));

    const blocked = core.workflowPacket(root, {
      workflow: "revise",
      execute: true,
      trackId: "revise_20260618",
      reason: "Implementation discovery requires an extra follow-up task.",
      plan: revisedPlan,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "staged_approval");
    assert.doesNotMatch(fs.readFileSync(path.join(root, "cadre", "tracks", "revise_20260618", "plan.md"), "utf8"), /Follow-up/);

    const written = approveWorkflow(root, {
      workflow: "revise",
      execute: true,
      approvalComplete: true,
      trackId: "revise_20260618",
      reason: "Implementation discovery requires an extra follow-up task.",
      plan: revisedPlan,
      force: true,
    });
    assert.equal(written.ok, true);
    assert.equal(written.phase_state, "executed");
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", "revise_20260618", "plan.md"), "utf8"), /Follow-up/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow revise collects declared spec and plan changes one active stage at a time", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-revise-lazy-stages-test-"));
  try {
    git(root, ["init"]);
    const trackId = "revise_lazy_20260714";
    writeTrack(root, trackId, samplePlan(trackId));
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed revision track"]);
    const specPath = path.join(root, "cadre", "tracks", trackId, "spec.json");
    const planPath = path.join(root, "cadre", "tracks", trackId, "plan.json");
    const baselineSpec = fs.readFileSync(specPath, "utf8");
    const baselinePlan = fs.readFileSync(planPath, "utf8");
    const revisedSpec = sampleSpec(trackId, {
      description: "Revise requirements before collecting the dependent execution plan.",
      acceptance_criteria: [{
        heading: "Lazy revision stages",
        body: "Spec review completes before Cadre requests or generates the revised plan.",
      }],
    });
    const revisedPlan = samplePlan(trackId);
    revisedPlan.phases[0].title = "Phase 1: Implement revised requirements";
    revisedPlan.phases[0].tasks[0].title = "Implement the approved revised spec";

    const missingSpec = core.workflowPacket(root, {
      workflow: "revise",
      trackId,
      reason: "Repository evidence changed both requirements and their execution plan.",
      intent: { revisionScope: "both" },
      plan: {},
      commitMode: "off",
    });
    assert.equal(missingSpec.ok, false);
    assert.equal(missingSpec.phase_state, "awaiting_clarification");
    assert.equal(missingSpec.approval.current_stage, "spec_changes");
    assert.deepEqual(missingSpec.missing_payload, ["spec"]);
    assert.deepEqual(missingSpec.warnings, []);
    const sessionId = missingSpec.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    let session = readJson(sessionFile);
    assert.deepEqual(session.stage_order, ["spec_changes", "plan_changes"]);
    assert.deepEqual(session.stage_records.spec_changes.snapshot_files, []);
    assert.deepEqual(session.stage_records.plan_changes.snapshot_files, []);
    assert.equal(fs.readFileSync(specPath, "utf8"), baselineSpec);
    assert.equal(fs.readFileSync(planPath, "utf8"), baselinePlan);

    const specPreview = core.workflowPacket(root, {
      workflow: "revise",
      approvalSessionId: sessionId,
      spec: revisedSpec,
    });
    assert.equal(specPreview.ok, true, specPreview.error);
    assert.equal(specPreview.approval.session_id, sessionId);
    assert.equal(specPreview.approval.current_stage, "spec_changes");
    assert.ok(!specPreview.warnings.some((warning) => /plan/i.test(warning)), "future plan warnings must stay deferred");
    assert.deepEqual(specPreview.review_artifacts.map((artifact) => artifact.path).sort(), [
      `cadre/tracks/${trackId}/spec.json`,
      `cadre/tracks/${trackId}/spec.md`,
    ]);
    session = readJson(sessionFile);
    assert.equal(session.stage_records.spec_changes.snapshot_files.length, 2);
    assert.deepEqual(session.stage_records.plan_changes.snapshot_files, []);
    const frozenSpec = JSON.stringify(session.stage_records.spec_changes.snapshot_files);
    assert.notEqual(fs.readFileSync(specPath, "utf8"), baselineSpec);
    assert.equal(fs.readFileSync(planPath, "utf8"), baselinePlan);

    const missingPlan = core.workflowPacket(root, {
      workflow: "revise",
      approvalSessionId: sessionId,
      approvalStage: "spec_changes",
      ...approvalStamp(specPreview.approval),
      approvedStages: ["spec_changes"],
    });
    assert.equal(missingPlan.ok, false);
    assert.equal(missingPlan.phase_state, "awaiting_clarification");
    assert.equal(missingPlan.approval.session_id, sessionId);
    assert.equal(missingPlan.approval.current_stage, "plan_changes");
    assert.deepEqual(missingPlan.approval.approved_stages, ["spec_changes"]);
    assert.deepEqual(missingPlan.missing_payload, ["plan"]);
    session = readJson(sessionFile);
    assert.equal(JSON.stringify(session.stage_records.spec_changes.snapshot_files), frozenSpec);
    assert.deepEqual(session.stage_records.plan_changes.snapshot_files, []);
    assert.equal(fs.readFileSync(planPath, "utf8"), baselinePlan);

    const planPreview = core.workflowPacket(root, {
      workflow: "revise",
      approvalSessionId: sessionId,
      plan: revisedPlan,
    });
    assert.equal(planPreview.ok, true, planPreview.error);
    assert.equal(planPreview.approval.current_stage, "plan_changes");
    assert.deepEqual(planPreview.review_artifacts.map((artifact) => artifact.path).sort(), [
      `cadre/tracks/${trackId}/plan.json`,
      `cadre/tracks/${trackId}/plan.md`,
    ]);
    session = readJson(sessionFile);
    assert.equal(JSON.stringify(session.stage_records.spec_changes.snapshot_files), frozenSpec);
    assert.equal(session.stage_records.plan_changes.snapshot_files.length, 2);
    const approvedSnapshots = Object.values(session.stage_records)
      .flatMap((record) => record.snapshot_files)
      .map((file) => ({ path: file.path, content: file.content }));

    const complete = core.workflowPacketV1(root, {
      workflow: "revise",
      approvalSessionId: sessionId,
      approvalStage: "plan_changes",
      ...approvalStamp(planPreview.approval),
      approvedStages: ["spec_changes", "plan_changes"],
    });
    assert.equal(complete.decision.kind, "ready");
    assert.deepEqual(complete.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "revise",
        input: {},
        execute: true,
        approval: {
          session_id: sessionId,
          approved_stages: ["spec_changes", "plan_changes"],
          complete: true,
        },
      },
    });
    const executed = core.workflowPacket(root, {
      workflow: "revise",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["spec_changes", "plan_changes"],
    });
    assert.equal(executed.ok, true, executed.error);
    assert.equal(executed.phase_state, "executed");
    for (const snapshot of approvedSnapshots) {
      assert.equal(fs.readFileSync(path.join(root, snapshot.path), "utf8"), snapshot.content, snapshot.path);
    }
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow revise freezes an implicitly selected track across staged continuation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-revise-frozen-track-test-"));
  try {
    git(root, ["init"]);
    const originalTrack = "active_a_20260714";
    const replacementTrack = "active_b_20260714";
    writeTrack(root, originalTrack, samplePlan(originalTrack), { status: "in_progress" });
    writeTrack(root, replacementTrack, samplePlan(replacementTrack), { status: "new" });
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed active revision tracks"]);
    const revisedSpec = sampleSpec(originalTrack, {
      description: "Freeze the implicitly selected track for every revision stage.",
    });
    const revisedPlan = samplePlan(originalTrack);
    revisedPlan.phases[0].tasks[0].title = "Continue revising the originally selected track";

    const specPreview = core.workflowPacket(root, {
      workflow: "revise",
      reason: "Both artifacts must remain attached to the initially active track.",
      intent: { revisionScope: "both" },
      spec: revisedSpec,
      plan: {},
      commitMode: "off",
    });
    assert.equal(specPreview.ok, true, specPreview.error);
    assert.equal(specPreview.track_id, originalTrack);
    const sessionId = specPreview.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    assert.equal(readJson(sessionFile).payload.trackId, originalTrack);

    const missingPlan = core.workflowPacket(root, {
      workflow: "revise",
      approvalSessionId: sessionId,
      approvalStage: "spec_changes",
      ...approvalStamp(specPreview.approval),
      approvedStages: ["spec_changes"],
    });
    assert.equal(missingPlan.approval.current_stage, "plan_changes");
    const originalMetadataPath = path.join(root, "cadre", "tracks", originalTrack, "metadata.json");
    const replacementMetadataPath = path.join(root, "cadre", "tracks", replacementTrack, "metadata.json");
    write(originalMetadataPath, `${JSON.stringify({ ...readJson(originalMetadataPath), status: "new" }, null, 2)}\n`);
    write(replacementMetadataPath, `${JSON.stringify({ ...readJson(replacementMetadataPath), status: "in_progress" }, null, 2)}\n`);

    const planPreview = core.workflowPacket(root, {
      workflow: "revise",
      approvalSessionId: sessionId,
      plan: revisedPlan,
    });
    assert.equal(planPreview.ok, true, planPreview.error);
    assert.equal(planPreview.track_id, originalTrack);
    assert.deepEqual(planPreview.review_artifacts.map((artifact) => artifact.path).sort(), [
      `cadre/tracks/${originalTrack}/plan.json`,
      `cadre/tracks/${originalTrack}/plan.md`,
    ]);
    assert.ok(readJson(sessionFile).stage_records.plan_changes.snapshot_files
      .every((file) => file.path.includes(`/tracks/${originalTrack}/`)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("target staged review previews appear in git diff and reject drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-target-review-drift-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "target_preview_20260626", samplePlan("target_preview_20260626"));
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed track"]);
    const revisedPlan = samplePlan("target_preview_20260626");
    revisedPlan.phases.splice(2, 0, {
      phase_index: 3,
      title: "Phase 3: Target preview",
      execution_mode: "sequential",
      depends_on: [],
      tasks: [planTask(3, 1, "Inspect git diff", [])],
    });
    const args = {
      workflow: "revise",
      trackId: "target_preview_20260626",
      reason: "Exercise target-path staged review.",
      plan: revisedPlan,
    };
    const preview = core.workflowPacket(root, args);
    assert.equal(preview.ok, true);
    assert.equal(preview.review_bundle.mode, "target");
    assert.equal(preview.review_bundle.mutates_worktree, true);
    assert.match(git(root, ["diff", "--", "cadre/tracks/target_preview_20260626/plan.md"]).stdout, /Target preview/);

    const approved = core.workflowPacket(root, {
      ...args,
      approvalSessionId: preview.approval.session_id,
      approvalStage: "plan_changes",
      ...approvalStamp(preview.approval),
      approvedStages: ["plan_changes"],
    });
    assert.equal(approved.ok, true);
    fs.appendFileSync(path.join(root, "cadre", "tracks", "target_preview_20260626", "plan.md"), "\nlocal drift\n");
    const execute = core.workflowPacket(root, {
      ...args,
      execute: true,
      approvalComplete: true,
      approvalSessionId: preview.approval.session_id,
      approvedStages: ["plan_changes"],
    });
    assert.equal(execute.ok, false);
    assert.equal(execute.stage, "staged_review_drift");
    assert.match(execute.error, /changed after review/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a changed unapproved preview safely replaces its overlapping session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-preview-replacement-test-"));
  try {
    git(root, ["init"]);
    const trackId = "replace_preview_20260714";
    writeTrack(root, trackId, samplePlan(trackId));
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed track"]);

    const firstPlan = samplePlan(trackId);
    firstPlan.phases[0].title = "Phase 1: First preview";
    firstPlan.phases[0].tasks[0].title = "Materialize the first unapproved preview";
    const first = core.workflowPacket(root, {
      workflow: "revise",
      trackId,
      reason: "Test replacement of an unapproved target preview.",
      plan: firstPlan,
    });
    assert.equal(first.ok, true, first.error);
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "plan.md"), "utf8"), /First preview/);
    const firstSessionFile = path.join(root, "cadre", "local", "approval-sessions", `${first.approval.session_id}.json`);
    assert.equal(fs.existsSync(firstSessionFile), true);

    const replacementPlan = samplePlan(trackId);
    replacementPlan.phases[0].title = "Phase 1: Replacement preview";
    replacementPlan.phases[0].tasks[0].title = "Materialize the corrected unapproved preview";
    const replacement = core.workflowPacket(root, {
      workflow: "revise",
      trackId,
      reason: "Replace the earlier preview with corrected evidence.",
      plan: replacementPlan,
    });
    assert.equal(replacement.ok, true, replacement.error);
    assert.notEqual(replacement.approval.session_id, first.approval.session_id);
    assert.equal(fs.existsSync(firstSessionFile), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions", `${replacement.approval.session_id}.json`)), true);
    const replacementProjection = fs.readFileSync(path.join(root, "cadre", "tracks", trackId, "plan.md"), "utf8");
    assert.match(replacementProjection, /Replacement preview/);
    assert.doesNotMatch(replacementProjection, /First preview/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a sessionless overlapping setup amendment returns the active session without mutation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-sessionless-recovery-test-"));
  try {
    git(root, ["init"]);
    const base = withSetupTestEvidence({
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      styleGuideIds: [],
      writeLsp: false,
      integrations: {},
      product: {
        title: "Initial setup evidence",
        summary: "Repository-grounded product evidence awaiting explicit staged approval.",
      },
      techStack: { languages: ["TypeScript"] },
    });
    const preview = core.workflowPacket(root, base);
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.approval.current_stage, "product");
    const sessionId = preview.approval.session_id;
    const sessionDirectory = path.join(root, "cadre", "local", "approval-sessions");
    const sessionFile = path.join(sessionDirectory, `${sessionId}.json`);
    const sessionBefore = fs.readFileSync(sessionFile, "utf8");
    const productBefore = fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8");
    const changed = {
      ...base,
      product: {
        title: "Corrected setup evidence",
        summary: "The user's authoritative correction must resume the active setup session.",
      },
    };

    const blocked = core.workflowPacket(root, changed);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /active setup approval session.*resume session/i);
    assert.equal(blocked.approval.session_id, sessionId);
    assert.equal(blocked.approval.session_resumable, true);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBefore);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8"), productBefore);
    assert.deepEqual(fs.readdirSync(sessionDirectory).filter((name) => name.endsWith(".json")), [`${sessionId}.json`]);

    const packet = core.workflowPacketV1(root, changed);
    assert.equal(packet.ok, false);
    assert.equal(packet.decision.kind, "blocked");
    assert.equal(packet.decision.session_id, sessionId);
    assert.equal(packet.decision.resume.arguments.approval.session_id, sessionId);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBefore);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8"), productBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a complete refresh replacement does not leak baseline or superseded preview fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-refresh-preview-baseline-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "product.json"), `${JSON.stringify({
      version: 1,
      schema: "cadre.product.v1",
      kind: "product",
      title: "Baseline Product",
      summary: "Repository-backed baseline product context.",
      sections: [
        { id: "users_personas", heading: "Users And Personas", body: "- Baseline operators reviewing controlled changes." },
        { id: "repository_evidence", heading: "Repository Evidence", body: "- Custom baseline evidence remains part of partial refreshes." },
      ],
    }, null, 2)}\n`);
    write(path.join(root, "cadre", "product.md"), "# Baseline Product\n\nBaseline operators reviewing controlled changes.\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed product context"]);

    const first = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: ["product"],
      proposedContext: {
        product: {
          sections: [{ id: "users_personas", heading: "Users And Personas", body: "- First preview users that must not leak into a corrected payload." }],
        },
      },
    });
    assert.equal(first.ok, true, first.error);
    assert.match(fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8"), /First preview users/);

    const replacement = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: ["product"],
      proposedContext: {
        product: { summary: "Corrected repository evidence for the product refresh." },
      },
    });
    assert.equal(replacement.ok, true, replacement.error);
    assert.notEqual(replacement.approval.session_id, first.approval.session_id);
    const canonical = fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8");
    assert.match(canonical, /Corrected repository evidence/);
    assert.doesNotMatch(canonical, /Baseline operators/);
    assert.doesNotMatch(canonical, /Custom baseline evidence/);
    assert.doesNotMatch(canonical, /First preview users/);
    assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions", `${first.approval.session_id}.json`)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("product refresh replaces a committed legacy template with evidence instead of preserving placeholders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-refresh-legacy-template-test-"));
  try {
    git(root, ["init"]);
    const legacyTemplate = fs.readFileSync(path.join(__dirname, "..", "templates", "product.json"), "utf8");
    write(path.join(root, "cadre", "product.json"), legacyTemplate);
    write(path.join(root, "cadre", "product.md"), "# Product Context\n\n- What the product is:\n- Who it serves:\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed legacy template"]);

    const refresh = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: ["product"],
      proposedContext: {
        product: {
          summary: "A repository-specific orchestration harness for evidence-backed agent workflows.",
        },
      },
    });
    assert.equal(refresh.ok, true, refresh.error);
    const canonical = fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8");
    assert.match(canonical, /repository-specific orchestration harness/);
    assert.doesNotMatch(canonical, /Project-Specific Product Notes/);
    assert.doesNotMatch(canonical, /What the product is/);
    assert.doesNotMatch(canonical, /Fill sections from repo evidence/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("approved target execution rejects staged and committed HEAD drift while retaining the session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-preview-head-drift-test-"));
  try {
    git(root, ["init"]);
    const trackId = "head_drift_20260714";
    writeTrack(root, trackId, samplePlan(trackId));
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed track"]);
    const plan = samplePlan(trackId);
    plan.phases[0].title = "Phase 1: Reviewed baseline";
    plan.phases[0].tasks[0].title = "Detect a committed preview baseline change";
    const args = {
      workflow: "revise",
      trackId,
      reason: "Ensure approved content cannot execute after HEAD changes its baseline.",
      plan,
    };
    const preview = core.workflowPacket(root, args);
    assert.equal(preview.ok, true, preview.error);
    const approved = core.workflowPacket(root, {
      ...args,
      approvalSessionId: preview.approval.session_id,
      approvalStage: "plan_changes",
      ...approvalStamp(preview.approval),
      approvedStages: ["plan_changes"],
    });
    assert.equal(approved.ok, true, approved.error);

    const reviewPaths = [`cadre/tracks/${trackId}/plan.json`, `cadre/tracks/${trackId}/plan.md`];
    git(root, ["add", ...reviewPaths]);
    const stagedExecution = core.workflowPacket(root, {
      ...args,
      execute: true,
      approvalComplete: true,
      approvalSessionId: preview.approval.session_id,
      approvedStages: ["plan_changes"],
    });
    assert.equal(stagedExecution.ok, false);
    assert.equal(stagedExecution.stage, "staged_review_drift");
    assert.match(stagedExecution.error, /staged Git content/);
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${preview.approval.session_id}.json`);
    assert.equal(fs.existsSync(sessionFile), true);

    git(root, ["reset", "--", ...reviewPaths]);
    git(root, ["add", ...reviewPaths]);
    git(root, ["commit", "-m", "commit reviewed preview outside Cadre"]);
    const executed = core.workflowPacket(root, {
      ...args,
      execute: true,
      approvalComplete: true,
      approvalSessionId: preview.approval.session_id,
      approvedStages: ["plan_changes"],
    });
    assert.equal(executed.ok, false);
    assert.equal(executed.stage, "staged_review_drift");
    assert.match(executed.error, /baseline changed in Git/);
    assert.equal(fs.existsSync(sessionFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("target setup materializes only the active stage and cancel restores all materialized state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-target-setup-cancel-test-"));
  try {
    git(root, ["init"]);
    const args = {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: true,
      styleGuideIds: ["general"],
      integrations: {},
      product: { title: "Diff Product", summary: "Review the complete target diff." },
      techStack: { languages: ["TypeScript"] },
    };
    const preview = core.workflowPacket(root, args);
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.review_bundle.mode, "target");
    assert.equal(preview.approval.current_document.id, "product");
    assert.equal(preview.approval.current_document.canonical_path, "cadre/product.json");
    assert.equal(preview.approval.current_document.projection_path, "cadre/product.md");
    assert.deepEqual(Object.keys(preview.approval.current_document.snapshot_hashes).sort(), ["cadre/product.json", "cadre/product.md"]);
    for (const file of ["cadre/product.json", "cadre/product.md", "cadre/.gitignore"]) {
      assert.equal(fs.existsSync(path.join(root, file)), true, file);
    }
    for (const file of [
      "cadre/product_guidelines.json",
      "cadre/product_guidelines.md",
      "cadre/tech-stack.json",
      "cadre/tech-stack.md",
      "cadre/lsp.json",
      "cadre/workflow.json",
      "cadre/workflow.md",
      "cadre/patterns.jsonl",
      "cadre/patterns.md",
      "cadre/styleguides/index.json",
      "cadre/styleguides/README.md",
      "cadre/config.json",
      "cadre/setup_state.json",
      "cadre/tracks.json",
    ]) assert.equal(fs.existsSync(path.join(root, file)), false, file);
    assert.deepEqual(preview.approval.intent_to_add_paths.sort(), ["cadre/product.json", "cadre/product.md"]);
    assert.deepEqual(preview.approval.approved_review_paths, []);
    assert.match(git(root, ["diff", "--", "cadre/product.json"]).stdout, /Diff Product/);
    assert.equal(git(root, ["diff", "--cached"]).stdout, "");
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${preview.approval.session_id}.json`);
    assert.equal(fs.existsSync(sessionFile), true);
    const session = readJson(sessionFile);
    assert.equal(session.schema_version, 2);
    assert.deepEqual(session.stage_order, ["product", "product_guidelines", "technical", "workflow"]);
    assert.deepEqual(session.stage_records.product.snapshot_files.map((file) => file.path), ["cadre/product.json", "cadre/product.md"]);
    assert.deepEqual(session.stage_records.product_guidelines.snapshot_files, []);
    assert.deepEqual(session.stage_records.technical.snapshot_files, []);
    assert.deepEqual(session.stage_records.workflow.snapshot_files, []);
    assert.deepEqual(session.final_snapshot_files, []);
    assert.deepEqual(session.snapshot_files.map((file) => file.path), ["cadre/product.json", "cadre/product.md"]);
    assert.deepEqual(session.ancillary_snapshot_files.map((file) => file.path), ["cadre/.gitignore"]);
    assert.equal(git(root, ["check-ignore", "-q", "--", path.relative(root, sessionFile)]).status, 0);

    const cancelled = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);
    assert.equal(cancelled.approval.cancelled, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "config.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", ".gitignore")), false);
    assert.equal(fs.existsSync(sessionFile), false);
    assert.equal(git(root, ["diff", "--cached"]).stdout, "");
    assert.equal(git(root, ["status", "--porcelain"]).stdout.trim(), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup amends only its current unapproved stage without resetting the approved prefix", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-current-stage-amendment-test-"));
  try {
    git(root, ["init"]);
    const args = {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Stable Product", summary: "The approved product snapshot." },
      productGuidelines: { title: "Guidelines", summary: "Initial guideline draft." },
      techStack: { languages: ["TypeScript"] },
    };
    const initial = core.workflowPacket(root, args);
    assert.equal(initial.ok, true, initial.error);
    const sessionId = initial.approval.session_id;
    const productBefore = new Map([
      ["cadre/product.json", fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8")],
      ["cadre/product.md", fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8")],
    ]);
    const productApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product",
      ...approvalStamp(initial.approval),
      approvedStages: ["product"],
    });
    assert.equal(productApproved.ok, true, productApproved.error);
    const originalGuidelineStamp = approvalStamp(productApproved.approval);
    const noOpResume = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
    });
    assert.equal(noOpResume.ok, true, noOpResume.error);
    assert.equal(noOpResume.approval.current_stage_hash, originalGuidelineStamp.approvalStageHash);
    assert.equal(noOpResume.approval.current_stage_revision, originalGuidelineStamp.approvalStageRevision);
    const guidelinesBefore = fs.readFileSync(path.join(root, "cadre", "product_guidelines.md"), "utf8");
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const sessionBeforeRejectedChange = fs.readFileSync(sessionFile, "utf8");
    const indexBeforeRejectedChange = git(root, ["diff", "--cached", "--binary"]).stdout;

    const rejectedApprovedChange = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      product: { summary: "Attempt to replace approved product input." },
    });
    assert.equal(rejectedApprovedChange.ok, false);
    assert.match(rejectedApprovedChange.error, /Only current stage product_guidelines input may change.*product/i);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBeforeRejectedChange);
    assert.equal(git(root, ["diff", "--cached", "--binary"]).stdout, indexBeforeRejectedChange);
    for (const [file, content] of productBefore) assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "product_guidelines.md"), "utf8"), guidelinesBefore);

    const amended = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      product_guidelines: { summary: "Corrected evidence-backed guideline draft." },
    });
    assert.equal(amended.ok, true, amended.error);
    assert.equal(amended.approval.session_id, sessionId);
    assert.equal(amended.approval.current_stage, "product_guidelines");
    assert.equal(amended.approval.current_stage_revision, originalGuidelineStamp.approvalStageRevision + 1);
    assert.notEqual(amended.approval.current_stage_hash, originalGuidelineStamp.approvalStageHash);
    assert.deepEqual(amended.approval.approved_stages, ["product"]);
    assert.deepEqual(amended.approval.approved_review_paths.sort(), ["cadre/product.json", "cadre/product.md"]);
    for (const [file, content] of productBefore) assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file);
    assert.match(fs.readFileSync(path.join(root, "cadre", "product_guidelines.md"), "utf8"), /Corrected evidence-backed guideline draft/);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.json")), false);
    assert.deepEqual(fs.readdirSync(path.dirname(sessionFile)).filter((name) => name.endsWith(".json")), [`${sessionId}.json`]);
    const amendedSession = readJson(sessionFile);
    assert.equal(amendedSession.payload.productGuidelines.summary, "Corrected evidence-backed guideline draft.");
    assert.equal(Object.prototype.hasOwnProperty.call(amendedSession.payload, "product_guidelines"), false);

    const staleApproval = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product_guidelines",
      ...originalGuidelineStamp,
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(staleApproval.ok, false);
    assert.match(staleApproval.error, /approvalStageHash.*reviewed product_guidelines stage/);
    assert.deepEqual(staleApproval.approval.approved_stages, ["product"]);
    const stalePacket = core.workflowPacketV1(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product_guidelines",
      ...originalGuidelineStamp,
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(stalePacket.decision.kind, "blocked");
    assert.equal(stalePacket.decision.session_id, sessionId);
    assert.equal(stalePacket.decision.current_stage, "product_guidelines");
    assert.equal(stalePacket.decision.stage_hash, amended.approval.current_stage_hash);
    assert.equal(stalePacket.decision.stage_revision, amended.approval.current_stage_revision);
    assert.deepEqual(stalePacket.decision.approved_stages, ["product"]);

    const wrongRevisionApproval = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product_guidelines",
      approvalStageHash: amended.approval.current_stage_hash,
      approvalStageRevision: amended.approval.current_stage_revision - 1,
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(wrongRevisionApproval.ok, false);
    assert.match(wrongRevisionApproval.error, /approvalStageRevision.*reviewed revision/);
    assert.deepEqual(wrongRevisionApproval.approval.approved_stages, ["product"]);

    const guidelinesApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product_guidelines",
      ...approvalStamp(amended.approval),
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(guidelinesApproved.ok, true, guidelinesApproved.error);
    assert.deepEqual(guidelinesApproved.approval.approved_review_paths.sort(), [
      "cadre/product.json",
      "cadre/product.md",
      "cadre/product_guidelines.json",
      "cadre/product_guidelines.md",
    ].sort());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup tech-stack amendment replaces stale structured evidence in the same session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-tech-stack-replacement-test-"));
  try {
    git(root, ["init"]);
    const technical = advanceSetupToTechnical(root, {
      providerMode: "github",
      syncMode: "shared",
      remoteHost: "stale.github.example",
      writeLsp: false,
      styleGuideIds: [],
      integrations: {},
      config: {
        auto_open: true,
        custom_setting: "preserve",
        packet_only: false,
        sync_mode: "shared",
        provider_mode: "github",
        provider_mcp_required: true,
        remote_host: "stale.config.example",
        integrations: { stale: { selected: true } },
      },
      product: {
        title: "Brownfield mobile product",
        summary: "Replace stale mobile stack evidence without restarting approved setup stages.",
      },
      techStack: {
        languages: ["Swift"],
        frameworks: ["SwiftUI"],
        platforms: ["iOS"],
        packageManagers: ["SwiftPM"],
        testing: { command: "swift test", framework: "XCTest" },
      },
    });
    assert.equal(technical.ok, true, technical.error);
    assert.equal(technical.approval.current_stage, "technical");
    assert.ok(technical.styleGuides.detected.includes("swift"));
    const sessionId = technical.approval.session_id;
    const originalRevision = technical.approval.current_stage_revision;
    const originalStamp = approvalStamp(technical.approval);
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const approvedBytes = new Map([
      "cadre/product.json",
      "cadre/product.md",
      "cadre/product_guidelines.json",
      "cadre/product_guidelines.md",
    ].map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));

    const technicalFileBeforeInvalid = fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8");
    const sessionBeforeInvalid = fs.readFileSync(sessionFile, "utf8");
    const invalidAmendment = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      providerMode: "bitbucket",
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(invalidAmendment.ok, true, invalidAmendment.error);
    assert.equal(invalidAmendment.phase_state, "awaiting_clarification");
    assert.ok(invalidAmendment.native_prompts.some((prompt) => prompt.id === "setup-provider-mode"));
    assert.equal(invalidAmendment.review_bundle, null);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBeforeInvalid);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"), technicalFileBeforeInvalid);

    const equivalentAliases = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      providerMode: " GITHUB ",
      provider_mode: "github",
      syncMode: "SHARED",
      sync_mode: "shared",
    });
    assert.equal(equivalentAliases.ok, true, equivalentAliases.error);
    assert.equal(equivalentAliases.approval.current_stage_revision, originalRevision);
    const sessionBeforeConflict = fs.readFileSync(sessionFile, "utf8");
    const conflictingAliases = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      providerMode: "github",
      provider_mode: "local",
      tech_stack: { languages: ["TypeScript"] },
    });
    assert.equal(conflictingAliases.ok, false);
    assert.match(conflictingAliases.error, /Conflicting aliases.*providerMode\/provider_mode/i);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBeforeConflict);

    const replacement = {
      languages: ["TypeScript"],
      frameworks: ["React"],
      runtimes: ["Node.js"],
    };
    const amended = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      techStack: replacement,
      provider_mode: "local",
      sync_mode: "local",
      write_lsp: false,
    });
    assert.equal(amended.ok, true, amended.error);
    assert.equal(amended.approval.session_id, sessionId);
    assert.equal(amended.approval.current_stage, "technical");
    assert.deepEqual(amended.approval.approved_stages, ["product", "product_guidelines"]);
    assert.equal(amended.approval.current_stage_revision, originalRevision + 1);
    assert.ok(amended.styleGuides.detected.includes("typescript"));
    assert.equal(amended.styleGuides.detected.includes("swift"), false);
    const amendedPayload = readJson(sessionFile).payload;
    assert.deepEqual(amendedPayload.techStack, replacement);
    assert.equal(amendedPayload.providerMode, "local");
    assert.equal(amendedPayload.syncMode, "local");
    assert.equal(amendedPayload.writeLsp, false);
    for (const alias of ["provider_mode", "provider", "sync_mode", "write_lsp", "setupLsp", "setup_lsp", "lsp"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(amendedPayload, alias), false, alias);
    }
    const reviewedTechStack = fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8");
    assert.doesNotMatch(reviewedTechStack, /Swift|SwiftUI|iOS|SwiftPM|swift test|XCTest/);
    assert.match(reviewedTechStack, /TypeScript/);
    for (const [file, content] of approvedBytes) assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file);
    assert.deepEqual(
      fs.readdirSync(path.dirname(sessionFile)).filter((name) => name.endsWith(".json")),
      [`${sessionId}.json`],
    );

    const noOpResume = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
    });
    assert.equal(noOpResume.ok, true, noOpResume.error);
    assert.equal(noOpResume.approval.current_stage_hash, amended.approval.current_stage_hash);
    assert.equal(noOpResume.approval.current_stage_revision, amended.approval.current_stage_revision);

    const staleApproval = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "technical",
      ...originalStamp,
      approvedStages: ["product", "product_guidelines", "technical"],
    });
    assert.equal(staleApproval.ok, false);
    assert.match(staleApproval.error, /approvalStageHash.*reviewed technical stage/);
    assert.deepEqual(staleApproval.approval.approved_stages, ["product", "product_guidelines"]);

    const technicalApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "technical",
      ...approvalStamp(amended.approval),
      approvedStages: ["product", "product_guidelines", "technical"],
    });
    assert.equal(technicalApproved.ok, true, technicalApproved.error);
    assert.equal(technicalApproved.approval.current_stage, "workflow");
    const workflowApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "workflow",
      ...approvalStamp(technicalApproved.approval),
      approvedStages: ["product", "product_guidelines", "technical", "workflow"],
    });
    assert.equal(workflowApproved.ok, true, workflowApproved.error);
    const executed = core.workflowPacket(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["product", "product_guidelines", "technical", "workflow"],
    });
    assert.equal(executed.ok, true, executed.error);
    for (const file of ["cadre/tech-stack.json", "cadre/tech-stack.md"]) {
      const content = fs.readFileSync(path.join(root, file), "utf8");
      assert.doesNotMatch(content, /Swift|SwiftUI|iOS|SwiftPM|swift test|XCTest/);
      assert.match(content, /TypeScript/);
    }
    const config = readJson(path.join(root, "cadre", "config.json"));
    assert.equal(config.auto_open, true);
    assert.equal(config.custom_setting, "preserve");
    assert.equal(config.packet_only, true);
    assert.equal(config.provider_mode, "local");
    assert.equal(config.provider_mcp_required, false);
    assert.equal(config.sync_mode, "local");
    assert.equal(Object.prototype.hasOwnProperty.call(config, "remote_host"), false);
    assert.deepEqual(config.integrations, {});
    for (const [file, content] of approvedBytes) assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file);
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup rejects malformed approval session ids without escaping session storage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-approval-session-id-test-"));
  try {
    git(root, ["init"]);
    const sentinel = path.join(root, "escape.json");
    write(sentinel, "{\"safe\":true}\n");
    const before = fs.readFileSync(sentinel, "utf8");
    const result = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: "../../../escape",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Safe Product", summary: "Keep malformed session identifiers outside storage." },
      productGuidelines: { title: "Guidelines", summary: "Validate approval identity before reading session files." },
      techStack: { languages: ["TypeScript"] },
      workflowPolicy: { title: "Workflow", summary: "Fail closed without mutating approval state." },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Approval session was not found/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), before);
    const cancelled = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: "../../../escape",
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, false);
    assert.match(cancelled.error, /Approval session was not found/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), before);
    const sessionDir = path.join(root, "cadre", "local", "approval-sessions");
    assert.deepEqual(fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir) : [], []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup cancellation restores an existing Cadre ignore file exactly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-existing-ignore-cancel-test-"));
  try {
    git(root, ["init"]);
    const ignorePath = path.join(root, "cadre", ".gitignore");
    const original = "# Keep project-local rules\n/custom-cache/\n";
    write(ignorePath, original);
    git(root, ["add", "cadre/.gitignore"]);
    git(root, ["commit", "-m", "seed Cadre ignore"]);
    const preview = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Ignore Product", summary: "Verify native-state rollback." },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(preview.ok, true, preview.error);
    assert.match(fs.readFileSync(ignorePath, "utf8"), /\/local\//);
    const cancelled = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: preview.approval.session_id,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);
    assert.equal(fs.readFileSync(ignorePath, "utf8"), original);
    assert.equal(git(root, ["status", "--porcelain"]).stdout.trim(), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup rejects current-stage amendment after target drift and succeeds after restoration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-current-stage-drift-test-"));
  try {
    git(root, ["init"]);
    const initial = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Drift Product", summary: "Stable product evidence." },
      productGuidelines: { title: "Guidelines", summary: "Initial guideline draft." },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(initial.ok, true, initial.error);
    const sessionId = initial.approval.session_id;
    const productApproved = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      approvalStage: "product",
      ...approvalStamp(initial.approval),
      approvedStages: ["product"],
    });
    assert.equal(productApproved.ok, true, productApproved.error);
    const projectionPath = path.join(root, "cadre", "product_guidelines.md");
    const previewBytes = fs.readFileSync(projectionPath, "utf8");
    fs.appendFileSync(projectionPath, "\nUser review note.\n");
    const editedBytes = fs.readFileSync(projectionPath, "utf8");
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const sessionBytes = fs.readFileSync(sessionFile, "utf8");

    const rejected = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      productGuidelines: { summary: "Replacement after drift must fail." },
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /changed after Cadre created the product_guidelines preview/);
    assert.equal(fs.readFileSync(projectionPath, "utf8"), editedBytes);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBytes);

    write(projectionPath, previewBytes);
    const amended = core.workflowPacket(root, {
      workflow: "setup",
      approvalSessionId: sessionId,
      productGuidelines: { summary: "Replacement after restoration succeeds." },
    });
    assert.equal(amended.ok, true, amended.error);
    assert.match(fs.readFileSync(projectionPath, "utf8"), /Replacement after restoration succeeds/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("approval cancellation rejects staged target drift atomically and retains the session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-target-cancel-drift-test-"));
  try {
    git(root, ["init"]);
    const trackId = "cancel_drift_20260714";
    writeTrack(root, trackId, samplePlan(trackId));
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "seed cancellation track"]);
    const plan = samplePlan(trackId);
    plan.phases[0].title = "Phase 1: Cancellation drift";
    plan.phases[0].tasks[0].title = "Keep staged review work intact";
    const preview = core.workflowPacket(root, {
      workflow: "revise",
      trackId,
      reason: "Verify cancellation retains a session when its target is staged.",
      plan,
    });
    assert.equal(preview.ok, true, preview.error);
    const reviewPaths = [`cadre/tracks/${trackId}/plan.json`, `cadre/tracks/${trackId}/plan.md`];
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${preview.approval.session_id}.json`);
    const previewProjection = fs.readFileSync(path.join(root, reviewPaths[1]), "utf8");
    git(root, ["add", ...reviewPaths]);

    const blocked = core.workflowPacket(root, {
      workflow: "revise",
      approvalSessionId: preview.approval.session_id,
      approvalCancel: true,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.approval.cancelled, false);
    assert.equal(blocked.approval.cancellation.session_retained, true);
    assert.equal(blocked.approval.cancellation.stage, "approval_cancel_git_drift");
    assert.equal(fs.existsSync(sessionFile), true);
    assert.equal(fs.readFileSync(path.join(root, reviewPaths[1]), "utf8"), previewProjection);
    assert.notEqual(git(root, ["diff", "--cached", "--", ...reviewPaths]).stdout, "");

    git(root, ["reset", "--", ...reviewPaths]);
    const cancelled = core.workflowPacket(root, {
      workflow: "revise",
      approvalSessionId: preview.approval.session_id,
      approvalCancel: true,
    });
    assert.equal(cancelled.ok, true, cancelled.error);
    assert.equal(cancelled.approval.cancelled, true);
    assert.equal(fs.existsSync(sessionFile), false);
    assert.doesNotMatch(fs.readFileSync(path.join(root, reviewPaths[1]), "utf8"), /Cancellation drift/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup replaces an untouched template preview with repository evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-placeholder-recovery-test-"));
  try {
    git(root, ["init"]);
    const base = {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
    };
    const legacy = seedLegacySetupPlaceholder(root);
    assert.equal(readJson(path.join(root, "cadre", "product.json")).title, "Product Context");
    const placeholderSession = path.join(root, "cadre", "local", "approval-sessions", `${legacy.placeholderSessionId}.json`);
    const failedSession = path.join(root, "cadre", "local", "approval-sessions", `${legacy.failedSessionId}.json`);
    assert.equal(fs.existsSync(placeholderSession), true);
    assert.equal(fs.existsSync(failedSession), true);

    const evidence = core.workflowPacket(root, {
      ...base,
      product: {
        title: "Evidence Product",
        summary: "Product context derived from the existing repository.",
      },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(evidence.ok, true, evidence.error);
    assert.equal(evidence.approval.current_stage, "product");
    assert.equal(readJson(path.join(root, "cadre", "product.json")).title, "Evidence Product");
    assert.match(fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8"), /# Evidence Product/);
    assert.equal(fs.existsSync(placeholderSession), false);
    assert.equal(fs.existsSync(failedSession), false);
    assert.equal(
      fs.existsSync(path.join(root, "cadre", "local", "approval-sessions", `${evidence.approval.session_id}.json`)),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup supersedes an untouched tracked legacy preview without changing HEAD", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-tracked-placeholder-recovery-test-"));
  try {
    git(root, ["init"]);
    const legacy = seedLegacySetupPlaceholder(root, { tracked: true });
    const headBefore = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    const evidence = core.workflowPacket(root, {
      workflow: "setup",
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      styleGuideIds: [],
      integrations: {},
      product: { title: "Evidence Product", summary: "Repository-grounded context." },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(evidence.ok, true, evidence.error);
    assert.equal(readJson(path.join(root, "cadre", "product.json")).title, "Evidence Product");
    assert.equal(git(root, ["rev-parse", "HEAD"]).stdout.trim(), headBefore);
    for (const sessionId of [legacy.placeholderSessionId, legacy.failedSessionId]) {
      assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`)), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup preserves edited template previews instead of claiming Cadre ownership", () => {
  for (const relativePath of ["cadre/product.json", "cadre/product.md"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-placeholder-drift-test-"));
    try {
      git(root, ["init"]);
      const base = {
        workflow: "setup",
        providerMode: "local",
        syncMode: "local",
        setupLsp: false,
        styleGuideIds: [],
        integrations: {},
      };
      const legacy = seedLegacySetupPlaceholder(root);
      const edited = path.join(root, relativePath);
      if (relativePath.endsWith(".json")) {
        const product = readJson(edited);
        write(edited, `${JSON.stringify({ ...product, user_note: "Keep this edit" }, null, 2)}\n`);
      } else {
        fs.appendFileSync(edited, "\nUser-authored review note.\n");
      }
      const before = new Map([
        ["cadre/product.json", fs.readFileSync(path.join(root, "cadre", "product.json"), "utf8")],
        ["cadre/product.md", fs.readFileSync(path.join(root, "cadre", "product.md"), "utf8")],
      ]);

      const evidence = core.workflowPacket(root, {
        ...base,
        product: { title: "Evidence Product", summary: "Repository-grounded context." },
        techStack: { languages: ["TypeScript"] },
      });
      assert.equal(evidence.ok, false);
      assert.equal(evidence.stage, "staged_approval");
      assert.match(evidence.error, new RegExp(relativePath.replace(".", "\\.")));
      for (const [file, content] of before) {
        assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file);
      }
      assert.equal(
        fs.existsSync(path.join(root, "cadre", "local", "approval-sessions", `${legacy.placeholderSessionId}.json`)),
        true,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("setup preserves staged or committed legacy previews and their owning sessions", () => {
  for (const mode of ["staged", "committed", "tracked-committed"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `cadre-setup-placeholder-${mode}-test-`));
    try {
      git(root, ["init"]);
      const legacy = seedLegacySetupPlaceholder(root, { tracked: mode === "tracked-committed" });
      git(root, ["add", "--", "cadre/product.json"]);
      if (mode !== "staged") git(root, ["commit", "-m", "keep reviewed placeholder"]);
      const beforeFiles = new Map(legacy.files.map((file) => [file.path, fs.readFileSync(path.join(root, file.path), "utf8")]));
      const beforeIndex = git(root, ["diff", "--cached", "--binary"]).stdout;

      const evidence = core.workflowPacket(root, {
        workflow: "setup",
        providerMode: "local",
        syncMode: "local",
        setupLsp: false,
        styleGuideIds: [],
        integrations: {},
        product: { title: "Evidence Product", summary: "Repository-grounded context." },
        techStack: { languages: ["TypeScript"] },
      });
      assert.equal(evidence.ok, false);
      assert.equal(evidence.stage, "staged_approval");
      assert.match(evidence.error, mode === "staged" ? /staged Git content.*cadre\/product\.json/ : /committed.*cadre\/product\.json/);
      for (const [file, content] of beforeFiles) {
        assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, file);
      }
      assert.equal(git(root, ["diff", "--cached", "--binary"]).stdout, beforeIndex);
      for (const sessionId of [legacy.placeholderSessionId, legacy.failedSessionId]) {
        assert.equal(fs.existsSync(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`)), true);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("setup consumes snake-case tech stack and style-guide selections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-setup-snake-alias-test-"));
  try {
    git(root, ["init"]);
    const preview = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      providerMode: "local",
      syncMode: "local",
      setupLsp: false,
      style_guide_ids: ["python"],
      integrations: ["code_search"],
      product: { title: "Alias Product", summary: "Validate supported setup aliases." },
      tech_stack: { languages: ["Python"] },
    });
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.approval.approval_complete, true);
    assert.deepEqual(preview.styleGuides.requested, ["python"]);
    assert.equal(preview.native_prompts.some((prompt) => prompt.id === "setup-style-guides"), false);
    assert.equal(readJson(path.join(root, "cadre", "tech-stack.json")).languages[0], "Python");
    assert.equal(fs.existsSync(path.join(root, "cadre", "styleguides", "python.json")), true);
    assert.deepEqual(readJson(path.join(root, "cadre", "config.json")).integrations, { code_search: { selected: true } });
    const inventoryEntry = core.integrationInventory(root).optional_mcps.find((entry) => entry.kind === "code_search");
    assert.equal(inventoryEntry.configured, true);
    assert.equal(inventoryEntry.available, null);
    assert.equal(inventoryEntry.source, "config.integrations.code_search");
    const readinessEntry = core.mcpReadiness(root).optional_mcps.find((entry) => entry.kind === "code_search");
    assert.equal(readinessEntry.configured, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("non-committing staged completion records a compact approval event and clears intent-to-add", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-approval-audit-test-"));
  try {
    git(root, ["init"]);
    const result = approveWorkflow(root, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      commitMode: "off",
      providerMode: "local",
      setupLsp: false,
      styleGuideIds: ["general"],
      product: { title: "Audit Product", summary: "Record approval hashes only." },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(git(root, ["diff", "--cached"]).stdout, "");
    const events = fs.readFileSync(path.join(root, "cadre", "events.jsonl"), "utf8").trim().split(/\n/).map(JSON.parse);
    const approvalEvent = events.find((event) => event.kind === "approval.completed");
    assert.ok(approvalEvent);
    assert.ok(approvalEvent.approved_documents.includes("product"));
    assert.ok(approvalEvent.documents.every((document) => document.sha256 && !Object.prototype.hasOwnProperty.call(document, "content")));
    assert.equal(fs.readdirSync(path.join(root, "cadre", "local", "approval-sessions")).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("projection registry covers every canonical pair and atomic writes roll back both files", () => {
  const expected = new Map([
    ["product", ["cadre/product.json", "cadre/product.md"]],
    ["product-guidelines", ["cadre/product_guidelines.json", "cadre/product_guidelines.md"]],
    ["tech-stack", ["cadre/tech-stack.json", "cadre/tech-stack.md"]],
    ["workflow", ["cadre/workflow.json", "cadre/workflow.md"]],
    ["repository-topology", ["cadre/repos.json", "cadre/repos.md"]],
    ["patterns", ["cadre/patterns.jsonl", "cadre/patterns.md"]],
    ["styleguide-catalog", ["cadre/styleguides/index.json", "cadre/styleguides/README.md"]],
    ["styleguide", ["cadre/styleguides/{id}.json", "cadre/styleguides/{id}.md"]],
    ["track-specification", ["cadre/tracks/{trackId}/spec.json", "cadre/tracks/{trackId}/spec.md"]],
    ["track-plan", ["cadre/tracks/{trackId}/plan.json", "cadre/tracks/{trackId}/plan.md"]],
    ["track-learnings", ["cadre/tracks/{trackId}/learnings.jsonl", "cadre/tracks/{trackId}/learnings.md"]],
    ["track-handoff", ["cadre/tracks/{trackId}/handoff.json", "cadre/tracks/{trackId}/HANDOFF.md"]],
    ["release", ["cadre/releases/{version}.json", "cadre/releases/{version}.md"]],
    ["project-skill", ["cadre/skills/{id}/skill.json", "cadre/skills/{id}/SKILL.md"]],
  ]);
  assert.equal(core.PROJECTION_REGISTRY.length, expected.size);
  for (const registration of core.PROJECTION_REGISTRY) {
    assert.deepEqual([registration.canonical, registration.projection], expected.get(registration.intent), registration.intent);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-atomic-pair-test-"));
  try {
    write(path.join(root, "pair.json"), "old canonical\n");
    write(path.join(root, "pair.md"), "old projection\n");
    const failed = core.writeArtifactFilesAtomic(root, [
      { path: "pair.json", content: "new canonical\n" },
      { path: "pair.md", content: "new projection\n" },
    ], { simulateFailureAfter: 1 });
    assert.equal(failed.ok, false);
    assert.equal(failed.rolled_back, true);
    assert.equal(fs.readFileSync(path.join(root, "pair.json"), "utf8"), "old canonical\n");
    assert.equal(fs.readFileSync(path.join(root, "pair.md"), "utf8"), "old projection\n");
    const temporaryFiles = fs.readdirSync(root, { recursive: true }).map(String).filter((file) => file.includes(".cadre-tmp"));
    assert.deepEqual(temporaryFiles, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflowPacket exposes packet-only routes for primary workflows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-workflow-test-"));
  const setupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-workflow-setup-test-"));
  const oldPath = process.env.PATH;
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "workflow@example.com"]);
    git(root, ["config", "user.name", "Workflow Test"]);
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    writeTrack(root, "workflow_20260618", samplePlan("workflow_20260618"), {
      status: "in_progress",
      owner: "workflow@example.com",
    });
    writeTrack(root, "done_20260618", samplePlan("done_20260618"), {
      status: "completed",
    });

    const setup = approveWorkflow(setupRoot, {
      workflow: "setup",
      execute: true,
      approvalComplete: true,
      product: { title: "Product", summary: "Test product" },
      techStack: { languages: ["TypeScript"] },
    });
    assert.equal(setup.ok, true);
    assert.equal(setup.packet_only, true);
    assert.ok(setup.written.includes("cadre/setup_state.json"));
    assert.equal(fs.existsSync(path.join(setupRoot, "cadre", "workflow.md")), true);

    const draft = core.workflowPacket(root, {
      workflow: "newtrack",
      trackId: "draft_20260618",
      spec: sampleSpec("spec"),
      plan: samplePlan("draft_20260618"),
    });
    assert.equal(draft.ok, true);
    assert.equal(draft.dry_run, true);
    assert.equal(draft.packet_only, true);

    for (const [workflow, args] of [
      ["implement", { trackId: "workflow_20260618" }],
      ["status", { mode: "fleet" }],
      ["review", { trackId: "workflow_20260618", includeLsp: false }],
      ["validate", { trackId: "workflow_20260618" }],
      ["archive", { trackId: "done_20260618" }],
      ["handoff", { trackId: "workflow_20260618" }],
      ["ship", { trackId: "workflow_20260618" }],
      ["land", { trackId: "workflow_20260618" }],
      ["release", {}],
      ["revise", { trackId: "workflow_20260618" }],
      ["refresh", {}],
      ["flag", { trackId: "workflow_20260618", status: "blocked", reason: "waiting for credentials" }],
      ["revert", { trackId: "workflow_20260618" }],
      ["formula", {}],
      ["artifacts", { scope: "track:workflow_20260618" }],
      ["artifact_sync", { scope: "track:workflow_20260618" }],
    ]) {
      const result = core.workflowPacket(root, { workflow, ...args });
      assert.equal(result.packet_only, true, `expected ${workflow} to be packet-only`);
      assert.equal(result.workflow, workflow);
      assert.equal(/Unknown Cadre workflow packet/.test(String(result.error || "")), false);
    }

    const handoffBlocked = core.workflowPacket(root, {
      workflow: "handoff",
      trackId: "workflow_20260618",
      handoffText: "# Handoff\n\nThe implementation track is active and waiting on credential access. Resume by validating the credential flow, then run the project test command before completing the task.\n",
      execute: true,
      reviewBundleDir: ".handoff-review",
    });
    assert.equal(handoffBlocked.ok, false);
    assert.equal(handoffBlocked.stage, "staged_approval");
    const handoffArtifact = handoffBlocked.review_artifacts.find((artifact) => artifact.path === "cadre/tracks/workflow_20260618/handoff.json");
    assert.ok(handoffArtifact);
    assert.equal(Object.prototype.hasOwnProperty.call(handoffArtifact, "content"), false);
    assert.equal(handoffBlocked.review_bundle.content_in_response, false);
    assert.ok(fs.existsSync(path.join(handoffBlocked.review_bundle.directory, "cadre", "tracks", "workflow_20260618", "handoff.json")));
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "workflow_20260618", "HANDOFF.md")), false);

    const handoff = approveWorkflow(root, {
      workflow: "handoff",
      trackId: "workflow_20260618",
      handoffText: "# Handoff\n\nThe implementation track is active and waiting on credential access. Resume by validating the credential flow, then run the project test command before completing the task.\n",
      execute: true,
      approvalComplete: true,
      force: true,
    });
    assert.equal(handoff.ok, true);
    assert.equal(handoff.phase_state, "executed");
    assert.match(fs.readFileSync(path.join(root, "cadre", "tracks", "workflow_20260618", "HANDOFF.md"), "utf8"), /validating the credential flow/);

    const archived = core.workflowPacket(root, {
      workflow: "archive",
      trackId: "done_20260618",
      execute: true,
    });
    assert.equal(archived.ok, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "archive", "done_20260618")), true);

    const flag = core.workflowPacket(root, {
      workflow: "flag",
      trackId: "workflow_20260618",
      status: "blocked",
      reason: "waiting for credentials",
      execute: true,
    });
    let metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "workflow_20260618", "metadata.json"), "utf8"));
    assert.equal(flag.ok, true);
    assert.equal(flag.dry_run, false);
    metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "workflow_20260618", "metadata.json"), "utf8"));
    assert.equal(metadata.status, "blocked");
    assert.equal(metadata.last_status_reason, "waiting for credentials");
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(setupRoot, { recursive: true, force: true });
  }
});

test("archive rewrites generated marker paths and rolls the move back on projection conflict", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-archive-pair-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "archive_ok_20260713", samplePlan("archive_ok_20260713"), { status: "completed" });
    const archived = core.workflowPacket(root, { workflow: "archive", trackId: "archive_ok_20260713", execute: true, commitMode: "off" });
    assert.equal(archived.ok, true, archived.error);
    const archivedPlan = fs.readFileSync(path.join(root, "cadre", "archive", "archive_ok_20260713", "plan.md"), "utf8");
    assert.match(archivedPlan, /from="cadre\/archive\/archive_ok_20260713\/plan\.json"/);
    assert.match(archivedPlan, /projection="cadre\/archive\/archive_ok_20260713\/plan\.md"/);
    assert.match(archivedPlan, /canonical_hash="[a-f0-9]+"/);

    writeTrack(root, "archive_conflict_20260713", samplePlan("archive_conflict_20260713"), { status: "completed" });
    write(path.join(root, "cadre", "tracks", "archive_conflict_20260713", "plan.md"), "# User-owned plan\n");
    const conflict = core.workflowPacket(root, { workflow: "archive", trackId: "archive_conflict_20260713", execute: true, commitMode: "off" });
    assert.equal(conflict.ok, false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "archive_conflict_20260713")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "archive", "archive_conflict_20260713")), false);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tracks", "archive_conflict_20260713", "plan.md"), "utf8"), "# User-owned plan\n");
    assert.equal(conflict.archived[0].move_rollback.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviewAssist and lspImpact provide fallback review context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-review-assist-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Cadre Test"]);
    writeTrack(root, "review_20260617", samplePlan("review_20260617"));
    write(path.join(root, "src", "core.js"), "function exportedCore() {\n  // TODO finish behavior\n  return true;\n}\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "init"]);

    const assist = core.reviewAssist(root, {
      trackId: "review_20260617",
      base: "HEAD",
      head: "HEAD",
      includeLsp: false,
    });
    assert.equal(assist.ok, true);
    assert.equal(assist.suggested_verdict, "changes_requested");
    assert.ok(assist.blocking_reasons.some((reason) => reason.includes("plan task")));

    const impact = core.lspImpact(root, {
      symbol: "exportedCore",
      files: ["src/core.js"],
      limit: 10,
    });
    assert.equal(impact.ok, true);
    assert.ok(impact.symbols.exportedCore.matches.length >= 1);
    assert.ok(impact.files["src/core.js"].some((symbol) => symbol.name === "exportedCore"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflowPacket compact responses trim heavy plan detail and expose resource URIs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-response-mode-test-"));
  try {
    git(root, ["init"]);
    writeTrack(root, "compact_20260618", samplePlan("compact_20260618"));

    const compact = core.workflowPacket(root, {
      workflow: "review",
      trackId: "compact_20260618",
      includeLsp: false,
      includeMachine: false,
    });
    assert.equal(compact.response_mode, "compact");
    assert.ok(compact.resource_uris.some((uri) => uri.includes("quality-gate")));
    assert.ok(compact.resource_uris.some((uri) => uri.includes("review-evidence")));
    assert.equal(compact.resource_uris.some((uri) => uri.includes("workspace-health")), false);
    assert.equal(typeof compact.track_context.plan.phases, "number");

    const detail = core.workflowPacket(root, {
      workflow: "review",
      trackId: "compact_20260618",
      includeLsp: false,
      includeMachine: false,
      responseMode: "detail",
    });
    assert.equal(detail.response_mode, "detail");
    assert.ok(Array.isArray(detail.track_context.plan.phases));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo intel aggregates repo-qualified diagnostics and symbols", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-intel-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "api",
      repos: [
        { name: "api", submodule_path: "repos/api", enabled: true },
        { name: "web", submodule_path: "repos/web", enabled: true },
      ],
    }, null, 2));
    for (const repo of ["api", "web"]) {
      const repoRoot = path.join(root, "repos", repo);
      fs.mkdirSync(repoRoot, { recursive: true });
      git(repoRoot, ["init"]);
      write(path.join(repoRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
      write(path.join(repoRoot, "src", `${repo}.ts`), `export function ${repo}Symbol() { return true; }\n`);
      git(repoRoot, ["add", "."]);
    }

    const map = core.repoMap(root, { limit: 20 });
    assert.equal(map.ok, true);
    assert.ok(map.repos.some((entry) => entry.repo === "api"));
    assert.ok(map.symbols.some((symbol) => symbol.repo === "api" && symbol.name === "apiSymbol"));

    const diagnostics = core.workspaceDiagnostics(root);
    assert.ok(diagnostics.adapters.some((adapter) => adapter.repo === "web" && adapter.id === "node"));

    const graph = core.dependencyGraph(root);
    assert.ok(graph.manifests.some((manifest) => manifest.repo === "api" && manifest.file === "package.json"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace diagnostics, test impact, and dependency graph expose polyglot evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-intel-graph-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "package.json"), JSON.stringify({
      scripts: {
        test: "node --test",
        typecheck: "tsc --noEmit",
      },
      devDependencies: {
        nx: "1.0.0",
      },
    }, null, 2));
    write(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    write(path.join(root, "nx.json"), "{}\n");
    write(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    write(path.join(root, "go.mod"), "module example.com/app\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.test.ts"), "test('app', () => {});\n");
    git(root, ["add", "."]);

    const diagnostics = core.workspaceDiagnostics(root);
    assert.equal(diagnostics.ok, true);
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "node"));
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "pytest"));
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "go"));
    assert.ok(diagnostics.adapters.some((adapter) => adapter.id === "nx"));
    assert.ok(diagnostics.commands.some((command) => command.command === "pnpm test"));

    const impact = core.testImpact(root, { files: ["src/app.ts"] });
    assert.equal(impact.ok, true);
    assert.deepEqual(impact.likely_tests["src/app.ts"], ["src/app.test.ts"]);
    assert.ok(impact.manifests.includes("package.json"));

    const graph = core.dependencyGraph(root);
    assert.equal(graph.ok, true);
    assert.ok(graph.manifests.some((manifest) => manifest.file === "package.json"));
    assert.ok(graph.edges.some((edge) => edge.from === "package.json"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("providerEvidence persists structured review evidence and metadata pointer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-review-evidence-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "reviewer@example.com"]);
    git(root, ["config", "user.name", "Reviewer"]);
    writeTrack(root, "evidence_20260617", samplePlan("evidence_20260617"), {
      owner: "owner@example.com",
    });

    const recorded = core.providerEvidence(root, {
      trackId: "evidence_20260617",
      provider: "github",
      reviewer: "reviewer@example.com",
      fetch: false,
      findings: [
        { id: "finding-1", severity: "blocking", message: "Needs a test" },
        { id: "finding-2", severity: "warning", message: "Polish naming" },
      ],
      evidence: { pr: 42, checks: "pending" },
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.entry.blocking_count, 1);

    const evidence = core.reviewEvidence(root, "evidence_20260617");
    assert.equal(evidence.ok, true);
    assert.equal(evidence.evidence.entries.length, 1);
    assert.equal(evidence.evidence.entries[0].provider, "github");

    const metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "evidence_20260617", "metadata.json"), "utf8"));
    assert.equal(metadata.review_evidence.path, "cadre/tracks/evidence_20260617/review-evidence.json");
    assert.equal(metadata.review_evidence.blocking_count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("provider status is provider-MCP-only and local mode skips provider evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-provider-contract-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), JSON.stringify({ provider_mode: "github", provider_mcp_required: true }, null, 2));
    writeTrack(root, "provider_20260618", samplePlan("provider_20260618"), {
      owner: "owner@example.com",
      review: {
        verdict: "approved",
        blocking_count: 0,
        reviewed_sha: "abc1234",
      },
    });

    const required = core.prCiStatus(root, {
      trackId: "provider_20260618",
      prNumber: 42,
    });
    assert.equal(required.ok, false);
    assert.equal(required.provider, "github");
    assert.equal(required.required_provider_mcp.provider, "github");
    assert.equal(required.required_evidence.kind, "github_pull_request_status");
    assert.match(required.reason, /CLI fallback is disabled/);
    assert.match(required.unsupported_reason, /provider_mode github requires github MCP evidence/);

    const review = core.workflowPacket(root, {
      workflow: "review",
      trackId: "provider_20260618",
      includeLsp: false,
      includeMachine: false,
      responseMode: "detail",
      prNumber: 42,
    });
    assert.equal(review.ok, true);
    assert.equal(review.phase_state, "pending_provider");
    assert.equal(review.response_mode, "detail");
    assert.equal(review.required_provider_mcp.provider, "github");
    assert.match(review.unsupported_reason, /provider_mode github requires github MCP evidence/);

    const reviewV1 = core.workflowPacketV1(root, {
      workflow: "review",
      trackId: "provider_20260618",
      includeLsp: false,
      includeMachine: false,
      prNumber: 42,
    });
    assert.deepEqual(reviewV1.required, ["providerEvidence"]);
    assert.equal(reviewV1.next, null);
    assert.equal(reviewV1.decision.kind, "provider_evidence");
    assert.equal(reviewV1.decision.required.write_back.tool, "cadre_action");
    assert.equal(reviewV1.decision.required.write_back.arguments.action, "review.provider_evidence");
    assert.equal(reviewV1.decision.required.write_back.arguments.input.providerEvidence, "<github-mcp-evidence>");

    const supplied = core.prCiStatus(root, {
      trackId: "provider_20260618",
      providerEvidence: { url: "https://github.com/org/app/pull/42", state: "OPEN", status_checks: "SUCCESS" },
    });
    assert.equal(supplied.ok, true);
    assert.equal(supplied.evidence_source, "github_mcp");

    write(path.join(root, "cadre", "config.json"), JSON.stringify({ provider_mode: "local", provider_mcp_required: false }, null, 2));
    const local = core.prCiStatus(root, {
      trackId: "provider_20260618",
      prNumber: 42,
    });
    assert.equal(local.ok, true);
    assert.equal(local.skipped, true);
    assert.equal(local.provider_mode, "local");
    assert.match(local.reason, /no provider MCP evidence required/);

    write(path.join(root, "cadre", "config.json"), JSON.stringify({ provider_mode: "github", provider_mcp_required: true }, null, 2));
    const shipPlan = core.workflowPacket(root, {
      workflow: "ship",
      trackId: "provider_20260618",
    });
    assert.equal(shipPlan.phase_state, "pending_provider");
    assert.equal(shipPlan.provider_actions.length, 1);
    assert.equal(shipPlan.provider_actions[0].provider, "github");
    assert.equal(shipPlan.git_actions.some((action) => action.kind === "push_branch"), true);
    assert.ok(shipPlan.continuation_token);

    const shipWithEvidence = core.workflowPacket(root, {
      workflow: "ship",
      trackId: "provider_20260618",
      providerEvidence: { url: "https://github.com/org/app/pull/42", state: "OPEN", status_checks: "SUCCESS" },
    });
    assert.equal(shipWithEvidence.ok, true);
    assert.equal(shipWithEvidence.phase_state, "ready");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("provider evidence write-back requires caller-supplied MCP evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-provider-writeback-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "config.json"), JSON.stringify({ provider_mode: "gitlab", provider_mcp_required: true }, null, 2));
    writeTrack(root, "writeback_20260618", samplePlan("writeback_20260618"), {
      owner: "owner@example.com",
    });

    const blocked = core.providerEvidence(root, {
      trackId: "writeback_20260618",
      provider: "gitlab",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.stage, "provider_mcp_evidence_required");
    assert.equal(fs.existsSync(path.join(root, "cadre", "tracks", "writeback_20260618", "review-evidence.json")), false);

    const recorded = core.providerEvidence(root, {
      trackId: "writeback_20260618",
      provider: "gitlab",
      evidence: { url: "https://gitlab.com/org/app/-/merge_requests/7", pipeline_status: "success", approvals: "approved" },
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.entry.provider, "gitlab");
    assert.deepEqual(recorded.entry.evidence, {
      url: "https://gitlab.com/org/app/-/merge_requests/7",
      pipeline_status: "success",
      approvals: "approved",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo reviewAssist, machine gate, and review records are repo-aware", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-review-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "owner@example.com"]);
    git(root, ["config", "user.name", "Owner"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({ mode: "polyrepo", default_repo: "app" }, null, 2));

    const appRoot = path.join(root, "repos", "app");
    fs.mkdirSync(appRoot, { recursive: true });
    git(appRoot, ["init"]);
    git(appRoot, ["config", "user.email", "app@example.com"]);
    git(appRoot, ["config", "user.name", "App"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() {\n  return true;\n}\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "initial app"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() {\n  // TODO verify edge case\n  return true;\n}\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "feature app"]);
    const appHead = git(appRoot, ["rev-parse", "HEAD"]).stdout.trim();

    const plan = `# Plan: poly_20260617

## Phase 1: App

- [x] Task 1: Update app
  <!-- repo: app -->
  <!-- files: src/app.js -->
`;
    writeTrack(root, "poly_20260617", plan, {
      owner: "owner@example.com",
      last_coverage: 91,
      repos: {
        app: {
          submodule_path: "repos/app",
          git_branch: "HEAD",
          base_branch: "HEAD~1",
        },
      },
    });

    const assist = core.reviewAssist(root, {
      trackId: "poly_20260617",
      includeLsp: false,
      includeMachine: false,
      todoLimit: 10,
    });
    assert.equal(assist.ok, true);
    const appDiff = assist.repo_diffs.find((entry) => entry.repo === "app");
    assert.ok(appDiff);
    assert.ok(appDiff.files.includes("src/app.js"));
    assert.ok(assist.todos.some((todo) => todo.repo === "app" && todo.file === "src/app.js"));

    const machine = core.reviewMachineGate(root, {
      trackId: "poly_20260617",
      machineCommand: "node -e \"process.exit(0)\"",
    });
    assert.equal(machine.ok, true);
    assert.equal(machine.available, true);
    assert.equal(machine.results[0].repo, "app");

    const review = core.recordReview(root, {
      trackId: "poly_20260617",
      verdict: "approved",
      reviewer: "reviewer@example.com",
    });
    assert.equal(review.ok, true);
    assert.equal(review.review.reviewed_shas.app, appHead);

    const matchingGate = core.reviewGate(root, "poly_20260617", {
      headSha: "control-without-review-pin",
      headShas: { app: appHead },
    });
    assert.equal(matchingGate.ok, true);

    const staleGate = core.reviewGate(root, "poly_20260617", {
      headShas: { app: "0000000" },
    });
    assert.equal(staleGate.ok, false);
    assert.ok(staleGate.reasons.some((reason) => reason.includes("reviewed_shas.app")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo land plans provider actions and repo-scoped git pushes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-land-plan-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "owner@example.com"]);
    git(root, ["config", "user.name", "Owner"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "app",
      repos: [
        { name: "app", submodule_path: "repos/app", default_branch: "main", enabled: true },
      ],
    }, null, 2));
    write(path.join(root, "cadre", "config.json"), JSON.stringify({
      provider_mode: "github",
      provider_mcp_required: true,
    }, null, 2));
    fs.mkdirSync(path.join(root, "repos", "app"), { recursive: true });
    git(path.join(root, "repos", "app"), ["init"]);

    writeTrack(root, "land_20260618", planFromPhases("land_20260618", [
      { phase_index: 1, title: "Phase 1: App", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Update app", ["src/app.js"], { status: "completed", repo: "app" })] },
    ]), {
      owner: "owner@example.com",
      review: {
        verdict: "approved",
        blocking_count: 0,
        reviewed_shas: { app: "abc1234" },
      },
      repos: {
        app: {
          submodule_path: "repos/app",
          git_branch: "track/land_20260618",
          base_branch: "main",
        },
      },
    });

    const land = core.workflowPacket(root, {
      workflow: "land",
      trackId: "land_20260618",
    });
    assert.equal(land.phase_state, "pending_provider");
    assert.equal(land.topology, "polyrepo");
    assert.equal(land.preflight.ok, true);
    assert.equal(land.provider_actions.length, 1);
    assert.equal(land.provider_actions[0].repo, "app");
    assert.ok(land.git_actions.some((action) => action.repo === "app" && action.cwd.endsWith(path.join("repos", "app"))));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("polyrepo workflows fail closed on unresolved task repos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-missing-repo-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({ mode: "polyrepo", default_repo: "app" }, null, 2));
    write(path.join(root, "cadre", "config.json"), JSON.stringify({
      coverage_command: "node -e \"require('fs').writeFileSync('coverage-ran.txt','yes')\"",
      machine_gate_command: "node -e \"process.exit(0)\"",
    }, null, 2));
    fs.mkdirSync(path.join(root, "repos", "app"), { recursive: true });

    const plan = planFromPhases("missing_repo_20260617", [
      {
        phase_index: 1,
        title: "Phase 1: App",
        execution_mode: "sequential",
        depends_on: [],
        tasks: [
          planTask(1, 1, "Update ghost repo", ["src/app.js"], {
            status: "completed",
            repo: "ghost",
          }),
        ],
      },
    ]);
    writeTrack(root, "missing_repo_20260617", plan, {
      owner: "owner@example.com",
      last_coverage: 91,
      repos: {
        app: {
          submodule_path: "repos/app",
          git_branch: "HEAD",
          base_branch: "main",
        },
      },
    });

    const integrity = core.planIntegrity(root, "missing_repo_20260617");
    assert.equal(integrity.ok, false);
    assert.ok(integrity.errors.some((error) => error.repo === "ghost"));

    const schedule = core.phaseSchedule(root, { trackId: "missing_repo_20260617" });
    assert.equal(schedule.ok, false);
    assert.ok(schedule.errors.some((error) => error.repo === "ghost"));

    const completion = core.completeTask(root, {
      trackId: "missing_repo_20260617",
      phaseIndex: 1,
      taskIndex: 1,
    });
    assert.equal(completion.ok, false);
    assert.equal(completion.stage, "polyrepo_repo_resolution");
    assert.equal(fs.existsSync(path.join(root, "coverage-ran.txt")), false);

    const coverage = core.testCoverage(root, {
      trackId: "missing_repo_20260617",
      phaseIndex: 1,
      taskIndex: 1,
    });
    assert.equal(coverage.ok, false);
    assert.equal(coverage.stage, "polyrepo_repo_resolution");

    const assist = core.reviewAssist(root, {
      trackId: "missing_repo_20260617",
      includeLsp: false,
      includeMachine: false,
    });
    assert.equal(assist.ok, false);
    assert.equal(assist.stage, "polyrepo_repo_resolution");

    const machine = core.reviewMachineGate(root, {
      trackId: "missing_repo_20260617",
    });
    assert.equal(machine.ok, false);
    assert.equal(machine.stage, "polyrepo_repo_resolution");

    const review = core.recordReview(root, {
      trackId: "missing_repo_20260617",
      verdict: "approved",
      reviewer: "reviewer@example.com",
    });
    assert.equal(review.ok, false);
    assert.equal(review.stage, "polyrepo_repo_resolution");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow revert, release, and refresh execute packet-owned local changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-execute-workflows-test-"));
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "owner@example.com"]);
    git(root, ["config", "user.name", "Owner"]);
    write(path.join(root, "cadre", "setup_state.json"), JSON.stringify({ version: 1 }, null, 2));
    const patternsSeed = { id: "initial", kind: "patterns_seed", text: "# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n" };
    write(path.join(root, "cadre", "patterns.jsonl"), `${JSON.stringify(patternsSeed)}\n`);
    write(path.join(root, "cadre", "patterns.md"), "<!-- cadre:generated from=\"cadre/patterns.jsonl\" schema=\"cadre.patterns.v1\" hash=\"test\" -->\n# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n");
    write(path.join(root, "src", "app.js"), "module.exports = 1;\n");
    git(root, ["add", "src/app.js"]);
    git(root, ["commit", "-m", "initial"]);
    write(path.join(root, "src", "app.js"), "module.exports = 2;\n");
    git(root, ["add", "src/app.js"]);
    git(root, ["commit", "-m", "feature"]);
    const sha = git(root, ["rev-parse", "--short=12", "HEAD"]).stdout.trim();

    writeTrack(root, "execute_20260618", planFromPhases("execute_20260618", [
      { phase_index: 1, title: "Phase 1: Change", execution_mode: "sequential", depends_on: [], tasks: [planTask(1, 1, "Change app", ["src/app.js"], { status: "completed", commit_shas: [sha] })] },
    ]), {
      status: "completed",
      review: {
        verdict: "approved",
        blocking_count: 0,
        reviewed_sha: sha,
      },
    });

    const revert = core.workflowPacket(root, {
      workflow: "revert",
      execute: true,
      trackId: "execute_20260618",
      reason: "test revert",
    });
    assert.equal(revert.ok, true);
    assert.equal(revert.phase_state, "executed");
    assert.equal(revert.git_results[0].ok, true);
    let metadata = JSON.parse(fs.readFileSync(path.join(root, "cadre", "tracks", "execute_20260618", "metadata.json"), "utf8"));
    assert.equal(metadata.status, "in_progress");
    assert.equal(metadata.last_revert.reason, "test revert");

    const releaseBlocked = core.workflowPacket(root, {
      workflow: "release",
      execute: true,
      createTag: true,
      releaseVersion: "v1.2.3",
      releaseNotes: "# Release v1.2.3\n\n## Highlights\n\nPrepare the reviewed application change for publication.\n",
      reviewBundleDir: ".release-review",
    });
    assert.equal(releaseBlocked.ok, false);
    assert.equal(releaseBlocked.stage, "staged_approval");
    const releaseArtifact = releaseBlocked.review_artifacts.find((artifact) => artifact.path === "cadre/releases/v1.2.3.md");
    assert.ok(releaseArtifact);
    assert.equal(Object.prototype.hasOwnProperty.call(releaseArtifact, "content"), false);
    assert.equal(releaseBlocked.review_bundle.content_in_response, false);
    assert.ok(fs.existsSync(path.join(releaseBlocked.review_bundle.directory, "cadre", "releases", "v1.2.3.md")));
    assert.equal(fs.existsSync(path.join(root, "cadre", "releases", "v1.2.3.md")), false);
    assert.equal(git(root, ["tag", "-l", "v1.2.3"]).stdout.trim(), "");

    const release = approveWorkflow(root, {
      workflow: "release",
      execute: true,
      approvalComplete: true,
      createTag: true,
      releaseVersion: "v1.2.3",
      releaseNotes: "# Release v1.2.3\n\n## Highlights\n\nApproved custom notes.\n",
    });
    assert.equal(release.ok, true);
    assert.equal(release.phase_state, "executed");
    assert.equal(fs.existsSync(path.join(root, "cadre", "releases", "v1.2.3.md")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "releases", "v1.2.3.json")), true);
    assert.equal(git(root, ["tag", "-l", "v1.2.3"]).stdout.trim(), "v1.2.3");
    const approvedReleaseMarkdown = fs.readFileSync(path.join(root, "cadre", "releases", "v1.2.3.md"), "utf8");
    const releaseCanonical = readJson(path.join(root, "cadre", "releases", "v1.2.3.json"));
    assert.equal(releaseCanonical.release_notes_markdown, "# Release v1.2.3\n\n## Highlights\n\nApproved custom notes.\n");
    fs.rmSync(path.join(root, "cadre", "releases", "v1.2.3.md"));
    const regeneratedRelease = core.artifactPacket(root, { action: "sync", artifact: "release:v1.2.3", execute: true, commitMode: "off" });
    assert.equal(regeneratedRelease.ok, true, regeneratedRelease.error);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "releases", "v1.2.3.md"), "utf8"), approvedReleaseMarkdown);
    const setupState = JSON.parse(fs.readFileSync(path.join(root, "cadre", "setup_state.json"), "utf8"));
    assert.equal(setupState.last_release.version, "v1.2.3");

    const refreshArgs = {
      workflow: "refresh",
      refreshLevels: ["patterns", "lsp"],
      proposedContext: {
        patterns: {
          text: "# Codebase Patterns\n\n## Execution safety\n\nRefresh semantic documents from supplied repository evidence and execute the exact approved snapshot.",
        },
      },
    };
    const refreshBlocked = core.workflowPacket(root, {
      ...refreshArgs,
      execute: true,
      reviewBundleDir: ".refresh-review",
    });
    assert.equal(refreshBlocked.ok, false);
    assert.equal(refreshBlocked.stage, "staged_approval");
    assert.deepEqual(refreshBlocked.selected_levels, ["lsp", "patterns"]);
    assert.equal(refreshBlocked.refresh_analysis.kind, "cadre.refresh_analysis.v1");
    assert.equal(refreshBlocked.approval.current_stage, "technical");
    assert.deepEqual(refreshBlocked.review_artifacts.map((artifact) => artifact.path), ["cadre/lsp.json"]);
    assert.ok(fs.existsSync(path.join(refreshBlocked.review_bundle.directory, "cadre", "lsp.json")));
    assert.equal(fs.existsSync(path.join(refreshBlocked.review_bundle.directory, "cadre", "patterns.md")), false);
    assert.match(fs.readFileSync(path.join(root, "cadre", "patterns.md"), "utf8"), /Last refreshed: YYYY-MM-DD/);

    const refresh = approveWorkflow(root, {
      ...refreshArgs,
      execute: true,
      approvalComplete: true,
      force: true,
    });
    assert.equal(refresh.ok, true);
    assert.equal(refresh.phase_state, "executed");
    assert.deepEqual(refresh.selected_levels, ["lsp", "patterns"]);
    assert.deepEqual(refresh.refreshed_documents.selected.sort(), ["lsp", "patterns"]);
    assert.match(fs.readFileSync(path.join(root, "cadre", "patterns.jsonl"), "utf8"), /Last refreshed: \d{4}-\d{2}-\d{2}/);
    assert.match(fs.readFileSync(path.join(root, "cadre", "patterns.md"), "utf8"), /Last refreshed: \d{4}-\d{2}-\d{2}/);
    assert.equal(fs.existsSync(path.join(root, "cadre", "lsp.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("multi-level refresh collects and materializes only the active selected stage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-multi-level-refresh-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "setup_state.json"), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
    write(path.join(root, "src", "index.ts"), "export const ready = true;\n");
    const selectedLevels = [
      "product",
      "product-guidelines",
      "tech-stack",
      "style-guides",
      "repository-topology",
      "lsp",
      "workflow",
      "patterns",
    ];
    const stages = ["product", "product_guidelines", "technical", "workflow", "patterns"];
    const missingProduct = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: [...selectedLevels].reverse(),
      commitMode: "off",
    });
    const sessionId = missingProduct.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    assert.deepEqual(missingProduct.selected_levels, selectedLevels);
    assert.equal(missingProduct.approval.current_stage, "product");
    assert.deepEqual(missingProduct.missing_payload, ["proposedContext.product"]);
    assert.deepEqual(readJson(sessionFile).stage_order, stages);
    assert.ok(Object.values(readJson(sessionFile).stage_records).every((record) => record.snapshot_files.length === 0));

    const product = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      proposedContext: {
        product: { title: "Refresh Product", summary: "Evidence-backed brownfield product context." },
      },
    });
    assert.deepEqual(product.review_artifacts.map((artifact) => artifact.path).sort(), ["cadre/product.json", "cadre/product.md"]);
    for (const absent of ["product_guidelines.json", "tech-stack.json", "workflow.json", "patterns.jsonl", "repos.json", "lsp.json"]) {
      assert.equal(fs.existsSync(path.join(root, "cadre", absent)), false, absent);
    }

    const missingGuidelines = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "product",
      ...approvalStamp(product.approval),
      approvedStages: ["product"],
    });
    assert.equal(missingGuidelines.approval.session_id, sessionId);
    assert.equal(missingGuidelines.approval.current_stage, "product_guidelines");
    assert.deepEqual(missingGuidelines.missing_payload, ["proposedContext.productGuidelines"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "product_guidelines.json")), false);

    const guidelines = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      proposedContext: {
        productGuidelines: { title: "Refresh Guidelines", summary: "Keep reviewed refresh stages evidence-backed and recoverable." },
      },
    });
    assert.deepEqual(guidelines.review_artifacts.map((artifact) => artifact.path).sort(), [
      "cadre/product_guidelines.json",
      "cadre/product_guidelines.md",
    ]);

    const missingTechnical = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "product_guidelines",
      ...approvalStamp(guidelines.approval),
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(missingTechnical.approval.current_stage, "technical");
    assert.deepEqual(missingTechnical.missing_payload, ["proposedContext.techStack", "proposedContext.repos"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "tech-stack.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "lsp.json")), false);

    const technical = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      styleGuideIds: ["typescript"],
      proposedContext: {
        techStack: { languages: ["TypeScript"], runtimes: ["Node.js"] },
        repos: {
          mode: "polyrepo",
          default_repo: "application",
          repos: [{ name: "application", submodule_path: "repos/application", enabled: true }],
        },
      },
    });
    assert.equal(technical.ok, true, technical.error || JSON.stringify(technical.warnings || {}));
    assert.equal(technical.approval.current_stage, "technical");
    assert.deepEqual(technical.review_artifacts.map((artifact) => artifact.path).sort(), [
      "cadre/lsp.json",
      "cadre/repos.json",
      "cadre/repos.md",
      "cadre/styleguides/README.md",
      "cadre/styleguides/index.json",
      "cadre/styleguides/typescript.json",
      "cadre/styleguides/typescript.md",
      "cadre/tech-stack.json",
      "cadre/tech-stack.md",
    ]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "workflow.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "patterns.jsonl")), false);

    const missingWorkflow = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "technical",
      ...approvalStamp(technical.approval),
      approvedStages: ["product", "product_guidelines", "technical"],
    });
    assert.equal(missingWorkflow.approval.current_stage, "workflow");
    assert.deepEqual(missingWorkflow.missing_payload, ["proposedContext.workflowPolicy"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "workflow.json")), false);

    const workflow = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      proposedContext: {
        workflowPolicy: { title: "Refresh Workflow", summary: "Run focused validation after every approved refresh." },
      },
    });
    assert.deepEqual(workflow.review_artifacts.map((artifact) => artifact.path).sort(), ["cadre/workflow.json", "cadre/workflow.md"]);

    const missingPatterns = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "workflow",
      ...approvalStamp(workflow.approval),
      approvedStages: ["product", "product_guidelines", "technical", "workflow"],
    });
    assert.equal(missingPatterns.approval.current_stage, "patterns");
    assert.deepEqual(missingPatterns.missing_payload, ["proposedContext.patterns"]);
    assert.equal(fs.existsSync(path.join(root, "cadre", "patterns.jsonl")), false);

    const patterns = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      proposedContext: {
        patterns: { text: "# Codebase Patterns\n\n## Refresh\n\nGenerate only the active selected stage." },
      },
    });
    assert.deepEqual(patterns.review_artifacts.map((artifact) => artifact.path).sort(), ["cadre/patterns.jsonl", "cadre/patterns.md"]);
    const approvedSnapshots = Object.values(readJson(sessionFile).stage_records)
      .flatMap((record) => record.snapshot_files)
      .map((file) => ({ path: file.path, content: file.content }));

    const complete = core.workflowPacketV1(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "patterns",
      ...approvalStamp(patterns.approval),
      approvedStages: stages,
    });
    assert.deepEqual(complete.next, {
      tool: "cadre_workflow",
      arguments: {
        root,
        workflow: "refresh",
        input: {},
        execute: true,
        approval: { session_id: sessionId, approved_stages: stages, complete: true },
      },
    });
    const executed = core.workflowPacket(root, {
      workflow: "refresh",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: stages,
    });
    assert.equal(executed.ok, true, executed.error);
    for (const snapshot of approvedSnapshots) {
      assert.equal(fs.readFileSync(path.join(root, snapshot.path), "utf8"), snapshot.content, snapshot.path);
    }
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refresh tech-stack amendment preserves sibling context and replaces stale fields exactly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-refresh-tech-stack-replacement-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "setup_state.json"), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
    const preview = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: ["product", "product-guidelines", "tech-stack"],
      commitMode: "off",
      proposedContext: {
        product: { title: "Refresh product", summary: "Preserve approved product context." },
        productGuidelines: { title: "Refresh guidelines", summary: "Preserve approved guideline context." },
      },
      techStack: {
        languages: ["Swift"],
        frameworks: ["SwiftUI"],
        platforms: ["iOS"],
        styleGuideIds: ["swift"],
        notes: "Legacy mobile implementation",
      },
    });
    assert.equal(preview.approval.current_stage, "product");
    const sessionId = preview.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    const guidelines = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "product",
      ...approvalStamp(preview.approval),
      approvedStages: ["product"],
    });
    assert.equal(guidelines.approval.current_stage, "product_guidelines");
    const technical = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "product_guidelines",
      ...approvalStamp(guidelines.approval),
      approvedStages: ["product", "product_guidelines"],
    });
    assert.equal(technical.approval.current_stage, "technical");
    assert.match(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"), /SwiftUI/);
    const originalRevision = technical.approval.current_stage_revision;
    const originalHash = technical.approval.current_stage_hash;
    const originalPreview = fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8");
    const originalUpdatedAt = readJson(path.join(root, "cadre", "tech-stack.json")).updated_at;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
    const noOp = core.workflowPacket(root, { workflow: "refresh", approvalSessionId: sessionId });
    assert.equal(noOp.ok, true, noOp.error);
    assert.equal(noOp.approval.current_stage_revision, originalRevision);
    assert.equal(noOp.approval.current_stage_hash, originalHash);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"), originalPreview);

    const replacement = { languages: ["TypeScript"], frameworks: ["React"], runtimes: ["Node.js"] };
    const amended = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      proposed_context: { tech_stack: replacement },
    });
    assert.equal(amended.ok, true, amended.error);
    assert.equal(amended.approval.session_id, sessionId);
    assert.equal(amended.approval.current_stage_revision, originalRevision + 1);
    assert.deepEqual(amended.approval.approved_stages, ["product", "product_guidelines"]);
    const payload = readJson(sessionFile).payload.proposedContext;
    assert.equal(payload.product.title, "Refresh product");
    assert.equal(payload.productGuidelines.title, "Refresh guidelines");
    assert.deepEqual(payload.techStack, replacement);
    assert.equal(Object.prototype.hasOwnProperty.call(readJson(sessionFile).payload, "proposed_context"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(readJson(sessionFile).payload, "techStack"), false);
    const canonical = readJson(path.join(root, "cadre", "tech-stack.json"));
    assert.deepEqual(canonical.languages, ["TypeScript"]);
    assert.deepEqual(canonical.frameworks, ["React"]);
    assert.deepEqual(canonical.runtimes, ["Node.js"]);
    assert.equal(canonical.version, 1);
    assert.equal(canonical.schema, "cadre.tech_stack.v1");
    assert.notEqual(canonical.updated_at, originalUpdatedAt);
    for (const stale of ["platforms", "styleGuideIds", "notes"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(canonical, stale), false, stale);
    }
    for (const file of ["cadre/tech-stack.json", "cadre/tech-stack.md"]) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /Swift|SwiftUI|iOS|mobile/);
    }
    const amendedPreview = fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
    const amendedNoOp = core.workflowPacket(root, { workflow: "refresh", approvalSessionId: sessionId });
    assert.equal(amendedNoOp.ok, true, amendedNoOp.error);
    assert.equal(amendedNoOp.approval.current_stage_revision, amended.approval.current_stage_revision);
    assert.equal(amendedNoOp.approval.current_stage_hash, amended.approval.current_stage_hash);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"), amendedPreview);

    const approved = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "technical",
      ...approvalStamp(amended.approval),
      approvedStages: ["product", "product_guidelines", "technical"],
    });
    assert.equal(approved.ok, true, approved.error);
    const executed = core.workflowPacket(root, {
      workflow: "refresh",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["product", "product_guidelines", "technical"],
    });
    assert.equal(executed.ok, true, executed.error);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "cadre", "tech-stack.json"), "utf8"), /Swift|SwiftUI|iOS|mobile/);
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refresh repository-topology aliases replace the same session artifact exactly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-refresh-topology-replacement-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "setup_state.json"), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
    const initial = core.workflowPacket(root, {
      workflow: "refresh",
      refreshLevels: ["repository-topology"],
      commitMode: "off",
      repositoryTopology: { mode: "monorepo", default_repo: ".", marker: "stale-old" },
    });
    assert.equal(initial.ok, true, initial.error);
    assert.equal(initial.approval.current_stage, "technical");
    const sessionId = initial.approval.session_id;
    const sessionFile = path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`);
    assert.equal(readJson(path.join(root, "cadre", "repos.json")).marker, "stale-old");

    const replacement = {
      mode: "polyrepo",
      default_repo: "backend",
      repos: [{ name: "backend", submodule_path: "repos/backend", enabled: true }],
      marker: "authoritative-new",
    };
    const amended = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      proposed_context: { repos: replacement },
    });
    assert.equal(amended.ok, true, amended.error);
    assert.equal(amended.approval.session_id, sessionId);
    assert.equal(amended.approval.current_stage_revision, initial.approval.current_stage_revision + 1);
    const proposed = readJson(sessionFile).payload.proposedContext;
    assert.deepEqual(proposed.repositoryTopology, replacement);
    assert.equal(Object.prototype.hasOwnProperty.call(proposed, "repos"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(proposed, "repository_topology"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(readJson(sessionFile).payload, "repositoryTopology"), false);
    const canonical = readJson(path.join(root, "cadre", "repos.json"));
    assert.equal(canonical.mode, "polyrepo");
    assert.equal(canonical.default_repo, "backend");
    assert.equal(canonical.marker, "authoritative-new");
    assert.equal(canonical.version, 1);
    assert.equal(canonical.schema, "cadre.repos.v1");
    assert.doesNotMatch(fs.readFileSync(path.join(root, "cadre", "repos.md"), "utf8"), /stale-old/);

    const approved = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: sessionId,
      approvalStage: "technical",
      ...approvalStamp(amended.approval),
      approvedStages: ["technical"],
    });
    assert.equal(approved.ok, true, approved.error);
    const executed = core.workflowPacket(root, {
      workflow: "refresh",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["technical"],
    });
    assert.equal(executed.ok, true, executed.error);
    assert.equal(readJson(path.join(root, "cadre", "repos.json")).marker, "authoritative-new");
    assert.equal(fs.existsSync(sessionFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refresh project documents replace stale fields for every semantic document", () => {
  const cases = [
    { level: "product", inputKey: "product", amendKey: "product", stage: "product", file: "product.json" },
    { level: "product-guidelines", inputKey: "productGuidelines", amendKey: "product_guidelines", stage: "product_guidelines", file: "product_guidelines.json" },
    { level: "workflow", inputKey: "workflowPolicy", amendKey: "workflow_policy", stage: "workflow", file: "workflow.json" },
  ];
  for (const testCase of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `cadre-refresh-${testCase.level}-replacement-test-`));
    try {
      git(root, ["init"]);
      write(path.join(root, "cadre", "setup_state.json"), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
      const initial = core.workflowPacket(root, {
        workflow: "refresh",
        refreshLevels: [testCase.level],
        commitMode: "off",
        [testCase.inputKey]: {
          title: `Legacy ${testCase.level}`,
          summary: "Legacy Swift-specific semantic evidence.",
          staleSwift: true,
          staleNested: { platform: "iOS" },
          sections: [{ heading: "Legacy", body: "SwiftUI only" }],
        },
      });
      assert.equal(initial.ok, true, initial.error);
      assert.equal(initial.approval.current_stage, testCase.stage);
      const sessionId = initial.approval.session_id;
      assert.equal(readJson(path.join(root, "cadre", testCase.file)).staleSwift, true);
      const replacement = {
        title: `Current ${testCase.level}`,
        summary: "Authoritative replacement grounded in current repository evidence.",
      };
      const amended = core.workflowPacket(root, {
        workflow: "refresh",
        approvalSessionId: sessionId,
        proposed_context: { [testCase.amendKey]: replacement },
      });
      assert.equal(amended.ok, true, amended.error);
      assert.equal(amended.approval.current_stage_revision, initial.approval.current_stage_revision + 1);
      const canonical = readJson(path.join(root, "cadre", testCase.file));
      assert.equal(canonical.title, replacement.title);
      assert.equal(canonical.summary, replacement.summary);
      assert.deepEqual(canonical.sections, []);
      assert.equal(Object.prototype.hasOwnProperty.call(canonical, "staleSwift"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(canonical, "staleNested"), false);
      assert.doesNotMatch(JSON.stringify(canonical), /Swift|SwiftUI|iOS|Legacy/);
      const sessionPayload = readJson(path.join(root, "cadre", "local", "approval-sessions", `${sessionId}.json`)).payload;
      assert.equal(Object.prototype.hasOwnProperty.call(sessionPayload, testCase.inputKey), false);
      const approved = core.workflowPacket(root, {
        workflow: "refresh",
        approvalSessionId: sessionId,
        approvalStage: testCase.stage,
        ...approvalStamp(amended.approval),
        approvedStages: [testCase.stage],
      });
      assert.equal(approved.ok, true, approved.error);
      const executed = core.workflowPacket(root, {
        workflow: "refresh",
        execute: true,
        approvalComplete: true,
        approvalSessionId: sessionId,
        approvedStages: [testCase.stage],
      });
      assert.equal(executed.ok, true, executed.error);
      assert.doesNotMatch(fs.readFileSync(path.join(root, "cadre", testCase.file), "utf8"), /Swift|SwiftUI|iOS|Legacy/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("style-guide refresh analyzes drift and preserves selection unless removal is explicit", () => {
  for (const explicit of [false, true]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `cadre-style-guide-refresh-${explicit ? "explicit" : "preserve"}-test-`));
    try {
      git(root, ["init"]);
      write(path.join(root, "cadre", "setup_state.json"), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
      write(path.join(root, "cadre", "tech-stack.json"), `${JSON.stringify({ languages: ["TypeScript"] }, null, 2)}\n`);
      write(path.join(root, "cadre", "styleguides", "index.json"), `${JSON.stringify({ selected: ["general", "python", "custom-team"] }, null, 2)}\n`);
      const customCanonical = `${JSON.stringify({ id: "custom-team", rules: [{ id: "team", text: "Preserve team conventions." }] }, null, 2)}\n`;
      const customProjection = "# Custom team style\n\nPreserve team conventions.\n";
      write(path.join(root, "cadre", "styleguides", "custom-team.json"), customCanonical);
      write(path.join(root, "cadre", "styleguides", "custom-team.md"), customProjection);
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "seed style-guide context"]);

      const analysis = core.workflowPacket(root, { workflow: "refresh" }).refresh_analysis;
      const finding = analysis.findings.find((entry) => entry.level === "style-guides");
      assert.equal(finding.recommended, true);
      assert.ok(finding.evidence.missing.includes("typescript"));

      const preview = core.workflowPacket(root, {
        workflow: "refresh",
        refreshLevels: ["style-guides"],
        ...(explicit ? { styleGuideIds: ["typescript"] } : {}),
      });
      assert.equal(preview.ok, true, preview.error);
      assert.equal(preview.approval.current_stage, "technical");
      const paths = preview.review_artifacts.map((artifact) => artifact.path);
      assert.equal(paths.includes("cadre/styleguides/typescript.json"), true);
      assert.equal(paths.includes("cadre/styleguides/python.json"), !explicit);
      assert.equal(paths.includes("cadre/styleguides/custom-team.json"), false);
      const index = readJson(path.join(root, "cadre", "styleguides", "index.json"));
      assert.deepEqual(index.selected, explicit
        ? ["typescript"]
        : ["custom-team", "general", "python", "typescript"]);
      assert.equal(fs.readFileSync(path.join(root, "cadre", "styleguides", "custom-team.json"), "utf8"), customCanonical);
      assert.equal(fs.readFileSync(path.join(root, "cadre", "styleguides", "custom-team.md"), "utf8"), customProjection);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("LSP-only refresh freezes the reviewed technical-stage configuration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-lsp-only-refresh-test-"));
  try {
    git(root, ["init"]);
    write(path.join(root, "cadre", "setup_state.json"), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
    write(path.join(root, "src", "index.ts"), "export const ready = true;\n");
    const preview = core.workflowPacket(root, { workflow: "refresh", refreshLevels: ["lsp"], commitMode: "off" });
    assert.equal(preview.ok, true, preview.error);
    assert.deepEqual(preview.selected_levels, ["lsp"]);
    assert.equal(preview.approval.required, true);
    assert.equal(preview.approval.current_stage, "technical");
    assert.deepEqual(preview.review_artifacts.map((artifact) => artifact.path), ["cadre/lsp.json"]);
    const approvedLsp = fs.readFileSync(path.join(root, "cadre", "lsp.json"), "utf8");
    const approved = core.workflowPacket(root, {
      workflow: "refresh",
      approvalSessionId: preview.approval.session_id,
      approvalStage: "technical",
      ...approvalStamp(preview.approval),
      approvedStages: ["technical"],
    });
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.approval.current_stage, null);
    const executed = core.workflowPacket(root, {
      workflow: "refresh",
      execute: true,
      approvalComplete: true,
      approvalSessionId: preview.approval.session_id,
      approvedStages: ["technical"],
    });
    assert.equal(executed.ok, true, executed.error);
    assert.equal(executed.phase_state, "executed");
    assert.equal(fs.existsSync(path.join(root, "cadre", "lsp.json")), true);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "lsp.json"), "utf8"), approvedLsp);
    assert.equal(executed.lsp_setup.reviewed_snapshot, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project skills select by workflow, expose bounded references, and attach to workflow packets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-project-skills-test-"));
  try {
    const trackId = "skills_20260710";
    writeTrack(root, trackId, samplePlan(trackId));
    write(path.join(root, "cadre", "config.json"), JSON.stringify({ sync_mode: "local", provider_mode: "local" }));
    writeProjectSkill(root, "architecture", {
      workflows: ["implement", "review"],
      references: ["references/boundaries.md"],
      instructions: "Keep domain code behind the documented architecture boundary.",
    });
    write(path.join(root, "cadre", "skills", "architecture", "references", "boundaries.md"), "Keep domain code pure.\n");
    writeProjectSkill(root, "always-on", { workflows: ["*"] });

    const selection = core.projectSkillSelection(root, "implement", { trackId });
    assert.equal(selection.ok, true);
    assert.deepEqual(selection.selected_ids, ["always-on", "architecture"]);
    assert.deepEqual(selection.target_repos, ["."]);
    const architecture = selection.selected.find((skill) => skill.id === "architecture");
    assert.equal(architecture.rules.length, 1);
    assert.match(architecture.rules[0].text, /architecture boundary/);
    assert.match(architecture.rules[0].references[0].resource_uri, /cadre:\/\/project-skill/);
    assert.ok(selection.inline_rule_chars <= selection.inline_rule_budget);

    const detail = core.projectSkillDetail(root, "architecture");
    assert.equal(detail.ok, true);
    assert.equal(detail.skill.references[0].content, "Keep domain code pure.\n");
    const packet = core.workflowPacket(root, { workflow: "implement", trackId });
    assert.deepEqual(packet.project_skills.selected_ids, ["always-on", "architecture"]);
    assert.ok(packet.resource_uris.some((uri) => uri.includes("cadre://project-skills")));
    const catalog = core.artifactCatalog(root, { scope: "skills" });
    assert.deepEqual(catalog.artifacts.map((artifact) => artifact.id), ["skill:always-on", "skill:architecture"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project skills block instead of truncating required rules over the inline budget", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-project-skill-budget-test-"));
  try {
    write(path.join(root, "cadre", "config.json"), "{}\n");
    writeProjectSkill(root, "oversized", { instructions: "x".repeat(2401) });
    const selection = core.projectSkillSelection(root, "implement");
    assert.equal(selection.ok, false);
    assert.equal(selection.inline_rule_chars, 0);
    assert.equal(selection.decision.kind, "narrow_scope");
    assert.ok(selection.errors.some((error) => error.includes("inline rule budget")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project skill inline rule budget supports config, call overrides, and guarded caps", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-project-skill-config-budget-test-"));
  try {
    write(path.join(root, "cadre", "config.json"), JSON.stringify({ project_skills: { inline_rule_budget: 3000 } }, null, 2));
    writeProjectSkill(root, "large-rules", { instructions: "x".repeat(2800) });

    const configured = core.projectSkillSelection(root, "implement");
    assert.equal(configured.ok, true);
    assert.equal(configured.inline_rule_budget, 3000);
    assert.equal(configured.inline_rule_budget_source, "config");
    assert.equal(configured.inline_rule_budget_requested, 3000);

    const overridden = core.projectSkillSelection(root, "implement", { skillRuleBudget: 2000 });
    assert.equal(overridden.ok, false);
    assert.equal(overridden.inline_rule_budget, 2000);
    assert.equal(overridden.inline_rule_budget_source, "argument");

    const capped = core.projectSkillSelection(root, "implement", { skillRuleBudget: 99999 });
    assert.equal(capped.ok, true);
    assert.equal(capped.inline_rule_budget, 20000);
    assert.equal(capped.inline_rule_budget_requested, 99999);
    assert.ok(capped.warnings.some((warning) => warning.includes("clamped")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project skills match workflow and file selectors before exposing conditional references", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-project-skill-selector-test-"));
  try {
    write(path.join(root, "cadre", "config.json"), "{}\n");
    write(path.join(root, "cadre", "skills", "payments", "skill.json"), JSON.stringify({
      version: 1,
      schema: "cadre.project-skill.v1",
      id: "payments",
      name: "payments",
      description: "Payment rules",
      selectors: { workflows: ["implement"], file_patterns: ["src/payments/**"] },
      rules: [{ id: "contract", text: "Preserve payment contracts.", priority: 1, required: true, references: ["contracts", "admin"] }],
      references: [
        { id: "contracts", path: "references/contracts.md", when: { file_patterns: ["src/payments/**"] } },
        { id: "admin", path: "references/admin.md", when: { file_patterns: ["docs/**"] } }
      ],
    }, null, 2));
    write(path.join(root, "cadre", "skills", "payments", "references", "contracts.md"), "Contract details.\n");
    write(path.join(root, "cadre", "skills", "payments", "references", "admin.md"), "Admin details.\n");

    assert.deepEqual(core.projectSkillSelection(root, "implement", { files: ["src/other.ts"] }).selected_ids, []);
    assert.deepEqual(core.projectSkillSelection(root, "review", { files: ["src/payments/api.ts"] }).selected_ids, []);
    const matching = core.projectSkillSelection(root, "implement", { files: ["src/payments/api.ts"] });
    assert.deepEqual(matching.selected_ids, ["payments"]);
    assert.equal(matching.selected[0].rules[0].references[0].id, "contracts");
    assert.equal(matching.selected[0].rules[0].references.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project skills use the control catalog and target affected polyrepo repos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-skills-test-"));
  try {
    const trackId = "poly_skills_20260710";
    const plan = samplePlan(trackId);
    for (const phase of plan.phases) {
      for (const task of phase.tasks) task.repo = "api";
    }
    writeTrack(root, trackId, plan);
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "api",
      repos: [
        { name: "api", submodule_path: "repos/api", enabled: true },
        { name: "web", submodule_path: "repos/web", enabled: true },
      ],
    }, null, 2));
    writeProjectSkill(root, "api-rules", { workflows: ["implement"], repos: ["api"] });
    writeProjectSkill(root, "web-rules", { workflows: ["implement"], repos: ["web"] });
    writeProjectSkill(path.join(root, "repos", "api"), "product-only", { workflows: ["implement"] });

    const automatic = core.projectSkillSelection(root, "implement", { trackId });
    assert.deepEqual(automatic.target_repos, ["api"]);
    assert.deepEqual(automatic.selected_ids, ["api-rules"]);
    assert.equal(automatic.installed.includes("product-only"), false);

    const explicit = core.projectSkillSelection(root, "implement", { trackId, skillIds: ["web-rules"] });
    assert.equal(explicit.ok, true);
    assert.deepEqual(explicit.selected_ids, ["api-rules", "web-rules"]);
    assert.ok(explicit.selected.find((skill) => skill.id === "web-rules").reasons.includes("explicit"));

    const noTarget = core.projectSkillSelection(root, "status", {});
    assert.deepEqual(noTarget.target_repos, []);
    assert.deepEqual(noTarget.selected_ids, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project skill validation warns for automatic failures and fails explicit selection", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-invalid-skills-test-"));
  try {
    write(path.join(root, "cadre", "config.json"), "{}\n");
    writeProjectSkill(root, "valid-skill", { workflows: ["implement"] });
    writeProjectSkill(root, "unknown-workflow", { workflows: ["deploy"] });
    writeProjectSkill(root, "unknown-repo", { workflows: ["implement"], repos: ["missing"] });
    writeProjectSkill(root, "traversal", { workflows: ["implement"], references: ["../secret.md"] });
    write(path.join(root, "cadre", "skills", "secret.md"), "secret\n");
    writeProjectSkill(root, "binary-ref", { workflows: ["implement"], references: ["reference.txt"] });
    write(path.join(root, "cadre", "skills", "binary-ref", "reference.txt"), Buffer.from([0, 1, 2]));
    writeProjectSkill(root, "unsupported-ref", { workflows: ["implement"], references: ["script.sh"] });
    write(path.join(root, "cadre", "skills", "unsupported-ref", "script.sh"), "exit 0\n");
    writeProjectSkill(root, "large-ref", { workflows: ["implement"], references: ["large.txt"] });
    write(path.join(root, "cadre", "skills", "large-ref", "large.txt"), "x".repeat(128 * 1024 + 1));
    writeProjectSkill(root, "symlink-ref", { workflows: ["implement"], references: ["linked.md"] });
    const outside = path.join(root, "outside.md");
    write(outside, "outside\n");
    fs.symlinkSync(outside, path.join(root, "cadre", "skills", "symlink-ref", "linked.md"));
    writeProjectSkill(root, "large-skill", { workflows: ["implement"], instructions: "x".repeat(128 * 1024 + 1) });
    const outsideSkill = path.join(root, "outside-skill");
    writeProjectSkill(outsideSkill, "linked-skill", { workflows: ["implement"] });
    fs.symlinkSync(path.join(outsideSkill, "cadre", "skills", "linked-skill"), path.join(root, "cadre", "skills", "linked-skill"));

    const automatic = core.projectSkillSelection(root, "implement");
    assert.equal(automatic.ok, true);
    assert.deepEqual(automatic.selected_ids, ["valid-skill"]);
    assert.ok(automatic.warnings.some((warning) => warning.includes("unknown workflow")));
    assert.ok(automatic.warnings.some((warning) => warning.includes("unknown repo")));
    assert.ok(automatic.warnings.some((warning) => warning.includes("escapes the skill directory")));
    assert.ok(automatic.warnings.some((warning) => warning.includes("binary reference")));
    assert.ok(automatic.warnings.some((warning) => warning.includes("unsupported reference type")));
    assert.ok(automatic.warnings.some((warning) => warning.includes("exceeds")));
    assert.equal(core.projectSkillDetail(root, "linked-skill").ok, false);

    const missing = core.projectSkillSelection(root, "implement", { skillIds: "does-not-exist" });
    assert.equal(missing.ok, false);
    const invalid = core.projectSkillSelection(root, "implement", { skillIds: ["unknown-workflow"] });
    assert.equal(invalid.ok, false);
    const packet = core.workflowPacket(root, { workflow: "status", skillIds: "does-not-exist" });
    assert.equal(packet.ok, false);
    assert.equal(packet.stage, "project_skills");
    const diagnostics = core.projectSkillDiagnostics(root);
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.invalid.length, 8);
    const validate = core.workflowPacket(root, { workflow: "validate" });
    assert.equal(validate.project_skill_diagnostics.ok, false);
    assert.equal(validate.project_skills.ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
