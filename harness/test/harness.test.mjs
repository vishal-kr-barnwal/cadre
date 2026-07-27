import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateScript = join(root, "skills", "cadre-create", "assets", "project", ".cadre", "bin", "cadre-state.mjs");
const templateRoot = join(root, "skills", "cadre-create", "assets", "project", ".cadre");

function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-test-"));
  cpSync(templateRoot, join(projectRoot, ".cadre"), { recursive: true });
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.project.name = "Fixture";
  project.project.context = "brownfield";
  project.setup = {
    status: "completed",
    checkpoint: "completed",
    commit: "1111111",
    artifactProgress: [],
    operation: null
  };
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  return projectRoot;
}

function runState(projectRoot, command, expectFailure = false) {
  const result = spawnSync(process.execPath, [stateScript, command, "--root", projectRoot], { encoding: "utf8" });
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}

test("empty initialized project validates", () => {
  const projectRoot = fixture();
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
});

test("approved create operation remains valid before its artifact commit", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-create-resume-"));
  cpSync(templateRoot, join(projectRoot, ".cadre"), { recursive: true });
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.project.name = "Interrupted setup";
  project.project.context = "greenfield";
  project.setup.operation.baseCommit = null;
  project.setup.operation.approvedArtifacts = ["product.md", "guidelines.md", "tech-stack.md", "workflow.md"];
  project.setup.operation.approvedAt = "2026-07-27T00:00:00Z";
  project.setup.artifactProgress = ["product.md", "guidelines.md"];
  project.setup.checkpoint = "context-writing";
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
  const status = runState(projectRoot, "status");
  assert.match(status.stdout, /Setup: in_progress; checkpoint=context-writing; operation=create/);
});

test("completed track requires manual verification, commits, and a clean review", () => {
  const projectRoot = fixture();
  const cadreRoot = join(projectRoot, ".cadre");
  const trackRoot = join(cadreRoot, "tracks", "example");
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "spec.md"), `# Specification: Example

## Functional Requirements
- FR-001: Work.
## Non-Functional Requirements
- NFR-001: Be reliable.
## Acceptance Criteria
- AC-001: It works.
## Dependencies
None.
## Additional Information
None.
## Dependent-track impact
None.
`);
  writeFileSync(join(trackRoot, "plan.md"), `# Plan: Example

## Phase 1: Deliver
- [x] T1.1 Implement <!-- commit: abcdef1 -->
- [x] T1.2 User Manual Verification <!-- commit: abcdef2 -->
- Phase completion commit: \`abcdef2\`

## Phase 2: Track-level User Manual Verification
- [x] T2.1 User Manual Verification <!-- commit: abcdef3 -->
- Phase completion commit: \`abcdef3\`
`);
  writeFileSync(join(trackRoot, "learning.md"), `# Incremental Learning

<!-- cadre:pattern-seed:start -->
## Pattern Seed
No existing pattern is relevant.
<!-- cadre:pattern-seed:end -->
`);
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId: "example",
    type: "feature",
    status: "completed",
    checkpoint: "ready",
    revision: 1,
    activePhase: null,
    activeTask: null,
    dependencies: [],
    commits: { spec: "aaaaaaa", plan: "bbbbbbb" },
    artifactProgress: [],
    operation: null,
    reviewCycles: [{ cycle: 1, outcome: "clean" }],
    history: []
  }, null, 2)}\n`);
  const projectPath = join(cadreRoot, "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.tracks.push({
    id: "example", title: "Example", type: "feature", status: "completed",
    dependencies: [], revision: 1, path: "tracks/example"
  });
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  runState(projectRoot, "render");
  assert.equal(runState(projectRoot, "validate").status, 0);

  const planPath = join(trackRoot, "plan.md");
  writeFileSync(planPath, readFileSync(planPath, "utf8").replace(" <!-- commit: abcdef2 -->", ""));
  const invalid = runState(projectRoot, "validate", true);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /completed task T1\.2 has no commit marker/);
});

test("drafting-plan track remains valid while its approved spec commit is pending", () => {
  const projectRoot = fixture();
  const cadreRoot = join(projectRoot, ".cadre");
  const trackRoot = join(cadreRoot, "tracks", "interrupted");
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "spec.md"), `# Specification: Interrupted

