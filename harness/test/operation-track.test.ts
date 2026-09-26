import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { z } from "zod/v4";
import { applyCandidate, previewCandidateApply } from "../src/domain/candidate-apply.js";
import { dependencySources } from "../src/domain/dependency-context.js";
import {
  applyExecutionCheckpoint,
  applyExecutionFinish,
  applyExecutionStart,
  previewExecutionCheckpoint,
  previewExecutionFinish,
  previewExecutionStart
} from "../src/domain/execution.js";
import {
  applyArchiveBatchCandidate,
  applyReviewComplete,
  deriveArchiveBatchCandidateInput,
  deriveReviewCompleteInput,
  previewArchiveBatchCandidate,
  previewReviewComplete
} from "../src/domain/governance.js";
import { applyProjectInitCandidate, previewProjectInitCandidate } from "../src/domain/init.js";
import { reconcileOperation } from "../src/domain/operation-receipts.js";
import { LEGACY_TEMPLATE_SET_VERSIONS, requiresVersionedMemory, TEMPLATE_SET_VERSION } from "../src/domain/version.js";
import { validateProject, validateSpecContent } from "../src/domain/state.js";
import { validateStagedState } from "../src/domain/staged-state.js";
import { prepareCandidateStage } from "../src/domain/staging.js";
import { templateCatalog } from "../src/domain/templates.js";
import { isTrackType, type TrackType } from "../src/domain/track-types.js";
import { CADRE_MCP_OUTPUT_SCHEMAS } from "../src/mcp/output-schemas.js";
import { CADRE_MCP_TOOLS } from "../src/mcp/tool-names.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const handoff = { decisions: ["Preserve operational evidence"], failedApproaches: [], openQuestions: [], nextAction: "Verify", sources: [] };

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(t: { after(callback: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), "cadre-operation-track-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Cadre Operation Test");
  git(root, "config", "user.email", "operation@example.test");
  git(root, "config", "commit.gpgsign", "false");
  return root;
}

function commitReceipt(root: string, receipt: { operationId: string; trailers: string[] }): void {
  git(root, "add", ".cadre");
  git(root, "commit", "-m", `cadre: ${receipt.operationId}`, "-m", receipt.trailers.join("\n"));
  assert.equal(reconcileOperation(root, receipt.operationId), git(root, "rev-parse", "HEAD"));
}

function initialize(root: string): void {
  const stagedFiles = ["product.md", "guidelines.md", "tech-stack.md"];
  prepareCandidateStage(root, "create", stagedFiles);
  for (const path of stagedFiles) {
    write(root, `.cadre/stage/create/${path}`, `# ${path}\nPreserve explicit human approval and evidence provenance.\n`);
  }
  const input = {
    projectRoot: root,
    projectName: "Operation fixture",
    context: "greenfield" as const,
    gitDisposition: "initialize" as const,
    baseCommit: null,
    approvedAt: "2026-10-01T00:00:00.000Z",
    stagedFiles,
    styleguideIds: ["project/styleguides/general"]
  };
  const applied = applyProjectInitCandidate(input, previewProjectInitCandidate(input).digest);
  assert.ok(applied.receipt);
  commitReceipt(root, applied.receipt);
  assert.deepEqual(validateProject(root).errors, []);
}

function plan(): string {
  return "# Plan\n"
    + "- Spec revision: 1\n"
    + "- Plan revision: 1\n\n"
    + "## Phase 1: Governed change\n"
    + "- Phase dependencies: none\n"
    + "- [ ] T1.1 Apply approved change\n"
    + "  - Task dependencies: none\n"
    + "  - Commit group: operation-change\n"
    + "- [ ] T1.2 User Manual Verification\n"
    + "- Phase completion commit: pending\n\n"
    + "## Phase 2: Track-level User Manual Verification\n"
    + "- [ ] T2.1 User Manual Verification\n"
    + "- Phase completion commit: pending\n";
}

function baseSpec(): string {
  return "# Specification\n"
    + "## Functional Requirements\nImplement the approved change.\n"
    + "## Non-Functional Requirements\nPreserve evidence.\n"
    + "## Acceptance Criteria\nVerification passes.\n"
    + "## Dependencies\nNone.\n"
    + "## Additional Information\nNone.\n"
    + "## Dependent-track impact\nNone.\n";
}

