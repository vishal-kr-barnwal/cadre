import { z } from "zod/v4";
import {
  EXECUTION_APPROVAL_MODES,
  EXECUTION_CHECKPOINT_EVENTS,
  EXECUTION_NODE_STATUSES
} from "../domain/execution.js";
import { TEMPLATE_IDS } from "../domain/templates.js";
import { CADRE_MCP_TOOLS, type CadreMcpToolName } from "./tool-names.js";

type ObjectSchema = z.ZodObject<z.ZodRawShape>;

const stringArray = z.array(z.string());
const pathSchema = z.string().min(1);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const commitSchema = z.string().regex(/^[0-9a-f]{7,40}$/);
const proposalTokenSchema = z.string().regex(/^cadre_pt1_[A-Za-z0-9_-]{32}$/);
const commandStatusSchema = z.enum(["approval_required", "applied"]);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const errorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string(),
  details: jsonObjectSchema.optional()
});

const errorOutputSchema = z.strictObject({ error: errorSchema });

/**
 * MCP SDK 1.x only publishes object-root output schemas. Expose the union's
 * complete field superset to clients, then retain exact success/error
 * validation through a Zod refinement on the server.
 */
function compatibleOutputSchema(...successSchemas: ObjectSchema[]) {
  const fields = new Map<string, z.ZodType[]>();
  for (const schema of successSchemas) {
    for (const [key, field] of Object.entries(schema.shape)) {
      const candidates = fields.get(key) ?? [];
      const candidate = field as z.ZodType;
      const signature = JSON.stringify(z.toJSONSchema(candidate));
      if (!candidates.some((existing) => JSON.stringify(z.toJSONSchema(existing)) === signature)) {
        candidates.push(candidate);
      }
      fields.set(key, candidates);
    }
  }
  const advertised = Object.fromEntries([...fields].map(([key, candidates]) => {
    const field = candidates.length === 1
      ? candidates[0]!
      : z.union(candidates as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    return [key, field.optional()];
  })) as z.ZodRawShape;
  return z.strictObject({ ...advertised, error: errorSchema.optional() }).superRefine((value, context) => {
    if (errorOutputSchema.safeParse(value).success) return;
    if (successSchemas.some((schema) => schema.safeParse(value).success)) return;
    context.addIssue({ code: "custom", message: "result does not match a declared Cadre output variant" });
  });
}

const artifactSchema = z.strictObject({ path: pathSchema, sha256: digestSchema });
const templateDescriptorSchema = z.strictObject({
  id: z.enum(TEMPLATE_IDS),
  uri: z.string().min(1),
  mimeType: z.string().min(1),
  sha256: digestSchema,
  artifactPath: pathSchema.optional()
});
const templateSetSchema = z.strictObject({
  templateSetVersion: z.string().min(1),
  templates: z.array(templateDescriptorSchema)
});

const planTaskSchema = z.strictObject({
  checked: z.boolean(),
  id: z.string(),
  phaseId: z.string(),
  ordinal: z.number().int(),
  title: z.string(),
  commit: commitSchema.nullable(),
  dependencies: stringArray,
  dependencyDeclared: z.boolean(),
  manualVerification: z.boolean(),
  line: z.number().int()
});
const planPhaseSchema = z.strictObject({
  number: z.number().int(),
  id: z.string(),
  title: z.string(),
  dependencies: stringArray,
  dependencyDeclared: z.boolean(),
  tasks: z.array(planTaskSchema),
  completionCommit: commitSchema.nullable().optional(),
  line: z.number().int(),
  trackVerification: z.boolean()
});
const planGraphSchema = z.strictObject({
  specRevision: z.number().int().nullable(),
  planRevision: z.number().int().nullable(),
  phases: z.array(planPhaseSchema),
  digest: digestSchema
});
const graphValidationSchema = z.strictObject({
  valid: z.boolean(),
  graph: planGraphSchema,
  errors: stringArray
});

const executionNodeStatusSchema = z.enum(EXECUTION_NODE_STATUSES);
const checkpointEventSchema = z.enum(EXECUTION_CHECKPOINT_EVENTS);
const executionNodeSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["phase", "task", "manual-verification"]),
  phaseId: z.string(),
  dependencies: stringArray,
  status: executionNodeStatusSchema,
  workerId: z.string().nullable(),
  workerHistory: stringArray.optional(),
  worktreePath: z.string().nullable(),
  branch: z.string().nullable(),
  workerCommit: commitSchema.nullable(),
  mergeCommit: commitSchema.nullable(),
  verification: z.string().nullable(),
  approval: z.string().nullable(),
  blocker: z.string().nullable()
});
const eventGuidanceSchema = z.record(z.string(), z.strictObject({
  currentStatus: executionNodeStatusSchema,
  allowed: z.array(z.strictObject({ event: checkpointEventSchema, requiredFields: stringArray }))
}));
const schedulerSchema = z.strictObject({
  readyPhases: stringArray,
  readyTasks: stringArray,
  active: stringArray,
  blocked: stringArray,
  eventGuidance: eventGuidanceSchema
});
const transitionSchema = z.strictObject({
  nodeId: z.string(),
  event: checkpointEventSchema,
  from: executionNodeStatusSchema,
  through: z.array(executionNodeStatusSchema),
  to: executionNodeStatusSchema,
  checkpoint: z.string()
});
const actionableNodeSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["phase", "task", "manual-verification"]),
  phaseId: z.string(),
  status: executionNodeStatusSchema,
  dependencies: stringArray,
  workerId: z.string().optional(),
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
  blocker: z.string().optional()
});
const executionStatusSchema = z.strictObject({
  execution: z.strictObject({
    executionId: z.string(),
    trackId: z.string(),
    status: z.enum(["in_progress", "completed"]),
    checkpoint: z.string(),
    requestedMode: z.enum(["parallel", "sequential"]),
    effectiveMode: z.enum(["parallel", "sequential"]),
    approvalMode: z.enum(EXECUTION_APPROVAL_MODES),
    maxWorkers: z.number().int(),
    planRevision: z.number().int(),
    startedAt: z.string(),
    completedAt: z.string().nullable()
  }),
  counts: z.partialRecord(executionNodeStatusSchema, z.number().int()),
  actionableNodes: z.array(actionableNodeSchema),
  node: executionNodeSchema.optional(),
  derivedStatus: schedulerSchema
});

