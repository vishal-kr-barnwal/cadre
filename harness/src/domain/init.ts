import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import { isAbsolute, join, relative, resolve } from "node:path";
import { buildTracks } from "./state.js";
import { candidateStageRoot, listCandidatePaths, readCandidateFiles } from "./staging.js";
import { getTemplates } from "./templates.js";
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

const REQUIRED_APPROVED_FILES = new Set([
  "product.md", "guidelines.md", "tech-stack.md", "workflow.md", "styleguides/general.md"
]);

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
      `Initialization artifacts are relative to .cadre-stage/create; use ${normalized.slice("init/".length)} instead of ${normalized}`
    );
  }
  if (!REQUIRED_APPROVED_FILES.has(normalized) && !/^styleguides\/[a-z0-9-]+\.md$/.test(normalized)) {
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
  if (existsSync(join(root, ".cadre"))) throw new Error(`${root}/.cadre already exists`);
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
  for (const path of REQUIRED_APPROVED_FILES) {
    if (!approved.has(path)) throw new Error(`Missing approved initialization artifact: ${path}`);
  }

  const approvedPaths = [...approved.keys()].sort();
  const approvedArtifactHashes = approvedPaths.map((path) => ({ path, sha256: hash(approved.get(path)!) }));
  const [gitignoreTemplate, projectTemplate, patternIndexTemplate] = getTemplates([
    "project/gitignore", "project/project", "project/patterns/index"
  ]);
  const generated = new Map<string, string>([
    ...approved.entries(),
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
  return buildProjectInitProposal(loadProjectInitCandidate(input));
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

function applyProjectInitAtStage(
  input: MaterializedProjectInit,
  proposal: ProjectInitProposal,
  stage: string,
  replaceablePaths: Set<string> = new Set()
): ProjectInitProposal {
  const projectRoot = safeProjectRoot(input.projectRoot);
  if (existsSync(stage) && (!lstatSync(stage).isDirectory() || lstatSync(stage).isSymbolicLink())) {
    throw new Error(`Initialization stage is not a regular directory: ${stage}`);
  }
  mkdirSync(stage, { recursive: true });
  for (const file of proposal.files) {
    const target = targetWithin(stage, file.path);
    assertNoSymlinkPath(stage, target);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      const current = readFileSync(target, "utf8");
      if (current !== file.content) {
        if (!replaceablePaths.has(file.path)) throw new Error(`Interrupted initialization disagrees at ${file.path}`);
        writeFileSync(target, file.content);
      }
    } else writeFileSync(target, file.content);
  }
  const finalRoot = join(projectRoot, ".cadre");
  if (existsSync(finalRoot)) throw new Error(`${finalRoot} appeared after preview; refusing to overwrite it`);
  renameSync(stage, finalRoot);
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
  const stage = candidateStageRoot(input.projectRoot, "create");
  const replaceablePaths = new Set(materialized.files.map((file) => normalizeCadrePath(file.path)));
  return applyProjectInitAtStage(materialized, proposal, stage, replaceablePaths);
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
