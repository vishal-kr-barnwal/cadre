import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_TEMPLATE_SET_VERSIONS, TEMPLATE_SET_VERSION } from "./version.js";

export { TEMPLATE_SET_VERSION } from "./version.js";

export interface TemplateRecord {
  id: string;
  uri: string;
  relativePath: string;
  mimeType: string;
  content: string;
  sha256: string;
}

export interface TemplateDescriptor extends Omit<TemplateRecord, "relativePath"> {
  artifactPath?: string;
}

export const TEMPLATE_SET_VERSIONS = [...LEGACY_TEMPLATE_SET_VERSIONS, TEMPLATE_SET_VERSION] as readonly string[];

export const TEMPLATE_IDS = [
  "project/archive-operation",
  "project/gitignore",
  "project/guidelines",
  "project/pattern",
  "project/patterns/index",
  "project/product",
  "project/project",
  "project/refresh",
  "project/refresh-operation",
  "project/styleguides/general",
  "project/styleguides/language",
  "project/tech-stack",
  "project/tracks",
  "project/workflow",
  "styleguide/dart",
  "styleguide/flutter",
  "styleguide/go",
  "styleguide/gradle",
  "styleguide/html-css",
  "styleguide/index",
  "styleguide/java",
  "styleguide/javascript",
  "styleguide/kotlin",
  "styleguide/maven",
  "styleguide/python",
  "styleguide/react",
  "styleguide/swift",
  "styleguide/swiftui",
  "styleguide/typescript",
  "track/bug",
  "track/dependency-context",
  "track/execution",
  "track/learning",
  "track/plan",
  "track/revert-operation",
  "track/revise-operation",
  "track/revision",
  "track/spec",
  "track/state"
] as const;

const TEMPLATE_ARTIFACT_PATHS: Partial<Record<(typeof TEMPLATE_IDS)[number], string>> = {
  "track/dependency-context": "dependency-context.json",
  "track/revision": "revisions/revision-<id>.md",
  "project/refresh": "refreshes/refresh-<id>.md",
  "project/refresh-operation": "operations/refresh-<id>.json",
  "project/gitignore": ".gitignore",
  "project/guidelines": "guidelines.md",
  "project/patterns/index": "patterns/index.md",
  "project/product": "product.md",
  "project/project": "project.json",
  "project/styleguides/general": "styleguides/general.md",
  "project/styleguides/language": "styleguides/<language>.md",
  "project/tech-stack": "tech-stack.md",
  "project/tracks": "tracks.md",
  "project/workflow": "workflow.md",
  "styleguide/dart": "styleguides/dart.md",
  "styleguide/flutter": "styleguides/flutter.md",
  "styleguide/go": "styleguides/go.md",
  "styleguide/gradle": "styleguides/gradle.md",
  "styleguide/html-css": "styleguides/html-css.md",
  "styleguide/index": "styleguides/index.md",
  "styleguide/java": "styleguides/java.md",
  "styleguide/javascript": "styleguides/javascript.md",
  "styleguide/kotlin": "styleguides/kotlin.md",
  "styleguide/maven": "styleguides/maven.md",
  "styleguide/python": "styleguides/python.md",
  "styleguide/react": "styleguides/react.md",
  "styleguide/swift": "styleguides/swift.md",
  "styleguide/swiftui": "styleguides/swiftui.md",
  "styleguide/typescript": "styleguides/typescript.md"
};

const PROJECT_TEMPLATE_PAYLOAD_PATHS = [
  "init/archive/.gitkeep",
  "init/gitignore.template",
  "init/guidelines.md",
  "init/operations/.gitkeep",
  "init/patterns/index.md",
  "init/product.md",
  "init/project.json",
  "init/refreshes/.gitkeep",
  "init/styleguides/general.md",
  "init/styleguides/language.md",
  "init/tech-stack.md",
  "init/tracks/.gitkeep",
  "init/tracks.md",
  "init/wisps/.gitkeep",
  "init/workflow.md",
  "project/archive-operation.json",
  "project/pattern.md",
  "project/refresh-operation.json",
  "project/refresh.md"
] as const;

