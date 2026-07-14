#!/usr/bin/env node
import * as core from "../../cadre-core";

import { createMcpRuntime } from "../application/router";
import { JobManager } from "../infrastructure/job-manager";
import { LspDaemonClient } from "../infrastructure/lsp-daemon-client";
import { NodeProjectSourceReader } from "../infrastructure/project-source-reader";
import { requireCadreRoot, rootFromCandidate } from "../infrastructure/root-resolution";

const runtime = createMcpRuntime({
  core,
  jobs: new JobManager(),
  lspDaemon: new LspDaemonClient(),
  projectSourceReader: new NodeProjectSourceReader(),
  rootResolver: { requireCadreRoot, rootFromCandidate },
});

export const handle = runtime.handle;
