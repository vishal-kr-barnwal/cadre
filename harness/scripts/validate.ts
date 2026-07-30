import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATE_IDS, templateCatalog } from "../src/domain/templates.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skills = [
  "create", "track", "implement", "review", "revise",
  "archive", "refresh", "revert", "status", "wisp"
];
const errors: string[] = [];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

for (const manifest of [
  ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", "marketplace/codex.json",
  "marketplace/claude.json", "package.json", ".mcp.json", ".mcp.codex.json"
]) {
  try {
    readJson<unknown>(join(root, manifest));
  } catch (error) {
    errors.push(`${manifest}: ${errorMessage(error)}`);
  }
}

interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
}

const packageManifest = readJson<PackageManifest>(join(root, "package.json"));
if (packageManifest.name !== "cadre-ai" || packageManifest.version !== "3.1.0") {
  errors.push("package: expected publish identity cadre-ai@3.1.0");
}
if (packageManifest.private === true) errors.push("package: publishable CLI must not be private");
if (packageManifest.bin?.["cadre-ai"] !== "dist/cadre-cli.mjs" || Object.keys(packageManifest.bin).length !== 1) {
  errors.push("package: cadre-ai must be the sole bin and point at dist/cadre-cli.mjs");
}
for (const entry of ["dist/", "skills/", "templates/", ".codex-plugin/", ".claude-plugin/"]) {
  if (!packageManifest.files?.includes(entry)) errors.push(`package: files must include ${entry}`);
}
if (packageManifest.dependencies && Object.keys(packageManifest.dependencies).length > 0) {
  errors.push("package: self-contained runtime must not have production dependencies");
}

interface Marketplace {
  name?: string;
  plugins?: Array<{ name?: string; source?: string | { path?: string } }>;
}

for (const [name, file] of [["Codex", "codex.json"], ["Claude", "claude.json"]] as const) {
  const marketplace = readJson<Marketplace>(join(root, "marketplace", file));
  const entry = marketplace.plugins?.find((plugin) => plugin.name === "cadre");
  if (marketplace.name !== "cadre" || !entry) errors.push(`${name} marketplace: missing cadre entry`);
  else {
    const source = typeof entry.source === "string" ? entry.source : entry.source?.path;
    if (source !== "./plugins/cadre") errors.push(`${name} marketplace: invalid local source`);
  }
}

for (const skill of skills) {
  const skillPath = join(root, "skills", skill, "SKILL.md");
  const metadataPath = join(root, "skills", skill, "agents", "openai.yaml");
  if (!existsSync(skillPath)) errors.push(`${skill}: missing SKILL.md`);
  if (!existsSync(metadataPath)) errors.push(`${skill}: missing agents/openai.yaml`);
  if (existsSync(skillPath)) {
    const body = readFileSync(skillPath, "utf8");
    if (!body.startsWith(`---\nname: ${skill}\n`)) errors.push(`${skill}: invalid frontmatter name`);
    if (body.includes("TODO")) errors.push(`${skill}: unresolved TODO`);
    if (body.includes(".cadre/bin/") || body.includes(".cadre/templates/")) {
      errors.push(`${skill}: references removed project-local runtime or templates`);
    }
  }
}

const templateRoot = join(root, "templates", "v1");
const projectTemplate = join(templateRoot, "init");
for (const file of [
  "gitignore.template", "workflow.md", "product.md", "guidelines.md", "tech-stack.md",
  "project.json", "operations/.gitkeep"
]) {
  if (!existsSync(join(projectTemplate, file))) errors.push(`project template: missing ${file}`);
}
for (const forbidden of ["bin", "templates"]) {
  if (existsSync(join(projectTemplate, forbidden))) errors.push(`project template: must not ship .cadre/${forbidden}`);
}
const cadreGitignore = readFileSync(join(projectTemplate, "gitignore.template"), "utf8");
if (!cadreGitignore.includes("/.worktrees/") || !cadreGitignore.includes("/wisps/")) {
  errors.push("project template: .gitignore must exclude worktrees and wisps");
}
try {
  const catalog = templateCatalog();
  if (catalog.length !== TEMPLATE_IDS.length) {
    errors.push(`template provider: expected ${TEMPLATE_IDS.length} templates, found ${catalog.length}`);
  }
} catch (error) {
  errors.push(`template provider: ${errorMessage(error)}`);
}
const providerLearningTemplate = join(templateRoot, "track", "learning.md");
if (!existsSync(providerLearningTemplate)
  || !readFileSync(providerLearningTemplate, "utf8").includes("<!-- cadre:pattern-seed:start -->")) {
  errors.push("template provider: learning.md lacks the marked Pattern Seed section");
}
const providerPlanTemplate = join(templateRoot, "track", "plan.md");
if (!existsSync(providerPlanTemplate)
  || !readFileSync(providerPlanTemplate, "utf8").includes("Phase dependencies")
  || !readFileSync(providerPlanTemplate, "utf8").includes("Task dependencies")) {
  errors.push("template provider: plan.md lacks explicit DAG dependencies");
}
const executionTemplate = join(templateRoot, "track", "execution.json");
try {
  const execution = readJson<{ schemaVersion?: number; nodes?: unknown }>(executionTemplate);
  if (execution.schemaVersion !== 1 || execution.nodes == null) errors.push("template provider: invalid execution.json");
} catch (error) {
  errors.push(`template provider: execution.json: ${errorMessage(error)}`);
}
const archiveOperationTemplate = join(templateRoot, "project", "archive-operation.json");
try {
  const operation = readJson<{ action?: string; selectedTracks?: unknown[] }>(archiveOperationTemplate);
  if (operation.action !== "archive" || !Array.isArray(operation.selectedTracks)) {
    errors.push("template provider: invalid archive-operation.json");
  }
} catch (error) {
  errors.push(`template provider: archive-operation.json: ${errorMessage(error)}`);
}
const refreshOperationTemplate = join(templateRoot, "project", "refresh-operation.json");
try {
  const operation = readJson<{ action?: string; operationId?: string }>(refreshOperationTemplate);
  if (operation.action !== "refresh" || !operation.operationId) {
    errors.push("template provider: invalid refresh-operation.json");
  }
} catch (error) {
  errors.push(`template provider: refresh-operation.json: ${errorMessage(error)}`);
}
const revertOperationTemplate = join(templateRoot, "track", "revert-operation.json");
try {
  const operation = readJson<{ action?: string; commits?: unknown[] }>(revertOperationTemplate);
  if (operation.action !== "revert" || !Array.isArray(operation.commits)) {
    errors.push("template provider: invalid revert-operation.json");
  }
} catch (error) {
  errors.push(`template provider: revert-operation.json: ${errorMessage(error)}`);
}