function operationSpec(): string {
  return baseSpec()
    + "## Operational Readiness\n"
    + "- Owner: Release manager\n"
    + "- Target: production API cluster\n"
    + "- Change window: 2026-10-01 01:00-02:00 UTC\n"
    + "- Preconditions: approved change ticket, backup verified, and on-call coverage confirmed\n"
    + "## Human-Controlled Preflight, Rollout, and Postflight Evidence\n"
    + "### Preflight\n"
    + "- Planned operator: Primary on-call engineer\n"
    + "- Evidence to capture: change ticket checklist and preflight command transcript\n"
    + "- Timestamp format: RFC 3339 UTC\n"
    + "### Rollout\n"
    + "- Planned operator: Release manager\n"
    + "- Evidence to capture: deployment record and approval reference\n"
    + "- Timestamp format: RFC 3339 UTC\n"
    + "### Postflight\n"
    + "- Planned operator: Service owner\n"
    + "- Evidence to capture: monitoring snapshot and verification note\n"
    + "- Timestamp format: RFC 3339 UTC\n"
    + "## Monitoring and Success Signals\n"
    + "- Signal: successful request rate\n"
    + "- Baseline: 99.9% over the prior seven days\n"
    + "- Success threshold: at least 99.9% for the observation window\n"
    + "- Observation window: 30 minutes after rollout\n"
    + "## Abort, Rollback, and Recovery\n"
    + "- Abort threshold: error rate exceeds 1% for five consecutive minutes\n"
    + "- Rollback/recovery owner: Release manager with service owner\n"
    + "- Procedure: restore the previous deployment and verify request recovery\n"
    + "- Reversibility limit: database migration is forward-compatible until the next maintenance window\n"
    + "## Residual Risk\n"
    + "- Residual risk: brief cache inconsistency during propagation\n"
    + "- Mitigation: monitor cache hit rate and invalidate affected keys if needed\n"
    + "- Acceptance owner: Engineering duty manager\n";
}

function learning(): string {
  return "# Learning\n"
    + "<!-- cadre:pattern-seed:start -->\n"
    + "## Pattern Seed\n"
    + "<!-- cadre:memory:start -->\n"
    + "{\"schemaVersion\":1,\"specRevision\":1,\"planRevision\":1,\"patterns\":[]}\n"
    + "<!-- cadre:memory:end -->\n"
    + "No existing patterns apply.\n"
    + "<!-- cadre:pattern-seed:end -->\n";
}

function trackFiles(root: string, trackId: string, type: TrackType, spec: string): Record<string, string> {
  return {
    "spec.md": spec,
    "plan.md": plan(),
    "learning.md": learning(),
    "dependency-context.json": json({
      schemaVersion: 1,
      specRevision: 1,
      planRevision: 1,
      dependencies: [],
      ...dependencySources(root, []),
      constraints: []
    }),
    "state.json": json({
      schemaVersion: 2,
      trackId,
      title: "Governed operation",
      type,
      status: "planned",
      checkpoint: "ready",
      revision: 1,
      dependencies: [],
      commits: { spec: null, plan: null },
      artifactProgress: [],
      operation: null,
      lastExecution: null,
      reviewCycles: [],
      history: []
    })
  };
}

function stageTrack(root: string, trackId: string, type: TrackType, spec: string) {
  const files = trackFiles(root, trackId, type, spec);
  const names = Object.keys(files);
  const candidateId = `track-${trackId}`;
  prepareCandidateStage(root, candidateId, names);
  for (const [path, content] of Object.entries(files)) write(root, `.cadre/stage/${candidateId}/${path}`, content);
  return {
    files,
    input: { projectRoot: root, candidateId, workflow: "track" as const, files: names }
  };
}