const stagedCandidateSchema = z.strictObject({
  trackId: z.string(),
  candidateId: z.string(),
  canonicalState: z.enum(["absent", "active", "archived", "invalid"]),
  valid: z.boolean(),
  files: z.array(artifactSchema),
  errors: stringArray,
  nextAction: z.string()
});
const projectTrackSummarySchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  checkpoint: z.string().optional(),
  operation: z.string().optional(),
  dependencies: stringArray.optional()
});
const trackSummarySchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  checkpoint: z.string().nullable(),
  operation: z.string().nullable(),
  dependencies: stringArray,
  revision: z.number().int(),
  location: z.string()
});
const worktreeRuntimeSchema = z.strictObject({
  worktrees: z.array(z.strictObject({
    path: z.string(),
    branch: z.string().nullable(),
    head: commitSchema,
    managed: z.boolean()
  })),
  orphanedDirectories: stringArray
});
const projectStatusProjectSchema = z.strictObject({
  valid: z.boolean(),
  derivedStateCurrent: z.boolean(),
  project: z.strictObject({
    name: z.string().nullable(),
    context: z.string().nullable(),
    runtimeVersion: z.string().nullable(),
    templateSetVersion: z.string().nullable(),
    setup: z.strictObject({ status: z.string().nullable(), checkpoint: z.string().nullable() }).nullable(),
    lastRefresh: z.unknown()
  }).nullable(),
  upgradeRequired: z.boolean(),
  targetRuntimeVersion: z.string(),
  targetTemplateSetVersion: z.string(),
  counts: z.record(z.string(), z.number().int()),
  tracks: z.array(projectTrackSummarySchema),
  errors: stringArray,
  warnings: stringArray,
  stagedTrackCandidates: z.array(stagedCandidateSchema),
  worktreeRuntime: worktreeRuntimeSchema.nullable()
});
const stagedTrackStatusSchema = z.strictObject({
  kind: z.literal("staged_track_candidate"),
  valid: z.boolean(),
  derivedStateCurrent: z.boolean(),
  upgradeRequired: z.boolean(),
  targetRuntimeVersion: z.string(),
  targetTemplateSetVersion: z.string(),
  trackId: z.string(),
  candidate: stagedCandidateSchema,
  errors: stringArray,
  focusedErrors: stringArray,
  warnings: stringArray,
  nextAction: z.string()
});
const canonicalTrackStatusShape = {
  kind: z.literal("canonical_track"),
  valid: z.boolean(),
  derivedStateCurrent: z.boolean(),
  upgradeRequired: z.boolean(),
  targetRuntimeVersion: z.string(),
  targetTemplateSetVersion: z.string(),
  track: trackSummarySchema,
  state: jsonObjectSchema.nullable(),
  dependencies: z.array(trackSummarySchema),
  errors: stringArray,
  focusedErrors: stringArray,
  stagedCandidate: stagedCandidateSchema.optional(),
  warnings: stringArray
};
const canonicalTrackStatusSchema = z.strictObject(canonicalTrackStatusShape);
const implementationStatusSchema = z.strictObject({
  ...canonicalTrackStatusShape,
  graph: z.strictObject({ valid: z.boolean(), graph: jsonObjectSchema, errors: stringArray }),
  execution: executionStatusSchema.nullable(),
  worktrees: worktreeRuntimeSchema.shape.worktrees,
  orphanedDirectories: stringArray
});

