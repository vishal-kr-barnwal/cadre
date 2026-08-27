import { createHash, randomUUID } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import { isAbsolute, join, relative, resolve } from "node:path";
import { buildTracks } from "./state.js";
import { candidateStageRoot, listCandidatePaths, readCandidateFiles } from "./staging.js";
import { describeTemplate, getTemplates } from "./templates.js";
import { CADRE_RUNTIME_VERSION, TEMPLATE_SET_VERSION } from "./version.js";
import { safeProjectRoot } from "./paths.js";
import { readGitFileAtCommit } from "./git.js";

export { CADRE_RUNTIME_VERSION } from "./version.js";
export { safeProjectRoot } from "./paths.js";

interface MaterializedArtifact {
  path: string;
  content: string;
}

interface MaterializedProjectInit {
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
  const files = [...generated.entries()]
    .map(([path, content]) => ({ path, content, sha256: hash(content) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const digest = hash(JSON.stringify({
    runtimeVersion: CADRE_RUNTIME_VERSION,
    templateSetVersion: TEMPLATE_SET_VERSION,
    files: files.map((file) => ({ path: file.path, sha256: proposalFileHash(file) }))
  }));
  return { runtimeVersion: CADRE_RUNTIME_VERSION, templateSetVersion: TEMPLATE_SET_VERSION, files, digest };
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
  const proposal = buildProjectInitProposal(loadProjectInitCandidate(input));
  assertInitializationBootstrap(input.projectRoot, proposal);
  return proposal;
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

function targetWithin(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  const relation = relative(root, target);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error(`Path escapes initialization root: ${relativePath}`);
  return target;
}

function assertNoSymlinkPath(root: string, target: string): void {
  let current = target;
  while (current !== root) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symbolic link inside initialization stage: ${current}`);
    }
    current = dirname(current);
  }
}

function applyProjectInitAtRoot(
  input: MaterializedProjectInit,
  proposal: ProjectInitProposal
): ProjectInitProposal {
  const projectRoot = safeProjectRoot(input.projectRoot);
  const cadreRoot = join(projectRoot, ".cadre");
  for (const file of proposal.files) {
    const target = targetWithin(cadreRoot, file.path);
    assertNoSymlinkPath(cadreRoot, target);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      const current = readFileSync(target, "utf8");
      if (current !== file.content) throw new Error(`Interrupted initialization disagrees at ${file.path}`);
      continue;
    }
    const temporaryPath = join(dirname(target), `.cadre-init-${process.pid}-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporaryPath, file.content, { flag: "wx" });
      renameSync(temporaryPath, target);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }
  return proposal;
}

export function applyProjectInitCandidate(
  input: ProjectInitCandidateInput,
  proposalDigest: string
): ProjectInitProposal {
  const materialized = loadProjectInitCandidate(input);
  const proposal = buildProjectInitProposal(materialized);
  if (proposal.digest !== proposalDigest) {
    throw new Error("Initialization candidate changed after preview; preview it again");
  }
  return applyProjectInitAtRoot(materialized, proposal);
}

export function recordSetupCommit(projectRootInput: string, commit: string): string {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("commit must be a hexadecimal Git commit SHA");
  const root = safeProjectRoot(projectRootInput);
  const path = join(root, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & {
    setup?: Record<string, unknown> & {
      operation?: (Record<string, unknown> & {
        approvedArtifactHashes?: Array<{ path: string; sha256: string }>;
      }) | null;
    };
    history?: unknown[];
  };
  if (project.setup?.status !== "in_progress" || project.setup.operation?.action !== "create") {
    throw new Error("Project setup is not awaiting its create commit");
  }
  if (project.setup.checkpoint !== "commit-pending") {
    throw new Error(`Project setup checkpoint is ${String(project.setup.checkpoint)}, not commit-pending`);
  }
  for (const artifact of project.setup.operation.approvedArtifactHashes ?? []) {
    const artifactPath = targetWithin(join(root, ".cadre"), normalizeCadrePath(artifact.path));
    if (!existsSync(artifactPath) || lstatSync(artifactPath).isSymbolicLink()) {
      throw new Error(`Approved setup artifact is unavailable: ${artifact.path}`);
    }
    if (hash(readFileSync(artifactPath, "utf8")) !== artifact.sha256) {
      throw new Error(`Approved setup artifact changed before commit recording: ${artifact.path}`);
    }
    if (hash(readGitFileAtCommit(root, commit, `.cadre/${artifact.path}`)) !== artifact.sha256) {
      throw new Error(`Setup commit does not contain the approved artifact: ${artifact.path}`);
    }
  }
  project.setup.status = "completed";
  project.setup.checkpoint = "completed";
  project.setup.commit = commit;
  project.setup.operation = null;
  project.history = [...(project.history ?? []), { action: "create", commit }];
  writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`);
  return path;
}

export function recordGitInitialized(projectRootInput: string): string {
  const root = safeProjectRoot(projectRootInput);
  const path = join(root, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(path, "utf8")) as ProjectStateForSetup;
  if (project.setup?.status !== "in_progress" || project.setup.operation?.action !== "create") {
    throw new Error("Project setup is not in an active create operation");
  }
  if (project.setup.operation.gitDisposition !== "initialize") {
    throw new Error("Project setup was not approved to initialize Git");
  }
  if (resolve(String(project.setup.operation.repositoryRoot)) !== root) {
    throw new Error("Approved Git repository root does not match projectRoot");
  }
  project.setup.checkpoint = "commit-pending";
  writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`);
  return path;
}

interface ProjectStateForSetup {
  setup?: {
    status?: string;
    checkpoint?: string;
    operation?: {
      action?: string;
      gitDisposition?: string;
      repositoryRoot?: string;
    } | null;
  };
  [key: string]: unknown;
}
