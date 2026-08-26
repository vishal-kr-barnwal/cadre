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
  formatStatus,
  renderTracksPreview,
  validateProject,
  writeTracks
} from "../domain/state.js";
import {
  getTemplate,
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
import { serializeCadreError } from "../domain/errors.js";
import { resolveGitCommit } from "../domain/git.js";
import { ProposalTokenStore, proposalTokenSchema } from "./proposals.js";
import { readCandidateFiles } from "../domain/staging.js";

function result<T extends object>(value: T, summary?: string) {
  return {
    content: [{ type: "text" as const, text: summary ?? JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>
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

function proposalInputSchema() {
  return { proposalToken: proposalTokenSchema };
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

  const server = new McpServer(
    { name: "cadre", version: CADRE_RUNTIME_VERSION },
    {
      instructions: [
        "Cadre provides deterministic, versioned templates and narrow project-state operations.",
        "Read every existing artifact before proposing edits. Never infer file contents.",
        "For any mutation, present the complete proposed artifacts to the human and obtain approval first.",
        "Stage unapproved artifact bodies under the project-local .cadre-stage directory and use candidate manifest/command tools; do not transport those bodies through MCP when a candidate tool is available.",
        "Use workflow_elicit for concise approval or clarification forms when supported. When active task context reports a non-interactive approval policy such as Codex Full Access, skip the form and ask one short chat question.",
        "Use one adaptive command call when authorization already exists. A command returns approval_required with a proposal token only when a human decision is required; call that same command with the token only after approval.",
        "Cadre state is resumable: inspect project_status once at command entry and reserve state_validate for final mutation gates.",
        "The plan is the implementation source of truth. Cadre MCP exposes only constrained, digest-gated Git worktree operations and never approves its own changes."
      ].join(" ")
    }
  );

  server.registerTool("workflow_elicit", {
    title: "Collect Cadre workflow input",
    description: "Present one client-native Cadre approval or clarification form. This read-only tool never grants approval or mutates state. Do not call it when active task context reports approval policy never, including Codex Full Access; ask one short chat question instead. Otherwise bind approval forms to the current proposal digest or immutable verification checkpoint, never request secrets, and use its chat fallback exactly once when form elicitation is unavailable.",
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

  server.registerTool("template_catalog", {
    title: "List Cadre templates",
    description: "List immutable template identifiers, URIs, media types, and content hashes.",
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async () => result({
    templateSetVersion: TEMPLATE_SET_VERSION,
    templates: templateCatalog().map((template) => {
      const { content: _content, ...descriptor } = describeTemplate(template);
      return descriptor;
    })
  }));

  server.registerTool("template_get", {
    title: "Get a Cadre template",
    description: "Read one immutable, versioned Cadre template by logical identifier.",
    inputSchema: { id: z.enum(TEMPLATE_IDS) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ id }) => {
    try {
      return result(describeTemplate(getTemplate(id)));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("template_get_many", {
    title: "Get multiple Cadre templates",
    description: "Read an ordered set of immutable, versioned Cadre templates in one call.",
    inputSchema: { ids: z.array(z.enum(TEMPLATE_IDS)).min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ ids }) => {
    try {
      return result({
        templateSetVersion: TEMPLATE_SET_VERSION,
        templates: getTemplates(ids).map(describeTemplate)
      });
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
        templates: resolveStyleguides(technologies).map(describeTemplate)
      });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("project_status", {
    title: "Read Cadre project status",
    description: "Read and summarize current project and track checkpoints, including resumable operations.",
    inputSchema: { projectRoot: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      const status = formatStatus(safeProjectRoot(projectRoot));
      return result({ text: status.text, ...serializableValidation(status.result) }, status.text);
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

  server.registerTool("artifact_candidate_manifest", {
    title: "Manifest staged artifact candidates",
    description: "Read an exact project-local candidate file set and return only its paths, SHA-256 hashes, and approval-binding digest.",
    inputSchema: {
      projectRoot: z.string().min(1),
      candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      files: z.array(z.string().min(1)).min(1)
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot, candidateId, files }) => {
    try {
      const root = safeProjectRoot(projectRoot);
      const manifest = readCandidateFiles(root, candidateId, files)
        .map((file) => ({ path: file.path, sha256: sha256(file.content) }))
        .sort((left, right) => left.path.localeCompare(right.path));
      return result({
        candidateId,
        files: manifest,
        digest: sha256(JSON.stringify({ projectRoot: root, candidateId, files: manifest }))
      });
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

  server.registerTool("execution_graph_validate_candidate", {
    title: "Validate a staged draft execution graph",
    description: "Read plan.md from a project-local candidate stage and validate the draft graph without transporting its Markdown through MCP.",
    inputSchema: {
      projectRoot: z.string().min(1),
      candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      targetStatus: z.enum(PLAN_VALIDATION_STATUSES),
      sourceLabel: z.string().min(1).max(200).regex(/^[^\r\n]+$/).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot, candidateId, targetStatus, sourceLabel }) => {
    try {
      const candidate = readCandidateFiles(projectRoot, candidateId, ["plan.md"])[0]!;
      if (Buffer.byteLength(candidate.content, "utf8") > MAX_DRAFT_PLAN_CHARACTERS) {
        throw new Error(`Candidate plan exceeds ${MAX_DRAFT_PLAN_CHARACTERS} bytes`);
      }
      const label = sourceLabel ?? candidate.absolutePath;
      const errors: string[] = [];
      const graph = parsePlanContent(candidate.content, label, errors);
      validatePlanGraph(label, graph, targetStatus, errors);
      return result({
        valid: errors.length === 0,
        path: candidate.absolutePath,
        sha256: sha256(candidate.content),
        graph,
        errors
      });
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
    inputSchema: z.union([z.object(reviewCompleteSchema), z.object(proposalInputSchema())]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      if ("proposalToken" in input) {
        const proposal = proposalTokens.resolve<ReviewCompleteInput>("review_complete", input.proposalToken);
        const applied = applyReviewComplete(proposal.input, proposal.digest);
        return result({
          commandStatus: "applied" as const,
          trackId: proposal.input.trackId,
          status: applied.state.status,
          files: [
            jsonArtifact(applied.statePath, applied.state),
            artifact(applied.tracksPath, applied.tracksContent)
          ],
          valid: applied.valid,
          derivedStateCurrent: applied.derivedStateCurrent
        });
      }
      const derived = deriveReviewCompleteInput(input as ReviewCompleteRequest);
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
    inputSchema: z.union([z.object(archiveBatchCandidateSchema), z.object(proposalInputSchema())]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      if ("proposalToken" in input) {
        const proposal = proposalTokens.resolve<ArchiveBatchCandidateInput>(
          "archive_batch_candidate",
          input.proposalToken
        );
        const applied = applyArchiveBatchCandidate(proposal.input, proposal.digest);
        return result({
          commandStatus: "applied" as const,
          batchId: proposal.input.batchId,
          selectedTracks: proposal.input.selectedTracks,
          operationPath: applied.operationPath,
          checkpoint: applied.operation.checkpoint,
          moves: applied.moves.map(({ trackId, targetPath }) => ({ trackId, targetPath })),
          writes: applied.writes.map((write) => artifact(write.path, write.content)),
          tracks: artifact(applied.tracksPath, applied.tracksContent),
          valid: applied.valid,
          derivedStateCurrent: applied.derivedStateCurrent
        });
      }
      const derived = deriveArchiveBatchCandidateInput(input as ArchiveBatchCandidateRequest);
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
      const derived = deriveArchiveBatchRecordInput(input as ArchiveBatchRecordRequest);
      const preview = previewArchiveBatchRecord(derived);
      const applied = applyArchiveBatchRecord(derived, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        batchId: derived.batchId,
        archiveCommit: derived.archiveCommit,
        checkpoint: applied.operation.checkpoint,
        files: [
          jsonArtifact(applied.operationPath, applied.operation),
          jsonArtifact(applied.projectPath, applied.project),
          ...applied.states.map((state) => jsonArtifact(state.path, state.state))
        ],
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
      const derived = deriveExecutionFinishInput(input as ExecutionFinishRequest);
      const preview = previewExecutionFinish(derived);
      const applied = applyExecutionFinish(derived, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        executionId: derived.executionId,
        status: applied.journal.status,
        checkpoint: applied.journal.checkpoint,
        headCommit: applied.journal.headCommit,
        files: [
          jsonArtifact(applied.journalPath, applied.journal),
          jsonArtifact(applied.statePath, applied.state),
          artifact(applied.planPath, applied.planContent),
          artifact(applied.tracksPath, applied.tracksContent)
        ]
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
      const preview = previewWorktreeCreate(input as WorktreeCreateInput);
      const applied = applyWorktreeCreate(input as WorktreeCreateInput, preview.digest, preview);
      return result({ commandStatus: "applied" as const, ...applied });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("integration", {
    title: "Integrate a worker branch",
    description: "Atomically merge in phase/autonomous mode; in governed mode return approval_required first, then accept the unchanged proposal token after human approval.",
    inputSchema: z.union([z.object(worktreeSchema), z.object(proposalInputSchema())]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      if ("proposalToken" in input) {
        const proposal = proposalTokens.resolve<WorktreeIntegrationInput>("worktree_integrate", input.proposalToken);
        return result({
          commandStatus: "applied" as const,
          ...applyWorktreeIntegration(proposal.input, proposal.digest)
        });
      }
      const integrationInput = input as WorktreeIntegrationInput;
      const preview = previewWorktreeIntegration(integrationInput);
      if (integrationRequiresApproval(integrationInput)) {
        return proposalResult("worktree_integrate", integrationInput, preview);
      }
      return result({
        commandStatus: "applied" as const,
        ...applyWorktreeIntegration(integrationInput, preview.digest, preview)
      });
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
      const preview = previewWorktreeCleanup(cleanupInput);
      return result({
        commandStatus: "applied" as const,
        ...applyWorktreeCleanup(cleanupInput, preview.digest, preview)
      });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_status", {
    title: "Read Cadre worktree status",
    description: "List registered Cadre-managed worktrees and orphaned empty runtime directories.",
    inputSchema: { projectRoot: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      return result(managedWorktreeStatus(projectRoot));
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
    stagedFiles: z.array(z.string().min(1)).min(5)
  };

  server.registerTool("project_init_candidate", {
    title: "Initialize from a staged Cadre candidate",
    description: "Prepare staged initialization for human approval, or atomically promote its unchanged proposal token after approval.",
    inputSchema: z.union([z.object(initCandidateSchema), z.object(proposalInputSchema())]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      if ("proposalToken" in input) {
        const proposal = proposalTokens.resolve<ProjectInitCandidateInput>(
          "project_init_candidate",
          input.proposalToken
        );
        const applied = applyProjectInitCandidate(proposal.input, proposal.digest);
        return result({
          commandStatus: "applied" as const,
          runtimeVersion: applied.runtimeVersion,
          templateSetVersion: applied.templateSetVersion,
          files: applied.files.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
          digest: applied.digest
        });
      }
      const preview = previewProjectInitCandidate(input as ProjectInitCandidateInput);
      return proposalResult("project_init_candidate", input, {
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
      const input = { projectRoot: safeProjectRoot(projectRoot) };
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