const validationSchema = z.strictObject({
  valid: z.boolean(),
  derivedStateCurrent: z.boolean(),
  project: jsonObjectSchema.nullable(),
  tracks: z.array(jsonObjectSchema),
  errors: stringArray,
  warnings: stringArray
});
const stagePrepareSchema = z.strictObject({
  stagePath: pathSchema,
  gitignorePath: pathSchema,
  retainedFiles: stringArray,
  removedFiles: stringArray
});
const candidateInspectSchema = z.strictObject({
  candidateId: z.string(),
  files: z.array(artifactSchema),
  plans: z.array(z.strictObject({
    path: pathSchema,
    targetStatus: z.string(),
    valid: z.boolean(),
    graph: planGraphSchema,
    errors: stringArray
  })),
  digest: digestSchema
});

const approvalBase = { commandStatus: z.literal("approval_required"), proposalToken: proposalTokenSchema };
const appliedReceiptBase = {
  commandStatus: z.literal("applied"),
  digest: digestSchema,
  changedPaths: stringArray,
  changedCount: z.number().int().nonnegative()
};
const reviewPrepareSchema = z.strictObject({
  ...approvalBase,
  digest: digestSchema,
  trackId: z.string(),
  reviewedHead: commitSchema,
  commitRange: z.string(),
  targetStatus: z.string(),
  files: z.array(artifactSchema)
});
const reviewAppliedSchema = z.strictObject({
  ...appliedReceiptBase,
  trackId: z.string(),
  status: z.string(),
  checkpoint: z.string(),
  valid: z.boolean(),
  derivedStateCurrent: z.boolean()
});

const archiveMovePrepareSchema = z.strictObject({
  trackId: z.string(), sourcePath: pathSchema, targetPath: pathSchema, needsMove: z.boolean()
});
const archivePrepareSchema = z.strictObject({
  ...approvalBase,
  digest: digestSchema,
  batchId: z.string(),
  selectedTracks: stringArray,
  operationPath: pathSchema,
  checkpoint: z.string(),
  resuming: z.boolean(),
  moves: z.array(archiveMovePrepareSchema),
  writes: z.array(artifactSchema),
  tracks: artifactSchema
});
const archiveAppliedSchema = z.strictObject({
  ...appliedReceiptBase,
  batchId: z.string(),
  selectedTracks: stringArray,
  operationPath: pathSchema,
  checkpoint: z.string(),
  moves: z.array(z.strictObject({ trackId: z.string(), targetPath: pathSchema })),
  valid: z.boolean(),
  derivedStateCurrent: z.boolean()
});
const archiveRecordSchema = z.strictObject({
  ...appliedReceiptBase,
  batchId: z.string(),
  archiveCommit: commitSchema,
  checkpoint: z.string(),
  valid: z.boolean(),
  derivedStateCurrent: z.boolean()
});

const executionStartOutputSchema = z.strictObject({
  commandStatus: z.literal("applied"),
  journalPath: pathSchema,
  statePath: pathSchema,
  execution: z.strictObject({
    executionId: z.string(),
    trackId: z.string(),
    checkpoint: z.string(),
    requestedMode: z.enum(["parallel", "sequential"]),
    effectiveMode: z.enum(["parallel", "sequential"]),
    approvalMode: z.enum(EXECUTION_APPROVAL_MODES),
    maxWorkers: z.number().int(),
    nodeCount: z.number().int()
  }),
  derivedStatus: schedulerSchema
});
const checkpointOutputSchema = z.strictObject({
  commandStatus: z.literal("applied"),
  path: pathSchema,
  transition: transitionSchema,
  checkpoint: z.string(),
  derivedStatus: schedulerSchema
});
const executionFinishOutputSchema = z.strictObject({
  ...appliedReceiptBase,
  executionId: z.string(),
  status: z.literal("completed"),
  checkpoint: z.string(),
  headCommit: commitSchema
});

const worktreeCreateOutputSchema = z.strictObject({
  commandStatus: z.literal("applied"),
  projectRoot: pathSchema,
  path: pathSchema,
  relativePath: pathSchema,
  branch: z.string(),
  baseCommit: commitSchema,
  existing: z.boolean(),
  digest: digestSchema,
  transition: transitionSchema.nullable(),
  derivedStatus: schedulerSchema
});
const integrationPrepareSchema = z.strictObject({
  ...approvalBase,
  sourcePath: pathSchema,
  sourceBranch: z.string(),
  sourceHead: commitSchema,
  targetPath: pathSchema,
  targetBranch: z.string(),
  targetHead: commitSchema,
  changedFiles: stringArray,
  alreadyIntegrated: z.boolean(),
  digest: digestSchema
});
const integrationAppliedSchema = z.strictObject({
  commandStatus: z.literal("applied"),
  status: z.enum(["integrated", "conflicted"]),
  mergeCommit: commitSchema.nullable(),
  conflicts: stringArray,
  targetPath: pathSchema,
  transition: transitionSchema.optional(),
  derivedStatus: schedulerSchema.optional()
});
const cleanupOutputSchema = z.strictObject({
  commandStatus: z.literal("applied"),
  removedPath: pathSchema,
  removedBranch: z.string(),
  transition: transitionSchema.nullable(),
  derivedStatus: schedulerSchema
});