## Functional Requirements
- FR-001: Resume.
## Non-Functional Requirements
- NFR-001: Preserve work.
## Acceptance Criteria
- AC-001: Continue from checkpoint.
## Dependencies
None.
## Additional Information
None.
## Dependent-track impact
None.
`);
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId: "interrupted",
    type: "bug",
    status: "drafting-plan",
    checkpoint: "commit-pending",
    revision: 1,
    activePhase: null,
    activeTask: null,
    dependencies: [],
    commits: { spec: null, plan: null },
    artifactProgress: ["spec.md"],
    operation: {
      action: "specify",
      baseCommit: "1111111",
      expectedCommit: "cadre(track): specify interrupted",
      approvedArtifacts: ["spec.md"],
      approvedAt: "2026-07-27T00:00:00Z"
    },
    reviewCycles: [],
    history: []
  }, null, 2)}\n`);
  const projectPath = join(cadreRoot, "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.tracks.push({
    id: "interrupted", title: "Interrupted", type: "bug", status: "drafting-plan",
    dependencies: [], revision: 1, path: "tracks/interrupted"
  });
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
  const status = runState(projectRoot, "status");
  assert.match(status.stdout, /checkpoint=commit-pending; operation=specify/);
});

test("installer writes both project skill locations and refuses accidental overwrite", () => {
  const target = mkdtempSync(join(tmpdir(), "cadre-install-"));
  execFileSync(process.execPath, [join(root, "scripts", "install.mjs"), "--agent", "all", "--scope", "project", "--target", target]);
  assert.ok(existsSync(join(target, ".agents", "skills", "cadre-track", "SKILL.md")));
  assert.ok(existsSync(join(target, ".claude", "skills", "cadre-track", "SKILL.md")));
  const duplicate = spawnSync(process.execPath, [join(root, "scripts", "install.mjs"), "--agent", "all", "--scope", "project", "--target", target], { encoding: "utf8" });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /already exists/);
});

test("every post-create command loads the shared workflow", () => {
  for (const skill of [
    "cadre-track", "cadre-implement", "cadre-review", "cadre-revise", "cadre-archive",
    "cadre-refresh", "cadre-revert", "cadre-status", "cadre-wisp"
  ]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /\.cadre\/workflow\.md/, `${skill} must load the shared workflow`);
  }
});

test("create classifies project context and ambiguous planning commands must clarify", () => {
  const create = readFileSync(join(root, "skills", "cadre-create", "SKILL.md"), "utf8");
  assert.match(create, /greenfield/);
  assert.match(create, /brownfield/);
  assert.match(create, /blocking question/);

  for (const skill of ["cadre-track", "cadre-revise", "cadre-refresh"]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /clarification gate/, `${skill} must apply the clarification gate`);
    assert.match(body, /Ask|ask/, `${skill} must ask when material ambiguity remains`);
  }
});

test("create requires separate workflow and styleguide acceptance", () => {
  const create = readFileSync(join(root, "skills", "cadre-create", "SKILL.md"), "utf8");
  assert.match(create, /whether the default workflow is acceptable or the human wants changes/);
  assert.match(create, /copy the default, amend it, or use a user-provided replacement/);

  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");
  assert.match(workflow, /Create-time workflow and styleguide acceptance/);
  assert.match(workflow, /Do not infer workflow acceptance/);
});

test("default styleguide catalog covers the supported stack", () => {
  const styleguideRoot = join(root, "skills", "cadre-create", "assets", "styleguides");
  const expected = [
    "go", "java", "kotlin", "maven", "gradle", "javascript", "typescript",
    "react", "flutter", "dart", "swift", "swiftui", "python"
  ];
  for (const name of expected) {
    const body = readFileSync(join(styleguideRoot, `${name}.md`), "utf8");
    assert.match(body, /^# /);
    assert.match(body, /## Sources/);
  }
});
