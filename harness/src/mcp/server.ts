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
  resolveStyleguides,
  TEMPLATE_SET_VERSION,
  templateCatalog
} from "../domain/templates.js";
import { CADRE_RUNTIME_VERSION } from "../domain/version.js";
import { parsePlan, validatePlanGraph } from "../domain/plan.js";
import {
  EXECUTION_NODE_STATUSES,
  applyExecutionFinish,
  applyExecutionNodeUpdate,
  applyExecutionStart,
  executionStatus,
  previewExecutionFinish,
  previewExecutionNodeUpdate,
  previewExecutionStart,
  type ExecutionFinishInput,
  type ExecutionNodeUpdateInput,
  type ExecutionStartInput
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

function result<T extends object>(value: T, summary?: string) {
  return {
    content: [{ type: "text" as const, text: summary ?? JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>
  };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: error instanceof Error ? error.message : String(error)
    }]
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

export function createCadreServer(): McpServer {
  const server = new McpServer(
    { name: "cadre", version: CADRE_RUNTIME_VERSION },
    {
      instructions: [
        "Cadre provides deterministic, versioned templates and narrow project-state operations.",
        "Read every existing artifact before proposing edits. Never infer file contents.",
        "For any mutation, present the complete proposed artifacts to the human and obtain approval first.",
        "Call a preview tool immediately before its matching apply tool and pass the returned digest unchanged.",
        "Cadre state is resumable: inspect project_status and state_validate before continuing an interrupted command.",
        "The plan is the implementation source of truth. Cadre MCP exposes only constrained, digest-gated Git worktree operations and never approves its own changes."
      ].join(" ")
    }
  );

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
    inputSchema: { id: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ id }) => {
    try {
      return result(getTemplate(id));
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

  const executionStartSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/),
    requestedMode: z.enum(["parallel", "sequential"]),
    effectiveMode: z.enum(["parallel", "sequential"]),
    maxWorkers: z.number().int().min(1).max(32),
    baseCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    approvedAt: z.iso.datetime()
  };

  server.registerTool("execution_start_preview", {
    title: "Preview implementation execution",
    description: "Preview the exact resumable implementation journal and track operation for an approved plan DAG.",
    inputSchema: executionStartSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return result(previewExecutionStart(input as ExecutionStartInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_start_apply", {
    title: "Start implementation execution",
    description: "Write the approved implementation journal and operation only when its preview digest is unchanged.",
    inputSchema: { ...executionStartSchema, proposalDigest: z.string().regex(/^[0-9a-f]{64}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalDigest, ...input }) => {
    try {
      return result(applyExecutionStart(input as ExecutionStartInput, proposalDigest));
    } catch (error) {
      return failure(error);
    }
  });

  const executionNodeSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/),
    nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/),
    status: z.enum(EXECUTION_NODE_STATUSES),
    workerId: z.string().min(1).nullable().optional(),
    worktreePath: z.string().min(1).nullable().optional(),
    branch: z.string().min(1).nullable().optional(),
    workerCommit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable().optional(),
    mergeCommit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable().optional(),
    verification: z.string().min(1).nullable().optional(),
    approval: z.string().min(1).nullable().optional(),
    blocker: z.string().min(1).nullable().optional()
  };

  server.registerTool("execution_node_preview", {
    title: "Preview execution node transition",
    description: "Validate and preview one legal runtime node transition without changing its journal.",
    inputSchema: executionNodeSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return result(previewExecutionNodeUpdate(input as ExecutionNodeUpdateInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_node_apply", {
    title: "Apply execution node transition",
    description: "Apply one approved execution node transition only when its preview digest is unchanged.",
    inputSchema: { ...executionNodeSchema, proposalDigest: z.string().regex(/^[0-9a-f]{64}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalDigest, ...input }) => {
    try {
      return result(applyExecutionNodeUpdate(input as ExecutionNodeUpdateInput, proposalDigest));
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
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/),
    headCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    completedAt: z.iso.datetime()
  };

  server.registerTool("execution_finish_preview", {
    title: "Preview completed implementation execution",
    description: "Verify all DAG nodes, plan evidence, and worktree cleanup before proposing ready-for-review state.",
    inputSchema: executionFinishSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return result(previewExecutionFinish(input as ExecutionFinishInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("execution_finish_apply", {
    title: "Complete implementation execution",
    description: "Finalize an approved execution and mark it ready for review only when the preview is unchanged.",
    inputSchema: { ...executionFinishSchema, proposalDigest: z.string().regex(/^[0-9a-f]{64}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalDigest, ...input }) => {
    try {
      return result(applyExecutionFinish(input as ExecutionFinishInput, proposalDigest));
    } catch (error) {
      return failure(error);
    }
  });

  const worktreeSchema = {
    projectRoot: z.string().min(1),
    trackId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/),
    nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/),
    phaseId: z.string().regex(/^P\d+$/).nullable().optional()
  };

  server.registerTool("worktree_create_preview", {
    title: "Preview a Cadre worker worktree",
    description: "Resolve the constrained worker path, branch, and exact base commit without mutating Git.",
    inputSchema: { ...worktreeSchema, baseCommit: z.string().regex(/^[0-9a-f]{7,40}$/) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return result(previewWorktreeCreate(input as WorktreeCreateInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_create_apply", {
    title: "Create a Cadre worker worktree",
    description: "Create or reconcile one approved constrained worker worktree using an unchanged preview digest.",
    inputSchema: {
      ...worktreeSchema,
      baseCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
      proposalDigest: z.string().regex(/^[0-9a-f]{64}$/)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ proposalDigest, ...input }) => {
    try {
      return result(applyWorktreeCreate(input as WorktreeCreateInput, proposalDigest));
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
      return result(previewWorktreeIntegration(input as WorktreeIntegrationInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("integration_apply", {
    title: "Integrate a worker branch",
    description: "Merge an approved worker branch without squashing; report conflicts without resolving them.",
    inputSchema: { ...worktreeSchema, proposalDigest: z.string().regex(/^[0-9a-f]{64}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalDigest, ...input }) => {
    try {
      return result(applyWorktreeIntegration(input as WorktreeIntegrationInput, proposalDigest));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_cleanup_preview", {
    title: "Preview worker cleanup",
    description: "Verify a clean worker branch is fully integrated before proposing worktree and branch removal.",
    inputSchema: worktreeSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return result(previewWorktreeCleanup(input as WorktreeIntegrationInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("worktree_cleanup_apply", {
    title: "Clean up an integrated worker",
    description: "Remove only a clean, integrated Cadre worktree and its safely deletable branch.",
    inputSchema: { ...worktreeSchema, proposalDigest: z.string().regex(/^[0-9a-f]{64}$/) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalDigest, ...input }) => {
    try {
      return result(applyWorktreeCleanup(input as WorktreeIntegrationInput, proposalDigest));
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
    description: "Validate approved rendered artifacts and return the exact proposed .cadre file set and digest without writing.",
    inputSchema: initSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async (input) => {
    try {
      return result(previewProjectInit(input as ProjectInitInput));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("project_init_apply", {
    title: "Apply approved Cadre project initialization",
    description: "Atomically create .cadre only when the current proposal matches an approved preview digest.",
    inputSchema: { ...initSchema, proposalDigest: z.string().regex(/^[0-9a-f]{64}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ proposalDigest, ...input }) => {
    try {
      return result(applyProjectInit(input as ProjectInitInput, proposalDigest));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("setup_record_commit", {
    title: "Record the project setup commit",
    description: "Complete a pending create operation by recording its already-created Git commit SHA.",
    inputSchema: {
      projectRoot: z.string().min(1),
      commit: z.string().regex(/^[0-9a-f]{7,40}$/)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ projectRoot, commit }) => {
    try {
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
      return result(renderTracksPreview(safeProjectRoot(projectRoot)));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("tracks_render_apply", {
    title: "Apply the derived tracks index",
    description: "Rewrite tracks.md only when current state matches a human-approved preview digest.",
    inputSchema: {
      projectRoot: z.string().min(1),
      proposalDigest: z.string().regex(/^[0-9a-f]{64}$/)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ projectRoot, proposalDigest }) => {
    try {
      return result({ path: writeTracks(safeProjectRoot(projectRoot), proposalDigest) });
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
