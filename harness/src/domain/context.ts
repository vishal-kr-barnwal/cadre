import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { CadreError } from "./errors.js";
import { inspectOnce } from "./inspection.js";
import { contentHash, handoffSchema, inspectMemory, readSafeArtifact, seedSection, sourceFreshness, type FreshnessFinding } from "./memory.js";
import { parsePlanContent, validatePlanGraph } from "./plan.js";
import { safeProjectRoot } from "./paths.js";
import type { ExecutionJournal } from "./execution.js";
import { markdownHeadings } from "./markdown-context.js";
import { inspectExecutionBindings } from "./execution-evidence.js";

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const contextInputSchema = z.strictObject({
  projectRoot: z.string().min(1), trackId: id,
  executionId: z.string().regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/).optional(),
  nodeId: z.string().regex(/^(?:P\d+|T\d+\.\d+)$/).optional(),
  maxBytes: z.number().int().min(4096).max(65536).default(16384),
  cursor: z.string().max(1024).optional(),
  knownSources: z.array(z.strictObject({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/),
    section: z.string(), contentHash: z.string().regex(/^[0-9a-f]{64}$/) })).max(256).default([])
});
export type ContextInput = z.input<typeof contextInputSchema>;
interface Source { path: string; sha256: string; reason: string; section: string; format: "source" | "handoff"; content: string }
export interface ContextExcerpt extends Source { offset: number; endOffset: number; sourceComplete: boolean; contentHash: string; reused: boolean }
export interface ContextPage {
  snapshot: string; complete: boolean; contextReady: boolean; nextCursor: string | null;
  totalSources: number; excerpts: ContextExcerpt[]; staleMemory: FreshnessFinding[]; errors: string[];
}
const cursorSchema = z.strictObject({ snapshot: z.string().regex(/^[0-9a-f]{64}$/), source: z.number().int().nonnegative(), offset: z.number().int().nonnegative() });

/** Retain general instructions and only scope phase history when headings are unambiguous. */
function learningSections(body: string, phaseIds: Set<string> | null): Array<{ section: string; content: string }> {
  if (!phaseIds || !seedSection(body)) return [{ section: "full learning (conservative)", content: body }];
  const parsed = markdownHeadings(body), headings = parsed.headings.filter((heading) => heading.level === 2);
  const matches = headings.filter((heading) => /^Phase \d+: .+$/.test(heading.title));
  const phaseId = (heading: (typeof matches)[number]) => `P${/^Phase (\d+):/.exec(heading.title)![1]}`;
  const present = new Set(matches.map(phaseId));
  if (parsed.ambiguous || present.size !== matches.length || [...phaseIds].some((phase) => !present.has(phase))
    || headings.some((heading) => heading.title !== "Pattern Seed" && !/^Phase \d+: .+$/.test(heading.title))) {
    return [{ section: "full learning (ambiguous or missing phase context)", content: body }];
  }
  const selected = [{ section: "Pattern Seed and general instructions", content: body.slice(0, matches[0]?.offset ?? body.length) }];
  matches.forEach((match, index) => {
    if (phaseIds.has(phaseId(match))) selected.push({ section: phaseId(match), content: body.slice(match.offset, matches[index + 1]?.offset ?? body.length) });
  });
  return selected;
}