const STYLEGUIDE_TEMPLATE_PAYLOAD_PATHS = [
  "styleguides/dart.md",
  "styleguides/flutter.md",
  "styleguides/go.md",
  "styleguides/gradle.md",
  "styleguides/html-css.md",
  "styleguides/index.md",
  "styleguides/java.md",
  "styleguides/javascript.md",
  "styleguides/kotlin.md",
  "styleguides/maven.md",
  "styleguides/python.md",
  "styleguides/react.md",
  "styleguides/swift.md",
  "styleguides/swiftui.md",
  "styleguides/typescript.md"
] as const;

const LEGACY_TRACK_TEMPLATE_PAYLOAD_PATHS = [
  "track/bug.md",
  "track/execution.json",
  "track/learning.md",
  "track/plan.md",
  "track/revert-operation.json",
  "track/revise-operation.json",
  "track/revision.md",
  "track/spec.md",
  "track/state.json"
] as const;

const DEPENDENCY_CONTEXT_TEMPLATE_PATH = "track/dependency-context.json";

export interface TemplatePayloadInspection {
  version: string;
  found: number;
  required: number;
  missing: readonly string[];
  unexpected: readonly string[];
}

/** Expected physical payload, including initialization directory markers. */
export function expectedTemplatePayloadPaths(version: string): readonly string[] {
  if (!TEMPLATE_SET_VERSIONS.includes(version)) throw new Error(`Unsupported Cadre template set ${version}`);
  const tracks = ["v5", TEMPLATE_SET_VERSION].includes(version)
    ? [...LEGACY_TRACK_TEMPLATE_PAYLOAD_PATHS, DEPENDENCY_CONTEXT_TEMPLATE_PATH]
    : [...LEGACY_TRACK_TEMPLATE_PAYLOAD_PATHS];
  return [...PROJECT_TEMPLATE_PAYLOAD_PATHS, ...STYLEGUIDE_TEMPLATE_PAYLOAD_PATHS, ...tracks].sort();
}

function walk(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(root, path);
    return entry.isFile() ? [relative(root, path).split(sep).join("/")] : [];
  });
}

/** Inspect all versioned payloads without exposing legacy templates as live resources. */
export function inspectTemplatePayloads(templatesRoot: string): TemplatePayloadInspection[] {
  const root = resolve(templatesRoot);
  return TEMPLATE_SET_VERSIONS.map((version) => {
    const expected = expectedTemplatePayloadPaths(version);
    const versionRoot = join(root, version);
    const actual = existsSync(versionRoot) ? walk(versionRoot).sort() : [];
    const actualSet = new Set(actual), expectedSet = new Set(expected);
    return {
      version,
      found: actual.length,
      required: expected.length,
      missing: expected.filter((path) => !actualSet.has(path)),
      unexpected: actual.filter((path) => !expectedSet.has(path))
    };
  });
}

/** Reject missing or extra files in any immutable template payload. */
export function assertCompleteTemplatePayloads(templatesRoot: string): TemplatePayloadInspection[] {
  const inspections = inspectTemplatePayloads(templatesRoot);
  const failures = inspections.filter((inspection) => inspection.missing.length || inspection.unexpected.length);
  if (failures.length) {
    const details = failures.map((inspection) => {
      const findings = [
        inspection.missing.length ? `missing ${inspection.missing.join(", ")}` : "",
        inspection.unexpected.length ? `unexpected ${inspection.unexpected.join(", ")}` : ""
      ].filter(Boolean).join("; ");
      return `${inspection.version} (${findings})`;
    }).join("; ");
    throw new Error(`Cadre immutable template payload is incomplete: ${details}`);
  }
  return inspections;
}

let catalogCache: readonly TemplateRecord[] | null = null;

function locateTemplateRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.CADRE_TEMPLATE_ROOT,
    resolve(moduleDirectory, "../../templates", TEMPLATE_SET_VERSION),
    resolve(moduleDirectory, "../templates", TEMPLATE_SET_VERSION)
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Cadre template set ${TEMPLATE_SET_VERSION} is unavailable`);
  return found;
}

function templateId(path: string): string | null {
  if (path.endsWith("/.gitkeep")) return null;
  if (path === "init/gitignore.template") return "project/gitignore";
  const withoutExtension = path.slice(0, -extname(path).length);
  const styleguidePrefix = "styleguides/";
  if (path.startsWith(styleguidePrefix)) return `styleguide/${withoutExtension.slice(styleguidePrefix.length)}`;
  if (path.startsWith("init/")) return `project/${withoutExtension.slice("init/".length)}`;
  return withoutExtension;
}

function mimeType(path: string): string {
  if (path === "init/gitignore.template") return "text/plain";
  return path.endsWith(".json") ? "application/json" : "text/markdown";
}

function assertCompleteCatalog(catalog: readonly TemplateRecord[]): void {
  const actual = new Set(catalog.map((template) => template.id));
  if (actual.size !== catalog.length) throw new Error(`Cadre template set ${TEMPLATE_SET_VERSION} has duplicate identifiers`);
  const expected = new Set<string>(TEMPLATE_IDS);
  const missing = TEMPLATE_IDS.filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id)).sort();
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected ${unexpected.join(", ")}` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`Cadre template set ${TEMPLATE_SET_VERSION} is incomplete: ${details}`);
  }
}

export function templateCatalog(): TemplateRecord[] {
  if (!catalogCache) {
    const root = locateTemplateRoot();
    assertCompleteTemplatePayloads(dirname(root));
    const catalog = walk(root)
      .map((relativePath): TemplateRecord | null => {
        const id = templateId(relativePath);
        if (!id) return null;
        const content = readFileSync(join(root, relativePath), "utf8");
        return {
          id,
          uri: `cadre://templates/${TEMPLATE_SET_VERSION}/${id}`,
          relativePath,
          mimeType: mimeType(relativePath),
          content,
          sha256: createHash("sha256").update(content).digest("hex")
        };
      })
      .filter((entry): entry is TemplateRecord => entry !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
    assertCompleteCatalog(catalog);
    catalogCache = catalog;
  }
  return catalogCache.map((template) => ({ ...template }));
}

export function getTemplate(id: string): TemplateRecord {
  return getTemplates([id])[0]!;
}

export function getTemplates(ids: string[]): TemplateRecord[] {
  const byId = new Map(templateCatalog().map((template) => [template.id, template]));
  return ids.map((id) => {
    const template = byId.get(id);
    if (!template) throw new Error(`Unknown Cadre template: ${id}`);
    return template;
  });
}

export function describeTemplate(template: TemplateRecord): TemplateDescriptor {
  const { relativePath: _sourcePath, ...descriptor } = template;
  const artifactPath = TEMPLATE_ARTIFACT_PATHS[template.id as (typeof TEMPLATE_IDS)[number]];
  return artifactPath ? { ...descriptor, artifactPath } : descriptor;
}

const STYLEGUIDE_RULES: Array<[RegExp, string[]]> = [
  [/\bhtml\b|\bcss\b|html\/css/i, ["html-css"]],
  [/\btypescript\b/i, ["javascript", "typescript"]],
  [/\bjavascript\b/i, ["javascript"]],
  [/\breact\b/i, ["html-css", "javascript", "react"]],
  [/\bflutter\b/i, ["dart", "flutter"]],
  [/\bdart\b/i, ["dart"]],
  [/\bswiftui\b/i, ["swift", "swiftui"]],
  [/\bswift\b/i, ["swift"]],
  [/\bkotlin\b/i, ["kotlin"]],
  [/\bjava\b/i, ["java"]],
  [/\bmaven\b/i, ["maven"]],
  [/\bgradle\b/i, ["gradle"]],
  [/\bgo(lang)?\b/i, ["go"]],
  [/\bpython\b/i, ["python"]]
];

export function resolveStyleguides(technologies: string[]): TemplateRecord[] {
  const joined = technologies.join("\n");
  const names = new Set<string>(["general"]);
  for (const [pattern, matches] of STYLEGUIDE_RULES) {
    if (pattern.test(joined)) matches.forEach((name) => names.add(name));
  }
  return getTemplates([...names].map((name) => (
    name === "general" ? "project/styleguides/general" : `styleguide/${name}`
  )));
}
