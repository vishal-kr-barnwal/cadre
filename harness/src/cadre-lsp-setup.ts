#!/usr/bin/env node
import path from "node:path";

import { runCli } from "./lsp/setup-recommender";

export {
  commandAvailability,
  loadConfig,
  mergeConfig,
  parseArgs,
  recommend,
  runCli,
  scanFiles,
} from "./lsp/setup-recommender";

if (["cadre-lsp-setup.js", "cadre-lsp-setup.ts"].includes(path.basename(process.argv[1] || ""))) {
  try {
    runCli();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
