export const CADRE_RUNTIME_VERSION = "3.9.0";
export const LEGACY_RUNTIME_VERSIONS = ["3.8.0", "3.7.1", "3.7.0", "3.6.0", "3.5.1", "3.5.0", "3.4.0", "3.3.0"] as const;
export const TEMPLATE_SET_VERSION = "v6";
export const LEGACY_TEMPLATE_SET_VERSIONS = ["v1", "v2", "v3", "v4", "v5"] as const;

/** A runtime identity this package recognizes in `.cadre/project.json`. */
export type RuntimeVersion = typeof CADRE_RUNTIME_VERSION | (typeof LEGACY_RUNTIME_VERSIONS)[number];
/** A superseded template set; only an approved refresh moves a project off it. */
export type LegacyTemplateSetVersion = (typeof LEGACY_TEMPLATE_SET_VERSIONS)[number];

const VERSIONED_MEMORY_LEGACY_TEMPLATE_SET_VERSIONS = new Set<string>(["v3", "v4", "v5"]);

export function requiresVersionedMemory(templateSetVersion: unknown): boolean {
  return templateSetVersion === TEMPLATE_SET_VERSION
    || typeof templateSetVersion === "string" && VERSIONED_MEMORY_LEGACY_TEMPLATE_SET_VERSIONS.has(templateSetVersion);
}

/** A published runtime/template pair that a project may still record before its approved refresh. */
export interface ContinuableExecutionRelease {
  readonly runtimeVersion: RuntimeVersion;
  readonly templateSetVersion: LegacyTemplateSetVersion;
}

/**
 * Pre-refresh project versions whose existing executions may continue under their original contract.
 *
 * Refresh migration requires a quiescent execution boundary, so an upgrade must not strand an
 * execution mid-flight. A project recorded at one of these pairs may still checkpoint, finish,
 * create worker worktrees for, and integrate an execution that already exists until it reaches
 * that boundary. Starting a new execution, candidate promotion, review completion, archive, and
 * every other mutation still require the approved refresh.
 *
 * Entries are literal published releases rather than the current runtime, so a version bump never
 * widens the exception implicitly. When a release changes the active template set, add the
 * previous release's pair here.
 */
export const CONTINUABLE_EXECUTION_RELEASES = [
  // Executions started by published 3.9.0 on template set v5, now that v6 is current.
  { runtimeVersion: "3.9.0", templateSetVersion: "v5" },
  // The 3.9.0 rule for executions on template set v4, retained unchanged.
  { runtimeVersion: "3.9.0", templateSetVersion: "v4" },
  { runtimeVersion: "3.8.0", templateSetVersion: "v4" }
] as const satisfies readonly ContinuableExecutionRelease[];

/**
 * Whether a project recorded at this runtime/template pair may continue an execution that already
 * exists: always for the current pair, otherwise only for a listed pre-refresh release. Inputs come
 * from untrusted project JSON, so any other value is rejected.
 */
export function mayContinueExecution(runtimeVersion: unknown, templateSetVersion: unknown): boolean {
  if (runtimeVersion === CADRE_RUNTIME_VERSION && templateSetVersion === TEMPLATE_SET_VERSION) return true;
  return CONTINUABLE_EXECUTION_RELEASES.some((release) =>
    release.runtimeVersion === runtimeVersion && release.templateSetVersion === templateSetVersion);
}
