import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { buildTracks } from "./state.js";
import { getTemplate } from "./templates.js";
import { CADRE_RUNTIME_VERSION, TEMPLATE_SET_VERSION } from "./version.js";

export { CADRE_RUNTIME_VERSION } from "./version.js";

export interface ApprovedFile {
  path: string;
  content: string;
}

export interface ProjectInitInput {
  projectRoot: string;
  projectName: string;
  context: "greenfield" | "brownfield";
  gitDisposition: "existing" | "initialize";
  baseCommit: string | null;
  approvedAt: string;
  files: ApprovedFile[];
}

export interface ProposedFile extends ApprovedFile {
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

export function safeProjectRoot(input: string): string {
  const root = resolve(input);
  if (root === parse(root).root || root === resolve(homedir())) {
    throw new Error(`Refusing broad project root ${root}`);
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Project root is not an existing directory: ${root}`);
  }
  return root;
}

function normalizeCadrePath(input: string): string {
  if (isAbsolute(input)) throw new Error(`Cadre artifact path must be relative: ${input}`);
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    throw new Error(`Cadre artifact path escapes the project: ${input}`);
  }
  if (!REQUIRED_APPROVED_FILES.has(normalized) && !/^styleguides\/[a-z0-9-]+\.md$/.test(normalized)) {
    throw new Error(`Unsupported initialization artifact: ${input}`);
  }
  return normalized;
}

function assertRendered(content: string, path: string): void {
  if (/\{\{[^}]+\}\}/.test(content)) throw new Error(`${path} contains unresolved template placeholders`);
}

function projectState(input: ProjectInitInput, approvedPaths: string[]): string {
  const state = JSON.parse(getTemplate("project/project").content) as {
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
  state.setup.operation.approvedAt = input.approvedAt;
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function previewProjectInit(input: ProjectInitInput): ProjectInitProposal {
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
  const generated = new Map<string, string>([
    ...approved.entries(),
    ["project.json", projectState(input, approvedPaths)],
    ["patterns/index.md", getTemplate("project/patterns/index").content],
    ["tracks.md", buildTracks([])],
    ["operations/.gitkeep", ""],
    ["tracks/.gitkeep", ""],
    ["archive/.gitkeep", ""],
    ["refreshes/.gitkeep", ""],
    ["wisps/.gitkeep", ""]
  ]);
  const files = [...generated.entries()]
    .map(([path, content]) => ({ path, content, sha256: hash(content) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const digest = hash(JSON.stringify({
    runtimeVersion: CADRE_RUNTIME_VERSION,
    templateSetVersion: TEMPLATE_SET_VERSION,
    files: files.map(({ path, sha256 }) => ({ path, sha256 }))
  }));
  return { runtimeVersion: CADRE_RUNTIME_VERSION, templateSetVersion: TEMPLATE_SET_VERSION, files, digest };
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

export function applyProjectInit(input: ProjectInitInput, proposalDigest: string): ProjectInitProposal {
  const proposal = previewProjectInit(input);
  if (proposal.digest !== proposalDigest) throw new Error("Initialization proposal digest does not match; preview again");
  const projectRoot = safeProjectRoot(input.projectRoot);
  const stage = join(projectRoot, `.cadre-init-${proposal.digest.slice(0, 12)}`);
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
      if (current !== file.content) throw new Error(`Interrupted initialization disagrees at ${file.path}`);
    } else writeFileSync(target, file.content);
  }
  const finalRoot = join(projectRoot, ".cadre");
  if (existsSync(finalRoot)) throw new Error(`${finalRoot} appeared after preview; refusing to overwrite it`);
  renameSync(stage, finalRoot);
  return proposal;
}

export function recordSetupCommit(projectRootInput: string, commit: string): string {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("commit must be a hexadecimal Git commit SHA");
  const root = safeProjectRoot(projectRootInput);
  const path = join(root, ".cadre", "project.json");
  const project = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & {
    setup?: Record<string, unknown> & { operation?: Record<string, unknown> | null };
    history?: unknown[];
  };
  if (project.setup?.status !== "in_progress" || project.setup.operation?.action !== "create") {
    throw new Error("Project setup is not awaiting its create commit");
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
