import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDoctor } from "./doctor.js";
import { runGuide } from "./guide.js";
import { runInstall } from "./install.js";
import { runUninstall } from "./uninstall.js";
import { CADRE_RUNTIME_VERSION } from "../src/domain/version.js";

function usage(): string {
  return [
    "Cadre CLI",
    "",
    "Usage:",
    "  cadre-ai install [--target auto|codex|claude|zed|all] [--scope user] [--dry-run] [--replace-marketplace]",
    "  cadre-ai uninstall [--target codex|claude|zed|all] [--scope user] [--dry-run]",
    "  cadre-ai doctor [--json] [--home PATH | --marketplace-root PATH]",
    "  cadre-ai guide",
    "  cadre-ai --version",
    "  cadre-ai help"
  ].join("\n");
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function runCli(args: string[]): number {
  const command = args[0] ?? "help";
  if (command === "install") return runInstall(args.slice(1));
  if (command === "uninstall" || command === "remove") return runUninstall(args.slice(1));
  if (command === "doctor") return runDoctor(args.slice(1), packageRoot());
  if (command === "guide") return runGuide(args.slice(1));
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