const projectStateTemplate = readJson<{
  runtimeVersion?: string;
  templateSetVersion?: string;
  project?: { context?: string };
  setup?: { operation?: { repositoryRoot?: string; gitDisposition?: string } };
  tracks?: unknown;
}>(join(projectTemplate, "project.json"));
if (projectStateTemplate.runtimeVersion !== "{{RUNTIME_VERSION}}"
  || projectStateTemplate.templateSetVersion !== "{{TEMPLATE_SET_VERSION}}") {
  errors.push("project template: runtime/template version placeholders are missing");
}
if (projectStateTemplate.project?.context !== "{{greenfield|brownfield}}") {
  errors.push("project template: project context classification placeholder is missing");
}
if (!projectStateTemplate.setup?.operation?.repositoryRoot || !projectStateTemplate.setup.operation.gitDisposition) {
  errors.push("project template: setup Git bootstrap fields are missing");
}
if (Object.hasOwn(projectStateTemplate, "tracks")) {
  errors.push("project template: project.json must not duplicate track records");
}

const trackStateTemplate = readJson<{ title?: string; lastExecution?: unknown }>(join(templateRoot, "track", "state.json"));
if (!trackStateTemplate.title) errors.push("template provider: track state title is missing");
if (!Object.hasOwn(trackStateTemplate, "lastExecution")) errors.push("template provider: track state lacks lastExecution");
if (Object.hasOwn(trackStateTemplate, "activePhase") || Object.hasOwn(trackStateTemplate, "activeTask")) {
  errors.push("template provider: active execution nodes must not be duplicated in track state");
}

const styleguideRoot = join(templateRoot, "styleguides");
for (const name of [
  "go", "java", "kotlin", "maven", "gradle", "javascript", "typescript",
  "react", "html-css", "flutter", "dart", "swift", "swiftui", "python"
]) {
  const path = join(styleguideRoot, `${name}.md`);
  if (!existsSync(path)) errors.push(`default styleguide: missing ${name}.md`);
  else if (!readFileSync(path, "utf8").includes("## Sources")) errors.push(`default styleguide: ${name}.md lacks sources`);
}

for (const file of [
  "src/mcp/server.ts", "src/domain/templates.ts", "src/domain/init.ts", "src/domain/state.ts",
  "src/domain/plan.ts", "src/domain/execution.ts", "src/domain/worktrees.ts",
  "scripts/permissions.ts", "dist/cadre-cli.mjs", "dist/cadre-mcp.mjs"
]) {
  if (!existsSync(join(root, file))) errors.push(`runtime: missing ${file}`);
}
for (const agent of ["cadre-phase-worker.md", "cadre-task-worker.md"]) {
  const path = join(root, "agents", agent);
  if (!existsSync(path)) errors.push(`plugin agent: missing ${agent}`);
  else {
    const body = readFileSync(path, "utf8");
    if (!body.includes("Do not spawn agents") || !body.includes("Never edit `.cadre/**`")) {
      errors.push(`plugin agent: ${agent} lacks scheduler/state isolation rules`);
    }
  }
}
if (existsSync(join(root, "skills", "create", "assets"))) errors.push("runtime: duplicate skill-local assets remain");
for (const file of ["scripts/install.mjs", "scripts/package-plugin.mjs", "scripts/validate.mjs", "test/harness.test.mjs"]) {
  if (existsSync(join(root, file))) errors.push(`runtime: legacy JavaScript source remains at ${file}`);
}

const codexManifest = readJson<{ mcpServers?: string }>(join(root, ".codex-plugin", "plugin.json"));
if (codexManifest.mcpServers !== "./.mcp.codex.json") {
  errors.push("Codex manifest: MCP companion path is missing");
}
interface StdioMcpConfig {
  mcpServers?: { cadre?: { command?: string; args?: string[]; cwd?: string } };
}
const codexMcp = readJson<StdioMcpConfig>(join(root, ".mcp.codex.json"));
if (codexMcp.mcpServers?.cadre?.command !== "node"
  || codexMcp.mcpServers.cadre.args?.[0] !== "./dist/cadre-mcp.mjs"
  || codexMcp.mcpServers.cadre.cwd !== ".") {
  errors.push("Codex MCP config: Cadre stdio command is invalid");
}
const claudeMcp = readJson<StdioMcpConfig>(join(root, ".mcp.json"));
if (claudeMcp.mcpServers?.cadre?.command !== "node"
  || claudeMcp.mcpServers.cadre.args?.[0] !== "${CLAUDE_PLUGIN_ROOT}/dist/cadre-mcp.mjs") {
  errors.push("Claude MCP config: Cadre stdio command is invalid");
}

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${skills.length} skills, the typed MCP runtime, templates, and both plugin manifests.\n`);
}
