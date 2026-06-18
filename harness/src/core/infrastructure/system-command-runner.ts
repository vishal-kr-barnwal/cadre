import { spawnSync } from "node:child_process";

import type { CommandResult, RuntimeArgs } from "../../types";
import type { CommandRunner } from "../ports";
import { errorMessage } from "../../guards";

export class SystemCommandRunner implements CommandRunner {
  run(command: string, args: string[], options: RuntimeArgs = {}): CommandResult {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      shell: options.shell === true,
      encoding: "utf8",
      timeout: typeof options.timeoutMs === "number" ? options.timeoutMs : undefined,
      maxBuffer: typeof options.maxBuffer === "number" ? options.maxBuffer : 10 * 1024 * 1024,
    });
    const commandResult: CommandResult = {
      ok: result.status === 0,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      command,
      args,
      cwd: options.cwd,
      timed_out: Boolean(result.error && errorMessage(result.error).includes("timed out")),
    };
    if (result.error) commandResult.error = errorMessage(result.error);
    return commandResult;
  }
}
