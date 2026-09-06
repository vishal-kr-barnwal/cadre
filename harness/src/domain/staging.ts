import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { safeProjectRoot } from "./paths.js";

export const CANDIDATE_STAGE_DIRECTORY = ".cadre/stage";
export const MAX_CANDIDATE_FILE_BYTES = 1024 * 1024;
export const MAX_CANDIDATE_TOTAL_BYTES = 8 * 1024 * 1024;

const CANDIDATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CandidateFile {
  path: string;
  absolutePath: string;
  content: string;
}

/** One canonical overlay identity for state, plans and learning. */
export function candidateArtifactPath(candidateId: string, path: string): string {
  const normalized = normalizeCandidatePath(path);
  const owner = candidateId.match(/^(?:track|revise|review|revert)-([a-z0-9-]+)$/)?.[1];
  return owner && !/^(?:tracks|archive|patterns|refreshes)\//.test(normalized)
    ? `tracks/${owner}/${normalized}` : normalized;
}

export function normalizeCandidateId(candidateId: string): string {
  if (!CANDIDATE_ID.test(candidateId)) {
    throw new Error("candidateId must contain lowercase letters, digits, and single hyphens");
  }
  return candidateId;
}

export function normalizeCandidatePath(input: string): string {
  if (!input || isAbsolute(input) || input.includes("\\")) {
    throw new Error(`Candidate artifact path must be a portable relative path: ${input}`);
  }
  const normalized = input.replace(/^\.\//, "");
  if (normalized === ".cadre" || normalized.startsWith(".cadre/")) {
    throw new Error(`Candidate paths are relative to the candidate stage, without a .cadre/ prefix: ${input}. Use state.json for the owned track or tracks/<id>/state.json for nested updates.`);
  }
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Candidate artifact path is not canonical: ${input}`);
  }
  return normalized;
}

export function candidateStageRoot(projectRootInput: string, candidateIdInput: string): string {
  const projectRoot = safeProjectRoot(projectRootInput);
  const candidateId = normalizeCandidateId(candidateIdInput);
  const cadreRoot = join(projectRoot, ".cadre");
  if (!existsSync(cadreRoot) || !lstatSync(cadreRoot).isDirectory() || lstatSync(cadreRoot).isSymbolicLink()) {
    throw new Error(`Cadre candidate root is unavailable or unsafe: ${cadreRoot}`);
  }
  const gitignorePath = join(cadreRoot, ".gitignore");
  if (!existsSync(gitignorePath) || !lstatSync(gitignorePath).isFile() || lstatSync(gitignorePath).isSymbolicLink()) {
    throw new Error(`Cadre candidate stage requires a regular ${gitignorePath}`);
  }
  if (!readFileSync(gitignorePath, "utf8").split(/\r?\n/).includes("/stage/")) {
    throw new Error(`${gitignorePath} must ignore /stage/ before candidate files are written`);
  }
  const stageParent = join(projectRoot, CANDIDATE_STAGE_DIRECTORY);
  if (existsSync(stageParent) && lstatSync(stageParent).isSymbolicLink()) {
    throw new Error(`Refusing candidate stage through symbolic link: ${stageParent}`);
  }
  return join(stageParent, candidateId);
}

export function prepareCandidateStage(projectRootInput: string, candidateIdInput: string, expectedFiles?: string[]): {
  stagePath: string;
  gitignorePath: string;
  retainedFiles: string[];
  removedFiles: string[];
} {
  const projectRoot = safeProjectRoot(projectRootInput);
  const candidateId = normalizeCandidateId(candidateIdInput);
  const normalizedExpected = expectedFiles?.map(normalizeCandidatePath);
  if (normalizedExpected && new Set(normalizedExpected).size !== normalizedExpected.length) {
    throw new Error("Candidate expectedFiles contains duplicate paths");
  }
  const cadreRoot = join(projectRoot, ".cadre");
  if (existsSync(cadreRoot)) {
    const stat = lstatSync(cadreRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe Cadre directory: ${cadreRoot}`);
  } else mkdirSync(cadreRoot);
  const gitignorePath = join(cadreRoot, ".gitignore");
  let content = "# Cadre-managed temporary execution worktrees\n/.worktrees/\n\n# Disposable Wisp output\n/wisps/\n";
  if (existsSync(gitignorePath)) {
    const stat = lstatSync(gitignorePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe Cadre ignore file: ${gitignorePath}`);
    content = readFileSync(gitignorePath, "utf8");
  }
  if (!content.split(/\r?\n/).includes("/stage/")) {
    content = `${content.endsWith("\n") ? content : `${content}\n`}\n# Unapproved candidate artifacts\n/stage/\n`;
    const temporaryPath = `${gitignorePath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaryPath, content, { flag: "wx" });
      renameSync(temporaryPath, gitignorePath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }
  const stagePath = join(cadreRoot, "stage", candidateId);
  mkdirSync(stagePath, { recursive: true });
  candidateStageRoot(projectRoot, candidateId);
  const retainedFiles = listCandidatePaths(projectRoot, candidateId);
  if (normalizedExpected === undefined) return { stagePath, gitignorePath, retainedFiles, removedFiles: [] };
  const expected = new Set(normalizedExpected);
  const removedFiles = retainedFiles.filter((path) => !expected.has(path));
  for (const path of removedFiles) unlinkSync(join(stagePath, path));
  const pruneEmptyDirectories = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) pruneEmptyDirectories(join(directory, entry.name));
    }
    if (directory !== stagePath && readdirSync(directory).length === 0) rmdirSync(directory);
  };
  pruneEmptyDirectories(stagePath);
  return {
    stagePath,
    gitignorePath,
    retainedFiles: retainedFiles.filter((path) => expected.has(path)),
    removedFiles
  };
}

function assertRegularPath(root: string, target: string): void {
  const relation = relative(root, target);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error(`Candidate artifact escapes its stage: ${target}`);
  }
  let current = target;
  while (current !== root) {
    if (!existsSync(current)) throw new Error(`Missing candidate artifact: ${target}`);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing candidate artifact through symbolic link: ${current}`);
    current = resolve(current, "..");
  }
  if (!existsSync(root)) throw new Error(`Missing candidate stage: ${root}`);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Candidate stage is not a regular directory: ${root}`);
  }
  const targetStat = lstatSync(target);
  if (!targetStat.isFile()) throw new Error(`Candidate artifact is not a regular file: ${target}`);
  if (targetStat.size > MAX_CANDIDATE_FILE_BYTES) {
    throw new Error(`Candidate artifact exceeds ${MAX_CANDIDATE_FILE_BYTES} bytes: ${target}`);
  }
}

export function readCandidateFiles(
  projectRootInput: string,
  candidateIdInput: string,
  paths: string[]
): CandidateFile[] {
  const root = candidateStageRoot(projectRootInput, candidateIdInput);
  const seen = new Set<string>();
  let totalBytes = 0;
  return paths.map((input): CandidateFile => {
    const path = normalizeCandidatePath(input);
    if (seen.has(path)) throw new Error(`Duplicate candidate artifact: ${path}`);
    seen.add(path);
    const absolutePath = resolve(root, path);
    assertRegularPath(root, absolutePath);
    const content = readFileSync(absolutePath, "utf8");
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > MAX_CANDIDATE_TOTAL_BYTES) {
      throw new Error(`Candidate stage exceeds ${MAX_CANDIDATE_TOTAL_BYTES} bytes`);
    }
    return { path, absolutePath, content };
  });
}

export function listCandidatePaths(projectRootInput: string, candidateIdInput: string): string[] {
  const root = candidateStageRoot(projectRootInput, candidateIdInput);
  if (!existsSync(root)) throw new Error(`Missing candidate stage: ${root}`);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Candidate stage is not a regular directory: ${root}`);
  }
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in candidate stage: ${target}`);
    if (stat.isDirectory()) return walk(target);
    if (!stat.isFile()) throw new Error(`Candidate stage contains a non-file entry: ${target}`);
    return [relative(root, target).split(sep).join("/")];
  });
  return walk(root).sort();
}
