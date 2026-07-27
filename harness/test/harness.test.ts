import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { formatStatus, renderTracksPreview, validateProject, writeTracks } from "../src/domain/state.js";
import {
  CLAUDE_APPROVAL,
  configureClaudeMcpApproval,
  configureCodexMcpApproval
} from "../scripts/permissions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(root, "templates", "v1", "init");
const providerRoot = join(root, "templates", "v1");

function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-test-"));
  cpSync(templateRoot, join(projectRoot, ".cadre"), { recursive: true });
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.runtimeVersion = "0.2.0";
  project.templateSetVersion = "v1";
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

function runState(projectRoot: string, command: "render" | "validate" | "status", expectFailure = false) {
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    if (command === "render") {
      const preview = renderTracksPreview(projectRoot);
      writeTracks(projectRoot, preview.digest);
      stdout = `${preview.path}\n`;
    } else if (command === "validate") {
      const validation = validateProject(projectRoot);
      status = validation.errors.length ? 1 : 0;
      stdout = status ? "" : "Cadre state is valid\n";
      stderr = status ? `${validation.errors.join("\n")}\n` : "";
    } else stdout = formatStatus(projectRoot).text;
  } catch (error) {
    status = 1;
    stderr = `${error instanceof Error ? error.message : String(error)}\n`;
  }
  if (!expectFailure && status !== 0) throw new Error(stderr || stdout);
  return { status, stdout, stderr };
}

test("empty initialized project validates", () => {
  const projectRoot = fixture();
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
});

test("approved create operation remains valid before its artifact commit", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "cadre-setup-resume-"));
  cpSync(templateRoot, join(projectRoot, ".cadre"), { recursive: true });
  const projectPath = join(projectRoot, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  project.runtimeVersion = "0.2.0";
  project.templateSetVersion = "v1";
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
    title: "Example",
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
  runState(projectRoot, "render");
  assert.equal(runState(projectRoot, "validate").status, 0);

  const statePath = join(trackRoot, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.status = "archived";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const archiveRoot = join(cadreRoot, "archive", "example");
  renameSync(trackRoot, archiveRoot);
  runState(projectRoot, "render");
  assert.equal(runState(projectRoot, "validate").status, 0);
  assert.match(readFileSync(join(cadreRoot, "tracks.md"), "utf8"), /example.*archived/);

  const planPath = join(archiveRoot, "plan.md");
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
    title: "Interrupted",
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
  runState(projectRoot, "render");
  const result = runState(projectRoot, "validate");
  assert.match(result.stdout, /Cadre state is valid/);
  const status = runState(projectRoot, "status");
  assert.match(status.stdout, /checkpoint=commit-pending; operation=specify/);
});

