import fs from "node:fs";
import path from "node:path";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { readJson } from "../../infrastructure/runtime/json-store";
import { loadTopology } from "../../infrastructure/runtime/project-config";
import { artifactValidate, readJsonl } from "./artifact-actions";
import { setupGenerationWarnings } from "./generation-quality";
import { choice, nativePrompt } from "./native-prompts";
import { repoMap } from "./repo-map";
import { lspSetup } from "./setup-infrastructure";
import { asArray } from "./status";
import { availableStyleGuideIds, collectTechStackTokens, styleGuideIdsForTechStack } from "./tech-stack";
import { lspConfigStatus } from "./workspace-health";
import { dependencyGraph, workspaceDiagnostics } from "./workspace-intel";

export const REFRESH_LEVELS = [
  "product",
  "product-guidelines",
  "tech-stack",
  "style-guides",
  "repository-topology",
  "lsp",
  "workflow",
  "patterns",
  "projections",
  "diagnostics",
] as const;

export type RefreshLevel = typeof REFRESH_LEVELS[number];

const LEVEL_ALIASES: Record<string, RefreshLevel | "all" | "all-recommended"> = {
  all: "all",
  "all-supported": "all",
  "all_supported": "all",
  recommended: "all-recommended",
  "all-recommended": "all-recommended",
  "all_recommended": "all-recommended",
  product: "product",
  guidelines: "product-guidelines",
  "product-guidelines": "product-guidelines",
  product_guidelines: "product-guidelines",
  productguidelines: "product-guidelines",
  tech: "tech-stack",
  "tech-stack": "tech-stack",
  tech_stack: "tech-stack",
  techstack: "tech-stack",
  style: "style-guides",
  styles: "style-guides",
  styleguide: "style-guides",
  styleguides: "style-guides",
  "style-guide": "style-guides",
  "style-guides": "style-guides",
  style_guide: "style-guides",
  style_guides: "style-guides",
  workflow: "workflow",
  "workflow-policy": "workflow",
  workflow_policy: "workflow",
  patterns: "patterns",
  repo: "repository-topology",
  repos: "repository-topology",
  repository: "repository-topology",
  topology: "repository-topology",
  "repository-topology": "repository-topology",
  repository_topology: "repository-topology",
  lsp: "lsp",
  docs: "projections",
  projection: "projections",
  projections: "projections",
  diagnostics: "diagnostics",
  analyze: "diagnostics",
  analysis: "diagnostics",
};

const LEVEL_LABELS: Record<RefreshLevel, string> = {
  product: "Product Context",
  "product-guidelines": "Product Guidelines",
  "tech-stack": "Tech Stack",
  "style-guides": "Style Guides",
  "repository-topology": "Repository Topology",
  lsp: "Language Servers",
  workflow: "Workflow Policy",
  patterns: "Project Patterns",
  projections: "Generated Projections",
  diagnostics: "Analysis Only",
};

function rawArgs(args: RuntimeArgs): UnknownRecord {
  return args as UnknownRecord;
}