function collectContext(input: z.output<typeof contextInputSchema>) {
  const root = safeProjectRoot(input.projectRoot), sources: Source[] = [], errors: string[] = [], staleMemory: FreshnessFinding[] = [];
  const inputHashes = new Map<string, string>();
  const read = (path: string) => { const body = readSafeArtifact(root, path); inputHashes.set(path, contentHash(body)); return body; };
  const add = (path: string, reason: string, section = "full"): string => {
    const content = read(path);
    sources.push({ path, sha256: contentHash(content), reason, section, format: "source", content });
    return content;
  };
  for (const path of ["workflow.md", "product.md", "guidelines.md", "tech-stack.md", "patterns/index.md"]) {
    add(`.cadre/${path}`, "required project instructions and applicability catalog");
  }
  // Applicability is not guessed: all project styleguides are included.
  const guides = join(root, ".cadre/styleguides");
  if (existsSync(guides)) for (const file of readdirSync(guides).filter((file) => /^[a-z0-9-]+\.md$/.test(file)).sort()) {
    add(`.cadre/styleguides/${file}`, "project styleguide; retain until applicability is established");
  }
  const project = JSON.parse(read(".cadre/project.json")) as { templateSetVersion?: string };
  const locate = (trackId: string) => {
    id.parse(trackId);
    const active = `.cadre/tracks/${trackId}`, archived = `.cadre/archive/${trackId}`;
    if (existsSync(join(root, active, "state.json")) && existsSync(join(root, archived, "state.json"))) throw new Error(`duplicate track ${trackId}`);
    return existsSync(join(root, active, "state.json")) ? active : archived;
  };
  const trackPath = locate(input.trackId);
  const stateBody = read(`${trackPath}/state.json`);
  const state = JSON.parse(stateBody) as { status: string; dependencies?: string[]; operation?: { executionId?: string }; lastExecution?: { executionId?: string } };
  errors.push(...inspectExecutionBindings(join(root, trackPath), state));
  add(`${trackPath}/spec.md`, "complete approved scope and acceptance criteria");
  const planBody = add(`${trackPath}/plan.md`, "complete plan, including task descriptions and verification requirements");
  const graph = parsePlanContent(planBody, `${trackPath}/plan.md`, errors);
  validatePlanGraph(`${trackPath}/plan.md`, graph, state.status, errors);
  let phases: Set<string> | null = null;
  if (input.nodeId) {
    const phase = graph.phases.find((phase) => phase.id === input.nodeId || phase.tasks.some((task) => task.id === input.nodeId));
    if (!phase) throw new Error(`unknown plan node ${input.nodeId}`);
    phases = new Set<string>();
    const visit = (phaseId: string) => {
      if (phases!.has(phaseId)) return;
      phases!.add(phaseId);
      const parent = graph.phases.find((phase) => phase.id === phaseId);
      if (!parent) throw new Error(`unknown dependency phase ${phaseId}`);
      parent.dependencies.forEach(visit);
    };
    visit(phase.id);
  }
  const patternPaths = new Set<string>();
  let uncertainPatterns = false;
  const addLearning = (path: string, trackId: string, historical: boolean, selected: Set<string> | null, plan: typeof graph) => {
    const body = read(path);
    const inspected = inspectMemory({ trackId, path, body, graph: plan, required: project.templateSetVersion === "v3",
      historical, readPattern: (path) => read(`.cadre/${path}`) });
    errors.push(...inspected.errors); staleMemory.push(...inspected.stale);
    if (!inspected.metadata) uncertainPatterns = true;
    if (!historical) for (const pattern of inspected.metadata?.patterns ?? []) patternPaths.add(pattern.path);
    for (const section of learningSections(body, selected)) sources.push({ path, sha256: contentHash(body),
      reason: "declared dependency learning and current phase decisions", format: "source", ...section });
  };
  addLearning(`${trackPath}/learning.md`, input.trackId, ["completed", "archived"].includes(state.status), phases, graph);
  const visited = new Set([input.trackId]);
  const visitDependency = (trackId: string) => {
    if (visited.has(trackId)) return;
    visited.add(trackId);
    const base = locate(trackId);
    const dependency = JSON.parse(read(`${base}/state.json`)) as { status: string; dependencies?: string[] };
    add(`${base}/spec.md`, "declared dependency contract");
    const plan = parsePlanContent(read(`${base}/plan.md`), `${base}/plan.md`);
    addLearning(`${base}/learning.md`, trackId, ["completed", "archived"].includes(dependency.status), null, plan);
    (dependency.dependencies ?? []).forEach(visitDependency);
  };
  (state.dependencies ?? []).forEach(visitDependency);
  if (uncertainPatterns) for (const path of readdirSync(join(root, ".cadre/patterns")).filter((path) => /^[a-z0-9-]+\.md$/.test(path) && path !== "index.md")) {
    patternPaths.add(`patterns/${path}`);
  }
  for (const path of [...patternPaths].sort()) {
    try { add(`.cadre/${path}`, uncertainPatterns ? "full pattern fallback: applicability metadata unavailable" : "explicit seed reference"); }
    catch (error) { errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const executionId = input.executionId ?? state.operation?.executionId ?? state.lastExecution?.executionId;
  if (executionId) {
    contextInputSchema.shape.executionId.parse(executionId);
    const path = `${trackPath}/executions/execution-${executionId}.json`, body = read(path);
    const journal = JSON.parse(body) as ExecutionJournal;
    if (journal.trackId !== input.trackId || journal.executionId !== executionId) throw new Error("execution identity mismatch");
    if (journal.graphDigest !== graph.digest) errors.push("execution handoffs belong to a different plan graph; reconcile before use");
    for (const node of Object.values(journal.nodes)) {
      if (phases && !phases.has(node.phaseId)) continue;
      const handoff = node.handoff === undefined ? null : handoffSchema.parse(node.handoff);
      if (!handoff && node.id !== input.nodeId) continue;
      const content = JSON.stringify({ nodeId: node.id, handoff, note: handoff ? "Persisted evidence, not authorization" : "not recorded",
        sources: handoff?.sources.map((reference) => ({ ...reference, freshness: sourceFreshness(root, reference, read) })) ?? [] });
      sources.push({ path, sha256: contentHash(body), section: node.id, reason: "persisted handoff; reconcile journal/Git before resuming", format: "handoff", content });
    }
  }
  const identity = { projectRoot: root, trackId: input.trackId, executionId: executionId ?? null, nodeId: input.nodeId ?? null,
    stateHash: contentHash(stateBody), inputs: [...inputHashes].sort(), sources, errors, staleMemory };
  return { sources, errors, staleMemory, snapshot: contentHash(JSON.stringify(identity)) };
}

export function readContext(raw: ContextInput): ContextPage {
  const input = contextInputSchema.parse(raw);
  return inspectOnce(() => {
    const collected = collectContext(input), { errors, staleMemory } = collected;
    const sources = collected.sources.map((source) => {
      const hash = contentHash(source.content);
      const reused = input.knownSources.some((known) => known.path === source.path && known.sha256 === source.sha256
        && known.section === source.section && known.contentHash === hash);
      return { ...source, contentHash: hash, reused, content: reused ? "" : source.content };
    });
    const snapshot = contentHash(JSON.stringify({ sources: collected.snapshot, knownSources: input.knownSources }));
    const cursor = input.cursor ? cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))) : { snapshot, source: 0, offset: 0 };
    if (cursor.snapshot !== snapshot) throw new CadreError("CONTEXT_SNAPSHOT_CHANGED", "Required sources changed; restart context_read without a cursor.");
    if (cursor.source >= sources.length || cursor.offset > sources[cursor.source]!.content.length) throw new Error("invalid context cursor position");
    let source = cursor.source, offset = cursor.offset;
    const page: ContextPage = { snapshot, complete: false, contextReady: false, nextCursor: null, totalSources: sources.length, excerpts: [], errors, staleMemory };
    const encode = () => Buffer.from(JSON.stringify({ snapshot, source, offset })).toString("base64url");
    // Reserve continuation overhead; measure serialized bytes, not character or token estimates.
    while (source < sources.length) {
      const item = sources[source]!;
      let low = 0, high = item.content.length - offset, take = 0;
      const excerpt = (length: number): ContextExcerpt => ({ ...item, content: item.content.slice(offset, offset + length), offset,
        endOffset: offset + length, sourceComplete: offset + length === item.content.length });
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const bytes = Buffer.byteLength(JSON.stringify({ ...page, excerpts: [...page.excerpts, excerpt(mid)], nextCursor: encode() }));
        if (bytes <= input.maxBytes - 64) { take = mid; low = mid + 1; } else high = mid - 1;
      }
      // Do not split a Unicode surrogate pair.
      if (take && /[\uD800-\uDBFF]/.test(item.content[offset + take - 1]!)) take--;
      if (!take && item.content.length > offset) break;
      page.excerpts.push(excerpt(take)); offset += take;
      if (offset === item.content.length) { source++; offset = 0; } else break;
    }
    if (!page.excerpts.length) throw new CadreError("CONTEXT_PAGE_TOO_SMALL", "Context findings or metadata exceed the page budget; increase maxBytes and inspect diagnostics.");
    page.complete = source === sources.length;
    page.contextReady = page.complete && !errors.length && !staleMemory.length;
    page.nextCursor = page.complete ? null : encode();
    return page;
  });
}
