import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, readFileSync, readdirSync
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { buildTracks } from "./state.js";
import { listCandidatePaths, readCandidateFiles } from "./staging.js";
import { describeTemplate, getTemplates } from "./templates.js";
import { CADRE_RUNTIME_VERSION, TEMPLATE_SET_VERSION } from "./version.js";
import { safeProjectRoot } from "./paths.js";
import { gitRoot } from "./git.js";
import { operationRef, promoteOperation, committedReceiptForDigest, pendingOperationForDigest, resumeOperation } from "./operation-receipts.js";
import { captureRepositoryBasis, type RepositoryBasis } from "./repository-basis.js";
import { readConfig, readSession } from "./github/storage.js";
import { readSafeArtifact } from "./memory.js";

export { CADRE_RUNTIME_VERSION } from "./version.js";
export { safeProjectRoot } from "./paths.js";

interface MaterializedArtifact {
  path: string;
  content: string;
}

interface MaterializedProjectInit {
  repositoryBasis?: RepositoryBasis;
  projectRoot: string;
  projectName: string;
  context: "greenfield" | "brownfield";
  gitDisposition: "existing" | "initialize";
  baseCommit: string | null;
  approvedAt: string;
  styleguideIds: string[];
  files: MaterializedArtifact[];
}

export interface ProjectInitCandidateInput {
  projectRoot: string;
  projectName: string;
  context: "greenfield" | "brownfield";
  gitDisposition: "existing" | "initialize";
  baseCommit: string | null;
  approvedAt: string;
  stagedFiles: string[];
  styleguideIds: string[];
}

export interface ProposedFile extends MaterializedArtifact {
  sha256: string;
}

export interface ProjectInitProposal {
  repositoryBasis?: RepositoryBasis;
  operationId?: string;
  receipt?: ReturnType<typeof promoteOperation>;
  runtimeVersion: string;
  templateSetVersion: string;
  files: ProposedFile[];
  digest: string;
}

const REQUIRED_STAGED_FILES = new Set(["product.md", "guidelines.md", "tech-stack.md"]);
const OPTIONAL_STAGED_FILE = /^(?:workflow\.md|styleguides\/[a-z0-9-]+\.md)$/;

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function proposalFileHash(file: ProposedFile): string {
  if (file.path !== "project.json") return file.sha256;
  const state = JSON.parse(file.content) as {
    setup?: { operation?: { approvedAt?: string } | null };
  };
  if (state.setup?.operation) state.setup.operation.approvedAt = "<audit-timestamp>";
  return hash(`${JSON.stringify(state, null, 2)}\n`);
}

function normalizeCadrePath(input: string): string {
  if (isAbsolute(input)) throw new Error(`Cadre artifact path must be relative: ${input}`);
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    throw new Error(`Cadre artifact path escapes the project: ${input}`);
  }
  if (normalized.startsWith("init/")) {
    throw new Error(
      `Initialization artifacts are relative to .cadre/stage/create; use ${normalized.slice("init/".length)} instead of ${normalized}`
    );
  }
  if (!REQUIRED_STAGED_FILES.has(normalized) && !OPTIONAL_STAGED_FILE.test(normalized)) {
    throw new Error(`Unsupported initialization artifact: ${input}`);
  }
  return normalized;
}

function assertRendered(content: string, path: string): void {
  if (/\{\{[^}]+\}\}/.test(content)) throw new Error(`${path} contains unresolved template placeholders`);
}

function projectState(
  input: MaterializedProjectInit,
  approvedPaths: string[],
  approvedArtifactHashes: Array<{ path: string; sha256: string }>,
  template: string
): string {
  const state = JSON.parse(template) as {
    runtimeVersion?: string;
    templateSetVersion?: string;
    project: { name: string; context: string };
    setup: {
      status: string;
      checkpoint: string;
      commit: string | null;
      artifactProgress: string[];
      operation: {
        baseCommit: string | null;
        repositoryRoot: string;
        gitDisposition: string;
        approvedArtifacts: string[];
        approvedArtifactHashes: Array<{ path: string; sha256: string }>;
        approvedAt: string;
      };
    };
  };
  state.runtimeVersion = CADRE_RUNTIME_VERSION;
  state.templateSetVersion = TEMPLATE_SET_VERSION;
  state.project = { name: input.projectName, context: input.context };
  state.setup.status = "in_progress";
  state.setup.checkpoint = input.gitDisposition === "initialize" ? "git-pending" : "commit-pending";
  state.setup.commit = null;
  state.setup.artifactProgress = approvedPaths;
  state.setup.operation.baseCommit = input.baseCommit;
  state.setup.operation.repositoryRoot = safeProjectRoot(input.projectRoot);
  state.setup.operation.gitDisposition = input.gitDisposition;
  state.setup.operation.approvedArtifacts = approvedPaths;
  state.setup.operation.approvedArtifactHashes = approvedArtifactHashes;
  state.setup.operation.approvedAt = input.approvedAt;
  return `${JSON.stringify(state, null, 2)}\n`;
}

