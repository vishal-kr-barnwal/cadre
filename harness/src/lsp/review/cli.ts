import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "../../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "../../guards";
import { isIgnoredFile, normalizeRel, shouldIgnore } from "../ignore-policy";

import { runReview } from "./run-review";
import { CliArgs } from "./types";

export function usage(): void {
  console.log(`Usage: node <cadre-lsp-review.js> [--base main] [--head HEAD] [--config cadre/lsp.json] [--json]

Runs a best-effort LSP reference scan for changed/removed symbols. If no
cadre/lsp.json exists, exits successfully with available=false.

Example cadre/lsp.json:
{
  "servers": [
    {
      "id": "typescript",
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    },
    {
      "id": "python",
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "extensions": [".py", ".pyi"]
    }
  ]
}`);
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    base: "main",
    head: "HEAD",
    config: "cadre/lsp.json",
    json: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--base" || arg === "--head" || arg === "--config") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === "--base") args.base = value;
      else if (arg === "--head") args.head = value;
      else args.config = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export async function runCli(): Promise<void> {
  const args = parseArgs(process.argv);
  const result = await runReview({ ...args, root: process.cwd() });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.available) {
    console.log(`LSP review helper unavailable: ${asOptionalString(result.reason) || "unknown reason"}`);
  } else if (result.findings.length === 0) {
    console.log("LSP review helper found no external reference risks.");
  } else {
    for (const finding of result.findings) {
      console.log(JSON.stringify(finding));
    }
  }
}