function rawRequestedLevels(args: RuntimeArgs): string[] {
  const raw = rawArgs(args);
  const direct = [raw.refreshLevels, raw.refresh_levels, raw.refreshScope, raw.refresh_scope, raw.scope]
    .flatMap((value) => typeof value === "string" ? value.split(",") : Array.isArray(value) ? value.map(String) : []);
  const listed = Array.isArray(raw.scopes) ? raw.scopes.map(String) : [];
  const flags = [
    raw.all === true ? "all" : null,
    raw.patterns === true ? "patterns" : null,
    raw.styleGuides === true || raw.style_guides === true ? "style-guides" : null,
    raw.docs === true ? "docs" : null,
    raw.projections === true ? "projections" : null,
    raw.diagnostics === true ? "diagnostics" : null,
    [raw.lsp, raw.writeLsp, raw.write_lsp, raw.setupLsp, raw.setup_lsp].some((value) => value === true) ? "lsp" : null,
  ].filter((value): value is string => Boolean(value));
  return [...direct, ...listed, ...flags].map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function invalidRefreshSelectionKeys(args: RuntimeArgs): string[] {
  const raw = rawArgs(args);
  const collectionKeys = ["refreshLevels", "refresh_levels", "refreshScope", "refresh_scope", "scope", "scopes"];
  const booleanKeys = ["all", "patterns", "styleGuides", "style_guides", "docs", "projections", "diagnostics", "lsp", "writeLsp", "write_lsp", "setupLsp", "setup_lsp"];
  return [
    ...collectionKeys.filter((key) => Object.prototype.hasOwnProperty.call(raw, key)
      && raw[key] !== undefined
      && typeof raw[key] !== "string"
      && !Array.isArray(raw[key])),
    ...booleanKeys.filter((key) => Object.prototype.hasOwnProperty.call(raw, key)
      && raw[key] !== undefined
      && typeof raw[key] !== "boolean"),
  ];
}

export function unsupportedRefreshLevels(args: RuntimeArgs = {}): string[] {
  return Array.from(new Set([
    ...rawRequestedLevels(args).filter((level) => !LEVEL_ALIASES[level]),
    ...invalidRefreshSelectionKeys(args).map((key) => `${key}:invalid`),
  ]));
}

export function refreshLevelIds(args: RuntimeArgs = {}, recommended: string[] = []): RefreshLevel[] {
  const selected = new Set<RefreshLevel>();
  for (const raw of rawRequestedLevels(args)) {
    const level = LEVEL_ALIASES[raw];
    if (level === "all") REFRESH_LEVELS.filter((entry) => entry !== "diagnostics").forEach((entry) => selected.add(entry));
    else if (level === "all-recommended") recommended.forEach((entry) => {
      if ((REFRESH_LEVELS as readonly string[]).includes(entry)) selected.add(entry as RefreshLevel);
    });
    else if (level) selected.add(level);
  }
  return REFRESH_LEVELS.filter((level) => selected.has(level));
}

export function refreshSelectionProvided(args: RuntimeArgs = {}): boolean {
  return rawRequestedLevels(args).length > 0 || invalidRefreshSelectionKeys(args).length > 0;
}

function compactWorkspace(value: JsonObject): JsonObject {
  const adapters = asArray(value.adapters).map(asJsonObject);
  const commands = asArray(value.commands).map(asJsonObject);
  return {
    repos: asArray(value.repos).length,
    adapters: adapters.slice(0, 20).map((entry) => ({ id: entry.id || null, ecosystem: entry.ecosystem || null, manifest: entry.manifest || null })),
    commands: commands.slice(0, 30).map((entry) => entry.command).filter((entry) => typeof entry === "string"),
  };
}

function compactDependencyGraph(value: JsonObject): JsonObject {
  return {
    manifests: asArray(value.manifests).slice(0, 30).map(asJsonObject),
    edge_count: asArray(value.edges).length,
    repo_count: asArray(value.repos).length,
  };
}

function detectedChangeText(args: RuntimeArgs): string {
  const raw = rawArgs(args);
  const value = raw.detectedChanges ?? raw.detected_changes ?? raw.changes ?? [];
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join(" ").toLowerCase();
  return isRecord(value) ? JSON.stringify(value).toLowerCase() : "";
}

function currentContext(root: string): JsonObject {
  return {
    product: readJson<JsonObject>(path.join(root, "cadre", "product.json"), {}),
    productGuidelines: readJson<JsonObject>(path.join(root, "cadre", "product_guidelines.json"), {}),
    techStack: readJson<JsonObject>(path.join(root, "cadre", "tech-stack.json"), {}),
    workflowPolicy: readJson<JsonObject>(path.join(root, "cadre", "workflow.json"), {}),
  };
}

function repositoryMetadata(root: string): JsonObject {
  const pkg = readJson<JsonObject>(path.join(root, "package.json"), {});
  const readme = ["README.md", "README.mdx", "readme.md"].find((file) => fs.existsSync(path.join(root, file)));
  return {
    package_name: asOptionalString(pkg.name) || null,
    package_description: asOptionalString(pkg.description) || null,
    readme_path: readme || null,
    agents_path: fs.existsSync(path.join(root, "AGENTS.md")) ? "AGENTS.md" : null,
    claude_path: fs.existsSync(path.join(root, "CLAUDE.md")) ? "CLAUDE.md" : null,
    gitmodules: fs.existsSync(path.join(root, ".gitmodules")),
  };
}

function missingTechLanguages(repo: JsonObject, techStack: JsonObject): string[] {
  const nonStackLanguages = new Set(["json", "markdown", "md", "yaml", "toml", "xml", "text"]);
  const detected = Object.keys(asJsonObject(repo.by_language)).filter((language) => !nonStackLanguages.has(language.toLowerCase()));
  const recorded = collectTechStackTokens(techStack).join(" ").toLowerCase();
  return detected.filter((language) => !recorded.includes(language.toLowerCase()));
}

function styleGuideDrift(root: string, techStack: JsonObject): JsonObject {
  const available = new Set(availableStyleGuideIds());
  const selected = asStringArray(readJson<JsonObject>(path.join(root, "cadre", "styleguides", "index.json"), {}).selected);
  const implied = Array.from(new Set([
    ...(available.has("general") ? ["general"] : []),
    ...styleGuideIdsForTechStack(techStack).filter((id) => available.has(id)),
  ])).sort();
  const missing = implied.filter((id) => !selected.includes(id));
  const missingFiles = selected.filter((id) => !fs.existsSync(path.join(root, "cadre", "styleguides", `${id}.json`)));
  return { selected, implied, missing, missing_files: missingFiles };
}

function projectionProblems(validation: JsonObject): JsonObject[] {
  return asArray(validation.results).map(asJsonObject).filter((entry) => entry.ok === false);
}

function patternsAreThin(root: string): boolean {
  const first = readJsonl(path.join(root, "cadre", "patterns.jsonl"))[0];
  const text = asOptionalString(first?.text || first?.body || first?.summary) || "";
  const evidence = text
    .replace(/^#+\s+.*$/gm, "")
    .replace(/Last refreshed:\s*.*$/gim, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  return evidence.length === 0;
}

function hasChange(changeText: string, expressions: RegExp[]): boolean {
  return expressions.some((pattern) => pattern.test(changeText));
}

function finding(level: RefreshLevel, reasons: string[], confidence: string, evidence: JsonObject = {}): JsonObject {
  return {
    level,
    label: LEVEL_LABELS[level],
    recommended: reasons.length > 0,
    confidence: reasons.length > 0 ? confidence : "none",
    reasons,
    evidence,
  };
}

export function refreshAnalysis(root: string, args: RuntimeArgs = {}): JsonObject {
  const repo = asJsonObject(repoMap(root, { limit: 60 }));
  const workspace = asJsonObject(workspaceDiagnostics(root, { execute: false }));
  const graph = asJsonObject(dependencyGraph(root));
  const lspPreview = asJsonObject(lspSetup(root, { ...args, execute: false }));
  const lspStatus = asJsonObject(lspConfigStatus(root));
  const projectionValidation = asJsonObject(artifactValidate(root, { scope: "refresh" }));
  const context = currentContext(root);
  const topology = loadTopology(root);
  const metadata = repositoryMetadata(root);
  const changes = detectedChangeText(args);
  const qualityWarnings = setupGenerationWarnings(context);
  const missingLanguages = missingTechLanguages(repo, asJsonObject(context.techStack));
  const styleGuides = styleGuideDrift(root, asJsonObject(context.techStack));
  const projectionIssues = projectionProblems(projectionValidation);
  const thinPatterns = patternsAreThin(root);
  const lspMissing = asStringArray(lspPreview.missingFromConfig || lspPreview.missing_from_config);
  const lspAdded = asStringArray(lspPreview.added);
  const lspStaleManaged = asStringArray(lspPreview.staleManaged || lspPreview.stale_managed || lspPreview.removed);

  const findings = [
    finding("product", [
      ...qualityWarnings.filter((warning) => warning.startsWith("product context")),
      ...(Object.keys(asJsonObject(context.product)).length === 0 ? ["cadre/product.json is missing or unreadable."] : []),
      ...(hasChange(changes, [/product/, /user flow/, /domain/, /public api/, /behavior/]) ? ["Reported changes may alter product behavior or domain context."] : []),
    ], "medium", { package_name: metadata.package_name, readme_path: metadata.readme_path }),
    finding("product-guidelines", [
      ...qualityWarnings.filter((warning) => warning.startsWith("product guidelines")),
      ...(Object.keys(asJsonObject(context.productGuidelines)).length === 0 ? ["cadre/product_guidelines.json is missing or unreadable."] : []),
      ...(hasChange(changes, [/invariant/, /policy/, /security/, /privacy/, /compatib/, /workflow rule/]) ? ["Reported changes may alter product rules or guarantees."] : []),
    ], "medium"),
    finding("tech-stack", [
      ...qualityWarnings.filter((warning) => warning.startsWith("tech stack")),
      ...(missingLanguages.length > 0 ? [`Repository languages are not recorded in the tech stack: ${missingLanguages.join(", ")}.`] : []),
      ...(hasChange(changes, [/dependency/, /framework/, /runtime/, /database/, /package/, /toolchain/]) ? ["Reported changes may alter the recorded toolchain or dependencies."] : []),
    ], missingLanguages.length > 0 ? "high" : "medium", { missing_languages: missingLanguages }),
    finding("style-guides", [
      ...(asStringArray(styleGuides.missing).length > 0
        ? [`Style guides implied by the recorded tech stack are not selected: ${asStringArray(styleGuides.missing).join(", ")}.`]
        : []),
      ...(asStringArray(styleGuides.missing_files).length > 0
        ? [`Selected style guide files are missing: ${asStringArray(styleGuides.missing_files).join(", ")}.`]
        : []),
      ...(hasChange(changes, [/style guide/, /formatting convention/, /lint rule/, /language convention/])
        ? ["Reported changes may alter project style-guide coverage."]
        : []),
    ], "medium", styleGuides),
    finding("repository-topology", [
      ...(metadata.gitmodules === true && !topology.polyrepo ? [".gitmodules exists but Cadre repository topology is not configured as polyrepo."] : []),
      ...(hasChange(changes, [/submodule/, /polyrepo/, /repository topology/, /new repo/, /remove repo/]) ? ["Reported changes may alter repository topology."] : []),
    ], metadata.gitmodules === true && !topology.polyrepo ? "high" : "medium", { configured_polyrepo: topology.polyrepo, gitmodules: metadata.gitmodules }),
    finding("lsp", [
      ...(lspMissing.length > 0 || lspAdded.length > 0 ? ["Detected language-server recommendations are not present in cadre/lsp.json."] : []),
      ...(lspStaleManaged.length > 0 ? [`Cadre-managed language servers no longer match repository evidence: ${lspStaleManaged.join(", ")}.`] : []),
    ], "high", { configured: lspStatus.configured === true, missing: lspMissing, added: lspAdded, stale_managed: lspStaleManaged }),
    finding("workflow", [
      ...qualityWarnings.filter((warning) => warning.startsWith("workflow context")),
      ...(hasChange(changes, [/test command/, /build command/, /lint/, /ci\b/, /review gate/, /release process/]) ? ["Reported changes may alter project commands or quality gates."] : []),
    ], "medium", { agents_path: metadata.agents_path, claude_path: metadata.claude_path }),
    finding("patterns", [
      ...(projectionIssues.some((entry) => entry.artifact_id === "patterns") ? ["The patterns canonical/projection pair is missing or stale."] : []),
      ...(thinPatterns ? ["Project patterns contain no repository-specific evidence."] : []),
      ...(hasChange(changes, [/architecture/, /convention/, /pattern/, /testing/, /gotcha/, /data flow/]) ? ["Reported changes contain reusable implementation or architecture learning."] : []),
    ], "medium"),
    finding("projections", [
      ...(projectionIssues.length > 0 ? [`${projectionIssues.length} project projection or canonical validation issue(s) were detected.`] : []),
    ], "high", { issues: projectionIssues.slice(0, 20) }),
    finding("diagnostics", [], "none", { analysis_always_runs: true }),
  ];
  const recommended = findings.filter((entry) => entry.recommended === true).map((entry) => String(entry.level));
  return {
    version: 1,
    kind: "cadre.refresh_analysis.v1",
    analyzed_at: new Date().toISOString(),
    available_levels: [...REFRESH_LEVELS],
    recommended_levels: recommended,
    findings,
    evidence: {
      repository: metadata,
      repo_map: { files: repo.files || 0, by_language: repo.by_language || {}, repo_count: asArray(repo.repos).length },
      workspace: compactWorkspace(workspace),
      dependency_graph: compactDependencyGraph(graph),
      configured_topology: { polyrepo: topology.polyrepo, default_repo: topology.defaultRepo },
      projection_validation_ok: projectionValidation.ok !== false,
      detected_changes_supplied: changes.length > 0,
    },
  };
}

export function refreshLevelPrompt(analysis: JsonObject): JsonObject {
  const recommended = new Set(asStringArray(analysis.recommended_levels));
  const descriptions: Record<RefreshLevel, string> = {
    product: "Refresh evidence-backed product users, workflows, domain context, and boundaries.",
    "product-guidelines": "Refresh product invariants, promises, decision rules, and review guidance.",
    "tech-stack": "Refresh languages, frameworks, runtimes, dependencies, and project commands.",
    "style-guides": "Refresh the selected style-guide catalog and language-specific rule projections.",
    "repository-topology": "Refresh configured repositories and polyrepo routing.",
    lsp: "Review and write currently detected language-server recommendations.",
    workflow: "Refresh development, verification, review, and commit policy.",
    patterns: "Refresh reusable architecture, implementation, testing, and data patterns.",
    projections: "Repair missing or stale generated projections from canonical state.",
    diagnostics: "Keep this run read-only and return analysis without refreshing documents.",
  };
  const prompt = nativePrompt(
    "refresh-levels",
    "Refresh Levels",
    "Cadre analyzed repository and control-plane drift. Which context levels should it refresh?",
    "multi",
    REFRESH_LEVELS.map((level) => choice(level, LEVEL_LABELS[level], descriptions[level], recommended.has(level))),
    {
      tool: "cadre_workflow",
      workflow: "refresh",
      argument: "refreshLevels",
      selectedIds: asStringArray(analysis.recommended_levels),
    },
    null
  );
  return prompt;
}
