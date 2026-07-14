import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ProjectControlJsonPath {
  ok: true;
  root: string;
  file: string;
  relative: string;
  controlDir: string;
}

export interface ProjectControlPathError {
  ok: false;
  error: string;
}

export type ProjectControlPathResult = ProjectControlJsonPath | ProjectControlPathError;

export interface ContainedProjectPath {
  ok: true;
  root: string;
  file: string;
  relative: string;
}

export type ContainedProjectPathResult = ContainedProjectPath | ProjectControlPathError;

export interface OwnedProjectControlJsonPath extends ProjectControlJsonPath {
  workspaceRoot: string;
}

export type OwnedProjectControlPathResult = OwnedProjectControlJsonPath | ProjectControlPathError;

export interface ProjectControlJsonRead {
  ok: true;
  value: unknown;
}

export type ProjectControlJsonReadResult = ProjectControlJsonRead | ProjectControlPathError;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalProjectRoot(root: string): string | null {
  try {
    const canonical = fs.realpathSync(path.resolve(root));
    return fs.statSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}

function requestedSegments(requested: string): string[] | null {
  if (
    !requested
    || requested.includes("\0")
    || path.posix.isAbsolute(requested)
    || path.win32.isAbsolute(requested)
  ) {
    return null;
  }
  const segments = requested.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments;
}

function lstatIfPresent(file: string): ReturnType<typeof fs.lstatSync> | null {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function safeExistingControlPlane(controlDir: string): ProjectControlPathError | null {
  try {
    const stat = lstatIfPresent(controlDir);
    if (!stat) return null;
    if (stat.isSymbolicLink()) return { ok: false, error: "Cadre config directory must not be a symbolic link" };
    if (!stat.isDirectory()) return { ok: false, error: "Cadre config directory is not a directory" };
    return null;
  } catch (error) {
    return { ok: false, error: `Cannot inspect Cadre config directory: ${errorMessage(error)}` };
  }
}

function safeExistingConfigFile(file: string): ProjectControlPathError | null {
  try {
    const stat = lstatIfPresent(file);
    if (!stat) return null;
    if (stat.isSymbolicLink()) return { ok: false, error: "Cadre config file must not be a symbolic link" };
    if (!stat.isFile()) return { ok: false, error: "Cadre config path is not a regular file" };
    return null;
  } catch (error) {
    return { ok: false, error: `Cannot inspect Cadre config file: ${errorMessage(error)}` };
  }
}

/**
 * Resolve a configurable JSON file in the project control plane. Config files
 * are deliberately limited to the caller's direct `cadre/<namespace>*.json`
 * family so setup cannot overwrite unrelated control-plane or project files.
 */
export function resolveProjectControlJsonPath(
  root: string,
  requested: string | undefined,
  defaultRelative: string,
): ProjectControlPathResult {
  const canonicalRoot = canonicalProjectRoot(root);
  if (!canonicalRoot) return { ok: false, error: "Project root does not exist or is not a directory" };
  const relativeInput = requested || defaultRelative;
  const segments = requestedSegments(relativeInput);
  const defaultSegments = requestedSegments(defaultRelative);
  const defaultName = defaultSegments?.length === 2 && defaultSegments[0] === "cadre"
    ? defaultSegments[1] as string
    : "";
  const defaultStem = path.basename(defaultName, ".json");
  const requestedName = segments?.[1] || "";
  const namespaceMatch = requestedName === defaultName
    || (requestedName.startsWith(`${defaultStem}-`) && requestedName.length > `${defaultStem}-.json`.length);
  if (
    !segments
    || segments.length !== 2
    || segments[0] !== "cadre"
    || path.extname(requestedName).toLowerCase() !== ".json"
    || !namespaceMatch
  ) {
    return {
      ok: false,
      error: `Cadre config must be ${defaultRelative} or a relative cadre/${defaultStem}-*.json path without traversal`,
    };
  }
  const controlDir = path.join(canonicalRoot, "cadre");
  const file = path.join(controlDir, segments[1] as string);
  const controlError = safeExistingControlPlane(controlDir);
  if (controlError) return controlError;
  const fileError = safeExistingConfigFile(file);
  if (fileError) return fileError;
  return {
    ok: true,
    root: canonicalRoot,
    file,
    relative: `cadre/${segments[1]}`,
    controlDir,
  };
}

/**
 * Resolve a control-plane config owned by one trusted Cadre root for use in a
 * potentially different workspace (for example, a polyrepo child). The owner
 * root must come from an application-controlled project resolution, never from
 * an untrusted tool argument.
 */
export function resolveOwnedProjectControlJsonPath(
  workspaceRoot: string,
  ownerRoot: string,
  requested: string | undefined,
  defaultRelative: string,
): OwnedProjectControlPathResult {
  const canonicalWorkspace = canonicalProjectRoot(workspaceRoot);
  if (!canonicalWorkspace) return { ok: false, error: "Review workspace root does not exist or is not a directory" };
  const owned = resolveProjectControlJsonPath(ownerRoot, requested, defaultRelative);
  if (!owned.ok) return owned;
  return { ...owned, workspaceRoot: canonicalWorkspace };
}

/** Read and parse a previously resolved config without following a final symlink. */
export function readProjectControlJson(resolved: ProjectControlJsonPath): ProjectControlJsonReadResult {
  let descriptor: number | null = null;
  try {
    const pathStat = fs.lstatSync(resolved.file);
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      return { ok: false, error: "Cadre config path is not a regular non-symlink file" };
    }
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(resolved.file, fs.constants.O_RDONLY | noFollow);
    const openStat = fs.fstatSync(descriptor);
    if (!openStat.isFile() || openStat.dev !== pathStat.dev || openStat.ino !== pathStat.ino) {
      return { ok: false, error: "Cadre config file changed during secure open" };
    }
    const value: unknown = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: `Cannot read Cadre config: ${errorMessage(error)}` };
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Best-effort cleanup after a failed read.
      }
    }
  }
}

