#!/usr/bin/env node
import path from "node:path";

import * as core from "./cadre-core";
import type { RuntimeArgs } from "./types";
import { asJsonObject, asOptionalString, errorMessage } from "./guards";

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

export async function runJob(payload: RuntimeArgs) {
  const root = payload.root || process.cwd();
  const args = asJsonObject(payload.args) as RuntimeArgs;
  switch (asOptionalString(payload.type)) {
    case "complete_task":
      return core.completeTask(root, args);
    case "coverage":
      return core.testCoverage(root, args);
    case "machine_gate":
      return core.reviewMachineGate(root, args);
    case "review_assist":
      return core.reviewAssist(root, args);
    case "lsp_review":
      return core.lspReview(root, args);
    case "lsp_impact":
      return core.lspImpact(root, args);
    case "dap_snapshot":
      return core.dapSnapshot(root, args);
    default:
      return { ok: false, error: `Unsupported job type: ${payload.type}` };
  }
}

export async function runJobRunner(): Promise<void> {
  const input = await readStdin();
  const payload = asJsonObject(JSON.parse(input || "{}")) as RuntimeArgs;
  const result = await runJob(payload);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (["cadre-job-runner.js", "cadre-job-runner.ts"].includes(path.basename(process.argv[1] || ""))) {
  runJobRunner().catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage(error), stack: error instanceof Error ? error.stack : undefined }, null, 2)}\n`);
    process.exit(1);
  });
}
