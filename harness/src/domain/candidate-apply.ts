import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { candidateArtifactPath, listCandidatePaths, readCandidateFiles, type CandidateFile } from "./staging.js";
import { validateStagedState } from "./staged-state.js";
import { inspectStagedMemory } from "./staged-memory.js";
import { contentHash, readSafeArtifact } from "./memory.js";
import { parsePlanContent, validatePlanGraph } from "./plan.js";
import { inspectDependencyContext } from "./dependency-context.js";
import { committedReceiptForDigest, operationRef, promoteOperation, requireCommittedOperations, type ReceiptFile } from "./operation-receipts.js";
import { resolveGitCommit } from "./git.js";
import { safeProjectRoot } from "./paths.js";
import { buildTracks, type TracksIndexEntry } from "./tracks-index.js";
import { CADRE_RUNTIME_VERSION } from "./version.js";
import { deriveAutonomousReviewCandidate } from "./review-candidate.js";
import { candidateStateChanges } from "./candidate-state-changes.js";
import { deriveRevisionCandidate } from "./revision-candidate.js";
import { validateSpecContent } from "./state.js";
import { requireQuiescentExecution } from "./execution-quiescence.js";
import { requireRefreshAuthority } from "./refresh-authority.js";
import type { ExecutionJournal } from "./execution.js";

