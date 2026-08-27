import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import {
  applyProjectInitCandidate,
  previewProjectInitCandidate,
  recordGitInitialized,
  recordSetupCommit,
  safeProjectRoot,
  type ProjectInitCandidateInput
} from "../domain/init.js";
import {
  renderTracksPreview,
  validateProject,
  writeTracks
} from "../domain/state.js";
import {
  getTemplates,
  describeTemplate,
  resolveStyleguides,
  TEMPLATE_IDS,
  TEMPLATE_SET_VERSION,
  templateCatalog
} from "../domain/templates.js";
import { CADRE_RUNTIME_VERSION } from "../domain/version.js";
import { parsePlan, parsePlanContent, validatePlanGraph } from "../domain/plan.js";
import {
  EXECUTION_APPROVAL_MODES,
  EXECUTION_CHECKPOINT_EVENTS,
  applyExecutionCheckpoint,
  applyExecutionFinish,
  applyExecutionStart,
  compactExecutionStatus,
  deriveExecutionFinishInput,
  deriveExecutionStartInput,
  executionSchedulerView,
  executionStatus,
  previewExecutionCheckpoint,
  previewExecutionFinish,
  previewExecutionStart,
  type ExecutionCheckpointInput,
  type ExecutionFinishRequest,
  type ExecutionStartRequest
} from "../domain/execution.js";
import {
  applyWorktreeCleanup,
  applyWorktreeCreate,
  applyWorktreeIntegration,
  integrationRequiresApproval,
  managedWorktreeStatus,
  previewWorktreeCleanup,
  previewWorktreeCreate,
  previewWorktreeIntegration,
  type WorktreeCreateInput,
  type WorktreeIntegrationInput
} from "../domain/worktrees.js";
import {
  applyArchiveBatchCandidate,
  applyArchiveBatchRecord,
  applyReviewComplete,
  deriveArchiveBatchCandidateInput,
  deriveArchiveBatchRecordInput,
  deriveReviewCompleteInput,
  previewArchiveBatchCandidate,
  previewArchiveBatchRecord,
  previewReviewComplete,
  type ArchiveBatchCandidateInput,
  type ArchiveBatchCandidateRequest,
  type ArchiveBatchRecordRequest,
  type ReviewCompleteInput,
  type ReviewCompleteRequest
} from "../domain/governance.js";
import {
  buildWorkflowElicitation,
  fallbackWorkflowElicitation,
  normalizeWorkflowElicitation,
  supportsFormElicitation,
  workflowElicitationInputSchema
} from "./elicitation.js";
import { CadreError, serializeCadreError } from "../domain/errors.js";
import { resolveGitCommit } from "../domain/git.js";
import { ProposalTokenStore, proposalTokenSchema } from "./proposals.js";
import { listCandidatePaths, prepareCandidateStage, readCandidateFiles } from "../domain/staging.js";

function result<T extends object>(value: T, summary = "Cadre operation completed.") {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: value as Record<string, unknown>
  };
}

