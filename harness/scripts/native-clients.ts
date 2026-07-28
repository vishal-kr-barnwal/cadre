import { spawnSync } from "node:child_process";

export const CLIENTS = ["codex", "claude"] as const;
export type ClientName = typeof CLIENTS[number];

export function commandExists(command: string): boolean {
  const lookup = process.platform === "win32" ? "where" : "which";
  return spawnSync(lookup, [command], { stdio: "ignore" }).status === 0;
}

export function runCommand(command: string, args: string[], capture = false): string {
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

export function runJson<T>(command: string, args: string[]): T {
  const output = runCommand(command, args, true);
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`${command} ${args.join(" ")} returned invalid JSON`);
  }
}
