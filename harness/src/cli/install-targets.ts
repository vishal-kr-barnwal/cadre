import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const INSTALL_TARGETS = ["codex", "claude", "copilot", "antigravity"] as const;

export type Target = typeof INSTALL_TARGETS[number];
export type Scope = "user" | "project" | "local";

export interface ParsedInstall {
  target: "auto" | "all" | Target;
  scope: Scope;
  dryRun: boolean;
  check: boolean;
  force: boolean;
  yes: boolean;
  cadreHome: string;
}

export interface RuntimePaths {
  runtimeRoot: string;
  nodePath: string;
  mcpServer: string;
}

export interface CommandPlan {
  command: string;
  args: string[];
  optional?: boolean;
}

export interface TargetPaths {
  primaryRoot: string;
  marketplaceRoot?: string;
  marketplaceFile?: string;
  pluginRoots: string[];
  skillRoots: string[];
}

export const TARGET_COMMANDS: Record<Target, string> = {
  codex: "codex",
  claude: "claude",
  copilot: "copilot",
  antigravity: "agy",
};

export const PACKAGE_PLUGIN_NAME = "cadre";
export const PACKAGE_DISPLAY_NAME = "Cadre";

export function runtimePaths(): RuntimePaths {
  const runtimeRoot = path.resolve(__dirname, "..");
  return {
    runtimeRoot,
    nodePath: process.execPath,
    mcpServer: path.join(runtimeRoot, "scripts", "mcp", "cadre-server.js"),
  };
}

export function commandExists(command: string): boolean {
  const result = process.platform === "win32"
    ? spawnSync("where", [command], { stdio: "ignore" })
    : spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

export function selectedTargets(options: ParsedInstall): Target[] {
  if (options.target !== "auto" && options.target !== "all") return [options.target];
  if (options.target === "all") return [...INSTALL_TARGETS];
  return INSTALL_TARGETS.filter((target) => commandExists(TARGET_COMMANDS[target]));
}

export function antigravityCliHome(): string {
  return process.env.ANTIGRAVITY_CLI_HOME
    || path.join(process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini"), "antigravity-cli");
}

export function antigravityIdeHome(): string {
  return process.env.ANTIGRAVITY_IDE_HOME
    || path.join(process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini"), "config");
}

export function targetPaths(home: string, target: Target, scope: Scope, cwd = process.cwd()): TargetPaths {
  if (target === "copilot" && scope !== "user") {
    const skillRoot = path.join(cwd, ".github", "skills", PACKAGE_PLUGIN_NAME);
    return { primaryRoot: skillRoot, pluginRoots: [], skillRoots: [skillRoot] };
  }
  if (target === "antigravity") {
    if (scope !== "user") {
      const pluginRoot = path.join(cwd, ".agents", "plugins", PACKAGE_PLUGIN_NAME);
      return { primaryRoot: pluginRoot, pluginRoots: [pluginRoot], skillRoots: [] };
    }
    const cliPlugin = path.join(antigravityCliHome(), "plugins", PACKAGE_PLUGIN_NAME);
    const idePlugin = path.join(antigravityIdeHome(), "plugins", PACKAGE_PLUGIN_NAME);
    return { primaryRoot: cliPlugin, pluginRoots: [cliPlugin, idePlugin], skillRoots: [] };
  }
  const marketplaceRoot = path.join(home, "marketplaces", target);
  const pluginRoot = path.join(marketplaceRoot, "plugins", PACKAGE_PLUGIN_NAME);
  const marketplaceFile = target === "codex"
    ? path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json")
    : target === "claude"
      ? path.join(marketplaceRoot, ".claude-plugin", "marketplace.json")
      : undefined;
  const paths: TargetPaths = {
    primaryRoot: pluginRoot,
    marketplaceRoot,
    pluginRoots: [pluginRoot],
    skillRoots: [],
  };
  if (marketplaceFile) paths.marketplaceFile = marketplaceFile;
  return paths;
}

export function installCommands(target: Target, paths: TargetPaths, scope: Scope): CommandPlan[] {
  if (target === "codex") {
    return [
      { command: "codex", args: ["plugin", "marketplace", "add", paths.marketplaceRoot || ""] },
      { command: "codex", args: ["plugin", "add", "cadre@cadre"] },
    ];
  }
  if (target === "claude") {
    return [
      { command: "claude", args: ["plugin", "marketplace", "add", "--scope", scope, paths.marketplaceRoot || ""] },
      { command: "claude", args: ["plugin", "install", "--scope", scope, "cadre@cadre"] },
      { command: "claude", args: ["plugin", "update", "--scope", scope, "cadre@cadre"] },
    ];
  }
  if (target === "copilot" && scope === "user") {
    return [{ command: "copilot", args: ["plugin", "install", paths.primaryRoot] }];
  }
  if (target === "antigravity" && scope === "user") {
    return [{ command: "agy", args: ["plugin", "install", paths.primaryRoot], optional: true }];
  }
  return [];
}
