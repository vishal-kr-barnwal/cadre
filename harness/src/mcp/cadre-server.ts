#!/usr/bin/env node
import { runJobRunner } from "../cadre-job-runner";
import { runLspDaemon } from "../cadre-lsp-daemon";
import { runCli as runLspReviewCli } from "../cadre-lsp-review";
import { runCli as runLspSetupCli } from "../cadre-lsp-setup";
import { errorMessage } from "../guards";
import { handle } from "./server-runtime";
import { startStdioTransport } from "./stdio-transport";

async function withHiddenModeStripped(fn: () => void | Promise<void>): Promise<void> {
  const originalArgv = process.argv;
  process.argv = [
    originalArgv[0] || process.execPath,
    originalArgv[1] || "cadre-server.js",
    ...originalArgv.slice(3),
  ];
  try {
    await fn();
  } finally {
    process.argv = originalArgv;
  }
}

const mode = process.argv[2];

async function main(): Promise<void> {
  if (mode === "--cadre-job-runner") {
    await runJobRunner();
    return;
  }
  if (mode === "--cadre-lsp-daemon") {
    runLspDaemon();
    return;
  }
  if (mode === "--cadre-lsp-setup") {
    await withHiddenModeStripped(() => runLspSetupCli());
    return;
  }
  if (mode === "--cadre-lsp-review") {
    await withHiddenModeStripped(() => runLspReviewCli());
    return;
  }
  startStdioTransport(handle);
}

main().catch((error) => {
  if (mode === "--cadre-job-runner") {
    process.stdout.write(`${JSON.stringify({ ok: false, error: errorMessage(error), stack: error instanceof Error ? error.stack : undefined }, null, 2)}\n`);
  } else {
    process.stderr.write(`${errorMessage(error)}\n`);
  }
  process.exit(1);
});
