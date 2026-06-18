#!/usr/bin/env node
"use strict";

const core = require("./cadre-core");

function readStdin() {
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

function runJob(payload) {
  const root = payload.root;
  const args = payload.args || {};
  switch (payload.type) {
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
    default:
      return { ok: false, error: `Unsupported job type: ${payload.type}` };
  }
}

async function main() {
  const input = await readStdin();
  const payload = JSON.parse(input || "{}");
  const result = runJob(payload);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2)}\n`);
  process.exit(1);
});
