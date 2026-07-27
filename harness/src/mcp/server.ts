import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
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

function serializableValidation(projectRoot: string) {
  const validation = validateProject(safeProjectRoot(projectRoot));
  return {
    valid: validation.errors.length === 0,
    project: validation.project,
    tracks: validation.tracks,
    errors: validation.errors
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
        "The plan is the implementation source of truth. Cadre MCP does not run Git commands or approve its own changes."
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
      return result({ text: status.text, ...serializableValidation(projectRoot) }, status.text);
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
      return result(serializableValidation(projectRoot));
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