const initPrepareSchema = z.strictObject({
  ...approvalBase,
  runtimeVersion: z.string(),
  templateSetVersion: z.string(),
  files: z.array(artifactSchema),
  digest: digestSchema
});
const initAppliedSchema = z.strictObject({
  ...appliedReceiptBase,
  runtimeVersion: z.string(),
  templateSetVersion: z.string()
});
const setupCommitSchema = z.strictObject({ path: pathSchema, commit: commitSchema });
const setupGitSchema = z.strictObject({ path: pathSchema, checkpoint: z.literal("commit-pending") });
const tracksRenderSchema = z.strictObject({
  commandStatus: z.literal("applied"),
  path: pathSchema,
  sha256: digestSchema,
  changed: z.boolean(),
  writtenPath: pathSchema
});

const workflowOutcomeSchema = z.strictObject({
  kind: z.enum(["approval", "clarification"]),
  status: z.enum(["approved", "changes_requested", "answered", "declined", "cancelled", "fallback_required"]),
  binding: z.string().optional(),
  answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), stringArray])).optional(),
  fallback: z.string().optional()
});

export const CADRE_MCP_OUTPUT_SCHEMAS = {
  [CADRE_MCP_TOOLS.workflowElicit]: compatibleOutputSchema(workflowOutcomeSchema),
  [CADRE_MCP_TOOLS.templateGetMany]: compatibleOutputSchema(templateSetSchema),
  [CADRE_MCP_TOOLS.styleguideResolve]: compatibleOutputSchema(templateSetSchema),
  [CADRE_MCP_TOOLS.projectStatus]: compatibleOutputSchema(
    projectStatusProjectSchema,
    stagedTrackStatusSchema,
    canonicalTrackStatusSchema,
    implementationStatusSchema
  ),
  [CADRE_MCP_TOOLS.stateValidate]: compatibleOutputSchema(validationSchema),
  [CADRE_MCP_TOOLS.candidateStagePrepare]: compatibleOutputSchema(stagePrepareSchema),
  [CADRE_MCP_TOOLS.candidateInspect]: compatibleOutputSchema(candidateInspectSchema),
  [CADRE_MCP_TOOLS.executionGraphValidate]: compatibleOutputSchema(graphValidationSchema),
  [CADRE_MCP_TOOLS.reviewComplete]: compatibleOutputSchema(reviewPrepareSchema, reviewAppliedSchema),
  [CADRE_MCP_TOOLS.archiveBatchCandidate]: compatibleOutputSchema(archivePrepareSchema, archiveAppliedSchema),
  [CADRE_MCP_TOOLS.archiveBatchRecord]: compatibleOutputSchema(archiveRecordSchema),
  [CADRE_MCP_TOOLS.executionStart]: compatibleOutputSchema(executionStartOutputSchema),
  [CADRE_MCP_TOOLS.executionCheckpoint]: compatibleOutputSchema(checkpointOutputSchema),
  [CADRE_MCP_TOOLS.executionStatus]: compatibleOutputSchema(executionStatusSchema),
  [CADRE_MCP_TOOLS.executionFinish]: compatibleOutputSchema(executionFinishOutputSchema),
  [CADRE_MCP_TOOLS.worktreeCreate]: compatibleOutputSchema(worktreeCreateOutputSchema),
  [CADRE_MCP_TOOLS.integration]: compatibleOutputSchema(integrationPrepareSchema, integrationAppliedSchema),
  [CADRE_MCP_TOOLS.worktreeCleanup]: compatibleOutputSchema(cleanupOutputSchema),
  [CADRE_MCP_TOOLS.projectInitCandidate]: compatibleOutputSchema(initPrepareSchema, initAppliedSchema),
  [CADRE_MCP_TOOLS.setupRecordCommit]: compatibleOutputSchema(setupCommitSchema),
  [CADRE_MCP_TOOLS.setupRecordGitInitialized]: compatibleOutputSchema(setupGitSchema),
  [CADRE_MCP_TOOLS.tracksRender]: compatibleOutputSchema(tracksRenderSchema)
} satisfies Record<CadreMcpToolName, z.ZodType>;
