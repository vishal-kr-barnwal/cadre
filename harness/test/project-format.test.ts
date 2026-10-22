import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture, read, write, json, git, finishCurrent } from "./helpers/revision-fixture.js";
import { reviewAndArchive } from "./helpers/complete-fixture.js";
import { supportsProjectFormat, requireSupportedProjectFormat, PROJECT_UPGRADE_INSTRUCTIONS } from "../src/domain/project-format.js";
import { validateProjectConfig } from "../src/domain/project-config-validation.js";
import { EXECUTION_APPROVAL_MODES } from "../src/domain/approval-policy.js";
import { CADRE_MCP_TOOL_NAMES } from "../src/mcp/tool-names.js";
import { CADRE_RUNTIME_VERSION, LEGACY_RUNTIME_VERSIONS, LEGACY_TEMPLATE_SET_VERSIONS } from "../src/domain/version.js";
import type { ProjectState } from "../src/domain/state.js";

test("format admission preserves 3.9 and 4.0 contracts and rejects obsolete or unknown formats", () => {
  for (const runtimeVersion of ["3.9.0", "3.9.1", "3.9.2", "4.0.0", CADRE_RUNTIME_VERSION]) {
    for (const templateSetVersion of ["v5", "v6"]) {
      const project = {schemaVersion: 2, runtimeVersion, templateSetVersion};
      const before = json(project);
      assert.equal(supportsProjectFormat(project), true);
      assert.doesNotThrow(() => requireSupportedProjectFormat(project));
      assert.equal(json(project), before);
    }
  }
  for (const patch of [
    ...LEGACY_RUNTIME_VERSIONS.map(runtimeVersion => ({runtimeVersion})),
    ...LEGACY_TEMPLATE_SET_VERSIONS.map(templateSetVersion => ({templateSetVersion})),
    {schemaVersion: 1}, {schemaVersion: 99}, {runtimeVersion: "4.1.0"}, {templateSetVersion: "v99"}
  ]) {
    const project = {schemaVersion: 2, runtimeVersion: "3.9.0", templateSetVersion: "v5", ...patch};
    assert.equal(supportsProjectFormat(project), false);
    assert.throws(() => requireSupportedProjectFormat(project), /Install cadre-ai@3\.9\.0/);
  }
  for (const name of ["archive_batch_record", "setup_record_commit", "setup_record_git_initialized"]) {
    assert.equal((CADRE_MCP_TOOL_NAMES as readonly string[]).includes(name), false);
  }
  assert.equal(CADRE_MCP_TOOL_NAMES.length, 24);
});

test("older project diagnostics expose the complete approved bridge without changing metadata", () => {
  const project = {schemaVersion: 1, runtimeVersion: "3.8.0", templateSetVersion: "v4", project: {name: "Old", context: "brownfield"},
    setup: {status: "completed", checkpoint: "completed", commit: "a".repeat(40), artifactProgress: [], operation: null}, history: []} as ProjectState;
  const before = json(project), errors: string[] = [], warnings: string[] = [];
  validateProjectConfig(project, "/.worktrees/\n/wisps/\n/stage/\n", ".cadre/.gitignore", errors, warnings);
  assert.deepEqual(errors, []);
  assert.ok(warnings.includes(`PROJECT_UPGRADE_REQUIRED: ${PROJECT_UPGRADE_INSTRUCTIONS}`));
  assert.match(warnings.join("\n"), /explicitly approved migration/);
  assert.match(warnings.join("\n"), /Then install cadre-ai@4\.0\.0/);
  assert.equal(json(project), before);
});

