import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentHash, inspectMemory, readSafeArtifact } from "./memory.js";
import { parsePlanContent } from "./plan.js";
import { candidateArtifactPath, type CandidateFile } from "./staging.js";
import { TEMPLATE_SET_VERSION, requiresVersionedMemory } from "./version.js";

/** Inspect the proposed overlay, including unchanged inputs that approval must bind. */
export function inspectStagedMemory(projectRoot: string, candidateId: string, files: CandidateFile[]) {
  const originalPaths = new Map(files.map((file) => [candidateArtifactPath(candidateId, file.path), file.path]));
  if (originalPaths.size !== files.length) throw new Error("Candidate paths alias the same canonical artifact; use one path per artifact");
  files = files.map((file) => ({ ...file, path: candidateArtifactPath(candidateId, file.path) }));
  const overlay = new Map(files.map((file) => [file.path, file.content]));
  const inputs = new Map<string, string>();
  const read = (path: string, fingerprint = true): string => {
    const staged = overlay.get(path);
    if (staged !== undefined) return staged;
    const body = readSafeArtifact(projectRoot, `.cadre/${path}`);
    if (fingerprint) inputs.set(path, contentHash(body));
    return body;
  };
  const persistedProject = existsSync(join(projectRoot, ".cadre/project.json"))
    ? JSON.parse(readSafeArtifact(projectRoot, ".cadre/project.json")) as { templateSetVersion?: string }
    : {};
  const project = (overlay.has("project.json") || existsSync(join(projectRoot, ".cadre/project.json"))
    ? JSON.parse(read("project.json", false)) : {}) as { templateSetVersion?: string };
  // Refresh promotion always stamps the current template set. A v1/v2 active
  // seed therefore must be explicitly staged and reseeded before approval.
  const legacyRefreshRequiresReseed = candidateId.startsWith("refresh-")
    && ["v1", "v2"].includes(persistedProject.templateSetVersion ?? "");
  const resultingTemplateSetVersion = legacyRefreshRequiresReseed
    ? TEMPLATE_SET_VERSION
    : project.templateSetVersion;
  const learningPaths = new Set(files.filter((file) => file.path.split("/").at(-1) === "learning.md").map((file) => file.path));
  const missingLegacyReseeds: Array<{ path: string; error: string }> = [];
  if (legacyRefreshRequiresReseed && existsSync(join(projectRoot, ".cadre/tracks"))) {
    for (const entry of readdirSync(join(projectRoot, ".cadre/tracks"), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;
      const statePath = `tracks/${entry.name}/state.json`;
      const state = JSON.parse(read(statePath, false)) as { status?: string };
      if (["completed", "archived"].includes(state.status ?? "")) continue;
      const learningPath = `tracks/${entry.name}/learning.md`;
      if (overlay.has(learningPath)) learningPaths.add(learningPath);
      else {
        missingLegacyReseeds.push({
          path: learningPath,
          error: `${learningPath}: refresh to ${TEMPLATE_SET_VERSION} requires explicitly staged and reseeded Pattern Seed memory for active track ${entry.name}`
        });
      }
    }
  }
  for (const file of files.filter((file) => file.path.split("/").at(-1) === "plan.md")) {
    const parent = dirname(file.path);
    const seed = parent === "." ? "learning.md" : `${parent}/learning.md`;
    const owner = candidateId.replace(/^(?:track|revise|review|revert)-/, "");
    const canonicalSeed = parent === "." ? `tracks/${owner}/learning.md` : seed;
    if (overlay.has(seed)) learningPaths.add(seed);
    else if (existsSync(join(projectRoot, ".cadre", canonicalSeed))) {
      // Evaluate the canonical seed against the proposed plan, even when the producer omitted it.
      learningPaths.add(canonicalSeed);
      overlay.set(`${dirname(canonicalSeed)}/plan.md`, file.content);
    }
  }
  const changedPatterns = files.some((file) => /^patterns\/.+\.md$/.test(file.path));
  if (changedPatterns && existsSync(join(projectRoot, ".cadre/tracks"))) {
    for (const entry of readdirSync(join(projectRoot, ".cadre/tracks"), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;
      const path = `tracks/${entry.name}/learning.md`;
      if (existsSync(join(projectRoot, ".cadre", path))) learningPaths.add(path);
    }
  }
  const historicalPaths: string[] = [];
  const learning = [...learningPaths].sort().map((path) => {
    const parent = dirname(path);
    const id = path.match(/(?:^|\/)tracks\/([a-z0-9-]+)\//)?.[1]
      ?? candidateId.replace(/^(?:track|revise|review|revert)-/, "");
    const canonicalParent = parent === "." ? `tracks/${id}` : parent;
    let historical = path.startsWith("archive/");
    const statePath = `${canonicalParent}/state.json`;
    if (overlay.has(statePath) || existsSync(join(projectRoot, ".cadre", statePath))) {
      const state = JSON.parse(read(statePath, false)) as { status?: string };
      historical ||= ["completed", "archived"].includes(state.status ?? "");
    }
    const stagedPlan = parent === "." ? "plan.md" : `${parent}/plan.md`;
    const planPath = overlay.has(stagedPlan) ? stagedPlan : `${canonicalParent}/plan.md`;
    const graph = overlay.has(planPath) || existsSync(join(projectRoot, ".cadre", planPath))
      ? parsePlanContent(read(planPath), planPath) : null;
    const reportedPath = originalPaths.get(path) ?? path;
    if (historical) historicalPaths.push(reportedPath);
    const inspected = inspectMemory({ trackId: id, path: reportedPath, body: read(path), graph,
      required: requiresVersionedMemory(resultingTemplateSetVersion), historical, readPattern: read });
    return { path: reportedPath, valid: inspected.errors.length === 0 && inspected.stale.length === 0,
      errors: inspected.errors, stale: inspected.stale };
  });
  for (const missing of missingLegacyReseeds) {
    learning.push({ path: missing.path, valid: false, errors: [missing.error], stale: [] });
  }
  learning.sort((left, right) => left.path.localeCompare(right.path));
  return { learning, policy: { templateSetVersion: resultingTemplateSetVersion ?? null, historicalPaths }, inputs: [...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })) };
}
