import { spawnSync } from "node:child_process";

import type { CommandAvailability } from "./types";

export function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function commandAvailability(command: unknown): CommandAvailability {
  if (!command || typeof command !== "string") {
    return {
      state: "invalid",
      command: typeof command === "string" ? command : null,
      message: "Server command is missing or invalid",
    };
  }
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    return {
      state: "available",
      command,
      path: result.stdout.trim().split(/\r?\n/)[0] || command,
    };
  }
  return {
    state: "missing",
    command,
    message: (result.stderr || result.stdout || "Command not found on PATH").trim(),
  };
}