/** Write JSON atomically after repeating all path and symlink checks. */
export function writeProjectControlJson(
  root: string,
  requested: string | undefined,
  defaultRelative: string,
  value: unknown,
): ProjectControlPathResult {
  const initial = resolveProjectControlJsonPath(root, requested, defaultRelative);
  if (!initial.ok) return initial;
  try {
    if (!fs.existsSync(initial.controlDir)) fs.mkdirSync(initial.controlDir, { mode: 0o700 });
  } catch (error) {
    return { ok: false, error: `Cannot create Cadre config directory: ${errorMessage(error)}` };
  }
  const resolved = resolveProjectControlJsonPath(root, requested, defaultRelative);
  if (!resolved.ok) return resolved;
  const temporary = path.join(resolved.controlDir, `.${path.basename(resolved.file)}.${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow,
      0o600,
    );
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    const finalCheck = resolveProjectControlJsonPath(root, requested, defaultRelative);
    if (!finalCheck.ok) return finalCheck;
    fs.renameSync(temporary, finalCheck.file);
    return finalCheck;
  } catch (error) {
    return { ok: false, error: `Cannot write Cadre config: ${errorMessage(error)}` };
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Best-effort cleanup after a failed write.
      }
    }
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Best-effort cleanup after a failed write.
    }
  }
}

/**
 * Resolve an arbitrary project-relative file while containing existing symlink
 * targets. Non-existent leaf paths are allowed when their nearest existing
 * ancestor remains inside the project.
 */
export function resolveContainedProjectPath(root: string, requested: string): ContainedProjectPathResult {
  const canonicalRoot = canonicalProjectRoot(root);
  if (!canonicalRoot) return { ok: false, error: "Project root does not exist or is not a directory" };
  if (!requested || requested.includes("\0")) return { ok: false, error: "Project file path is required" };

  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(lexicalRoot, requested);
  if (!isContained(lexicalRoot, lexicalCandidate)) {
    return { ok: false, error: "Project file path must stay inside the project root" };
  }
  const lexicalRelative = path.relative(lexicalRoot, lexicalCandidate);
  const candidate = path.resolve(canonicalRoot, lexicalRelative);
  if (!isContained(canonicalRoot, candidate)) {
    return { ok: false, error: "Project file path must stay inside the project root" };
  }

  try {
    let existing = candidate;
    while (!lstatIfPresent(existing) && existing !== canonicalRoot) existing = path.dirname(existing);
    const canonicalExisting = fs.realpathSync(existing);
    if (!isContained(canonicalRoot, canonicalExisting)) {
      return { ok: false, error: "Project file path resolves outside the project root" };
    }
    const canonicalCandidate = lstatIfPresent(candidate) ? fs.realpathSync(candidate) : candidate;
    if (!isContained(canonicalRoot, canonicalCandidate)) {
      return { ok: false, error: "Project file path resolves outside the project root" };
    }
    return {
      ok: true,
      root: canonicalRoot,
      file: canonicalCandidate,
      relative: path.relative(canonicalRoot, canonicalCandidate).split(path.sep).join("/"),
    };
  } catch (error) {
    return { ok: false, error: `Cannot inspect project file path: ${errorMessage(error)}` };
  }
}
