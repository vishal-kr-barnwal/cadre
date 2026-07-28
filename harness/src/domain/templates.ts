import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATE_SET_VERSION } from "./version.js";

export { TEMPLATE_SET_VERSION } from "./version.js";

export interface TemplateRecord {
  id: string;
  uri: string;
  relativePath: string;
  mimeType: string;
  content: string;
  sha256: string;
}

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

function walk(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(root, path) : [relative(root, path).split(sep).join("/")];
  });
}

function templateId(path: string): string | null {
  if (path.endsWith("/.gitkeep")) return null;
  if (path === "init/.gitignore") return "project/gitignore";
  const withoutExtension = path.slice(0, -extname(path).length);
  const styleguidePrefix = "styleguides/";
  if (path.startsWith(styleguidePrefix)) return `styleguide/${withoutExtension.slice(styleguidePrefix.length)}`;
  if (path.startsWith("init/")) return `project/${withoutExtension.slice("init/".length)}`;
  return withoutExtension;
}

function mimeType(path: string): string {
  if (path.endsWith(".gitignore")) return "text/plain";
  return path.endsWith(".json") ? "application/json" : "text/markdown";
}

export function templateCatalog(): TemplateRecord[] {
  const root = locateTemplateRoot();
  return walk(root)
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
