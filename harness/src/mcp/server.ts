import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import {
  applyProjectInit,
  previewProjectInit,
  recordGitInitialized,
  recordSetupCommit,
  safeProjectRoot,
  type ProjectInitInput
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
  deriveExecutionFinishInput,
  deriveExecutionStartInput,
  executionStatus,
  previewExecutionCheckpoint,
  previewExecutionFinish,
  previewExecutionStart,
  type ExecutionCheckpointInput,
  type ExecutionFinishInput,
  type ExecutionFinishRequest,
  type ExecutionStartInput,
  type ExecutionStartRequest
} from "../domain/execution.js";
import {
  applyWorktreeCleanup,
  applyWorktreeCreate,
  applyWorktreeIntegration,
  managedWorktreeStatus,
  previewWorktreeCleanup,
  previewWorktreeCreate,
  previewWorktreeIntegration,
  type WorktreeCreateInput,
  type WorktreeIntegrationInput
} from "../domain/worktrees.js";
import {
  applyArchiveBatch,
  applyArchiveBatchRecord,
  applyReviewComplete,
  deriveArchiveBatchInput,
  deriveArchiveBatchRecordInput,
  deriveReviewCompleteInput,
  previewArchiveBatch,
  previewArchiveBatchRecord,
  previewReviewComplete,
  type ArchiveBatchInput,
  type ArchiveBatchRequest,
  type ArchiveBatchRecordInput,
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
import { decodeProposalToken, encodeProposalToken, proposalTokenSchema } from "./proposals.js";

function result<T extends object>(value: T, summary?: string) {
  return {
    content: [{ type: "text" as const, text: summary ?? JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>
  };
}

function proposalResult<T extends object & { digest: string }>(kind: string, input: unknown, value: T) {
  return result({
    ...value,
    proposalToken: encodeProposalToken(kind, input, value.digest)
  });
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
  const server = new McpServer(
    { name: "cadre", version: CADRE_RUNTIME_VERSION },
    {
      instructions: [
        "Cadre provides deterministic, versioned templates and narrow project-state operations.",
        "Read every existing artifact before proposing edits. Never infer file contents.",
        "For any mutation, present the complete proposed artifacts to the human and obtain approval first.",
        "Use workflow_elicit for concise approval or clarification forms when supported. When active task context reports a non-interactive approval policy such as Codex Full Access, skip the form and ask one short chat question.",
        "Call a preview tool immediately before its matching apply tool and pass only the returned proposal token.",
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
    templates: templateCatalog().map(({ content: _content, ...template }) => template)
  }));

  server.registerTool("template_get", {
    title: "Get a Cadre template",
    description: "Read one immutable, versioned Cadre template by logical identifier.",
    inputSchema: { id: z.enum(TEMPLATE_IDS) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ id }) => {
    try {
      return result(getTemplate(id));
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
      return result({ templateSetVersion: TEMPLATE_SET_VERSION, templates: getTemplates(ids) });
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
        templates: resolveStyleguides(technologies)
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

  server.registerTool("execution_graph_validate_draft", {
    title: "Validate a draft execution graph",
    description: "Compile and validate an unapproved plan supplied as Markdown without reading or writing project files.",
    inputSchema: {
      planMarkdown: z.string().min(1).max(MAX_DRAFT_PLAN_CHARACTERS),
      targetStatus: z.enum(PLAN_VALIDATION_STATUSES),
      sourceLabel: z.string().min(1).max(200).regex(/^[^\r\n]+$/).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ planMarkdown, targetStatus, sourceLabel }) => {
    try {
      const label = sourceLabel ?? "<draft-plan>";
      const errors: string[] = [];
      const graph = parsePlanContent(planMarkdown, label, errors);
      validatePlanGraph(label, graph, targetStatus, errors);
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

  server.registerTool("review_complete_preview", {
    title: "Preview clean review completion",
    description: "Preview the exact clean-review cycle, completed track state, and derived index behind one digest.",
    inputSchema: reviewCompleteSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      const derived = deriveReviewCompleteInput(input as ReviewCompleteRequest);
      return proposalResult("review_complete", derived, previewReviewComplete(derived));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("review_complete_apply", {
    title: "Apply clean review completion",
    description: "Apply an approved clean-review transition only while its exact state and index preview remain current.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<ReviewCompleteInput>("review_complete", proposalToken);
      return result(applyReviewComplete(proposal.input, proposal.digest));
    } catch (error) {
      return failure(error);
    }
  });

  const archiveBatchSchema = {
    projectRoot: z.string().min(1),
    selectedTracks: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1).optional(),
    updates: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("pattern"), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), content: z.string() }),
      z.object({ kind: z.literal("pattern_index"), content: z.string() }),
      z.object({
        kind: z.literal("active_track_seed"),
        trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        content: z.string()
      })
    ]))
  };

  server.registerTool("archive_batch_preview", {
    title: "Preview complete archive batch",
    description: "Preview selected moves, lifecycle states, pattern/seed writes, operation journal, and the post-archive track index together.",
    inputSchema: archiveBatchSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      const derived = deriveArchiveBatchInput(input as ArchiveBatchRequest);
      return proposalResult("archive_batch", derived, previewArchiveBatch(derived));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("archive_batch_apply", {
    title: "Apply complete archive batch",
    description: "Journal and apply one approved archive batch only while its complete preview remains current.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<ArchiveBatchInput>("archive_batch", proposalToken);
      return result(applyArchiveBatch(proposal.input, proposal.digest));
    } catch (error) {
      return failure(error);
    }
  });

  const archiveRecordSchema = {
    projectRoot: z.string().min(1),
    batchId: z.string().regex(/^archive-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/)
  };

  server.registerTool("archive_batch_record_preview", {
    title: "Preview archive provenance record",
    description: "Preview the authorized follow-up that records the archive commit in track, project, and batch state.",
    inputSchema: archiveRecordSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      const derived = deriveArchiveBatchRecordInput(input as ArchiveBatchRecordRequest);
      return proposalResult("archive_batch_record", derived, previewArchiveBatchRecord(derived));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("archive_batch_record_apply", {
    title: "Record archive provenance",
    description: "Record an approved batch's immutable archive commit and complete its journal behind a stale-state digest.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<ArchiveBatchRecordInput>("archive_batch_record", proposalToken);
      return result(applyArchiveBatchRecord(proposal.input, proposal.digest));
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

  server.registerTool("execution_start_preview", {
    title: "Preview implementation execution",
    description: "Preview the exact resumable implementation journal and track operation for an approved plan DAG.",
    inputSchema: executionStartSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      const derived = deriveExecutionStartInput(input as ExecutionStartRequest);
      return proposalResult("execution_start", derived, previewExecutionStart(derived));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_start_apply", {
    title: "Start implementation execution",
    description: "Write the approved implementation journal and operation only when its preview digest is unchanged.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<ExecutionStartInput>("execution_start", proposalToken);
      return result(applyExecutionStart(proposal.input, proposal.digest));
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

  server.registerTool("execution_checkpoint_preview", {
    title: "Preview an execution checkpoint",
    description: "Translate one semantic execution event into the complete legal journal transition sequence.",
    inputSchema: executionCheckpointSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return proposalResult(
        "execution_checkpoint",
        input,
        previewExecutionCheckpoint(input as ExecutionCheckpointInput)
      );
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_checkpoint_apply", {
    title: "Apply an execution checkpoint",
    description: "Apply one previewed semantic execution event atomically.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<ExecutionCheckpointInput>("execution_checkpoint", proposalToken);
      return result(applyExecutionCheckpoint(proposal.input, proposal.digest));
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
      executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/)
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return result(executionStatus(input.projectRoot, input.trackId, input.executionId));
    } catch (error) {
      return failure(error);
    }
  });

  const executionFinishSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/)
  };

  server.registerTool("execution_finish_preview", {
    title: "Preview completed implementation execution",
    description: "Verify all DAG nodes, plan evidence, and worktree cleanup before proposing ready-for-review state and its derived tracks index under one digest.",
    inputSchema: executionFinishSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      const derived = deriveExecutionFinishInput(input as ExecutionFinishRequest);
      return proposalResult("execution_finish", derived, previewExecutionFinish(derived));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_finish_apply", {
    title: "Complete implementation execution",
    description: "Finalize an approved execution, ready-for-review state, and derived tracks index together only when the preview is unchanged.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<ExecutionFinishInput>("execution_finish", proposalToken);
      return result(applyExecutionFinish(proposal.input, proposal.digest));
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

  server.registerTool("worktree_create_preview", {
    title: "Preview a Cadre worker worktree",
    description: "Resolve the constrained worker path, branch, and exact base commit without mutating Git.",
    inputSchema: worktreeSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return proposalResult("worktree_create", input, previewWorktreeCreate(input as WorktreeCreateInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_create_apply", {
    title: "Create a Cadre worker worktree",
    description: "Create or reconcile one approved constrained worker worktree using an unchanged preview digest.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<WorktreeCreateInput>("worktree_create", proposalToken);
      return result(applyWorktreeCreate(proposal.input, proposal.digest));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("integration_preview", {
    title: "Preview worker integration",
    description: "Verify clean source/target worktrees, protected Cadre state, branch tips, and changed files before merge.",
    inputSchema: worktreeSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return proposalResult("worktree_integrate", input, previewWorktreeIntegration(input as WorktreeIntegrationInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("integration_apply", {
    title: "Integrate a worker branch",
    description: "Merge an approved worker branch without squashing; report conflicts without resolving them.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<WorktreeIntegrationInput>("worktree_integrate", proposalToken);
      return result(applyWorktreeIntegration(proposal.input, proposal.digest));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_cleanup_preview", {
    title: "Preview worker cleanup",
    description: "Verify a clean worker branch is fully integrated before proposing worktree and branch removal, including recovery after its node was already completed.",
    inputSchema: worktreeSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return proposalResult("worktree_cleanup", input, previewWorktreeCleanup(input as WorktreeIntegrationInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_cleanup_apply", {
    title: "Clean up an integrated worker",
    description: "Remove only a clean, fully integrated Cadre worktree and its safely deletable branch, whether its journal node is integrated or already completed.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<WorktreeIntegrationInput>("worktree_cleanup", proposalToken);
      return result(applyWorktreeCleanup(proposal.input, proposal.digest));
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

  const approvedFileSchema = z.object({ path: z.string().min(1), content: z.string() });
  const initSchema = {
    projectRoot: z.string().min(1),
    projectName: z.string().min(1),
    context: z.enum(["greenfield", "brownfield"]),
    gitDisposition: z.enum(["existing", "initialize"]),
    baseCommit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
    approvedAt: z.iso.datetime(),
    files: z.array(approvedFileSchema).min(5)
  };

  server.registerTool("project_init_preview", {
    title: "Preview Cadre project initialization",
    description: "Validate approved rendered artifacts and return the proposed .cadre file set and semantic digest without writing; approvedAt is audit metadata and does not affect the digest.",
    inputSchema: initSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return proposalResult("project_init", input, previewProjectInit(input as ProjectInitInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("project_init_apply", {
    title: "Apply approved Cadre project initialization",
    description: "Atomically create .cadre only when the semantic proposal matches an approved preview digest; records approvedAt as audit metadata.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<ProjectInitInput>("project_init", proposalToken);
      return result(applyProjectInit(proposal.input, proposal.digest));
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

  server.registerTool("tracks_render_preview", {
    title: "Preview the derived tracks index",
    description: "Read all track-local state and return the exact derived tracks.md update and digest.",
    inputSchema: { projectRoot: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      const input = { projectRoot: safeProjectRoot(projectRoot) };
      return proposalResult("tracks_render", input, renderTracksPreview(input.projectRoot));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("tracks_render_apply", {
    title: "Apply the derived tracks index",
    description: "Rewrite tracks.md only when current state matches a human-approved preview digest.",
    inputSchema: proposalInputSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalToken }) => {
    try {
      const proposal = decodeProposalToken<{ projectRoot: string }>("tracks_render", proposalToken);
      return result({ path: writeTracks(proposal.input.projectRoot, proposal.digest) });
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
