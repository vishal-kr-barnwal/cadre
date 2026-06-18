#!/usr/bin/env node
import path from "node:path";
import { errorMessage } from "./guards";
import { runCli } from "./lsp/review-runner";

export { LspClient, commandAvailability, runReview, runCli } from "./lsp/review-runner";

if (["cadre-lsp-review.js", "cadre-lsp-review.ts"].includes(path.basename(process.argv[1] || ""))) {
  runCli().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