function buildProjectInitProposal(input: MaterializedProjectInit): ProjectInitProposal {
  const root = safeProjectRoot(input.projectRoot);
  if (!input.projectName.trim()) throw new Error("Project name is required");
  if (!Number.isFinite(Date.parse(input.approvedAt))) throw new Error("approvedAt must be an ISO timestamp");
  if (input.baseCommit !== null && !/^[0-9a-f]{7,40}$/.test(input.baseCommit)) {
    throw new Error("baseCommit must be null or a hexadecimal Git commit SHA");
  }

  const approved = new Map<string, string>();
  for (const file of input.files) {
    const path = normalizeCadrePath(file.path);
    if (approved.has(path)) throw new Error(`Duplicate initialization artifact: ${path}`);
    assertRendered(file.content, path);
    approved.set(path, file.content.endsWith("\n") ? file.content : `${file.content}\n`);
  }
  for (const path of REQUIRED_STAGED_FILES) {
    if (!approved.has(path)) throw new Error(`Missing approved initialization artifact: ${path}`);
  }

  if (!Array.isArray(input.styleguideIds) || !input.styleguideIds.length) {
    throw new Error("Initialization requires at least the general styleguide ID");
  }
  if (new Set(input.styleguideIds).size !== input.styleguideIds.length) {
    throw new Error("Initialization styleguide IDs must be unique");
  }
  if (!input.styleguideIds.includes("project/styleguides/general")) {
    throw new Error("Initialization styleguide IDs must include project/styleguides/general");
  }
  if (input.styleguideIds.some((id) => id !== "project/styleguides/general" && !/^styleguide\/[a-z0-9-]+$/.test(id))) {
    throw new Error("Initialization styleguide IDs must reference bundled styleguides");
  }
  const [gitignoreTemplate, projectTemplate, patternIndexTemplate, workflowTemplate, ...styleguideTemplates] = getTemplates([
    "project/gitignore", "project/project", "project/patterns/index", "project/workflow", ...input.styleguideIds
  ]);
  const generatedContext = new Map<string, string>([["workflow.md", workflowTemplate!.content]]);
  for (const template of styleguideTemplates) {
    const descriptor = describeTemplate(template);
    if (!descriptor.artifactPath) throw new Error(`Styleguide ${template.id} has no artifact destination`);
    const content = template.id === "project/styleguides/general"
      ? template.content.replace("{{GENERAL_STYLE_ADDITIONS}}", "- None.")
      : template.content;
    generatedContext.set(descriptor.artifactPath, content);
  }
  for (const path of approved.keys()) {
    if (path.startsWith("styleguides/") && !generatedContext.has(path)) {
      throw new Error(`Initialization override ${path} is not in the selected styleguide set`);
    }
  }
  for (const [path, content] of approved) generatedContext.set(path, content);
  const approvedPaths = [...generatedContext.keys()].sort();
  const approvedArtifactHashes = approvedPaths.map((path) => ({ path, sha256: hash(generatedContext.get(path)!) }));
  const generated = new Map<string, string>([
    ...generatedContext.entries(),
    [".gitignore", gitignoreTemplate!.content],
    ["project.json", projectState(input, approvedPaths, approvedArtifactHashes, projectTemplate!.content)],
    ["patterns/index.md", patternIndexTemplate!.content],
    ["tracks.md", buildTracks([])],
    ["operations/.gitkeep", ""],
    ["tracks/.gitkeep", ""],
    ["archive/.gitkeep", ""],
    ["refreshes/.gitkeep", ""]
  ]);
  // Optional GitHub bootstrap artifacts already belong to the reserved setup PR.
  // Include their exact bytes in the ordinary approved initialization manifest.
  if (readConfig(input.projectRoot)) {
    const session = readSession(input.projectRoot);
    if (!session?.operation) throw new Error("Join the GitHub setup reservation before initialization");
    for (const path of ["github.json", `github/operations/${session.operation}.json`]) {
      generated.set(path, readSafeArtifact(input.projectRoot, `.cadre/${path}`));
    }
  }
  const files = [...generated.entries()]
    .map(([path, content]) => ({ path, content, sha256: hash(content) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  let digest = hash(JSON.stringify({
    runtimeVersion: CADRE_RUNTIME_VERSION,
    templateSetVersion: TEMPLATE_SET_VERSION,
    files: files.map((file) => ({ path: file.path, sha256: proposalFileHash(file) })),
    ...(input.repositoryBasis ? {repositoryBasis: input.repositoryBasis} : {})
  }));
  const operationId = `create-${digest.slice(0, 32)}`;
  const projectFile = files.find((file) => file.path === "project.json")!;
  const finalState = JSON.parse(projectFile.content);
  finalState.schemaVersion = 2;
  finalState.setup = { ...finalState.setup, status: "completed", checkpoint: "completed", commit: operationRef(operationId), operation: null };
  finalState.history = [...(finalState.history ?? []), { action: "create", commit: operationRef(operationId) }];
  projectFile.content = `${JSON.stringify(finalState, null, 2)}\n`;
  projectFile.sha256 = hash(projectFile.content);
  digest = hash(JSON.stringify({ files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    ...(input.repositoryBasis ? {repositoryBasis: input.repositoryBasis} : {}) }));
  return { runtimeVersion: CADRE_RUNTIME_VERSION, templateSetVersion: TEMPLATE_SET_VERSION, files, digest, operationId,
    ...(input.repositoryBasis ? {repositoryBasis: input.repositoryBasis} : {}) };
}

function loadProjectInitCandidate(input: ProjectInitCandidateInput): MaterializedProjectInit {
  const stagedFiles = input.stagedFiles.map(normalizeCadrePath).sort();
  const actualFiles = listCandidatePaths(input.projectRoot, "create");
  if (JSON.stringify(actualFiles) !== JSON.stringify(stagedFiles)) {
    throw new Error(
      `Initialization candidate manifest differs from staged files; expected ${stagedFiles.join(", ")}, found ${actualFiles.join(", ")}`
    );
  }
  const files = readCandidateFiles(input.projectRoot, "create", stagedFiles)
    .map(({ path, content }) => ({ path, content }));
  return { ...input, files };
}

export function previewProjectInitCandidate(input: ProjectInitCandidateInput): ProjectInitProposal {
  const proposal = buildProjectInitProposal(materializeCurrentInit(input));
  assertInitializationBootstrap(input.projectRoot, proposal);
  return proposal;
}

function materializeCurrentInit(input: ProjectInitCandidateInput): MaterializedProjectInit {
  const materialized = loadProjectInitCandidate(input), repositoryBasis = captureRepositoryBasis(input.projectRoot);
  if (input.gitDisposition === "existing") gitRoot(input.projectRoot);
  if (input.gitDisposition === "existing" ? repositoryBasis.head
    ? !input.baseCommit || !repositoryBasis.head.startsWith(input.baseCommit) : input.baseCommit !== null
    : input.baseCommit !== null || repositoryBasis.head !== null) {
    throw new Error("Initialization Git disposition/baseCommit differs from the current repository HEAD");
  }
  return {...materialized, repositoryBasis};
}

function assertInitializationBootstrap(projectRootInput: string, proposal: ProjectInitProposal): void {
  const root = safeProjectRoot(projectRootInput);
  const cadreRoot = join(root, ".cadre");
  if (!existsSync(cadreRoot) || !lstatSync(cadreRoot).isDirectory() || lstatSync(cadreRoot).isSymbolicLink()) {
    throw new Error(`${cadreRoot} must be a prepared candidate-stage directory`);
  }
  const expected = new Map(proposal.files.map((file) => [file.path, file.content]));
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      const path = relative(cadreRoot, target).replaceAll("\\", "/");
      if (path === "stage" || path.startsWith("stage/")) continue;
      if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link inside initialization state: ${target}`);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported initialization state entry: ${target}`);
      const content = expected.get(path);
      if (content === undefined) throw new Error(`${cadreRoot} contains unexpected canonical state: ${path}`);
      if (readFileSync(target, "utf8") !== content) {
        throw new Error(`Interrupted initialization disagrees at ${path}`);
      }
    }
  };
  visit(cadreRoot);
  const canonicalEntries = readdirSync(cadreRoot).filter((entry) => ![".gitignore", "stage"].includes(entry));
  if (canonicalEntries.length && !canonicalEntries.some((entry) => proposal.files.some((file) => file.path === entry || file.path.startsWith(`${entry}/`)))) {
    throw new Error(`${cadreRoot} contains unrelated canonical project state`);
  }
}

export function applyProjectInitCandidate(
  input: ProjectInitCandidateInput,
  proposalDigest: string
): ProjectInitProposal {
  const committed = committedReceiptForDigest(input.projectRoot, "create", proposalDigest);
  const pending = committed ? null : pendingOperationForDigest(input.projectRoot, "create", proposalDigest);
  if (committed || pending) return {runtimeVersion: CADRE_RUNTIME_VERSION, templateSetVersion: TEMPLATE_SET_VERSION,
    files: [], digest: proposalDigest, receipt: committed ?? resumeOperation(input.projectRoot, pending!, proposalDigest)};
  const materialized = materializeCurrentInit(input);
  const proposal = buildProjectInitProposal(materialized);
  if (proposal.digest !== proposalDigest) {
    throw new Error("Initialization candidate changed after preview; preview it again");
  }
  return { ...proposal, receipt: promoteOperation(input.projectRoot, {
    operationId: proposal.operationId!, kind: "create", approvalDigest: proposalDigest, baseCommit: materialized.repositoryBasis!.head,
    createBasis: materialized.repositoryBasis!
  }, proposal.files.map((file) => ({ path: `.cadre/${file.path}`, content: file.content }))) };
}