function templateResult(templates: ReturnType<typeof describeTemplate>[]) {
  return {
    content: templates.map((template) => ({
      type: "resource" as const,
      resource: {
        uri: template.uri,
        mimeType: template.mimeType,
        text: template.content
      }
    })),
    structuredContent: {
      templateSetVersion: TEMPLATE_SET_VERSION,
      templates: templates.map(({ content: _content, ...descriptor }) => descriptor)
    }
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function artifact(path: string, content: string) {
  return { path, sha256: sha256(content) };
}

function jsonArtifact(path: string, value: unknown) {
  return artifact(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requireCurrentProject(projectRoot: string): string {
  const root = safeProjectRoot(projectRoot);
  const path = join(root, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(path, "utf8")) as {
    runtimeVersion?: string;
    templateSetVersion?: string;
  };
  if (
    project.runtimeVersion !== CADRE_RUNTIME_VERSION
    || project.templateSetVersion !== TEMPLATE_SET_VERSION
  ) {
    throw new CadreError(
      "PROJECT_REFRESH_REQUIRED",
      `Cadre project refresh required before mutation: current ${project.runtimeVersion ?? "unknown"}/${project.templateSetVersion ?? "unknown"}, target ${CADRE_RUNTIME_VERSION}/${TEMPLATE_SET_VERSION}.`,
      {
        currentRuntimeVersion: project.runtimeVersion ?? null,
        currentTemplateSetVersion: project.templateSetVersion ?? null,
        targetRuntimeVersion: CADRE_RUNTIME_VERSION,
        targetTemplateSetVersion: TEMPLATE_SET_VERSION
      }
    );
  }
  return root;
}

const adaptiveModeSchema = z.enum(["prepare", "apply"]);

function adaptiveInputSchema(prepare: z.ZodRawShape) {
  const optionalPrepare = Object.fromEntries(Object.entries(prepare).map(([key, schema]) => [
    key,
    (schema as unknown as { optional(): z.ZodType }).optional()
  ])) as z.ZodRawShape;
  return z.object({
    mode: adaptiveModeSchema,
    proposalToken: proposalTokenSchema.optional(),
    ...optionalPrepare
  }).strict();
}

function normalizeAdaptiveInput(
  input: Record<string, unknown>,
  requiredPrepareFields: string[],
  command: string
): { mode: "apply"; proposalToken: string } | { mode: "prepare"; request: Record<string, unknown> } {
  const prepareFields = Object.keys(input).filter((key) => key !== "mode" && key !== "proposalToken");
  if (input.mode === "apply") {
    if (typeof input.proposalToken !== "string") throw new Error(`${command} apply mode requires proposalToken`);
    if (prepareFields.length) throw new Error(`${command} apply mode accepts only mode and proposalToken`);
    return { mode: "apply", proposalToken: input.proposalToken };
  }
  if (input.mode !== "prepare") throw new Error(`${command} mode must be prepare or apply`);
  if (input.proposalToken !== undefined) throw new Error(`${command} prepare mode cannot include proposalToken`);
  const missing = requiredPrepareFields.filter((key) => input[key] === undefined);
  if (missing.length) throw new Error(`${command} prepare mode requires ${missing.join(", ")}`);
  const { mode: _mode, proposalToken: _proposalToken, ...request } = input;
  return { mode: "prepare", request };
}

function failure(error: unknown) {
  const serialized = serializeCadreError(error);
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: serialized.message
    }],
    structuredContent: { error: serialized }
  };
}

function serializableValidation(validation: ReturnType<typeof validateProject>) {
  return {
    valid: validation.errors.length === 0,
    derivedStateCurrent: validation.warnings.length === 0,
    project: validation.project,
    tracks: validation.tracks,
    errors: validation.errors,
    warnings: validation.warnings
  };
}

function trackSummary(track: ReturnType<typeof validateProject>["tracks"][number]) {
  return {
    id: track.id,
    title: track.title,
    type: track.type,
    status: track.status,
    checkpoint: track.checkpoint ?? null,
    operation: track.operation?.action ?? null,
    dependencies: track.dependencies ?? [],
    revision: track.revision ?? 1,
    location: track.location
  };
}

function projectTrackSummary(track: ReturnType<typeof validateProject>["tracks"][number]) {
  const dependencies = track.dependencies ?? [];
  return {
    id: track.id,
    title: track.title,
    status: track.status,
    ...(track.checkpoint ? { checkpoint: track.checkpoint } : {}),
    ...(track.operation?.action ? { operation: track.operation.action } : {}),
    ...(dependencies.length ? { dependencies } : {})
  };
}

function projectStatusView(validation: ReturnType<typeof validateProject>) {
  const counts = Object.fromEntries(
    [...new Set(validation.tracks.map((track) => track.status))]
      .map((status) => [status, validation.tracks.filter((track) => track.status === status).length])
  );
  return {
    valid: validation.errors.length === 0,
    derivedStateCurrent: validation.warnings.length === 0,
    project: validation.project ? {
      name: validation.project.project?.name ?? null,
      context: validation.project.project?.context ?? null,
      runtimeVersion: validation.project.runtimeVersion ?? null,
      templateSetVersion: validation.project.templateSetVersion ?? null,
      setup: validation.project.setup ? {
        status: validation.project.setup.status ?? null,
        checkpoint: validation.project.setup.checkpoint ?? null
      } : null,
      lastRefresh: validation.project.lastRefresh ?? null
    } : null,
    upgradeRequired: validation.project
      ? validation.project.runtimeVersion !== CADRE_RUNTIME_VERSION
        || validation.project.templateSetVersion !== TEMPLATE_SET_VERSION
      : false,
    targetRuntimeVersion: CADRE_RUNTIME_VERSION,
    targetTemplateSetVersion: TEMPLATE_SET_VERSION,
    counts,
    tracks: validation.tracks.map(projectTrackSummary),
    errors: validation.errors,
    warnings: validation.warnings
  };
}

const PLAN_VALIDATION_STATUSES = [
  "drafting-spec", "drafting-plan", "planned", "in_progress",
  "ready_for_review", "completed", "archived"
] as const;
const MAX_DRAFT_PLAN_CHARACTERS = 256 * 1024;

export function createCadreServer(): McpServer {
  const proposalTokens = new ProposalTokenStore();
  function proposalResult<T extends object & { digest: string }>(kind: string, input: unknown, value: T) {
    return result({
      commandStatus: "approval_required" as const,
      ...value,
      proposalToken: proposalTokens.issue(kind, input, value.digest)
    });
  }
  function applyCheckpointNow(input: ExecutionCheckpointInput) {
    const preview = previewExecutionCheckpoint(input);
    const applied = applyExecutionCheckpoint(input, preview.digest, preview);
    return {
      transition: applied.transition,
      derivedStatus: executionSchedulerView(applied.journal, [input.nodeId])
    };
  }
  function recordIntegrationNow(input: WorktreeIntegrationInput, commit: string) {
    const journal = executionStatus(input.projectRoot, input.trackId, input.executionId).journal;
    const node = journal.nodes[input.nodeId];
    if (!node) throw new Error(`unknown execution node ${input.nodeId}`);
    if (["integrated", "completed"].includes(node.status)) {
      return { transition: null, derivedStatus: executionSchedulerView(journal, [input.nodeId]) };
    }
    return applyCheckpointNow({
      ...input,
      event: "record_integration",
      commit,
      verification: `Integrated ${input.nodeId} into its registered parent worktree.`
    });
  }

  const server = new McpServer(
    { name: "cadre", version: CADRE_RUNTIME_VERSION },
    {
      instructions: [
        "Cadre provides deterministic, versioned templates and narrow project-state operations.",
        "Read every existing artifact before proposing edits. Never infer file contents.",
        "For any mutation, present the complete proposed artifacts to the human and obtain approval first.",
        "Stage unapproved artifact bodies under the project-local .cadre/stage directory and use candidate manifest/command tools; do not transport those bodies through MCP when a candidate tool is available.",
        "Use workflow_elicit for concise approval or clarification forms when supported. When active task context reports a non-interactive approval policy such as Codex Full Access, skip the form and ask one short chat question.",
        "Use one adaptive command call when authorization already exists. A command returns approval_required with a proposal token only when a human decision is required; call that same command with the token only after approval.",
        "Cadre state is resumable: inspect project_status once at command entry and reserve state_validate for final mutation gates.",
        "The plan is the implementation source of truth. Cadre MCP exposes only constrained, digest-gated Git worktree operations and never approves its own changes."
      ].join(" ")
    }
  );

  server.registerTool("workflow_elicit", {
    title: "Collect Cadre workflow input",
    description: "Present one read-only Cadre approval or clarification form. Skip it under non-interactive host policy, bind approvals to an immutable digest or checkpoint, never request secrets, and use its chat fallback once.",
    inputSchema: workflowElicitationInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    let request;
    try {
      request = buildWorkflowElicitation(input);
    } catch (error) {
      return failure(error);
    }
    if (!supportsFormElicitation(server.server.getClientCapabilities())) {
      return result(fallbackWorkflowElicitation(input, "The MCP client does not support form elicitation"));
    }
    try {
      return result(normalizeWorkflowElicitation(input, await server.server.elicitInput(request)));
    } catch {
      return result(fallbackWorkflowElicitation(input, "The MCP client or its active policy rejected form elicitation"));
    }
  });

  for (const template of templateCatalog()) {
    server.registerResource(
      `template-${template.id.replaceAll("/", "-")}`,
      template.uri,
      {
        title: `Cadre template: ${template.id}`,
        description: `Immutable ${TEMPLATE_SET_VERSION} Cadre template`,
        mimeType: template.mimeType
      },
      async () => ({ contents: [{ uri: template.uri, mimeType: template.mimeType, text: template.content }] })
    );
  }

  server.registerTool("template_get_many", {
    title: "Get multiple Cadre templates",
    description: "Read an ordered set of immutable, versioned Cadre templates in one call.",
    inputSchema: { ids: z.array(z.enum(TEMPLATE_IDS)).min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ ids }) => {
    try {
      return templateResult(getTemplates(ids).map(describeTemplate));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("styleguide_resolve", {
    title: "Resolve default styleguides",
    description: "Resolve the bundled idiomatic styleguides relevant to an approved technology list.",
    inputSchema: { technologies: z.array(z.string()).min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ technologies }) => {
    try {
      return result({
        templateSetVersion: TEMPLATE_SET_VERSION,
        templates: resolveStyleguides(technologies).map((template) => {
          const { content: _content, ...descriptor } = describeTemplate(template);
          return descriptor;
        })
      }, "Resolved the default Cadre styleguide set.");
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("project_status", {
    title: "Read Cadre project status",
    description: "Read compact project, focused track, or implementation status with embedded validation.",
    inputSchema: {
      projectRoot: z.string().min(1),
      view: z.enum(["project", "track", "implementation"]).optional().default("project"),
      trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot, view, trackId, executionId }) => {
    try {
      const root = safeProjectRoot(projectRoot);
      const validation = validateProject(root);
      if (view === "project") {
        let worktreeRuntime = null;
        try {
          worktreeRuntime = managedWorktreeStatus(root);
        } catch {
          worktreeRuntime = null;
        }
        return result(
          { ...projectStatusView(validation), worktreeRuntime },
          `Cadre project ${validation.errors.length ? "has validation errors" : "is valid"}; ${validation.tracks.length} track${validation.tracks.length === 1 ? "" : "s"}.`
        );
      }
      if (!trackId) throw new Error(`${view} project_status requires trackId`);
      const track = validation.tracks.find((candidate) => candidate.id === trackId);
      if (!track) throw new Error(`unknown Cadre track ${trackId}`);
      const dependencies = (track.dependencies ?? [])
        .map((id) => validation.tracks.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .map(trackSummary);
      const focused = {
        valid: validation.errors.length === 0,
        derivedStateCurrent: validation.warnings.length === 0,
        upgradeRequired: validation.project?.runtimeVersion !== CADRE_RUNTIME_VERSION
          || validation.project?.templateSetVersion !== TEMPLATE_SET_VERSION,
        targetRuntimeVersion: CADRE_RUNTIME_VERSION,
        targetTemplateSetVersion: TEMPLATE_SET_VERSION,
        track: trackSummary(track),
        state: validation.states.get(trackId) ?? null,
        dependencies,
        errors: validation.errors.filter((error) => error.startsWith(`${trackId}:`) || error.startsWith("project.json:")),
        warnings: validation.warnings
      };
      if (view === "track") {
        return result(focused, `${trackId}: ${track.status}; checkpoint=${track.checkpoint ?? "none"}.`);
      }
      const planPath = join(root, ".cadre", track.location, "plan.md");
      const graphErrors: string[] = [];
      const graph = parsePlan(planPath, graphErrors);
      validatePlanGraph(planPath, graph, track.status, graphErrors);
      const activeExecutionId = executionId
        ?? (typeof track.operation?.executionId === "string" ? track.operation.executionId : undefined)
        ?? track.lastExecution?.executionId;
      const execution = activeExecutionId
        ? compactExecutionStatus(executionStatus(root, trackId, activeExecutionId).journal)
        : null;
      const worktreeStatus = managedWorktreeStatus(root);
      const trackWorktreeSegment = `${join(".cadre", ".worktrees", trackId)}/`;
      return result({
        ...focused,
        graph: { valid: graphErrors.length === 0, graph, errors: graphErrors },
        execution,
        worktrees: worktreeStatus.worktrees.filter((entry) => entry.path.includes(trackWorktreeSegment)),
        orphanedDirectories: worktreeStatus.orphanedDirectories.filter((path) => path.includes(trackWorktreeSegment))
      }, `${trackId}: implementation status is ${track.status}.`);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("state_validate", {
    title: "Validate Cadre project state",
    description: "Validate Cadre project invariants and return all discovered tracks and errors.",
    inputSchema: { projectRoot: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      return result(serializableValidation(validateProject(safeProjectRoot(projectRoot))));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("candidate_stage_prepare", {
    title: "Prepare a Cadre candidate stage",
    description: "Create or resume one project-local candidate directory and ensure /stage/ is ignored by Git.",
    inputSchema: {
      projectRoot: z.string().min(1),
      candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ projectRoot, candidateId }) => {
    try {
      return result(prepareCandidateStage(projectRoot, candidateId), `Prepared Cadre candidate stage ${candidateId}.`);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("candidate_inspect", {
    title: "Inspect staged artifact candidates",
    description: "Manifest an exact staged file set and optionally validate its plan graph in one read-only call.",
    inputSchema: {
      projectRoot: z.string().min(1),
      candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      files: z.array(z.string().min(1)).min(1),
      targetStatus: z.enum(PLAN_VALIDATION_STATUSES).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot, candidateId, files, targetStatus }) => {
    try {
      const root = safeProjectRoot(projectRoot);
      const candidates = readCandidateFiles(root, candidateId, files);
      const manifest = candidates
        .map((file) => ({ path: file.path, sha256: sha256(file.content) }))
        .sort((left, right) => left.path.localeCompare(right.path));
      const actualPaths = listCandidatePaths(root, candidateId);
      const expectedPaths = manifest.map((file) => file.path);
      if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error(
          `Candidate stage must contain exactly the declared files; expected ${expectedPaths.join(", ")}, found ${actualPaths.join(", ")}`
        );
      }
      let plan;
      if (targetStatus) {
        const candidate = candidates.find((file) => file.path === "plan.md");
        if (!candidate) throw new Error("candidate inspection with targetStatus requires plan.md in files");
        if (Buffer.byteLength(candidate.content, "utf8") > MAX_DRAFT_PLAN_CHARACTERS) {
          throw new Error(`Candidate plan exceeds ${MAX_DRAFT_PLAN_CHARACTERS} bytes`);
        }
        const errors: string[] = [];
        const graph = parsePlanContent(candidate.content, candidate.path, errors);
        validatePlanGraph(candidate.path, graph, targetStatus, errors);
        plan = { valid: errors.length === 0, path: candidate.path, graph, errors };
      }
      return result({
        candidateId,
        files: manifest,
        digest: sha256(JSON.stringify({ projectRoot: root, candidateId, files: manifest })),
        ...(plan ? { plan } : {})
      }, `Inspected ${manifest.length} staged Cadre artifact${manifest.length === 1 ? "" : "s"}.`);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_graph_validate", {
    title: "Validate a track execution graph",
    description: "Compile and validate phase/task dependencies and derived manual-verification barriers from an approved plan.",
    inputSchema: { projectRoot: z.string().min(1), trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot, trackId }) => {
    try {
      const root = safeProjectRoot(projectRoot);
      const statePath = join(root, ".cadre", "tracks", trackId, "state.json");
      const planPath = join(root, ".cadre", "tracks", trackId, "plan.md");
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { status?: string };
      const errors: string[] = [];
      const graph = parsePlan(planPath, errors);
      validatePlanGraph(planPath, graph, state.status ?? "planned", errors);
      return result({ valid: errors.length === 0, graph, errors });
    } catch (error) {
      return failure(error);
    }
  });

  const reviewCompleteSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    commitRangeStart: z.string().min(1),
    approval: z.string().min(1),
    acceptedRisks: z.array(z.string().min(1)).optional()
  };

  server.registerTool("review_complete", {
    title: "Complete a clean review",
    description: "Prepare the exact clean-review completion for human approval, or apply its unchanged proposal token after approval.",
    inputSchema: adaptiveInputSchema(reviewCompleteSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        input as Record<string, unknown>,
        ["projectRoot", "trackId", "commitRangeStart", "approval"],
        "review_complete"
      );
      if (adaptive.mode === "apply") {
        const proposal = proposalTokens.resolve<ReviewCompleteInput>("review_complete", adaptive.proposalToken);
        requireCurrentProject(proposal.input.projectRoot);
        const applied = applyReviewComplete(proposal.input, proposal.digest);
        return result({
          commandStatus: "applied" as const,
          trackId: proposal.input.trackId,
          status: applied.state.status,
          checkpoint: applied.state.checkpoint,
          digest: proposal.digest,
          changedPaths: [applied.statePath, applied.tracksPath],
          changedCount: 2,
          valid: applied.valid,
          derivedStateCurrent: applied.derivedStateCurrent
        });
      }
      requireCurrentProject(String(adaptive.request.projectRoot));
      const derived = deriveReviewCompleteInput(adaptive.request as unknown as ReviewCompleteRequest);
      const preview = previewReviewComplete(derived);
      return proposalResult("review_complete", derived, {
        digest: preview.digest,
        trackId: derived.trackId,
        reviewedHead: derived.reviewedHead,
        commitRange: derived.commitRange,
        targetStatus: preview.state.status,
        files: [
          jsonArtifact(preview.statePath, preview.state),
          artifact(preview.tracksPath, preview.tracksContent)
        ]
      });
    } catch (error) {
      return failure(error);
    }
  });

  const archiveCandidateUpdateSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pattern"), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }),
    z.object({ kind: z.literal("pattern_index") }),
    z.object({
      kind: z.literal("active_track_seed"),
      trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    })
  ]);
  const archiveBatchCandidateSchema = {
    projectRoot: z.string().min(1),
    candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    selectedTracks: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1).optional(),
    updates: z.array(archiveCandidateUpdateSchema)
  };

  server.registerTool("archive_batch_candidate", {
    title: "Govern a staged archive batch",
    description: "Prepare a staged archive batch for human approval, or apply its unchanged proposal token after approval.",
    inputSchema: adaptiveInputSchema(archiveBatchCandidateSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        input as Record<string, unknown>,
        ["projectRoot", "candidateId", "updates"],
        "archive_batch_candidate"
      );
      if (adaptive.mode === "apply") {
        const proposal = proposalTokens.resolve<ArchiveBatchCandidateInput>(
          "archive_batch_candidate",
          adaptive.proposalToken
        );
        requireCurrentProject(proposal.input.projectRoot);
        const applied = applyArchiveBatchCandidate(proposal.input, proposal.digest);
        return result({
          commandStatus: "applied" as const,
          batchId: proposal.input.batchId,
          selectedTracks: proposal.input.selectedTracks,
          operationPath: applied.operationPath,
          checkpoint: applied.operation.checkpoint,
          digest: proposal.digest,
          moves: applied.moves.map(({ trackId, targetPath }) => ({ trackId, targetPath })),
          changedPaths: [...applied.writes.map((write) => write.path), applied.tracksPath],
          changedCount: applied.writes.length + 1,
          valid: applied.valid,
          derivedStateCurrent: applied.derivedStateCurrent
        });
      }
      requireCurrentProject(String(adaptive.request.projectRoot));
      const derived = deriveArchiveBatchCandidateInput(adaptive.request as unknown as ArchiveBatchCandidateRequest);
      const preview = previewArchiveBatchCandidate(derived);
      return proposalResult("archive_batch_candidate", derived, {
        digest: preview.digest,
        batchId: derived.batchId,
        selectedTracks: derived.selectedTracks,
        operationPath: preview.operationPath,
        checkpoint: preview.operation.checkpoint,
        resuming: preview.resuming,
        moves: preview.moves.map(({ trackId, sourcePath, targetPath, needsMove }) => ({
          trackId, sourcePath, targetPath, needsMove
        })),
        writes: preview.writes.map((write) => artifact(write.path, write.content)),
        tracks: artifact(preview.tracksPath, preview.tracksContent)
      });
    } catch (error) {
      return failure(error);
    }
  });

  const archiveRecordSchema = {
    projectRoot: z.string().min(1),
    batchId: z.string().regex(/^archive-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/)
  };

  server.registerTool("archive_batch_record", {
    title: "Record archive provenance",
    description: "Atomically validate and record the already-authorized archive commit in track, project, and batch state.",
    inputSchema: archiveRecordSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      const derived = deriveArchiveBatchRecordInput(input as ArchiveBatchRecordRequest);
      const preview = previewArchiveBatchRecord(derived);
      const applied = applyArchiveBatchRecord(derived, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        batchId: derived.batchId,
        archiveCommit: derived.archiveCommit,
        checkpoint: applied.operation.checkpoint,
        digest: preview.digest,
        changedPaths: [applied.operationPath, applied.projectPath, ...applied.states.map((state) => state.path)],
        changedCount: applied.states.length + 2,
        valid: applied.valid,
        derivedStateCurrent: applied.derivedStateCurrent
      });
    } catch (error) {
      return failure(error);
    }
  });

  const executionStartSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    requestedMode: z.enum(["parallel", "sequential"]).optional().default("parallel"),
    approvalMode: z.enum(EXECUTION_APPROVAL_MODES).optional(),
    maxWorkers: z.number().int().min(1).max(32).optional().default(3)
  };

  server.registerTool("execution_start", {
    title: "Start implementation execution",
    description: "Atomically validate and start the implementation execution already authorized by the implement invocation.",
    inputSchema: executionStartSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      const derived = deriveExecutionStartInput(input as ExecutionStartRequest);
      const preview = previewExecutionStart(derived);
      const applied = applyExecutionStart(derived, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        journalPath: applied.journalPath,
        statePath: applied.statePath,
        execution: {
          executionId: applied.journal.executionId,
          trackId: applied.journal.trackId,
          checkpoint: applied.journal.checkpoint,
          requestedMode: applied.journal.requestedMode,
          effectiveMode: applied.journal.effectiveMode,
          approvalMode: applied.journal.approvalMode,
          maxWorkers: applied.journal.maxWorkers,
          nodeCount: Object.keys(applied.journal.nodes).length
        },
        derivedStatus: executionSchedulerView(applied.journal)
      });
    } catch (error) {
      return failure(error);
    }
  });

  const executionScopeSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/)
  };
  const executionCheckpointSchema = {
    ...executionScopeSchema,
    nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/),
    event: z.enum(EXECUTION_CHECKPOINT_EVENTS),
    workerId: z.string().min(1).nullable().optional(),
    worktreePath: z.string().min(1).nullable().optional(),
    branch: z.string().min(1).nullable().optional(),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
    verification: z.string().min(1).optional(),
    authorization: z.string().min(1).optional(),
    blocker: z.string().min(1).optional()
  };

  server.registerTool("execution_checkpoint", {
    title: "Apply an execution checkpoint",
    description: "Atomically validate and apply one already-authorized semantic execution event.",
    inputSchema: executionCheckpointSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      const preview = previewExecutionCheckpoint(input as ExecutionCheckpointInput);
      const applied = applyExecutionCheckpoint(input as ExecutionCheckpointInput, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        path: applied.path,
        transition: applied.transition,
        checkpoint: applied.journal.checkpoint,
        derivedStatus: executionSchedulerView(applied.journal, [input.nodeId])
      });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_status", {
    title: "Read implementation execution status",
    description: "Read an execution journal and derive ready, active, and blocked DAG nodes.",
    inputSchema: {
      projectRoot: z.string().min(1),
      trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/),
      nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      const status = executionStatus(input.projectRoot, input.trackId, input.executionId);
      return result(compactExecutionStatus(status.journal, input.nodeId));
    } catch (error) {
      return failure(error);
    }
  });

  const executionFinishSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/)
  };

  server.registerTool("execution_finish", {
    title: "Complete implementation execution",
    description: "Atomically verify and finalize an execution after its required manual verification is already recorded.",
    inputSchema: executionFinishSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      const derived = deriveExecutionFinishInput(input as ExecutionFinishRequest);
      const preview = previewExecutionFinish(derived);
      const applied = applyExecutionFinish(derived, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        executionId: derived.executionId,
        status: applied.journal.status,
        checkpoint: applied.journal.checkpoint,
        headCommit: applied.journal.headCommit,
        digest: preview.digest,
        changedPaths: [applied.journalPath, applied.statePath, applied.planPath, applied.tracksPath],
        changedCount: 4
      });
    } catch (error) {
      return failure(error);
    }
  });

  const worktreeSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/),
    nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/)
  };

  server.registerTool("worktree_create", {
    title: "Create a Cadre worker worktree",
    description: "Atomically validate and create or reconcile one already-authorized constrained worker worktree.",
    inputSchema: worktreeSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      const preview = previewWorktreeCreate(input as WorktreeCreateInput);
      const applied = applyWorktreeCreate(input as WorktreeCreateInput, preview.digest, preview);
      const journal = executionStatus(input.projectRoot, input.trackId, input.executionId).journal;
      const node = journal.nodes[input.nodeId];
      if (!node) throw new Error(`unknown execution node ${input.nodeId}`);
      const checkpoint = node.status === "running"
        && node.worktreePath === applied.path
        && node.branch === applied.branch
        ? { transition: null, derivedStatus: executionSchedulerView(journal, [input.nodeId]) }
        : applyCheckpointNow({
            projectRoot: input.projectRoot,
            trackId: input.trackId,
            executionId: input.executionId,
            nodeId: input.nodeId,
            event: "start",
            worktreePath: applied.path,
            branch: applied.branch
          });
      return result({ commandStatus: "applied" as const, ...applied, ...checkpoint }, `Created worker worktree for ${input.nodeId}.`);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("integration", {
    title: "Integrate a worker branch",
    description: "Atomically merge in phase/autonomous mode; in governed mode return approval_required first, then accept the unchanged proposal token after human approval.",
    inputSchema: adaptiveInputSchema(worktreeSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        input as Record<string, unknown>,
        ["projectRoot", "trackId", "executionId", "nodeId"],
        "integration"
      );
      if (adaptive.mode === "apply") {
        const proposal = proposalTokens.resolve<WorktreeIntegrationInput>("worktree_integrate", adaptive.proposalToken);
        requireCurrentProject(proposal.input.projectRoot);
        const applied = applyWorktreeIntegration(proposal.input, proposal.digest);
        const checkpoint = applied.status === "integrated" && applied.mergeCommit
          ? recordIntegrationNow(proposal.input, applied.mergeCommit)
          : {};
        return result({ commandStatus: "applied" as const, ...applied, ...checkpoint }, `Integrated ${proposal.input.nodeId}.`);
      }
      const integrationInput = adaptive.request as unknown as WorktreeIntegrationInput;
      requireCurrentProject(integrationInput.projectRoot);
      const preview = previewWorktreeIntegration(integrationInput);
      if (integrationRequiresApproval(integrationInput)) {
        return proposalResult("worktree_integrate", integrationInput, preview);
      }
      const applied = applyWorktreeIntegration(integrationInput, preview.digest, preview);
      const checkpoint = applied.status === "integrated" && applied.mergeCommit
        ? recordIntegrationNow(integrationInput, applied.mergeCommit)
        : {};
      return result({
        commandStatus: "applied" as const,
        ...applied,
        ...checkpoint
      }, `Integrated ${integrationInput.nodeId}.`);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_cleanup", {
    title: "Clean up an integrated worker",
    description: "Atomically verify and remove only a clean, fully integrated Cadre worktree and safely deletable branch.",
    inputSchema: worktreeSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      const cleanupInput = input as WorktreeIntegrationInput;
      requireCurrentProject(cleanupInput.projectRoot);
      const preview = previewWorktreeCleanup(cleanupInput);
      const applied = applyWorktreeCleanup(cleanupInput, preview.digest, preview);
      const journal = executionStatus(input.projectRoot, input.trackId, input.executionId).journal;
      const node = journal.nodes[input.nodeId];
      const checkpoint = node?.status === "completed"
        ? { transition: null, derivedStatus: executionSchedulerView(journal, [input.nodeId]) }
        : applyCheckpointNow({ ...cleanupInput, event: "complete" });
      return result({
        commandStatus: "applied" as const,
        ...applied,
        ...checkpoint
      }, `Cleaned worker worktree for ${input.nodeId}.`);
    } catch (error) {
      return failure(error);
    }
  });

  const initCandidateSchema = {
    projectRoot: z.string().min(1),
    projectName: z.string().min(1),
    context: z.enum(["greenfield", "brownfield"]),
    gitDisposition: z.enum(["existing", "initialize"]),
    baseCommit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
    approvedAt: z.iso.datetime(),
    stagedFiles: z.array(z.string().min(1)).min(3),
    styleguideIds: z.array(z.string().min(1)).min(1)
  };

  server.registerTool("project_init_candidate", {
    title: "Initialize from a staged Cadre candidate",
    description: "Prepare staged initialization for human approval, or atomically promote its unchanged proposal token after approval.",
    inputSchema: adaptiveInputSchema(initCandidateSchema),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        input as Record<string, unknown>,
        [
          "projectRoot", "projectName", "context", "gitDisposition", "baseCommit", "approvedAt", "stagedFiles",
          "styleguideIds"
        ],
        "project_init_candidate"
      );
      if (adaptive.mode === "apply") {
        const proposal = proposalTokens.resolve<ProjectInitCandidateInput>(
          "project_init_candidate",
          adaptive.proposalToken
        );
        const applied = applyProjectInitCandidate(proposal.input, proposal.digest);
        return result({
          commandStatus: "applied" as const,
          runtimeVersion: applied.runtimeVersion,
          templateSetVersion: applied.templateSetVersion,
          changedPaths: applied.files.map(({ path }) => path),
          changedCount: applied.files.length,
          digest: applied.digest
        });
      }
      const request = adaptive.request as unknown as ProjectInitCandidateInput;
      const preview = previewProjectInitCandidate(request);
      return proposalResult("project_init_candidate", request, {
        runtimeVersion: preview.runtimeVersion,
        templateSetVersion: preview.templateSetVersion,
        files: preview.files.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
        digest: preview.digest
      });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("setup_record_commit", {
    title: "Record the project setup commit",
    description: "Complete a pending create operation by recording its already-created Git commit SHA.",
    inputSchema: { projectRoot: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      requireCurrentProject(projectRoot);
      const commit = resolveGitCommit(projectRoot);
      return result({ path: recordSetupCommit(projectRoot, commit), commit });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("setup_record_git_initialized", {
    title: "Record Git initialization checkpoint",
    description: "Advance an approved create operation after the caller verifies Git was initialized at the exact project root.",
    inputSchema: { projectRoot: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      requireCurrentProject(projectRoot);
      return result({ path: recordGitInitialized(projectRoot), checkpoint: "commit-pending" });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("tracks_render", {
    title: "Render the derived tracks index",
    description: "Atomically validate and rewrite deterministic tracks.md from current track-local state.",
    inputSchema: { projectRoot: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      const input = { projectRoot: requireCurrentProject(projectRoot) };
      const preview = renderTracksPreview(input.projectRoot);
      const path = writeTracks(input.projectRoot, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        path: preview.path,
        sha256: sha256(preview.content),
        changed: preview.changed,
        writtenPath: path
      });
    } catch (error) {
      return failure(error);
    }
  });

  return server;
}

export async function runCadreServer(): Promise<void> {
  const server = createCadreServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCadreServer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
