import { contextInputSchema, readContext } from "../domain/context.js";
import { handoffSchema, requireFreshTrackMemory } from "../domain/memory.js";
import { inspectStagedMemory } from "../domain/staged-memory.js";
import { validateStagedState } from "../domain/staged-state.js";
import { fullProjectTracks } from "../domain/status-views.js";
import { lifecycleSchema, pageTracks, summarizeGraph, summarizeTrackState, trackSources } from "../domain/status-views.js";
import { McpServer, type RegisteredTool, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
import {
  listCandidatePaths,
  normalizeCandidatePath,
  prepareCandidateStage,
  readCandidateFiles,
  type CandidateFile
} from "../domain/staging.js";
import { CADRE_MCP_TOOLS } from "./tool-names.js";
import { CADRE_MCP_OUTPUT_SCHEMAS } from "./output-schemas.js";
import { clientResultFormat, createResultFormatter } from "./results.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function artifact(path: string, content: string) {
  return { path, sha256: sha256(content) };
}

function candidateManifest(files: CandidateFile[]) {
  return files
    .map((file) => artifact(file.path, file.content))
    .sort((left, right) => left.path.localeCompare(right.path));
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

function adaptiveInputSchema(prepare: z.ZodRawShape) {
  return {
    request: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("prepare"), ...prepare }),
      z.strictObject({ mode: z.literal("apply"), proposalToken: proposalTokenSchema })
    ])
  };
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

