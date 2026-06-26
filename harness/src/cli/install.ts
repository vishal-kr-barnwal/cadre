import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { approvalSummary, bootstrapClientApprovals, checkClientApprovals } from "./client-approvals";
import { checkTarget, pingMcp, printPlan, runCommand } from "./install-checks";
import {
  INSTALL_TARGETS,
  ParsedInstall,
  Scope,
  Target,
  commandExists,
  installCommands,
  runtimePaths,
  selectedTargets,
  targetPaths,
  uninstallCommands,
} from "./install-targets";
import { removeTarget, writeTarget } from "./install-writers";

interface CliContext {
  skillShim: string;
}

function usage(): string {
  return [
    "Cadre CLI",
    "",
    "Usage:",
    "  cadre install [--target codex|claude|copilot|antigravity|all] [--scope user|project|local] [--dry-run] [--check] [--force] [--yes]",
    "  cadre uninstall [--target codex|claude|copilot|antigravity|all] [--scope user|project|local] [--dry-run] [--yes]",
    "  cadre doctor",
    "  cadre help",
  ].join("\n");
}

function parseTarget(value: string | undefined): "all" | Target {
  if (!value) throw new Error("--target requires a value");
  if (value === "all") return value;
  if ((INSTALL_TARGETS as readonly string[]).includes(value)) return value as Target;
  throw new Error("--target must be codex, claude, copilot, antigravity, or all");
}

function parseScope(value: string | undefined): Scope {
  if (value === "user" || value === "project" || value === "local") return value;
  throw new Error("--scope must be user, project, or local");
}