const versions = ["3.9.0", "3.9.1", "3.9.2", "4.0.0"];
for (const [versionIndex, runtimeVersion] of versions.entries()) for (const [modeIndex, approvalMode] of EXECUTION_APPROVAL_MODES.entries()) {
  for (const [scheduleIndex, requestedMode] of (["sequential", "parallel"] as const).entries()) {
    const client = ["codex", "claude-code", "zed"][(versionIndex + modeIndex + scheduleIndex) % 3]!;
    test(`compatible continuation without refresh: ${runtimeVersion}/${client}/${approvalMode}/${requestedMode}`, async (t) => {
      const f = await fixture(t, client), {root, call, load} = f;
      const project = JSON.parse(read(root, ".cadre/project.json"));
      const templateSetVersion = runtimeVersion === "4.0.0" ? "v6" : "v5";
      project.runtimeVersion = runtimeVersion; project.templateSetVersion = templateSetVersion;
      write(root, ".cadre/project.json", json(project));
      write(root, ".cadre/workflow.md", readFileSync(resolve(`templates/${templateSetVersion}/init/workflow.md`), "utf8"));
      git(root, "add", ".cadre"); git(root, "commit", "-m", `fixture: preserve ${runtimeVersion} project contract`);
      const before = read(root, ".cadre/project.json"), workflow = read(root, ".cadre/workflow.md");
      const status = await call("project_status", {projectRoot: root, view: "project"});
      assert.equal(status.valid, true); assert.equal(status.upgradeRequired, false);
      await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode, requestedMode});
      await finishCurrent(root, call, load().operation.executionId);
      assert.equal(read(root, ".cadre/project.json"), before);
      await reviewAndArchive(f);
      const after = JSON.parse(read(root, ".cadre/project.json"));
      assert.equal(after.runtimeVersion, runtimeVersion); assert.equal(after.templateSetVersion, templateSetVersion);
      assert.deepEqual(after.setup, project.setup);
      assert.deepEqual(after.history.slice(0, -1), project.history);
      assert.equal(after.history.at(-1).action, "archive");
      assert.equal(read(root, ".cadre/workflow.md"), workflow);
      assert.equal(JSON.parse(read(root, ".cadre/archive/sample/state.json")).status, "archived");
      assert.equal(git(root, "status", "--porcelain"), "");
    });
  }
}

for (const client of ["codex", "claude-code", "zed"]) test(`older formats block mutations with bridge instructions: ${client}`, async (t) => {
  const {root, call, load} = await fixture(t, client);
  await call("execution_start", {projectRoot: root, trackId: "sample", approvalMode: "track", requestedMode: "sequential"});
  const executionId = load().operation.executionId;
  const project = JSON.parse(read(root, ".cadre/project.json"));
  project.runtimeVersion = "3.8.0"; project.templateSetVersion = "v4"; project.schemaVersion = 1;
  write(root, ".cadre/project.json", json(project));
  const scope = {projectRoot: root, trackId: "sample", executionId}, before = git(root, "diff", "--", ".cadre"), status = git(root, "status", "--porcelain");
  const state = read(root, ".cadre/tracks/sample/state.json"), journal = read(root, `.cadre/tracks/sample/executions/execution-${executionId}.json`);
  const requests: Array<[string, Record<string, unknown>]> = [
    ["execution_start", {projectRoot: root, trackId: "sample"}],
    ["execution_checkpoint", {scope: {...scope, nodeId: "P1"}, action: {event: "block", blocker: "Fixture gate check"}}],
    ["execution_finish", scope],
    ["worktree_create", {...scope, nodeId: "P1"}],
    ["worktree_cleanup", {...scope, nodeId: "P1"}],
    ["integration", {request: {mode: "prepare", ...scope, nodeId: "P1"}}],
    ["review_complete", {request: {mode: "prepare", projectRoot: root, trackId: "sample", approval: "Fixture review evidence"}}],
    ["archive_batch_candidate", {request: {mode: "prepare", projectRoot: root, candidateId: "archive-fixture", selectedTracks: ["sample"], updates: []}}],
    ["candidate_stage_prepare", {projectRoot: root, candidateId: "refresh-fixture", expectedFiles: []}],
    ["candidate_apply", {request: {mode: "prepare", projectRoot: root, candidateId: "refresh-fixture", workflow: "refresh", files: ["project.json"]}}],
    ["candidate_apply", {request: {mode: "resume", projectRoot: root, operationId: "refresh-fixture", approvalDigest: "a".repeat(64)}}],
    ["tracks_render", {projectRoot: root}]
  ];
  for (const [name, args] of requests) {
    await assert.rejects(() => call(name, args), error => {
      assert.match(String(error), /PROJECT_UPGRADE_REQUIRED/, name);
      assert.match(String(error), /Install cadre-ai@3\.9\.0/, name);
      assert.match(String(error), /Then install cadre-ai@4\.0\.0/, name);
      return true;
    });
  }
  const diagnostic = await call("project_status", {projectRoot: root, view: "project"});
  assert.equal(diagnostic.upgradeRequired, true);
  assert.match(diagnostic.warnings.join("\n"), /Install cadre-ai@3\.9\.0/);
  assert.equal(git(root, "diff", "--", ".cadre"), before);
  assert.equal(git(root, "status", "--porcelain"), status);
  assert.equal(read(root, ".cadre/tracks/sample/state.json"), state);
  assert.equal(read(root, `.cadre/tracks/sample/executions/execution-${executionId}.json`), journal);
});