function serializableValidation(validation: ReturnType<typeof validateProject>) {
  return {
    valid: validation.errors.length === 0,
    derivedStateCurrent: validation.warnings.length === 0,
    project: validation.project,
    tracks: validation.tracks,
    staleMemory: validation.staleMemory,
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

type ProjectValidation = ReturnType<typeof validateProject>;

function focusedValidationErrors(validation: ProjectValidation, root: string, trackIds: string[]): string[] {
  const markers = trackIds.flatMap((id) => [
    `${id}:`,
    join(root, ".cadre", "tracks", id),
    join(root, ".cadre", "archive", id),
    `/${id}/`
  ]);
  return validation.errors.filter((error) => markers.some((marker) => error.includes(marker)));
}

function stagedTrackCandidates(root: string, validation: ProjectValidation) {
  const stageRoot = join(root, ".cadre", "stage");
  if (!existsSync(stageRoot)) return [];
  return readdirSync(stageRoot, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith("track-") && entry.name.length > "track-".length)
    .map((entry) => {
      const candidateId = entry.name;
      const trackId = candidateId.slice("track-".length);
      const canonical = validation.tracks.find((track) => track.id === trackId);
      const canonicalState = canonical?.location.startsWith("archive/")
        ? "archived" as const
        : canonical
          ? "active" as const
          : [join(root, ".cadre", "tracks", trackId), join(root, ".cadre", "archive", trackId)]
              .some((path) => existsSync(path))
            ? "invalid" as const
            : "absent" as const;
      try {
        const paths = listCandidatePaths(root, candidateId);
        const files = candidateManifest(readCandidateFiles(root, candidateId, paths));
        return {
          trackId,
          candidateId,
          canonicalState,
          valid: true,
          files,
          errors: [] as string[],
          nextAction: canonicalState === "absent"
            ? "Resume the unapproved proposal with the track workflow and candidate_inspect."
            : "Reconcile the matching canonical operation, then remove the stage only after approved hashes and provenance are recorded."
        };
      } catch (error) {
        return {
          trackId,
          candidateId,
          canonicalState,
          valid: false,
          files: [],
          errors: [serializeCadreError(error).message],
          nextAction: "Repair or remove the unsafe staged candidate before resuming it."
        };
      }
    })
    .sort((left, right) => left.trackId.localeCompare(right.trackId));
}

const PLAN_VALIDATION_STATUSES = [
  "drafting-spec", "drafting-plan", "planned", "in_progress",
  "ready_for_review", "completed", "archived"
] as const;
const MAX_DRAFT_PLAN_CHARACTERS = 256 * 1024;

export function createCadreServer(): McpServer {
  const { result, failure, templateResult } = createResultFormatter(() => clientResultFormat(server.server.getClientVersion()));
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
        "Read structuredContent when present; otherwise parse the final JSON text block for next-step fields. Template bodies are included once in the selected representation.",
        "The plan is the implementation source of truth. Cadre MCP exposes only constrained, digest-gated Git worktree operations and never approves its own changes."
      ].join(" ")
    }
  );

  const registeredTools: RegisteredTool[] = [];
  const registerTool: typeof server.registerTool = (name, config, callback) => {
    const tool = server.registerTool(name, config, (async (input: Record<string, unknown>, extra: Parameters<ToolCallback<z.ZodRawShape>>[1]) => {
      const response = await (callback as ToolCallback<z.ZodRawShape>)(input, extra);
      // Retain server-side variant validation even when no schema is advertised.
      if (!response.isError) {
        const payload = response.structuredContent
          ?? JSON.parse((response.content.at(-1) as { text: string }).text);
        CADRE_MCP_OUTPUT_SCHEMAS[name as keyof typeof CADRE_MCP_OUTPUT_SCHEMAS].parse(payload);
      }
      return response;
    }) as typeof callback);
    registeredTools.push(tool);
    return tool;
  };
  server.server.oninitialized = () => {
    if (clientResultFormat(server.server.getClientVersion()) === "text") {
      // A published outputSchema requires structuredContent. Text clients get
      // the same payload without advertising a structured-output contract.
      for (const tool of registeredTools) delete tool.outputSchema;
    }
  };

  registerTool(CADRE_MCP_TOOLS.workflowElicit, {
    title: "Collect Cadre workflow input",
    description: "Request a decision.",
    inputSchema: workflowElicitationInputSchema,
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.workflowElicit],
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

  registerTool(CADRE_MCP_TOOLS.templateGetMany, {
    title: "Get multiple Cadre templates",
    description: "Read templates.",
    inputSchema: {
      ids: z.array(z.enum(TEMPLATE_IDS)).min(1),
      contentMode: z.enum(["embedded_resource", "text"]).optional().default("embedded_resource")
    },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.templateGetMany],
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ ids, contentMode }) => {
    try {
      return templateResult(getTemplates(ids).map(describeTemplate), contentMode);
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.styleguideResolve, {
    title: "Resolve default styleguides",
    description: "Resolve styleguides.",
    inputSchema: { technologies: z.array(z.string()).min(1) },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.styleguideResolve],
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

  registerTool(CADRE_MCP_TOOLS.contextRead, {
    title: "Read required track context", description: "Read scoped context; consume all pages before acting. Sources remain authoritative.",
    inputSchema: contextInputSchema,
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.contextRead],
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => { try { return result(readContext(input)); } catch (error) { return failure(error); } });

  registerTool(CADRE_MCP_TOOLS.projectStatus, {
    title: "Read Cadre project status",
    description: "Read project status.",
    inputSchema: {
      projectRoot: z.string().min(1),
      view: z.enum(["project", "track", "implementation"]).optional().default("project"),
      detail: z.enum(["summary", "full"]).default("summary"),
      statuses: z.array(lifecycleSchema).optional(), limit: z.number().int().min(1).max(200).default(50),
      cursor: z.string().max(1024).optional(),
      trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/).optional()
    },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.projectStatus],
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot, view, trackId, executionId, detail, statuses, limit, cursor }) => {
    try {
      const root = safeProjectRoot(projectRoot);
      const validation = validateProject(root);
      if (view === "project") {
        const page = pageTracks(validation.tracks, { statuses, limit, cursor });
        let worktreeRuntime = null;
        try {
          worktreeRuntime = managedWorktreeStatus(root);
        } catch {
          worktreeRuntime = null;
        }
        return result(
          { ...projectStatusView(validation), detail,
            ...(detail === "full" ? { projectState: validation.project, trackDetails: fullProjectTracks(root, page.tracks, validation.states, validation.plans) } : {}),
            tracks: page.tracks.map(projectTrackSummary), listing: page.listing, staleMemory: validation.staleMemory, stagedTrackCandidates: stagedTrackCandidates(root, validation), worktreeRuntime },
          `Cadre project ${validation.errors.length ? "has validation errors" : "is valid"}; ${validation.tracks.length} track${validation.tracks.length === 1 ? "" : "s"}.`
        );
      }
      if (!trackId) throw new Error(`${view} project_status requires trackId`);
      const track = validation.tracks.find((candidate) => candidate.id === trackId);
      const stagedCandidate = stagedTrackCandidates(root, validation).find((candidate) => candidate.trackId === trackId);
      if (!track) {
        const canonicalPaths = [
          join(root, ".cadre", "tracks", trackId),
          join(root, ".cadre", "archive", trackId)
        ];
        if (canonicalPaths.some((path) => existsSync(path))) {
          throw new CadreError(
            "TRACK_STATE_INVALID",
            `Cadre track ${trackId} has a canonical directory but its state is invalid or unreadable.`,
            {
              trackId,
              errors: validation.errors.filter((error) => error.includes(trackId))
            }
          );
        }
        const candidateId = `track-${trackId}`;
        if (!stagedCandidate) throw new Error(`unknown Cadre track ${trackId}`);
        if (view === "implementation") {
          throw new CadreError(
            "TRACK_CANDIDATE_ONLY",
            `Cadre track ${trackId} has a staged candidate but no canonical state; resume it with track status and candidate_inspect before implementation.`,
            { trackId, candidateId }
          );
        }
        return result({
          kind: "staged_track_candidate" as const,
          valid: validation.errors.length === 0 && stagedCandidate.valid,
          derivedStateCurrent: validation.warnings.length === 0,
          upgradeRequired: validation.project?.runtimeVersion !== CADRE_RUNTIME_VERSION
            || validation.project?.templateSetVersion !== TEMPLATE_SET_VERSION,
          targetRuntimeVersion: CADRE_RUNTIME_VERSION,
          targetTemplateSetVersion: TEMPLATE_SET_VERSION,
          trackId,
          candidate: stagedCandidate,
          errors: [...validation.errors, ...stagedCandidate.errors],
          focusedErrors: [...focusedValidationErrors(validation, root, [trackId]), ...stagedCandidate.errors],
          warnings: validation.warnings,
          nextAction: "Resume the track proposal with candidate_inspect; do not create canonical state before approval."
        }, `${trackId}: staged track candidate awaiting inspection or approval.`);
      }
      const dependencies = (track.dependencies ?? [])
        .map((id) => validation.tracks.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .map(trackSummary);
      const focused = {
        kind: "canonical_track" as const,
        valid: validation.errors.length === 0,
        derivedStateCurrent: validation.warnings.length === 0,
        upgradeRequired: validation.project?.runtimeVersion !== CADRE_RUNTIME_VERSION
          || validation.project?.templateSetVersion !== TEMPLATE_SET_VERSION,
        targetRuntimeVersion: CADRE_RUNTIME_VERSION,
        targetTemplateSetVersion: TEMPLATE_SET_VERSION,
        track: trackSummary(track),
        state: detail === "full" ? validation.states.get(trackId) ?? null : summarizeTrackState(validation.states.get(trackId)),
        detail, sources: trackSources(root, track.location),
        staleMemory: validation.staleMemory.filter((finding) => [trackId, ...dependencies.map((dependency) => dependency.id)].includes(finding.trackId)),
        dependencies,
        errors: validation.errors,
        focusedErrors: focusedValidationErrors(validation, root, [trackId, ...dependencies.map((dependency) => dependency.id)]),
        ...(stagedCandidate ? { stagedCandidate } : {}),
        warnings: validation.warnings
      };
      if (view === "track") {
        return result(focused, `${trackId}: ${track.status}; checkpoint=${track.checkpoint ?? "none"}.`);
      }
      const planPath = join(root, ".cadre", track.location, "plan.md");
      const graphErrors: string[] = [];
      const graph = validation.plans.get(trackId) ?? parsePlan(planPath, graphErrors);
      validatePlanGraph(planPath, graph, track.status, graphErrors);
      const activeExecutionId = executionId
        ?? (typeof track.operation?.executionId === "string" ? track.operation.executionId : undefined)
        ?? track.lastExecution?.executionId;
      const executionJournal = activeExecutionId ? executionStatus(root, trackId, activeExecutionId).journal : null;
      const execution = executionJournal ? compactExecutionStatus(executionJournal) : null;
      const worktreeStatus = managedWorktreeStatus(root);
      const trackWorktreeSegment = `${join(".cadre", ".worktrees", trackId)}/`;
      return result({
        ...focused,
        graph: { valid: graphErrors.length === 0, graph: detail === "full" ? graph : summarizeGraph(graph), errors: graphErrors },
        execution,
        ...(detail === "full" ? { executionJournal } : {}),
        worktrees: worktreeStatus.worktrees.filter((entry) => entry.path.includes(trackWorktreeSegment)),
        orphanedDirectories: worktreeStatus.orphanedDirectories.filter((path) => path.includes(trackWorktreeSegment))
      }, `${trackId}: implementation status is ${track.status}.`);
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.stateValidate, {
    title: "Validate Cadre project state",
    description: "Validate state.",
    inputSchema: { projectRoot: z.string().min(1) },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.stateValidate],
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      return result(serializableValidation(validateProject(safeProjectRoot(projectRoot))));
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.candidateStagePrepare, {
    title: "Prepare a Cadre candidate stage",
    description: "Prepare staging.",
    inputSchema: {
      projectRoot: z.string().min(1),
      candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      expectedFiles: z.array(z.string().min(1)).min(1).optional()
    },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.candidateStagePrepare],
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ projectRoot, candidateId, expectedFiles }) => {
    try {
      return result(
        prepareCandidateStage(projectRoot, candidateId, expectedFiles),
        `Prepared Cadre candidate stage ${candidateId}.`
      );
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.candidateInspect, {
    title: "Inspect staged artifact candidates",
    description: "Inspect staging.",
    inputSchema: z.strictObject({
      projectRoot: z.string().min(1),
      candidateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      files: z.array(z.string().min(1)).min(1),
      planValidations: z.array(z.object({
        path: z.string().min(1),
        targetStatus: z.enum(PLAN_VALIDATION_STATUSES)
      })).optional().default([])
    }),
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.candidateInspect],
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ projectRoot, candidateId, files, planValidations }) => {
    try {
      const root = safeProjectRoot(projectRoot);
      const candidates = readCandidateFiles(root, candidateId, files);
      validateStagedState(root, candidateId, candidates);
      const manifest = candidateManifest(candidates);
      const actualPaths = listCandidatePaths(root, candidateId);
      const expectedPaths = manifest.map((file) => file.path);
      if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error(
          `Candidate stage must contain exactly the declared files; expected ${expectedPaths.join(", ")}, found ${actualPaths.join(", ")}`
        );
      }
      const normalizedPlanValidations = planValidations
        .map((validation) => ({
          path: normalizeCandidatePath(validation.path),
          targetStatus: validation.targetStatus
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
      const validationPaths = normalizedPlanValidations.map((validation) => validation.path);
      if (new Set(validationPaths).size !== validationPaths.length) {
        throw new Error("Candidate planValidations contains duplicate paths");
      }
      for (const path of validationPaths) {
        if (path.split("/").at(-1) !== "plan.md") {
          throw new Error(`Candidate plan validation path must name plan.md: ${path}`);
        }
        if (!expectedPaths.includes(path)) {
          throw new Error(`Candidate plan validation path is not a declared staged file: ${path}`);
        }
      }
      const candidatePlanPaths = candidates
        .map((candidate) => candidate.path)
        .filter((path) => path.split("/").at(-1) === "plan.md")
        .sort();
      if (JSON.stringify(candidatePlanPaths) !== JSON.stringify(validationPaths)) {
        throw new Error(
          `Candidate planValidations must exactly match staged plan files; expected ${candidatePlanPaths.join(", ") || "none"}, found ${validationPaths.join(", ") || "none"}`
        );
      }
      const plans = normalizedPlanValidations.map((validation) => {
        const candidate = candidates.find((file) => file.path === validation.path)!;
        if (Buffer.byteLength(candidate.content, "utf8") > MAX_DRAFT_PLAN_CHARACTERS) {
          throw new Error(`Candidate plan exceeds ${MAX_DRAFT_PLAN_CHARACTERS} bytes: ${candidate.path}`);
        }
        const errors: string[] = [];
        const graph = parsePlanContent(candidate.content, candidate.path, errors);
        validatePlanGraph(candidate.path, graph, validation.targetStatus, errors);
        return { ...validation, valid: errors.length === 0, graph, errors };
      });
      const memory = inspectStagedMemory(root, candidateId, candidates);
      return result({
        candidateId,
        files: manifest,
        plans, learning: memory.learning, memoryInputs: memory.inputs, memoryPolicy: memory.policy,
        digest: sha256(JSON.stringify({
          projectRoot: root,
          candidateId,
          files: manifest,
          memoryInputs: memory.inputs, memoryPolicy: memory.policy,
          planValidations: normalizedPlanValidations
        }))
      }, `Inspected ${manifest.length} staged Cadre artifact${manifest.length === 1 ? "" : "s"}.`);
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.executionGraphValidate, {
    title: "Validate a track execution graph",
    description: "Validate plan DAG.",
    inputSchema: { projectRoot: z.string().min(1), trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.executionGraphValidate],
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
    approval: z.string().min(1),
    acceptedRisks: z.array(z.string().min(1)).optional()
  };

  registerTool(CADRE_MCP_TOOLS.reviewComplete, {
    title: "Complete a clean review",
    description: "Complete review.",
    inputSchema: adaptiveInputSchema(reviewCompleteSchema),
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.reviewComplete],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async ({ request }) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        request as Record<string, unknown>,
        ["projectRoot", "trackId", "approval"],
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

  registerTool(CADRE_MCP_TOOLS.archiveBatchCandidate, {
    title: "Govern a staged archive batch",
    description: "Apply archive batch.",
    inputSchema: adaptiveInputSchema(archiveBatchCandidateSchema),
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.archiveBatchCandidate],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async ({ request }) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        request as Record<string, unknown>,
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

  registerTool(CADRE_MCP_TOOLS.archiveBatchRecord, {
    title: "Record archive provenance",
    description: "Record archive.",
    inputSchema: archiveRecordSchema,
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.archiveBatchRecord],
    annotations: { destructiveHint: false, openWorldHint: false }
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

  registerTool(CADRE_MCP_TOOLS.executionStart, {
    title: "Start implementation execution",
    description: "Start execution.",
    inputSchema: executionStartSchema,
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.executionStart],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      requireFreshTrackMemory(input.projectRoot, input.trackId);
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
  const checkpointScopeSchema = {
    ...executionScopeSchema,
    nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/)
  };
  const commitSchema = z.string().regex(/^[0-9a-f]{7,40}$/);
  const evidenceSchema = z.string().min(1);
  const executionCheckpointActionSchema = z.discriminatedUnion("event", [
    z.strictObject({
      event: z.literal("start"),
      workerId: z.string().min(1).nullable().optional(),
      worktreePath: z.string().min(1).nullable().optional(),
      branch: z.string().min(1).nullable().optional(),
      verification: evidenceSchema.optional()
    }),
    z.strictObject({
      event: z.literal("record_commit"),
      handoff: handoffSchema.optional(),
      commit: commitSchema,
      verification: evidenceSchema,
      authorization: evidenceSchema
    }),
    z.strictObject({
      event: z.literal("record_integration"),
      commit: commitSchema,
      verification: evidenceSchema
    }),
    z.strictObject({
      event: z.literal("record_verification"),
      commit: commitSchema,
      verification: evidenceSchema,
      authorization: evidenceSchema
    }),
    z.strictObject({
      event: z.literal("complete"),
      commit: commitSchema.optional(),
      verification: evidenceSchema.optional(),
      authorization: evidenceSchema.optional()
    }),
    z.strictObject({ event: z.literal("block"), blocker: evidenceSchema, handoff: handoffSchema.optional() }),
    z.strictObject({ event: z.literal("resume") })
  ]);

  registerTool(CADRE_MCP_TOOLS.executionCheckpoint, {
    title: "Apply an execution checkpoint",
    description: "Checkpoint execution.",
    inputSchema: {
      scope: z.strictObject(checkpointScopeSchema),
      action: executionCheckpointActionSchema
    },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.executionCheckpoint],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async ({ scope, action }) => {
    try {
      const recoveryNode = ["complete", "record_integration"].includes(action.event)
        ? executionStatus(scope.projectRoot, scope.trackId, scope.executionId).journal.nodes[scope.nodeId] : undefined;
      const recovery = action.event === "block"
        || action.event === "complete" && ["committed", "integrated"].includes(recoveryNode?.status ?? "")
        || action.event === "record_integration" && recoveryNode?.status === "integrated";
      if (!recovery) requireCurrentProject(scope.projectRoot);
      if (["start", "resume", "record_commit", "record_verification"].includes(action.event)) requireFreshTrackMemory(scope.projectRoot, scope.trackId);
      const checkpointInput = { ...scope, ...action } as ExecutionCheckpointInput;
      const preview = previewExecutionCheckpoint(checkpointInput);
      const applied = applyExecutionCheckpoint(checkpointInput, preview.digest, preview);
      return result({
        commandStatus: "applied" as const,
        path: applied.path,
        transition: applied.transition,
        checkpoint: applied.journal.checkpoint,
        derivedStatus: executionSchedulerView(applied.journal, [checkpointInput.nodeId])
      });
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.executionStatus, {
    title: "Read implementation execution status",
    description: "Read execution.",
    inputSchema: {
      projectRoot: z.string().min(1),
      trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/),
      nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/).optional()
    },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.executionStatus],
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

  registerTool(CADRE_MCP_TOOLS.executionFinish, {
    title: "Complete implementation execution",
    description: "Finish execution.",
    inputSchema: executionFinishSchema,
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.executionFinish],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      requireFreshTrackMemory(input.projectRoot, input.trackId);
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

  registerTool(CADRE_MCP_TOOLS.worktreeCreate, {
    title: "Create a Cadre worker worktree",
    description: "Create worktree.",
    inputSchema: worktreeSchema,
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.worktreeCreate],
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      requireCurrentProject(input.projectRoot);
      requireFreshTrackMemory(input.projectRoot, input.trackId);
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

  registerTool(CADRE_MCP_TOOLS.integration, {
    title: "Integrate a worker branch",
    description: "Integrate branch.",
    inputSchema: adaptiveInputSchema(worktreeSchema),
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.integration],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async ({ request }) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        request as Record<string, unknown>,
        ["projectRoot", "trackId", "executionId", "nodeId"],
        "integration"
      );
      if (adaptive.mode === "apply") {
        const proposal = proposalTokens.resolve<WorktreeIntegrationInput>("worktree_integrate", adaptive.proposalToken);
        const recoveryPreview = previewWorktreeIntegration(proposal.input);
        if (recoveryPreview.alreadyIntegrated) {
          const applied = applyWorktreeIntegration(proposal.input, recoveryPreview.digest, recoveryPreview);
          return result({ commandStatus: "applied" as const, ...applied, ...recordIntegrationNow(proposal.input, recoveryPreview.targetHead) });
        }
        requireCurrentProject(proposal.input.projectRoot);
        requireFreshTrackMemory(proposal.input.projectRoot, proposal.input.trackId);
        const applied = applyWorktreeIntegration(proposal.input, proposal.digest);
        const checkpoint = applied.status === "integrated" && applied.mergeCommit
          ? recordIntegrationNow(proposal.input, applied.mergeCommit)
          : {};
        return result({ commandStatus: "applied" as const, ...applied, ...checkpoint }, `Integrated ${proposal.input.nodeId}.`);
      }
      const integrationInput = adaptive.request as unknown as WorktreeIntegrationInput;
      const preview = previewWorktreeIntegration(integrationInput);
      if (preview.alreadyIntegrated) {
        const applied = applyWorktreeIntegration(integrationInput, preview.digest, preview);
        return result({ commandStatus: "applied" as const, ...applied, ...recordIntegrationNow(integrationInput, preview.targetHead) });
      }
      requireCurrentProject(integrationInput.projectRoot);
      requireFreshTrackMemory(integrationInput.projectRoot, integrationInput.trackId);
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

  registerTool(CADRE_MCP_TOOLS.worktreeCleanup, {
    title: "Clean up an integrated worker",
    description: "Clean worktree.",
    inputSchema: worktreeSchema,
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.worktreeCleanup],
    annotations: { destructiveHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      const cleanupInput = input as WorktreeIntegrationInput;
      // Verified cleanup remains available during an upgrade; its invariants are unchanged.
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
    approvedAt: z.string().min(1),
    stagedFiles: z.array(z.string().min(1)).min(3),
    styleguideIds: z.array(z.string().min(1)).min(1)
  };

  registerTool(CADRE_MCP_TOOLS.projectInitCandidate, {
    title: "Initialize from a staged Cadre candidate",
    description: "Initialize project.",
    inputSchema: adaptiveInputSchema(initCandidateSchema),
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.projectInitCandidate],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async ({ request }) => {
    try {
      const adaptive = normalizeAdaptiveInput(
        request as Record<string, unknown>,
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
      const initRequest = adaptive.request as unknown as ProjectInitCandidateInput;
      const preview = previewProjectInitCandidate(initRequest);
      return proposalResult("project_init_candidate", initRequest, {
        runtimeVersion: preview.runtimeVersion,
        templateSetVersion: preview.templateSetVersion,
        files: preview.files.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
        digest: preview.digest
      });
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.setupRecordCommit, {
    title: "Record the project setup commit",
    inputSchema: { projectRoot: z.string().min(1) },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.setupRecordCommit],
    annotations: { destructiveHint: false, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      requireCurrentProject(projectRoot);
      const commit = resolveGitCommit(projectRoot);
      return result({ path: recordSetupCommit(projectRoot, commit), commit });
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.setupRecordGitInitialized, {
    title: "Record Git initialization checkpoint",
    inputSchema: { projectRoot: z.string().min(1) },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.setupRecordGitInitialized],
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ projectRoot }) => {
    try {
      requireCurrentProject(projectRoot);
      return result({ path: recordGitInitialized(projectRoot), checkpoint: "commit-pending" });
    } catch (error) {
      return failure(error);
    }
  });

  registerTool(CADRE_MCP_TOOLS.tracksRender, {
    title: "Render the derived tracks index",
    inputSchema: { projectRoot: z.string().min(1) },
    outputSchema: CADRE_MCP_OUTPUT_SCHEMAS[CADRE_MCP_TOOLS.tracksRender],
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false }
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