test("installer prepares a dual-product user plugin marketplace", () => {
  const parent = mkdtempSync(join(tmpdir(), "cadre-install-"));
  const target = join(parent, "cadre");
  execFileSync(process.execPath, [
    "--import", "tsx", join(root, "scripts", "install.ts"), "--agent", "all", "--prepare-only",
    "--marketplace-root", target, "--cachebuster", "test-build"
  ]);

  const pluginRoot = join(target, "plugins", "cadre");
  assert.ok(existsSync(join(pluginRoot, "skills", "track", "SKILL.md")));
  const codexManifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const claudeManifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(codexManifest.version, "0.2.1+codex.test-build");
  assert.equal(claudeManifest.version, "0.2.1+claude.test-build");
  assert.ok(existsSync(join(pluginRoot, "dist", "cadre-mcp.mjs")));
  assert.ok(existsSync(join(pluginRoot, "templates", "v1", "track", "spec.md")));
  assert.equal(existsSync(join(pluginRoot, "scripts")), false);

  const codexMarketplace = JSON.parse(readFileSync(join(target, ".agents", "plugins", "marketplace.json"), "utf8"));
  const claudeMarketplace = JSON.parse(readFileSync(join(target, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(codexMarketplace.plugins[0].source.path, "./plugins/cadre");
  assert.equal(claudeMarketplace.plugins[0].source, "./plugins/cadre");

  execFileSync(process.execPath, [
    "--import", "tsx", join(root, "scripts", "install.ts"), "--agent", "all", "--prepare-only",
    "--marketplace-root", target, "--cachebuster", "second-build"
  ]);
  const backups = readdirSync(parent).filter((entry) => entry.startsWith("cadre.backup-"));
  assert.equal(backups.length, 1);
  const previousManifest = JSON.parse(readFileSync(
    join(parent, backups[0]!, "plugins", "cadre", ".codex-plugin", "plugin.json"), "utf8"
  ));
  assert.equal(previousManifest.version, "0.2.1+codex.test-build");
  const updatedManifest = JSON.parse(readFileSync(join(target, "plugins", "cadre", ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(updatedManifest.version, "0.2.1+codex.second-build");
});

test("installer permission helpers narrowly pre-approve Cadre MCP tools", () => {
  const directory = mkdtempSync(join(tmpdir(), "cadre-permissions-"));
  const codexConfig = join(directory, "codex", "config.toml");
  mkdirSync(dirname(codexConfig), { recursive: true });
  writeFileSync(codexConfig, "# Preserve this comment\nmodel = \"gpt-5\"\n");

  const codexFirst = configureCodexMcpApproval(codexConfig);
  assert.equal(codexFirst.changed, true);
  const codexBody = readFileSync(codexConfig, "utf8");
  assert.match(codexBody, /# Preserve this comment/);
  assert.match(codexBody, /\[plugins\."cadre@cadre"\.mcp_servers\.cadre\]/);
  assert.match(codexBody, /default_tools_approval_mode = "approve"/);
  assert.equal(configureCodexMcpApproval(codexConfig).changed, false);

  writeFileSync(codexConfig, `${codexBody.replace(
    "default_tools_approval_mode = \"approve\"",
    "default_tools_approval_mode = \"prompt\""
  )}`);
  assert.equal(configureCodexMcpApproval(codexConfig).changed, true);
  assert.match(readFileSync(codexConfig, "utf8"), /default_tools_approval_mode = "approve"/);

  const claudeSettings = join(directory, "claude", "settings.json");
  mkdirSync(dirname(claudeSettings), { recursive: true });
  writeFileSync(claudeSettings, `{
  // Preserve this comment
  "permissions": {
    "allow": ["Read"]
  }
}
`);
  const claudeFirst = configureClaudeMcpApproval(claudeSettings);
  assert.equal(claudeFirst.changed, true);
  const claudeBody = readFileSync(claudeSettings, "utf8");
  assert.match(claudeBody, /\/\/ Preserve this comment/);
  assert.match(claudeBody, new RegExp(CLAUDE_APPROVAL.replaceAll("*", "\\*")));
  assert.equal(configureClaudeMcpApproval(claudeSettings).changed, false);

  const deniedSettings = join(directory, "claude-denied.json");
  writeFileSync(deniedSettings, '{"permissions":{"deny":["mcp__cadre__*"]}}\n');
  assert.throws(
    () => configureClaudeMcpApproval(deniedSettings),
    /deny rule.*blocks Cadre MCP tools/
  );
});

test("compiled MCP exposes versioned templates and initializes projects without copied runtime", async () => {
  const client = new Client({ name: "cadre-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "cadre-mcp.mjs")]
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    for (const name of [
      "template_catalog", "template_get", "styleguide_resolve", "project_status",
      "state_validate", "project_init_preview", "project_init_apply",
      "setup_record_git_initialized", "setup_record_commit", "tracks_render_preview", "tracks_render_apply"
    ]) {
      assert.ok(tools.tools.some((tool) => tool.name === name), `missing MCP tool ${name}`);
    }
    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "cadre://templates/v1/track/spec"));

    const workflow = await client.callTool({ name: "template_get", arguments: { id: "project/workflow" } });
    assert.equal(workflow.isError, undefined);
    assert.equal((workflow.structuredContent as { id?: string }).id, "project/workflow");

    const projectRoot = mkdtempSync(join(tmpdir(), "cadre-mcp-init-"));
    const files = [
      ["product.md", "# Product\n"],
      ["guidelines.md", "# Guidelines\n"],
      ["tech-stack.md", "# Tech Stack\n- TypeScript\n"],
      ["workflow.md", "# Workflow\nRead before edit.\n"],
      ["styleguides/general.md", "# General Styleguide\n"]
    ].map(([path, content]) => ({ path: path!, content: content! }));
    const input = {
      projectRoot,
      projectName: "MCP fixture",
      context: "greenfield",
      gitDisposition: "existing",
      baseCommit: null,
      approvedAt: "2026-07-28T00:00:00.000Z",
      files
    };
    const preview = await client.callTool({ name: "project_init_preview", arguments: input });
    assert.equal(preview.isError, undefined);
    const digest = (preview.structuredContent as { digest?: string }).digest;
    assert.match(digest ?? "", /^[0-9a-f]{64}$/);
    const applied = await client.callTool({
      name: "project_init_apply",
      arguments: { ...input, proposalDigest: digest }
    });
    assert.equal(applied.isError, undefined);
    assert.ok(existsSync(join(projectRoot, ".cadre", "project.json")));
    assert.equal(existsSync(join(projectRoot, ".cadre", "bin")), false);
    assert.equal(existsSync(join(projectRoot, ".cadre", "templates")), false);
  } finally {
    await client.close();
  }
});

test("plugin namespace is not repeated in skill identities", () => {
  for (const skill of [
    "create", "track", "implement", "review", "revise",
    "archive", "refresh", "revert", "status", "wisp"
  ]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.ok(body.startsWith(`---\nname: ${skill}\n`));
    assert.equal(existsSync(join(root, "skills", `cadre-${skill}`)), false);
  }
});

test("every post-create command loads the shared workflow", () => {
  for (const skill of [
    "track", "implement", "review", "revise", "archive",
    "refresh", "revert", "status", "wisp"
  ]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /\.cadre\/workflow\.md/, `${skill} must load the shared workflow`);
  }
});

test("create classifies project context and ambiguous planning commands must clarify", () => {
  const create = readFileSync(join(root, "skills", "create", "SKILL.md"), "utf8");
  assert.match(create, /greenfield/);
  assert.match(create, /brownfield/);
  assert.match(create, /blocking question/);

  for (const skill of ["track", "revise", "refresh"]) {
    const body = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
    assert.match(body, /clarification gate/, `${skill} must apply the clarification gate`);
    assert.match(body, /Ask|ask/, `${skill} must ask when material ambiguity remains`);
  }
});

test("create bootstraps Git only when no worktree exists", () => {
  const create = readFileSync(join(root, "skills", "create", "SKILL.md"), "utf8");
  assert.match(create, /git rev-parse --show-toplevel/);
  assert.match(create, /git init/);
  assert.match(create, /never initialize a nested repository/);
  assert.match(create, /setup_record_git_initialized/);

  const project = JSON.parse(readFileSync(join(templateRoot, "project.json"), "utf8"));
  assert.ok(project.setup.operation.repositoryRoot);
  assert.ok(project.setup.operation.gitDisposition);
});

test("create requires separate workflow and styleguide acceptance", () => {
  const create = readFileSync(join(root, "skills", "create", "SKILL.md"), "utf8");
  assert.match(create, /whether the default workflow is acceptable or the human wants changes/);
  assert.match(create, /use the default, amend it, or use a user-provided replacement/);

  const workflow = readFileSync(join(templateRoot, "workflow.md"), "utf8");
  assert.match(workflow, /Create-time workflow and styleguide acceptance/);
  assert.match(workflow, /Do not infer workflow acceptance/);
});

test("default styleguide catalog covers the supported stack", () => {
  const styleguideRoot = join(providerRoot, "styleguides");
  const expected = [
    "go", "java", "kotlin", "maven", "gradle", "javascript", "typescript",
    "react", "html-css", "flutter", "dart", "swift", "swiftui", "python"
  ];
  for (const name of expected) {
    const body = readFileSync(join(styleguideRoot, `${name}.md`), "utf8");
    assert.match(body, /^# /);
    assert.match(body, /## Sources/);
  }
});

test("archive supports a resumable multi-track batch", () => {
  const archive = readFileSync(join(root, "skills", "archive", "SKILL.md"), "utf8");
  assert.match(archive, /one or more `completed` tracks in a single batch/);
  assert.match(archive, /all completed/);
  assert.match(archive, /Reject the batch without partial mutation/);
  assert.match(archive, /project\/archive-operation/);
  assert.match(archive, /commit all approved archive moves and derived changes together/);

  const operation = JSON.parse(readFileSync(join(providerRoot, "project", "archive-operation.json"), "utf8"));
  assert.equal(operation.action, "archive");
  assert.ok(Array.isArray(operation.selectedTracks));
  assert.ok(Array.isArray(operation.completedTracks));

  const projectRoot = fixture();
  const invalidOperation = {
    ...operation,
    batchId: "archive-invalid",
    baseCommit: "1111111",
    expectedCommit: "cadre(archive): archive missing",
    selectedTracks: ["missing"],
    approvedArtifacts: ["archive/missing"],
    approvedAt: "2026-07-27T00:00:00Z"
  };
  writeFileSync(
    join(projectRoot, ".cadre", "operations", "archive-invalid.json"),
    `${JSON.stringify(invalidOperation, null, 2)}\n`
  );
  const invalid = runState(projectRoot, "validate", true);
  assert.match(invalid.stderr, /unknown selected track missing/);
});

test("track state is canonical and generated tracks omit paths and dependencies", () => {
  const projectRoot = fixture();
  const cadreRoot = join(projectRoot, ".cadre");
  const trackRoot = join(cadreRoot, "tracks", "local-state");
  mkdirSync(trackRoot, { recursive: true });
  writeFileSync(join(trackRoot, "state.json"), `${JSON.stringify({
    schemaVersion: 1,
    trackId: "local-state",
    title: "Local state",
    type: "feature",
    status: "drafting-spec",
    checkpoint: "approved",
    revision: 1,
    activePhase: null,
    activeTask: null,
    dependencies: [],
    commits: { spec: null, plan: null },
    artifactProgress: ["state.json"],
    operation: {
      action: "specify",
      baseCommit: "1111111",
      expectedCommit: "cadre(track): specify local-state",
      approvedArtifacts: ["spec.md"],
      approvedAt: "2026-07-27T00:00:00Z"
    },
    reviewCycles: [],
    history: []
  }, null, 2)}\n`);

  runState(projectRoot, "render");
  const tracks = readFileSync(join(cadreRoot, "tracks.md"), "utf8");
  assert.match(tracks, /`local-state` Local state/);
  assert.doesNotMatch(tracks, /Dependencies|Path/);

  const statePath = join(trackRoot, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.dependencies = ["missing-dependency"];
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const invalid = runState(projectRoot, "validate", true);
  assert.match(invalid.stderr, /unknown dependency missing-dependency/);
  const project = JSON.parse(readFileSync(join(cadreRoot, "project.json"), "utf8"));
  assert.equal(Object.hasOwn(project, "tracks"), false);
});