test("operation specs require structured planned evidence in direct and staged validation", (t) => {
  const root = fixture(t);
  initialize(root);
  const feature = trackFiles(root, "feature-control", "feature", baseSpec());
  const operation = trackFiles(root, "operation-control", "operation", operationSpec());
  const featureErrors: string[] = [];
  const headingErrors: string[] = [];
  validateSpecContent("spec.md", baseSpec(), "feature", featureErrors);
  validateSpecContent("spec.md", baseSpec(), "operation", headingErrors);
  assert.deepEqual(featureErrors, []);
  assert.match(headingErrors.join("\n"), /missing ## Operational Readiness/);

  const blank = operationSpec().replace("- Owner: Release manager", "- Owner: ");
  const blankErrors: string[] = [];
  validateSpecContent("spec.md", blank, "operation", blankErrors);
  assert.match(blankErrors.join("\n"), /Operational Readiness Owner must be meaningful/);

  const placeholder = operationSpec().replace("- Acceptance owner: Engineering duty manager", "- Acceptance owner: {{RISK_ACCEPTANCE_OWNER}}");
  const placeholderErrors: string[] = [];
  validateSpecContent("spec.md", placeholder, "operation", placeholderErrors);
  assert.match(placeholderErrors.join("\n"), /Acceptance owner must be meaningful/);

  const missingSignal = operationSpec().replace("- Signal: successful request rate\n", "");
  const missingSignalErrors: string[] = [];
  validateSpecContent("spec.md", missingSignal, "operation", missingSignalErrors);
  assert.match(missingSignalErrors.join("\n"), /Monitoring and Success Signals is missing Signal/);

  const proseOnlyHeading = operationSpec().replace("## Operational Readiness", "<!-- ## Operational Readiness -->");
  const proseOnlyHeadingErrors: string[] = [];
  validateSpecContent("spec.md", proseOnlyHeading, "operation", proseOnlyHeadingErrors);
  assert.match(proseOnlyHeadingErrors.join("\n"), /missing ## Operational Readiness/);

  const candidates = (files: Record<string, string>) => Object.entries(files).map(([path, content]) => ({
    path, content, absolutePath: join(root, ".cadre/stage", "unused", path)
  }));

  assert.doesNotThrow(() => validateStagedState(root, "track-feature-control", candidates(feature), [
    { path: "plan.md", targetStatus: "planned" }
  ]));
  assert.doesNotThrow(() => validateStagedState(root, "track-operation-control", candidates(operation), [
    { path: "plan.md", targetStatus: "planned" }
  ]));
  assert.throws(() => validateStagedState(root, "track-operation-control", candidates({
    ...operation,
    "spec.md": placeholder
  }), [{ path: "plan.md", targetStatus: "planned" }]), /Acceptance owner must be meaningful/);
});

test("operation candidates are accepted only with complete digest-bound evidence", (t) => {
  const root = fixture(t);
  initialize(root);
  const { input } = stageTrack(root, "operation-sample", "operation", baseSpec());
  assert.throws(() => previewCandidateApply(input), /missing ## Operational Readiness/);

  write(root, `.cadre/stage/${input.candidateId}/spec.md`, operationSpec());
  const preview = previewCandidateApply(input);
  assert.equal(preview.validation.valid, true);
  assert.equal(isTrackType("operation"), true);
  assert.equal(isTrackType("deployment"), false);
  assert.equal(requiresVersionedMemory(TEMPLATE_SET_VERSION), true);

  write(root, `.cadre/stage/${input.candidateId}/spec.md`, `${operationSpec()}\nChanged after preview.\n`);
  assert.throws(() => applyCandidate(input, preview.digest), /required context changed/);

  write(root, `.cadre/stage/${input.candidateId}/spec.md`, operationSpec());
  const promoted = applyCandidate(input, previewCandidateApply(input).digest);
  commitReceipt(root, promoted);
  const state = JSON.parse(readFileSync(join(root, ".cadre/tracks/operation-sample/state.json"), "utf8"));
  assert.equal(state.type, "operation");
  assert.match(readFileSync(join(root, ".cadre/tracks.md"), "utf8"), /operation-sample.*operation/);
  assert.deepEqual(validateProject(root).errors, []);
  write(root, ".cadre/tracks/operation-sample/spec.md", operationSpec().replace(
    "- Planned operator: Release manager",
    "- Planned operator: {{ROLLOUT_OPERATOR}}"
  ));
  assert.match(validateProject(root).errors.join("\n"), /Rollout Planned operator must be meaningful/);
});

test("operation tracks still require clean review before archive", (t) => {
  const root = fixture(t);
  initialize(root);
  const { input } = stageTrack(root, "operation-lifecycle", "operation", operationSpec());
  const promoted = applyCandidate(input, previewCandidateApply(input).digest);
  commitReceipt(root, promoted);

  const scope = { projectRoot: root, trackId: "operation-lifecycle", executionId: "operation-run" };
  const start = {
    ...scope,
    requestedMode: "sequential" as const,
    effectiveMode: "sequential" as const,
    maxWorkers: 1,
    baseCommit: git(root, "rev-parse", "HEAD"),
    approvedAt: "2026-10-01T01:00:00.000Z"
  };
  applyExecutionStart(start, previewExecutionStart(start).digest);
  const checkpoint = (nodeId: string, action: Record<string, unknown>) => {
    const request = { ...scope, nodeId, ...action } as Parameters<typeof previewExecutionCheckpoint>[0];
    return applyExecutionCheckpoint(request, previewExecutionCheckpoint(request).digest);
  };
  checkpoint("P1", { event: "start" });
  write(root, "service-change.txt", "human-controlled evidence recorded\n");
  git(root, "add", "service-change.txt");
  git(root, "commit", "-m", "feat: prepare governed operation");
  const head = git(root, "rev-parse", "HEAD");
  const evidence = { commit: head, verification: "baseline/delta and monitoring evidence verified", authorization: "human approval recorded" };
  checkpoint("T1.1", { event: "complete_group", commit: head, tasks: [{ nodeId: "T1.1", verification: evidence.verification, authorization: evidence.authorization, handoff }] });
  checkpoint("T1.2", { event: "record_verification", ...evidence });
  checkpoint("P1", { event: "complete", ...evidence });
  checkpoint("P2", { event: "start" });
  checkpoint("T2.1", { event: "record_verification", ...evidence });
  checkpoint("P2", { event: "complete", ...evidence });
  const finish = { ...scope, headCommit: head, completedAt: "2026-10-01T02:00:00.000Z" };
  const finished = applyExecutionFinish(finish, previewExecutionFinish(finish).digest);
  assert.ok(finished.receipt);
  commitReceipt(root, finished.receipt);

  const candidateId = "archive-operation-lifecycle";
  prepareCandidateStage(root, candidateId, ["patterns/index.md"]);
  write(root, `.cadre/stage/${candidateId}/patterns/index.md`, readFileSync(join(root, ".cadre/patterns/index.md"), "utf8"));
  const archiveInput = () => deriveArchiveBatchCandidateInput({
    projectRoot: root,
    candidateId,
    selectedTracks: [scope.trackId],
    updates: [{ kind: "pattern_index" }]
  });
  assert.throws(() => previewArchiveBatchCandidate(archiveInput()), /not an eligible completed track/);

  const review = deriveReviewCompleteInput({ projectRoot: root, trackId: scope.trackId, approval: "Human approves the clean operation review." });
  const reviewed = applyReviewComplete(review, previewReviewComplete(review).digest);
  assert.ok("receipt" in reviewed);
  commitReceipt(root, reviewed.receipt);
  const preparedArchive = archiveInput();
  const archivePreview = previewArchiveBatchCandidate(preparedArchive);
  const archive = applyArchiveBatchCandidate(preparedArchive, archivePreview.digest);
  assert.ok("receipt" in archive);
  commitReceipt(root, archive.receipt);
  const archived = JSON.parse(readFileSync(join(root, ".cadre/archive/operation-lifecycle/state.json"), "utf8"));
  assert.equal(archived.status, "archived");
  assert.equal(archived.type, "operation");
  assert.deepEqual(validateProject(root).errors, []);
});

test("refreshing v1/v2 active tracks requires explicit v6 Pattern Seed reseeding", (t) => {
  for (const legacyVersion of ["v1", "v2"]) {
    const root = fixture(t);
    initialize(root);
    const active = stageTrack(root, `legacy-${legacyVersion}`, "feature", baseSpec());
    commitReceipt(root, applyCandidate(active.input, previewCandidateApply(active.input).digest));

    const projectPath = ".cadre/project.json";
    const learningPath = `.cadre/tracks/legacy-${legacyVersion}/learning.md`;
    const project = JSON.parse(readFileSync(join(root, projectPath), "utf8"));
    project.templateSetVersion = legacyVersion;
    write(root, projectPath, json(project));
    write(root, learningPath, "# Learning\n<!-- cadre:pattern-seed:start -->\n## Pattern Seed\nLegacy v1/v2 evidence remains readable.\n<!-- cadre:pattern-seed:end -->\n");
    git(root, "add", ".cadre");
    git(root, "commit", "-m", `test: retain ${legacyVersion} active learning`);

    const candidateId = `refresh-${legacyVersion}`;
    prepareCandidateStage(root, candidateId, ["project.json"]);
    write(root, `.cadre/stage/${candidateId}/project.json`, readFileSync(join(root, projectPath), "utf8"));
    const refresh = { projectRoot: root, candidateId, workflow: "refresh" as const, files: ["project.json"] };
    assert.throws(() => previewCandidateApply(refresh), /explicitly staged and reseeded Pattern Seed memory/);

    const files = ["project.json", `tracks/legacy-${legacyVersion}/learning.md`];
    prepareCandidateStage(root, candidateId, files);
    write(root, `.cadre/stage/${candidateId}/project.json`, readFileSync(join(root, projectPath), "utf8"));
    write(root, `.cadre/stage/${candidateId}/tracks/legacy-${legacyVersion}/learning.md`, learning());
    const reseeded = { ...refresh, files };
    const preview = previewCandidateApply(reseeded);
    assert.equal(preview.memory.learning.find((item) => item.path.endsWith("/learning.md"))?.valid, true);
    commitReceipt(root, applyCandidate(reseeded, preview.digest));
    assert.equal(JSON.parse(readFileSync(join(root, projectPath), "utf8")).templateSetVersion, TEMPLATE_SET_VERSION);
    assert.deepEqual(validateProject(root).errors, []);
  }
});

test("v6 is current while v1-v5 remain readable and refresh upgrades to v6", (t) => {
  const root = fixture(t);
  initialize(root);
  assert.equal(TEMPLATE_SET_VERSION, "v6");
  assert.ok(templateCatalog().every((template) => template.uri.startsWith("cadre://templates/v6/")));
  assert.deepEqual(LEGACY_TEMPLATE_SET_VERSIONS, ["v1", "v2", "v3", "v4", "v5"]);
  for (const version of LEGACY_TEMPLATE_SET_VERSIONS) {
    assert.equal(requiresVersionedMemory(version), ["v3", "v4", "v5"].includes(version));
  }

  const projectPath = ".cadre/project.json";
  const project = JSON.parse(readFileSync(join(root, projectPath), "utf8"));
  for (const version of LEGACY_TEMPLATE_SET_VERSIONS) {
    project.templateSetVersion = version;
    write(root, projectPath, json(project));
    const legacy = validateProject(root);
    assert.deepEqual(legacy.errors, [], `${version} must remain readable`);
    assert.ok(legacy.warnings.some((warning) => warning.includes("PROJECT_REFRESH_REQUIRED")));
  }
  project.templateSetVersion = "v5";
  write(root, projectPath, json(project));
  git(root, "add", ".cadre/project.json");
  git(root, "commit", "-m", "test: retain v5 project evidence");

  prepareCandidateStage(root, "refresh-v6", ["project.json"]);
  write(root, ".cadre/stage/refresh-v6/project.json", readFileSync(join(root, projectPath), "utf8"));
  const refresh = { projectRoot: root, candidateId: "refresh-v6", workflow: "refresh" as const, files: ["project.json"] };
  const refreshed = applyCandidate(refresh, previewCandidateApply(refresh).digest);
  commitReceipt(root, refreshed);
  assert.equal(JSON.parse(readFileSync(join(root, projectPath), "utf8")).templateSetVersion, TEMPLATE_SET_VERSION);
  assert.deepEqual(validateProject(root).errors, []);

  const advertised = JSON.stringify(z.toJSONSchema(CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.projectStatus]));
  assert.match(advertised, /"operation"/);
});