export interface CandidateApplyInput {
  projectRoot: string;
  candidateId: string;
  workflow: "track" | "revise" | "refresh" | "review" | "revert";
  files: string[];
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function allowed(input: CandidateApplyInput, path: string): boolean {
  if (input.workflow === "refresh") return /^(?:project\.json|\.gitignore|(?:product|guidelines|workflow|tech-stack)\.md|styleguides\/[a-z0-9-]+\.md|refreshes\/[a-z0-9-]+\.(?:md|json)|tracks\/[a-z0-9-]+\/(?:state\.json|spec\.md|plan\.md|learning\.md|dependency-context\.json|revisions\/revision-[a-z0-9-]+\.md|executions\/execution-[a-zA-Z0-9-]+\.json))$/.test(path);
  if (input.workflow === "revise" && /^tracks\/[a-z0-9-]+\/(?:state\.json|spec\.md|plan\.md|learning\.md|dependency-context\.json|revisions\/revision-[a-z0-9-]+\.md)$/.test(path)) return true;
  const owner = input.candidateId.slice(input.workflow.length + 1), parent = `tracks/${owner}/`;
  if (!path.startsWith(parent)) return false;
  const file = path.slice(parent.length);
  if (/^(?:state\.json|learning\.md|plan\.md|dependency-context\.json)$/.test(file)) return true;
  if (["track", "revise"].includes(input.workflow) && file === "spec.md") return true;
  if (input.workflow === "revise" && /^revisions\/revision-[a-z0-9-]+\.md$/.test(file)) return true;
  if (input.workflow === "review" && /^(?:bugs\/(?:review|bug)-[0-9]+\.md|reviews\/loop-[0-9]+\.json)$/.test(file)) return true;
  return input.workflow === "revert" && /^(?:executions\/execution-[a-zA-Z0-9-]+\.json|reverts\/revert-[a-z0-9-]+\.(?:json|md))$/.test(file);
}

export function previewCandidateApply(input: CandidateApplyInput) {
  requireCommittedOperations(input.projectRoot);
  const root = safeProjectRoot(input.projectRoot), baseCommit = resolveGitCommit(root);
  if (!input.candidateId.startsWith(`${input.workflow}-`)) throw new Error("Candidate ID must be owned by its workflow");
  const staged = readCandidateFiles(root, input.candidateId, input.files);
  if (JSON.stringify(listCandidatePaths(root, input.candidateId)) !== JSON.stringify(staged.map((file) => file.path).sort())) throw new Error("Candidate stage must contain exactly the approved manifest");
  const original = new Map(staged.map((file) => [candidateArtifactPath(input.candidateId, file.path), file.content]));
  if (original.size !== staged.length) throw new Error("Candidate aliases an artifact");
  for (const path of original.keys()) if (!allowed(input, path)) {
    const hint = input.workflow === "review" ? "; review bug artifacts must use bugs/review-<cycle>.md or bugs/bug-<number>.md with numeric suffixes"
      : input.workflow === "revert" ? "; revert artifact IDs use lowercase letters, digits and hyphens, e.g. reverts/revert-t1-1-execution-before.json for target T1.1"
      : input.workflow === "revise" ? "; revision artifact IDs use lowercase letters, digits and hyphens, e.g. revisions/revision-2.md" : "";
    throw new Error(`Candidate cannot promote ${path}${hint}`);
  }
  for (const [path, body] of original) if (/^tracks\/[^/]+\/spec\.md$/.test(path)) {
    const errors: string[] = []; validateSpecContent(body, path, errors);
    if (errors.length) throw new Error(errors.join("; "));
  }
  const project = JSON.parse(readSafeArtifact(root, ".cadre/project.json"));
  if (project.templateSetVersion !== "v5" && input.workflow !== "refresh") throw new Error("Refresh to v5 before using cohesive candidate promotion");
  const operationId = `${input.workflow}-${contentHash(JSON.stringify([root, baseCommit, [...original].sort()])).slice(0, 32)}`;
  const reference = operationRef(operationId), overlay = new Map(original), unchanged = new Map<string, string>();
  unchanged.set("project.json", contentHash(readSafeArtifact(root, ".cadre/project.json")));
  const read = (path: string): string => {
    if (overlay.has(path)) return overlay.get(path)!;
    const body = readSafeArtifact(root, `.cadre/${path}`); unchanged.set(path, contentHash(body)); return body;
  };
  const trackIds = new Set([...overlay.keys()].map((path) => /^tracks\/([^/]+)\//.exec(path)?.[1]).filter((id): id is string => Boolean(id)));
  if (input.workflow === "refresh") {
    if (!overlay.has("project.json")) throw new Error("Refresh requires proposed project.json");
    for (const entry of readdirSync(join(root, ".cadre/tracks"), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const previous = JSON.parse(readSafeArtifact(root, `.cadre/tracks/${entry.name}/state.json`));
      if (!["completed", "archived"].includes(previous.status)) trackIds.add(entry.name);
      if (previous.operation && previous.operation.action !== "implement") throw new Error("Refresh requires reconciliation of the active operation");
      if (previous.operation?.action === "implement") {
        const path = `tracks/${entry.name}/${previous.operation.journal}`;
        const journal = JSON.parse(readSafeArtifact(root, `.cadre/${path}`)) as ExecutionJournal;
        unchanged.set(path, contentHash(readSafeArtifact(root, `.cadre/${path}`)));
        requireQuiescentExecution(root, journal);
        if (overlay.has(path)) {
          const proposed = JSON.parse(overlay.get(path)!);
          const stable = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => !["approvalMode", "approvalPolicyVersion"].includes(key)));
          if (JSON.stringify(stable(proposed)) !== JSON.stringify(stable(journal))) throw new Error("Migration must preserve the original execution contract, nodes and evidence");
        }
      }
    }
    const next = JSON.parse(overlay.get("project.json")!);
    if (JSON.stringify(next.setup) !== JSON.stringify(project.setup) || JSON.stringify(next.history ?? []) !== JSON.stringify(project.history ?? [])) throw new Error("Refresh must preserve setup approval and project history");
    next.schemaVersion = 2; next.runtimeVersion = CADRE_RUNTIME_VERSION; next.templateSetVersion = "v5";
    next.lastRefresh = { ...(next.lastRefresh ?? {}), commit: reference };
    next.history = [...(next.history ?? []), { action: "refresh", commit: reference }];
    overlay.set("project.json", json(next));
    const ignore = read(".gitignore");
    overlay.set(".gitignore", ignore.replace(/\s*$/, "\n") + ["/stage/", "/.build-cache/cadre/"].filter((line) => !ignore.split(/\r?\n/).includes(line)).map((line) => `${line}\n`).join(""));
  }
  for (const id of trackIds) {
    const parent = `tracks/${id}`, path = `${parent}/state.json`;
    let state = JSON.parse(read(path));
    if (state.trackId !== id) throw new Error("Candidate state identity mismatch");
    if (!state.title || typeof state.title !== "string" || !["feature", "bug"].includes(state.type)
      || !Number.isInteger(state.revision) || state.revision < 1 || !Array.isArray(state.artifactProgress)
      || !Array.isArray(state.dependencies) || state.dependencies.includes(id)
      || new Set(state.dependencies).size !== state.dependencies.length) throw new Error("Candidate state requires a title, type, positive revision, artifact progress and unique non-self dependencies");
    const previous = existsSync(join(root, ".cadre", path)) ? JSON.parse(readSafeArtifact(root, `.cadre/${path}`)) : null;
    const recordAuthored = [...original.keys()].some((file) => file.startsWith(`${parent}/revisions/`));
    const modified = (file: string) => original.has(`${parent}/${file}`)
      && original.get(`${parent}/${file}`) !== readSafeArtifact(root, `.cadre/${parent}/${file}`);
    const refreshRevision = input.workflow === "refresh" && previous
      && (recordAuthored || modified("spec.md") || original.has(`${parent}/plan.md`)
        && parsePlanContent(original.get(`${parent}/plan.md`)!, `${parent}/plan.md`).digest
          !== parsePlanContent(readSafeArtifact(root, `.cadre/${parent}/plan.md`), `${parent}/plan.md`).digest);
    if (refreshRevision && project.templateSetVersion !== "v5") throw new Error("Complete legacy refresh migration before revising track scope");
    if (input.workflow === "review" && previous?.autonomousReview) {
      state = deriveAutonomousReviewCandidate(root, previous, original, reference);
      // Bind canonical authority and execution evidence to the promotion digest.
      unchanged.set(path, contentHash(readSafeArtifact(root, `.cadre/${path}`)));
    }
    if (previous && ["completed", "archived"].includes(previous.status)) throw new Error("Terminal tracks are immutable; create a successor");
    if (previous && JSON.stringify(state.history ?? []) !== JSON.stringify(previous.history ?? [])) throw new Error("Preserve historical state evidence; promotion appends its receipt reference");
    if (previous && input.workflow === "refresh") {
      if (!refreshRevision && state.revision !== previous.revision) throw new Error("Context-only refresh must preserve the track revision; include a complete revision proposal for changed scope");
      for (const key of ["lastExecution", "reviewCycles"]) if (JSON.stringify(state[key]) !== JSON.stringify(previous[key])) throw new Error(`Refresh must preserve ${key}`);
      requireRefreshAuthority(root, previous, state, original);
    }
    state.schemaVersion = 2;
    state.history = [...(state.history ?? []), { action: input.workflow, commit: reference }];
    if (input.workflow !== "revert") {
      state.commits = { ...state.commits,
        ...((input.workflow === "refresh" ? modified("spec.md") : overlay.has(`${parent}/spec.md`)) ? { spec: reference } : {}),
        ...((input.workflow === "refresh" ? modified("plan.md") : overlay.has(`${parent}/plan.md`)) ? { plan: reference } : {}) };
    }
    if (overlay.has(`${parent}/dependency-context.json`)) state.commits = { ...state.commits, dependencyContext: reference };
    if (input.workflow === "track") {
      if (previous && !["drafting-spec", "drafting-plan"].includes(previous.status)) throw new Error("Track already has an approved baseline");
      for (const file of ["spec.md", "plan.md", "learning.md", "state.json", "dependency-context.json"]) if (!original.has(`${parent}/${file}`)) throw new Error(`Combined track approval requires ${file}`);
      state.status = "planned"; state.checkpoint = "ready"; state.operation = null;
    }
    if (input.workflow === "review") {
      if (previous?.status !== "ready_for_review") throw new Error("Review remediation requires canonical ready_for_review state; reconcile an interrupted promotion first");
      if (state.status !== "in_progress") throw new Error("Review remediation requires proposed in_progress state; Autonomous derives it from the next-cycle loop snapshot, other modes must stage state.json");
    }
    if (refreshRevision || input.workflow === "revise" && previous
      && (recordAuthored || ["state.json", "spec.md", "plan.md"].some((file) => original.has(`${parent}/${file}`)))) {
      const revisionArtifacts = new Map(original);
      if (input.workflow === "refresh" && !modified("spec.md")) revisionArtifacts.delete(`${parent}/spec.md`);
      state = deriveRevisionCandidate(root, previous, state, revisionArtifacts, overlay, reference,
        (path) => { const body = readSafeArtifact(root, `.cadre/${path}`); unchanged.set(path, contentHash(body)); return body; });
    }
    const graph = parsePlanContent(read(`${parent}/plan.md`), `${parent}/plan.md`), errors: string[] = [];
    validatePlanGraph(`${parent}/plan.md`, graph, state.status, errors);
    if (errors.length) throw new Error(errors.join("; "));
    inspectDependencyContext(root, read(`${parent}/dependency-context.json`), state.dependencies ?? [], graph.specRevision, graph.planRevision, (path) => read(path.replace(/^\.cadre\//, "")));
    overlay.set(path, json(state));
  }
  const files: CandidateFile[] = [...overlay].map(([path, content]) => ({ path, content, absolutePath: join(root, ".cadre", path) }));
  validateStagedState(root, input.candidateId, files);
  const memory = inspectStagedMemory(root, input.candidateId, files);
  if (memory.learning.some((item) => !item.valid)) throw new Error("Candidate contains invalid or stale learning");
  const tracks: TracksIndexEntry[] = [];
  for (const location of ["tracks", "archive"]) {
    const ids = new Set(existsSync(join(root, ".cadre", location)) ? readdirSync(join(root, ".cadre", location), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []);
    if (location === "tracks") for (const id of trackIds) ids.add(id);
    for (const id of ids) {
      const state = JSON.parse(read(`${location}/${id}/state.json`));
      tracks.push({ id, title: state.title, status: state.status, type: state.type, revision: state.revision });
    }
  }
  overlay.set("tracks.md", buildTracks(tracks.sort((a, b) => a.id.localeCompare(b.id))));
  const promoted: ReceiptFile[] = [...overlay].map(([path, content]) => ({ path: `.cadre/${path}`, content }));
  const before = promoted.map((file) => ({ path: file.path, sha256: existsSync(join(root, file.path)) ? contentHash(readSafeArtifact(root, file.path)) : null }));
  const manifest = promoted.map((file) => ({ path: file.path, sha256: contentHash(file.content!) }));
  const digest = contentHash(JSON.stringify({ operationId, baseCommit, manifest, before, memoryInputs: memory.inputs, unchanged: [...unchanged].sort() }));
  const stateChanges = [...overlay].filter(([path]) => path === "project.json" || /^tracks\/[^/]+\/state\.json$/.test(path)).map(([path, content]) => ({
    path: `.cadre/${path}`,
    changes: candidateStateChanges(JSON.parse(original.get(path) ?? readSafeArtifact(root, `.cadre/${path}`)), JSON.parse(content))
  })).filter((item) => item.changes.length);
  const inputs = new Map([...unchanged, ...memory.inputs.map(({ path, sha256 }) => [path, sha256] as const)]);
  const recoveryInputs = [...inputs].filter(([path]) => !overlay.has(path)).sort(([a], [b]) => a.localeCompare(b))
    .map(([path, sha256]) => ({ path: `.cadre/${path}`, sha256 }));
  return { operationId, baseCommit, files: promoted, manifest, digest, memory, stateChanges, recoveryInputs, validation: { valid: true as const, errors: [] as string[] } };
}

export function applyCandidate(input: CandidateApplyInput, digest: string) {
  const committed = committedReceiptForDigest(input.projectRoot, input.workflow, digest);
  if (committed) return { ...committed, changedPaths: [], changedCount: 0, validation: { valid: true, errors: [] } };
  const preview = previewCandidateApply(input);
  if (preview.digest !== digest) throw new Error("Candidate or required context changed after approval; reassess and preview again");
  return { ...promoteOperation(input.projectRoot, { operationId: preview.operationId, kind: input.workflow, approvalDigest: digest, baseCommit: preview.baseCommit, inputs: preview.recoveryInputs }, preview.files),
    changedPaths: preview.files.map((file) => file.path), changedCount: preview.files.length, validation: preview.validation };
}
