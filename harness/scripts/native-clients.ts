import { spawnSync } from "node:child_process";
import { CLIENTS, type ClientName } from "./client-adapters.js";

export { CLIENTS, type ClientName } from "./client-adapters.js";

export function commandExists(command: ClientName): boolean {
  const lookup = process.platform === "win32" ? "where" : "which";
  return spawnSync(lookup, [command], { stdio: "ignore" }).status === 0;
}

export function runCommand(command: ClientName, args: readonly string[], capture = false): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit"
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error(`${command} is not installed or not available on PATH`);
  }
  if (result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout).trim() : "command failed";
    throw new Error(`${command} ${args.join(" ")}: ${detail}`);
  }
  return capture ? (result.stdout ?? "") : "";
}

export function runJson<T>(command: ClientName, args: readonly string[]): T {
  const output = runCommand(command, args, true);
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`${command} ${args.join(" ")} returned invalid JSON`);
  }
}
