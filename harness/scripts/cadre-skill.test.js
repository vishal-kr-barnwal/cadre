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

function readJsonLines(file) {
  const content = fs.readFileSync(file, "utf8").trim();
  return content ? content.split(/\n/).map((line) => JSON.parse(line)) : [];
}

function git(root, args) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-skill-workflow-"));
  write(path.join(root, "cadre", "config.json"), `${JSON.stringify({ traceability: { enabled: true, auto_control_commits: true } }, null, 2)}\n`);
  git(root, ["init"]);
  git(root, ["config", "user.name", "Cadre Test"]);
  git(root, ["config", "user.email", "cadre-test@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

function approvePreviewAndExecute(root, input, preview) {
  if (preview.approval?.required !== true) {
    return core.workflowPacket(root, { workflow: "skill", ...input, execute: true });
  }
  let result = preview;
  const session = preview.approval.session_id;
  for (let attempt = 0; result.approval.current_stage && attempt < 10; attempt += 1) {
    const stage = result.approval.current_stage;
    const approved = [...(result.approval.approved_stages || []), stage];
    result = core.workflowPacket(root, { workflow: "skill", approvalSessionId: session, approvalStage: stage, approvedStages: approved });
    assert.equal(result.ok, true, result.error);
  }
  return core.workflowPacket(root, {
    workflow: "skill",
    execute: true,
    approvalComplete: true,
    approvalSessionId: session,
    approvedStages: result.approval.approved_stages,
  });
}

function approveAndExecute(root, input) {
  const preview = core.workflowPacket(root, { workflow: "skill", ...input });
  return approvePreviewAndExecute(root, input, preview);
}

function createInput() {
  return {
    operation: "create",
    skillId: "web-ui",
    changes: [
      { type: "metadata.set", name: "Web UI", description: "UI guidance" },
      { type: "selectors.set", workflows: ["implement", "review"], file_patterns: ["apps/web/**"] },
      { type: "rule.upsert", id: "semantic-html", text: "Use semantic HTML.", priority: 20, required: true, references: ["guide"] },
      { type: "reference.upsert", id: "guide", path: "references/guide.md", content: "# Guide\r\n\r\nUse buttons." },
    ],
  };
}

test("skill workflow lists and validates valid and malformed catalog entries", () => {
  const root = project();
  try {
    write(path.join(root, "cadre", "skills", "broken", "skill.json"), "{ nope\n");
    const list = core.workflowPacket(root, { workflow: "skill", operation: "list" });
    assert.equal(list.ok, true);
    assert.deepEqual(list.invalid.map((entry) => entry.id), ["broken"]);
    const show = core.workflowPacket(root, { workflow: "skill", operation: "show", skillId: "broken" });
    assert.equal(show.ok, false);
    assert.match(show.diagnostics[0], /cannot be read/);
    const validate = core.workflowPacket(root, { workflow: "skill", operation: "validate" });
    assert.equal(validate.ok, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill workflow creates, projects, updates, renames, and removes through staged approval", () => {
  const root = project();
  try {
    let result = approveAndExecute(root, createInput());
    assert.equal(result.ok, true, result.error);
    assert.equal(result.phase_state, "executed");
    assert.ok(result.control_commit.commit_sha);
    const projection = fs.readFileSync(path.join(root, "cadre", "skills", "web-ui", "SKILL.md"), "utf8");
    assert.match(projection, /Reference inventory/);
    assert.doesNotMatch(projection, /Use buttons/);
    assert.equal(fs.readFileSync(path.join(root, "cadre", "skills", "web-ui", "references", "guide.md"), "utf8"), "# Guide\n\nUse buttons.\n");

    result = approveAndExecute(root, {
      operation: "update", skillId: "web-ui", changes: [
        { type: "selectors.set", workflows: ["review"], file_patterns: ["packages/ui/**"] },
        { type: "rule.upsert", id: "semantic-html", text: "Prefer native elements.", references: [] },
        { type: "reference.remove", id: "guide" },
      ],
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "references", "guide.md")), false);

    const renamePreview = core.workflowPacket(root, { workflow: "skill", operation: "rename", skillId: "web-ui", newSkillId: "browser-ui", changes: [] });
    assert.equal(renamePreview.ok, true, renamePreview.error);
    assert.equal(renamePreview.approval.required, true);
    assert.equal(renamePreview.approval.current_stage, "mutation");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "browser-ui", "skill.json")), true);
    result = approvePreviewAndExecute(root, { operation: "rename", skillId: "web-ui", newSkillId: "browser-ui", changes: [] }, renamePreview);
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "cadre", "skills", "browser-ui", "skill.json"))).id, "browser-ui");

    const removePreview = core.workflowPacket(root, { workflow: "skill", operation: "remove", skillId: "browser-ui", changes: [] });
    assert.equal(removePreview.ok, true, removePreview.error);
    assert.equal(removePreview.approval.required, true);
    assert.equal(removePreview.approval.current_stage, "mutation");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "browser-ui")), true);
    result = approvePreviewAndExecute(root, { operation: "remove", skillId: "browser-ui", changes: [] }, removePreview);
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "browser-ui")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill rename and remove require approval over destination and actual source files", () => {
  const root = project();
  try {
    const created = approveAndExecute(root, createInput());
    assert.equal(created.ok, true, created.error);

    const directRename = core.workflowPacket(root, {
      workflow: "skill",
      operation: "rename",
      skillId: "web-ui",
      newSkillId: "browser-ui",
      changes: [],
      execute: true,
    });
    assert.equal(directRename.ok, false);
    assert.equal(directRename.phase_state, "awaiting_staged_approval");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui")), true);
    const renameSession = JSON.parse(fs.readFileSync(path.join(root, "cadre", "local", "approval-sessions", `${directRename.approval.session_id}.json`), "utf8"));
    assert.ok(renameSession.stage_records.mutation.snapshot_files.some((file) => file.path === "cadre/skills/web-ui/skill.json" && file.missing === true));
    assert.ok(renameSession.stage_records.mutation.snapshot_files.some((file) => file.path === "cadre/skills/browser-ui/skill.json" && file.missing !== true));
    const renameCancel = core.workflowPacket(root, { workflow: "skill", approvalSessionId: directRename.approval.session_id, approvalCancel: true });
    assert.equal(renameCancel.approval.cancelled, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "browser-ui")), false);

    const renamePreview = core.workflowPacket(root, { workflow: "skill", operation: "rename", skillId: "web-ui", newSkillId: "browser-ui", changes: [] });
    const renameSessionId = renamePreview.approval.session_id;
    const approvedRename = core.workflowPacket(root, {
      workflow: "skill",
      approvalSessionId: renameSessionId,
      approvalStage: "mutation",
      approvedStages: ["mutation"],
    });
    assert.equal(approvedRename.ok, true, approvedRename.error);
    write(path.join(root, "cadre", "skills", "browser-ui", "late.txt"), "not reviewed\n");
    const changedDestination = core.workflowPacket(root, {
      workflow: "skill",
      execute: true,
      approvalComplete: true,
      approvalSessionId: renameSessionId,
      approvedStages: ["mutation"],
    });
    assert.equal(changedDestination.ok, false);
    assert.equal(changedDestination.stage, "staged_review_drift");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui")), true);
    fs.rmSync(path.join(root, "cadre", "skills", "browser-ui", "late.txt"), { force: true });
    const renamed = core.workflowPacket(root, {
      workflow: "skill",
      execute: true,
      approvalComplete: true,
      approvalSessionId: renameSessionId,
      approvedStages: ["mutation"],
    });
    assert.equal(renamed.ok, true, renamed.error);
    const removePreview = core.workflowPacket(root, { workflow: "skill", operation: "remove", skillId: "browser-ui", changes: [] });
    const removeSessionId = removePreview.approval.session_id;
    const approvedRemove = core.workflowPacket(root, {
      workflow: "skill",
      approvalSessionId: removeSessionId,
      approvalStage: "mutation",
      approvedStages: ["mutation"],
    });
    assert.equal(approvedRemove.ok, true, approvedRemove.error);
    write(path.join(root, "cadre", "skills", "browser-ui", "late.txt"), "not reviewed\n");
    const drifted = core.workflowPacket(root, {
      workflow: "skill",
      execute: true,
      approvalComplete: true,
      approvalSessionId: removeSessionId,
      approvedStages: ["mutation"],
    });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.stage, "staged_review_drift");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "browser-ui")), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill removal rolls back after a commit hook failure and retries the approved session", () => {
  const root = project();
  try {
    const created = approveAndExecute(root, createInput());
    assert.equal(created.ok, true, created.error);
    const preview = core.workflowPacket(root, { workflow: "skill", operation: "remove", skillId: "web-ui", changes: [] });
    const sessionId = preview.approval.session_id;
    const ready = core.workflowPacket(root, {
      workflow: "skill",
      approvalSessionId: sessionId,
      approvalStage: "mutation",
      approvedStages: ["mutation"],
    });
    assert.equal(ready.ok, true, ready.error);

    const hook = path.join(root, ".git", "hooks", "pre-commit");
    write(hook, "#!/bin/sh\nexit 1\n");
    fs.chmodSync(hook, 0o755);
    const failed = core.workflowPacket(root, {
      workflow: "skill",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["mutation"],
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.stage, "commit");
    assert.equal(failed.rolled_back, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "skill.json")), true);
    assert.equal(readJsonLines(path.join(root, "cadre", "events.jsonl")).filter((event) => event.kind === "project_skill_removed").length, 0);

    fs.rmSync(hook, { force: true });
    const retried = core.workflowPacket(root, {
      workflow: "skill",
      execute: true,
      approvalComplete: true,
      approvalSessionId: sessionId,
      approvedStages: ["mutation"],
    });
    assert.equal(retried.ok, true, retried.error);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui")), false);
    assert.equal(readJsonLines(path.join(root, "cadre", "events.jsonl")).filter((event) => event.kind === "project_skill_removed").length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill review defaults to target mode while explicit bundle mode stays non-mutating", () => {
  const root = project();
  try {
    const input = createInput();
    const bundle = core.workflowPacket(root, { workflow: "skill", ...input, reviewOutputMode: "bundle" });
    assert.equal(bundle.ok, true, bundle.error);
    assert.equal(bundle.review_bundle.mode, "bundle");
    assert.equal(bundle.review_bundle.mutates_worktree, false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui")), false);
    const bundleCancel = core.workflowPacket(root, { workflow: "skill", approvalSessionId: bundle.approval.session_id, approvalCancel: true });
    assert.equal(bundleCancel.approval.cancelled, true);

    const target = core.workflowPacket(root, { workflow: "skill", ...input });
    assert.equal(target.ok, true, target.error);
    assert.equal(target.review_bundle.mode, "target");
    assert.equal(target.approval.current_document.id, "skill");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "skill.json")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "references", "guide.md")), false);
    const references = core.workflowPacket(root, {
      workflow: "skill",
      approvalSessionId: target.approval.session_id,
      approvalStage: "skill",
      approvedStages: ["skill"],
    });
    assert.equal(references.ok, true, references.error);
    assert.equal(references.approval.current_stage, "references");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "references", "guide.md")), true);
    const targetCancel = core.workflowPacket(root, { workflow: "skill", approvalSessionId: target.approval.session_id, approvalCancel: true });
    assert.equal(targetCancel.approval.cancelled, true);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "skill.json")), false);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "SKILL.md")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("changed skill create and update retries replace previews from their original baselines", () => {
  const root = project();
  try {
    const firstCreateInput = createInput();
    const firstCreate = core.workflowPacket(root, { workflow: "skill", ...firstCreateInput });
    assert.equal(firstCreate.ok, true, firstCreate.error);
    const firstCreateSession = path.join(root, "cadre", "local", "approval-sessions", `${firstCreate.approval.session_id}.json`);
    assert.equal(fs.existsSync(firstCreateSession), true);

    const replacementCreateInput = {
      operation: "create",
      skillId: "web-ui",
      changes: [
        { type: "metadata.set", name: "Web UI", description: "Replacement UI guidance" },
        { type: "selectors.set", workflows: ["implement", "review"], file_patterns: ["apps/web/**"] },
        { type: "rule.upsert", id: "semantic-html", text: "Use accessible semantic HTML.", priority: 20, required: true, references: ["guide"] },
        { type: "reference.upsert", id: "guide", path: "references/guide.md", content: "# Guide\n\nUse accessible controls." },
      ],
    };
    const replacementCreate = core.workflowPacket(root, { workflow: "skill", ...replacementCreateInput });
    assert.equal(replacementCreate.ok, true, replacementCreate.error);
    assert.notEqual(replacementCreate.approval.session_id, firstCreate.approval.session_id);
    assert.equal(fs.existsSync(firstCreateSession), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "cadre", "skills", "web-ui", "skill.json"), "utf8")).description, "Replacement UI guidance");
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "web-ui", "references", "guide.md")), false);
    const replacementReferences = core.workflowPacket(root, {
      workflow: "skill",
      approvalSessionId: replacementCreate.approval.session_id,
      approvalStage: "skill",
      approvedStages: ["skill"],
    });
    assert.equal(replacementReferences.ok, true, replacementReferences.error);
    assert.equal(replacementReferences.approval.current_stage, "references");
    assert.equal(fs.readFileSync(path.join(root, "cadre", "skills", "web-ui", "references", "guide.md"), "utf8"), "# Guide\n\nUse accessible controls.\n");
    const created = approvePreviewAndExecute(root, replacementCreateInput, replacementReferences);
    assert.equal(created.ok, true, created.error);

    const firstUpdateInput = {
      operation: "update",
      skillId: "web-ui",
      changes: [
        { type: "metadata.set", name: "Preview Only Name", description: "This metadata belongs only to the abandoned preview" },
      ],
    };
    const firstUpdate = core.workflowPacket(root, { workflow: "skill", ...firstUpdateInput });
    assert.equal(firstUpdate.ok, true, firstUpdate.error);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "cadre", "skills", "web-ui", "skill.json"), "utf8")).name, "Preview Only Name");
    const firstUpdateSession = path.join(root, "cadre", "local", "approval-sessions", `${firstUpdate.approval.session_id}.json`);

    const replacementUpdateInput = {
      operation: "update",
      skillId: "web-ui",
      changes: [
        { type: "selectors.set", workflows: ["review"], file_patterns: ["packages/ui/**"] },
      ],
    };
    const replacementUpdate = core.workflowPacket(root, { workflow: "skill", ...replacementUpdateInput });
    assert.equal(replacementUpdate.ok, true, replacementUpdate.error);
    assert.notEqual(replacementUpdate.approval.session_id, firstUpdate.approval.session_id);
    assert.equal(fs.existsSync(firstUpdateSession), false);
    const replacementManifest = JSON.parse(fs.readFileSync(path.join(root, "cadre", "skills", "web-ui", "skill.json"), "utf8"));
    assert.equal(replacementManifest.name, "Web UI");
    assert.equal(replacementManifest.description, "Replacement UI guidance");
    assert.deepEqual(replacementManifest.selectors.workflows, ["review"]);
    assert.deepEqual(replacementManifest.selectors.file_patterns, ["packages/ui/**"]);
    const updated = approvePreviewAndExecute(root, replacementUpdateInput, replacementUpdate);
    assert.equal(updated.ok, true, updated.error);
    const finalManifest = JSON.parse(fs.readFileSync(path.join(root, "cadre", "skills", "web-ui", "skill.json"), "utf8"));
    assert.equal(finalManifest.name, "Web UI");
    assert.deepEqual(finalManifest.selectors.workflows, ["review"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill workflow pauses source discovery for model formatting without writing review artifacts", () => {
  const root = project();
  try {
    write(path.join(root, "notes", "raw.md"), "rough notes\n");
    const result = core.workflowPacket(root, {
      workflow: "skill", operation: "create", skillId: "docs", changes: [
        { type: "metadata.set", name: "Docs", description: "Documentation rules" },
        { type: "selectors.set", workflows: ["review"] },
        { type: "rule.upsert", id: "docs", text: "Keep docs current.", references: ["raw"] },
        { type: "reference.upsert", id: "raw", path: "references/raw.md", source_path: "notes/raw.md" },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.phase_state, "awaiting_formatting");
    assert.match(result.detail_resources[0], /^cadre:\/\/project-skill-source/);
    assert.equal(result.approval, null);
    assert.equal(fs.existsSync(path.join(root, "cadre", "skills", "docs")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill workflow rejects symlinked formatting sources even when the link stays in-project", () => {
  const root = project();
  try {
    write(path.join(root, ".env"), "SECRET=do-not-format\n");
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.symlinkSync(path.join(root, ".env"), path.join(root, "notes", "raw.md"));
    const result = core.workflowPacket(root, {
      workflow: "skill", operation: "create", skillId: "docs", changes: [
        { type: "metadata.set", name: "Docs", description: "Documentation rules" },
        { type: "selectors.set", workflows: ["review"] },
        { type: "rule.upsert", id: "docs", text: "Keep docs current.", references: ["raw"] },
        { type: "reference.upsert", id: "raw", path: "references/raw.md", source_path: "notes/raw.md" },
      ],
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /link-free project file/);
    assert.deepEqual(result.detail_resources || [], []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill workflow rejects dangling references, invalid selectors, path escapes, and invalid JSON", () => {
  const root = project();
  try {
    const common = [
      { type: "metadata.set", name: "Bad", description: "Bad skill" },
      { type: "selectors.set", workflows: ["unknown"], repos: ["missing"] },
      { type: "rule.upsert", id: "rule", text: "Rule", references: ["missing"] },
      { type: "reference.upsert", id: "data", path: "../data.json", content: "not json" },
    ];
    const result = core.workflowPacket(root, { workflow: "skill", operation: "create", skillId: "bad", changes: common });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /unknown workflow/.test(error)));
    assert.ok(result.errors.some((error) => /unknown repo/.test(error)));
    assert.ok(result.errors.some((error) => /references unknown/.test(error)));
    assert.ok(result.errors.some((error) => /stay inside/.test(error)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
