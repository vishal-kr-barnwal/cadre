#!/usr/bin/env node
import { runCli } from "./cli/install";

declare const __CADRE_SKILL_SHIM__: string | undefined;

runCli(process.argv.slice(2), {
  skillShim: typeof __CADRE_SKILL_SHIM__ === "string" ? __CADRE_SKILL_SHIM__ : "",
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
