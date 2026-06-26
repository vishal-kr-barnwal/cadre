import fs from "node:fs";
import path from "node:path";
import { PACKAGE_DISPLAY_NAME, PACKAGE_PLUGIN_NAME, RuntimePaths, Target, TargetPaths } from "./install-targets";

const MARKETPLACE_PLUGIN_SOURCE = "./plugins/cadre";

function readPackageMetadata(runtimeRoot: string): Record<string, string> {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "package.json"), "utf8")) as Record<string, unknown>;
    return {
      version: typeof json.version === "string" ? json.version : "0.0.0",
      description: typeof json.description === "string" ? json.description : "MCP-first Cadre workflows.",
      homepage: typeof json.homepage === "string" ? json.homepage : "https://cadre-docs.pages.dev/",
      repository: typeof json.repository === "string" ? json.repository : "https://github.com/vishal-kr-barnwal/cadre",
      license: typeof json.license === "string" ? json.license : "Apache-2.0",
    };
  } catch {
    return {
      version: "0.0.0",
      description: "MCP-first Cadre workflows.",
      homepage: "https://cadre-docs.pages.dev/",
      repository: "https://github.com/vishal-kr-barnwal/cadre",
      license: "Apache-2.0",
    };
  }
}

function baseManifest(runtime: RuntimePaths): Record<string, unknown> {
  const metadata = readPackageMetadata(runtime.runtimeRoot);
  return {
    name: PACKAGE_PLUGIN_NAME,
    version: metadata.version,
    description: metadata.description,
    author: { name: "Vishal Kumar", url: "https://github.com/vishal-kr-barnwal" },
    homepage: metadata.homepage,
    repository: metadata.repository,
    license: metadata.license,
    keywords: ["cadre", "context-driven-development", "skills", "mcp"],
    skills: "./skills/",
  };
}

function pluginManifest(target: Target, runtime: RuntimePaths): Record<string, unknown> {
  const base = baseManifest(runtime);
  if (target === "claude") return { ...base, displayName: PACKAGE_DISPLAY_NAME, mcpServers: "./mcp-config.json" };
  if (target === "antigravity") {
    return {
      $schema: "https://antigravity.google/schemas/v1/plugin.json",
      name: PACKAGE_PLUGIN_NAME,
      description: base.description,
      version: base.version,
    };
  }
  const mcpServers = "./.mcp.json";
  const codexInterface = {
    displayName: PACKAGE_DISPLAY_NAME,
    shortDescription: "MCP-first planning, tracks, reviews, and packet tools.",
    longDescription: "Cadre packages context-driven development workflows through one global MCP runtime.",
    developerName: "Vishal Kumar",
    category: "Productivity",
    capabilities: ["Read", "Write", "Interactive"],
    defaultPrompt: ["Set up this repo with Cadre.", "Show Cadre team status.", "Review the current Cadre track."],
    brandColor: "#10A37F",
  };
  return target === "copilot"
    ? { ...base, mcpServers }
    : { ...base, mcpServers, interface: codexInterface };
}

function mcpConfig(target: Target, runtime: RuntimePaths): Record<string, unknown> {
  const server: Record<string, unknown> = {
    command: runtime.nodePath,
    args: [runtime.mcpServer],
    cwd: runtime.runtimeRoot,
  };
  if (target === "copilot") {
    server.type = "local";
    server.tools = ["*"];
  }
  return { mcpServers: { cadre: server } };
}

function marketplace(target: Target, runtime: RuntimePaths): Record<string, unknown> {
  const metadata = readPackageMetadata(runtime.runtimeRoot);
  if (target === "codex") {
    return {
      name: PACKAGE_PLUGIN_NAME,
      interface: { displayName: PACKAGE_DISPLAY_NAME },
      plugins: [{
        name: PACKAGE_PLUGIN_NAME,
        source: { source: "local", path: MARKETPLACE_PLUGIN_SOURCE },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      }],
    };
  }
  return {
    name: PACKAGE_PLUGIN_NAME,
    owner: { name: "Vishal Kumar" },
    description: "Cadre MCP-first workflows for Claude Code.",
    plugins: [{
      name: PACKAGE_PLUGIN_NAME,
      source: MARKETPLACE_PLUGIN_SOURCE,
      description: metadata.description,
      version: metadata.version,
      author: { name: "Vishal Kumar" },
      category: "productivity",
      tags: ["cadre", "skills", "mcp", "context-driven-development"],
    }],
  };
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function writePluginRoot(target: Target, pluginRoot: string, runtime: RuntimePaths, skillShim: string): void {
  fs.rmSync(pluginRoot, { recursive: true, force: true });
  writeText(path.join(pluginRoot, "skills", "cadre", "SKILL.md"), skillShim);
  if (target === "codex") {
    writeJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"), pluginManifest(target, runtime));
    writeJson(path.join(pluginRoot, ".mcp.json"), mcpConfig(target, runtime));
  } else if (target === "claude") {
    writeJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"), pluginManifest(target, runtime));
    writeJson(path.join(pluginRoot, "mcp-config.json"), mcpConfig(target, runtime));
  } else if (target === "copilot") {
    writeJson(path.join(pluginRoot, "plugin.json"), pluginManifest(target, runtime));
    writeJson(path.join(pluginRoot, ".mcp.json"), mcpConfig(target, runtime));
  } else {
    writeJson(path.join(pluginRoot, "plugin.json"), pluginManifest(target, runtime));
    writeJson(path.join(pluginRoot, "mcp_config.json"), mcpConfig(target, runtime));
  }
}

export function writeTarget(target: Target, paths: TargetPaths, runtime: RuntimePaths, skillShim: string): void {
  for (const pluginRoot of paths.pluginRoots) writePluginRoot(target, pluginRoot, runtime, skillShim);
  for (const skillRoot of paths.skillRoots) {
    fs.rmSync(skillRoot, { recursive: true, force: true });
    writeText(path.join(skillRoot, "SKILL.md"), skillShim);
  }
  if (paths.marketplaceFile && (target === "codex" || target === "claude")) {
    writeJson(paths.marketplaceFile, marketplace(target, runtime));
  }
}

export function removeTarget(paths: TargetPaths): string[] {
  const roots = new Set<string>();
  if (paths.marketplaceRoot) roots.add(paths.marketplaceRoot);
  for (const pluginRoot of paths.pluginRoots) roots.add(pluginRoot);
  for (const skillRoot of paths.skillRoots) roots.add(skillRoot);
  const removed: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    fs.rmSync(root, { recursive: true, force: true });
    removed.push(root);
  }
  return removed;
}
