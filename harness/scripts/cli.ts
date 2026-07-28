import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInstall } from "./install.js";
import { runUninstall } from "./uninstall.js";
import { CADRE_RUNTIME_VERSION } from "../src/domain/version.js";

function usage(): string {
  return [
    "Cadre CLI",
    "",
    "Usage:",
    "  cadre install [--target auto|codex|claude|all] [--scope user] [--dry-run] [--replace-marketplace]",
    "  cadre uninstall [--target codex|claude|all] [--scope user] [--dry-run]",
    "  cadre doctor",
    "  cadre --version",
    "  cadre help"
  ].join("\n");
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function runDoctor(): number {
  const root = packageRoot();
  const required = [
    "dist/cadre-cli.mjs",
    "dist/cadre-mcp.mjs",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    "skills",
    "templates"
  ];
  const missing = required.filter((entry) => !existsSync(join(root, entry)));
  const packageJson = join(root, "package.json");
  let identity = `cadre-ai@${CADRE_RUNTIME_VERSION}`;
  if (existsSync(packageJson)) {
    const metadata = JSON.parse(readFileSync(packageJson, "utf8")) as { name?: string; version?: string };
    identity = `${metadata.name ?? "cadre-ai"}@${metadata.version ?? CADRE_RUNTIME_VERSION}`;
  }
  process.stdout.write(`${identity}\npackage root: ${root}\n`);
  if (missing.length) {
    process.stderr.write(`Missing packaged runtime assets: ${missing.join(", ")}\n`);
    return 1;
  }
  process.stdout.write("self-contained runtime: ok\n");
  return 0;
}

export function runCli(args: string[]): number {
  const command = args[0] ?? "help";
  if (command === "install") return runInstall(args.slice(1));
  if (command === "uninstall" || command === "remove") return runUninstall(args.slice(1));
  if (command === "doctor") return runDoctor();
  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${CADRE_RUNTIME_VERSION}\n`);
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  process.stderr.write(`${usage()}\n`);
  return 1;
}

try {
  process.exitCode = runCli(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
