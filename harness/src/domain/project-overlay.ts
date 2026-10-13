import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSafeArtifact } from "./memory.js";
import { validateTrackSet } from "./track-set-validation.js";
import { validateStagedState } from "./staged-state.js";
import { validateProjectConfig } from "./project-config-validation.js";
import type { PromotionFile } from "./promotion-evidence.js";
import type { ProjectState, TrackState } from "./state.js";

/** Validate the complete proposed track set without writing a temporary control plane. */
export function requireProjectOverlay(root: string, files: PromotionFile[]): void {
  const overlay = new Map(files.map((file) => [file.path, file.content]));
  const paths = new Set(files.map((file) => file.path).filter((path) => /^\.cadre\/(?:tracks|archive)\/[^/]+\/state\.json$/.test(path)));
  for (const directory of ["tracks", "archive"]) {
    const base = join(root, ".cadre", directory);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) throw new Error(`Unsafe track directory: ${directory}/${entry.name}`);
      if (entry.isDirectory()) paths.add(`.cadre/${directory}/${entry.name}/state.json`);
    }
  }
  const errors: string[] = [];
  const projectPath = ".cadre/project.json", ignorePath = ".cadre/.gitignore";
  if (overlay.has(projectPath) || existsSync(join(root, projectPath))) {
    const project = overlay.has(projectPath) ? overlay.get(projectPath) : readSafeArtifact(root, projectPath);
    const ignore = overlay.has(ignorePath) ? overlay.get(ignorePath) : readSafeArtifact(root, ignorePath);
    if (!project || ignore === null) throw new Error("Promotion cannot remove required project configuration");
    validateProjectConfig(JSON.parse(project) as ProjectState, ignore, join(root, ignorePath), errors, []);
  }
  const tracks = [...paths].flatMap((path) => {
    const body = overlay.has(path) ? overlay.get(path) : readSafeArtifact(root, path);
    if (body === null) return [];
    const state = JSON.parse(body!) as TrackState;
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error(`${path}: invalid track state`);
    return [{location: path.slice(".cadre/".length, -"/state.json".length), state}];
  });
  validateTrackSet(tracks, errors);
  if (errors.length) throw new Error(errors.join("; "));
  validateStagedState(root, "promotion", files.filter((file) => file.content !== null).map((file) => ({
    path: file.path.slice(".cadre/".length), content: file.content!, absolutePath: join(root, file.path)
  })));
}