function parseInstall(argv: string[]): ParsedInstall {
  const parsed: ParsedInstall = {
    target: "auto",
    scope: "user",
    dryRun: false,
    check: false,
    force: false,
    yes: false,
    cadreHome: process.env.CADRE_HOME || path.join(os.homedir(), ".cadre"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--check") parsed.check = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--yes" || arg === "-y") parsed.yes = true;
    else if (arg === "--target") {
      parsed.target = parseTarget(argv[index + 1]);
      index += 1;
    } else if (arg === "--scope") {
      parsed.scope = parseScope(argv[index + 1]);
      index += 1;
    } else if (arg === "--home") {
      const value = argv[index + 1];
      if (!value) throw new Error("--home requires a path");
      parsed.cadreHome = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown install option: ${arg}`);
    }
  }
  return parsed;
}

function printApprovalResult(target: Target, path: string, configured: boolean): void {
  if (configured) {
    process.stdout.write(`Cadre ${target} MCP tool approvals are configured in ${path}\n`);
  } else {
    process.stdout.write(`Cadre ${target} MCP tools may prompt on first use; no approval file was changed.\n`);
  }
}

function installedNoun(paths: { pluginRoots: string[] }): string {
  return paths.pluginRoots.length > 0 ? "plugin" : "skill";
}

function pathsExist(paths: { marketplaceRoot?: string; pluginRoots: string[]; skillRoots: string[] }): boolean {
  return Boolean(
    (paths.marketplaceRoot && fs.existsSync(paths.marketplaceRoot))
    || paths.pluginRoots.some((root) => fs.existsSync(root))
    || paths.skillRoots.some((root) => fs.existsSync(root))
  );
}

function selectedUninstallTargets(options: ParsedInstall): Target[] {
  if (options.target !== "auto" && options.target !== "all") return [options.target];
  if (options.target === "all") return [...INSTALL_TARGETS];
  return INSTALL_TARGETS.filter((target) =>
    commandExists(target === "antigravity" ? "agy" : target)
    || pathsExist(targetPaths(options.cadreHome, target, options.scope))
  );
}

function printUninstallPlan(target: Target, paths: { marketplaceRoot?: string; pluginRoots: string[]; skillRoots: string[] }, commands: ReturnType<typeof uninstallCommands>): void {
  if (paths.marketplaceRoot) process.stdout.write(`Would remove: ${paths.marketplaceRoot}\n`);
  for (const pluginRoot of paths.pluginRoots) process.stdout.write(`Would remove: ${pluginRoot}\n`);
  for (const skillRoot of paths.skillRoots) process.stdout.write(`Would remove: ${skillRoot}\n`);
  for (const command of commands) process.stdout.write(`Would run: ${command.command} ${command.args.join(" ")}\n`);
  if (!pathsExist(paths) && commands.length === 0) process.stdout.write(`No Cadre ${target} files or native uninstall commands found.\n`);
}

function missingInstallCommandIsWarning(options: ParsedInstall, target: Target, optional?: boolean): boolean {
  return optional === true || (options.target === "all" && target === "copilot");
}

function runInstall(argv: string[], context: CliContext): number {
  const options = parseInstall(argv);
  const runtime = runtimePaths();
  const targets = selectedTargets(options);
  if (targets.length === 0) {
    process.stderr.write("No supported client detected. Install Codex, Claude, Copilot, or Antigravity, or pass --target codex|claude|copilot|antigravity.\n");
    return 1;
  }
  const ping = pingMcp(runtime);
  if (!ping.ok) {
    process.stderr.write(`Cadre MCP check failed: ${ping.reason}\n`);
    return 1;
  }
  let ok = true;
  for (const target of targets) {
    let targetOk = true;
    const paths = targetPaths(options.cadreHome, target, options.scope);
    const commands = installCommands(target, paths, options.scope);
    if (options.dryRun) {
      printPlan(target, paths, commands);
      process.stdout.write(`Would configure: ${approvalSummary(target)}\n`);
      continue;
    }
    if (!options.check) writeTarget(target, paths, runtime, context.skillShim);
    const errors = checkTarget(target, paths, runtime);
    if (!options.check) {
      const approvals = bootstrapClientApprovals(target);
      if (!approvals.ok) errors.push(`${target} approval bootstrap failed: ${approvals.error || approvals.path}`);
    }
    const approvalCheck = checkClientApprovals(target);
    if (!approvalCheck.ok) errors.push(`${target} approval check failed: ${approvalCheck.error || approvalCheck.path}`);
    if (errors.length > 0) {
      ok = false;
      targetOk = false;
      for (const error of errors) process.stderr.write(`${error}\n`);
      continue;
    }
    if (options.check) {
      process.stdout.write(`Cadre ${target} ${installedNoun(paths)} is installed and points at ${runtime.mcpServer}\n`);
      printApprovalResult(target, approvalCheck.path, approvalCheck.configured);
      continue;
    }
    for (const command of commands) {
      if (!commandExists(command.command)) {
        const message = `${command.command} command not found; plugin files were written but native registration was skipped.\n`;
        if (missingInstallCommandIsWarning(options, target, command.optional)) process.stderr.write(message);
        else {
          targetOk = false;
          ok = false;
          process.stderr.write(message);
        }
        continue;
      }
      const result = runCommand(command);
      if (!result.ok) {
        targetOk = false;
        ok = false;
        process.stderr.write(`${command.command} ${command.args.join(" ")} failed: ${result.stderr}\n`);
      }
    }
    if (targetOk) {
      process.stdout.write(`Installed Cadre ${target} ${installedNoun(paths)} through ${paths.primaryRoot}\n`);
      printApprovalResult(target, approvalCheck.path, approvalCheck.configured);
    }
  }
  return ok ? 0 : 1;
}

function runUninstall(argv: string[]): number {
  const options = parseInstall(argv);
  const targets = selectedUninstallTargets(options);
  if (targets.length === 0) {
    process.stderr.write("No Cadre client install found. Pass --target codex|claude|copilot|antigravity to remove a specific generated target.\n");
    return 1;
  }
  for (const target of targets) {
    const paths = targetPaths(options.cadreHome, target, options.scope);
    const commands = uninstallCommands(target, paths, options.scope);
    if (options.dryRun) {
      printUninstallPlan(target, paths, commands);
      continue;
    }
    for (const command of commands) {
      if (!commandExists(command.command)) {
        process.stderr.write(`${command.command} command not found; removing generated Cadre ${target} files only.\n`);
        continue;
      }
      const result = runCommand(command);
      if (!result.ok) {
        process.stderr.write(`${command.command} ${command.args.join(" ")} failed; continuing local cleanup: ${result.stderr}\n`);
      }
    }
    const removed = removeTarget(paths);
    if (removed.length > 0) {
      process.stdout.write(`Uninstalled Cadre ${target} ${installedNoun(paths)} and removed ${removed.join(", ")}\n`);
    } else {
      process.stdout.write(`No generated Cadre ${target} files found to remove.\n`);
    }
  }
  return 0;
}

function runDoctor(): number {
  const runtime = runtimePaths();
  const ping = pingMcp(runtime);
  const checks = [
    `package root: ${runtime.runtimeRoot}`,
    `node: ${runtime.nodePath}`,
    `cadre-mcp: ${runtime.mcpServer}`,
    `mcp ping: ${ping.ok ? "ok" : `failed (${ping.reason})`}`,
  ];
  process.stdout.write(`${checks.join("\n")}\n`);
  return ping.ok ? 0 : 1;
}

export async function runCli(argv: string[], context: CliContext): Promise<void> {
  const command = argv[0] || "help";
  let code = 0;
  if (command === "install") code = runInstall(argv.slice(1), context);
  else if (command === "uninstall" || command === "remove") code = runUninstall(argv.slice(1));
  else if (command === "doctor") code = runDoctor();
  else if (command === "help" || command === "--help" || command === "-h") process.stdout.write(`${usage()}\n`);
  else {
    process.stderr.write(`${usage()}\n`);
    code = 1;
  }
  if (code !== 0) process.exit(code);
}
