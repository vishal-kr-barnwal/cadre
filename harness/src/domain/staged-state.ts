import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateExecutionJournal, type ExecutionJournal } from "./execution.js";
import { parsePlanContent, validatePlanGraph } from "./plan.js";
import { contentHash, readSafeArtifact } from "./memory.js";
import { candidateArtifactPath, type CandidateFile } from "./staging.js";
import { validateTrackOperation } from "./state.js";

/** Validate relationships in the proposed state before a digest can be approved. */
export function validateStagedState(root: string, candidateId: string, files: CandidateFile[],
  planValidations: Array<{ path: string; targetStatus: string }> = []): void {
  const canonical = (path: string) => candidateArtifactPath(candidateId, path);
  const targets = new Map(planValidations.map((validation) => [canonical(validation.path), validation.targetStatus]));
  const overlay = new Map(files.map((file) => [canonical(file.path), file.content]));
  if (overlay.size !== files.length) throw new Error("Candidate paths alias the same canonical artifact; use one path per artifact");
  const read = (path: string) => overlay.get(path) ?? readSafeArtifact(root, `.cadre/${path}`);
  const parents = new Set<string>();
  for (const file of files) {
    if (/(?:^|\/)revisions\//.test(file.path) && !/(?:^|\/)revisions\/revision-[^/]+\.md$/.test(file.path)) {
      throw new Error(`Invalid revision artifact ${file.path}; use revisions/revision-<id>.md before approval`);
    }
    const affected = canonical(file.path).match(/^((?:tracks|archive)\/[^/]+)\/(?:state\.json|plan\.md|executions\/[^/]+\.json)$/);
    if (affected) parents.add(affected[1]!);
    const journalPath = canonical(file.path);
    if (candidateId.startsWith("revert-") && /\/executions\/execution-[^/]+\.json$/.test(journalPath)
      && existsSync(join(root, ".cadre", journalPath))) {
      const before = readSafeArtifact(root, `.cadre/${journalPath}`);
      const previous = JSON.parse(before) as ExecutionJournal, proposed = JSON.parse(file.content) as ExecutionJournal;
      const evidenceChanged = Object.entries(previous.nodes ?? {}).some(([id, node]) => {
        const next = proposed.nodes?.[id];
        return !next || ["workerCommit", "mergeCommit", "verification", "approval", "handoff", "workerHistory"].some(
          (field) => JSON.stringify(node[field as keyof typeof node]) !== JSON.stringify(next[field as keyof typeof next]));
      });
      const parent = journalPath.slice(0, journalPath.indexOf("/executions/"));
      if (evidenceChanged && ![...overlay].some(([path, body]) => path.startsWith(`${parent}/reverts/`)
        && path.endsWith("-execution-before.json") && body === before)) {
        throw new Error(`${file.path}: revert changes persisted execution evidence; include exact original journal bytes as reverts/revert-<id>-execution-before.json (SHA-256 ${contentHash(before)}) in the approved candidate`);
      }
    }
  }
  for (const parent of parents) {
    const path = `${parent}/state.json`;
    if (!overlay.has(path) && !existsSync(join(root, ".cadre", path))) continue; // New draft: no proposed state yet.
    const state = JSON.parse(read(path));
    if (!state || typeof state !== "object" || typeof state.trackId !== "string" || !parent.endsWith(`/${state.trackId}`)) {
      throw new Error(`${path}: staged state identity does not match its track`);
    }
    if (state.operation?.action === "revise" && !/^revisions\/revision-[^/]+\.md$/.test(state.operation.revisionPath ?? "")) {
      throw new Error(`${path}: invalid proposed revisionPath`);
    }
    const directory = join(root, ".cadre", parent, "executions");
    const paths = new Set(existsSync(directory) ? readdirSync(directory).filter((file) => /^execution-.+\.json$/.test(file)) : []);
    for (const key of overlay.keys()) if (key.startsWith(`${parent}/executions/`)) paths.add(key.slice(`${parent}/executions/`.length));
    const errors: string[] = [];
    validateTrackOperation(state, path, errors);
    const key = (absolute: string) => absolute.slice(join(root, ".cadre").length + 1);
    const plan = `${parent}/plan.md`;
    const graph = overlay.has(plan) || existsSync(join(root, ".cadre", plan)) ? parsePlanContent(read(plan), plan, errors) : null;
    const target = targets.get(plan) ?? state.status;
    const inspection = {
      read: (absolute) => JSON.parse(read(key(absolute))) as ExecutionJournal,
      exists: (absolute) => overlay.has(key(absolute)) || existsSync(absolute), journalPaths: [...paths]
    } satisfies NonNullable<Parameters<typeof validateExecutionJournal>[4]>;
    if (overlay.has(path) && target !== state.status) {
      errors.push(`${path}: staged status ${state.status} conflicts with plan targetStatus ${target}`);
    }
    let proposedState = state;
    if (!overlay.has(path) && target !== state.status) {
      // These skills stage artifacts before approval and persist the state transition only
      // during promotion. Validate the old execution against its own approved graph first.
      const workflow = candidateId.split("-")[0];
      const allowed = workflow === "review" && state.status === "ready_for_review" && target === "in_progress"
        || workflow === "revise" && ["planned", "in_progress", "ready_for_review"].includes(state.status) && ["planned", "in_progress"].includes(target)
        || workflow === "track" && ["drafting-spec", "drafting-plan"].includes(state.status) && target === "planned";
      if (!allowed) errors.push(`${path}: cannot infer ${state.status} -> ${target}; include the proposed state in the candidate`);
      else {
        // Drafting has no approved plan yet; a missing or malformed old draft must
        // not prevent inspection of its corrected candidate.
        const previous = ["drafting-spec", "drafting-plan"].includes(state.status) ? null
          : parsePlanContent(readSafeArtifact(root, `.cadre/${plan}`), plan, errors);
        if (previous) validatePlanGraph(plan, previous, state.status, errors);
        validateExecutionJournal(join(root, ".cadre", parent), state, previous, errors);
        proposedState = { ...state, status: target };
      }
    }
    if (existsSync(join(root, ".cadre", path))) {
      const previous = JSON.parse(readSafeArtifact(root, `.cadre/${path}`));
      if (["completed", "archived"].includes(previous.status) && !["completed", "archived"].includes(target)) {
        errors.push(`${path}: terminal tracks cannot be reopened; propose a successor track`);
      }
    }
    if (graph) validatePlanGraph(plan, graph, target, errors);
    validateExecutionJournal(join(root, ".cadre", parent), proposedState, graph, errors, inspection);
    if (errors.length) throw new Error(`${path}: ${errors.join("; ")}`);
  }
}
