#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeTrack(root, id, plan, metadata = {}) {
  write(path.join(root, "cadre", "tracks.md"), "# Tracks\n\n<!-- cadre:index:start -->\n<!-- cadre:index:end -->\n");
  const dir = path.join(root, "cadre", "tracks", id);
  write(path.join(dir, "metadata.json"), JSON.stringify({
    track_id: id,
    type: "feature",
    status: "new",
    priority: "medium",
    description: id,
    git_branch: `track/${id}`,
    depends_on: [],
    ...metadata,
  }, null, 2));
  write(path.join(dir, "plan.md"), plan);
  write(path.join(dir, "spec.md"), `# Spec: ${id}\n`);
}

function startServer() {
  const server = spawn(process.execPath, [path.join(__dirname, "cadre-server.js")], {
    cwd: path.resolve(__dirname, "..", ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();

  server.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;
      const message = JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
      buffer = buffer.slice(bodyEnd);
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { mcpError: message.error }));
      else waiter.resolve(message.result);
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 3000);
    });
  }

  return { server, request };
}

function parseTextJson(result) {
  return JSON.parse(result.content[0].text);
}

function requestDaemon(daemon, method, params = {}) {
  const id = requestDaemon.nextId++;
  daemon.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const onLine = (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== id) return;
      cleanup();
      if (message.error) reject(new Error(message.error.message || "daemon error"));
      else resolve(message.result);
    };
    const cleanup = () => {
      clearTimeout(timer);
      requestDaemon.listeners.delete(id);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for daemon ${method}`));
    }, 3000);
    requestDaemon.listeners.set(id, onLine);
  });
}
requestDaemon.nextId = 1;
requestDaemon.listeners = new Map();

async function waitForJob(request, jobId) {
  for (let i = 0; i < 20; i += 1) {
    const result = await request("tools/call", {
      name: "cadre_job",
      arguments: { action: "result", jobId },
    });
    const parsed = parseTextJson(result);
    if (parsed.data.job.status !== "running") return parsed;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

test("LSP setup JSON and daemon status/shutdown smoke", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-lsp-smoke-"));
  const daemon = spawn(process.execPath, [path.join(__dirname, "..", "cadre-lsp-daemon.js")], {
    cwd: path.resolve(__dirname, "..", ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let daemonBuffer = "";
  daemon.stdout.setEncoding("utf8");
  daemon.stdout.on("data", (chunk) => {
    daemonBuffer += chunk;
    while (daemonBuffer.includes("\n")) {
      const index = daemonBuffer.indexOf("\n");
      const line = daemonBuffer.slice(0, index).trim();
      daemonBuffer = daemonBuffer.slice(index + 1);
      if (!line) continue;
      for (const listener of requestDaemon.listeners.values()) listener(line);
    }
  });

  try {
    write(path.join(root, "src", "index.ts"), "export function typedSmoke() { return true; }\n");
    write(path.join(root, "app", "main.py"), "def python_smoke():\n    return True\n");
    write(path.join(root, "crates", "core", "lib.rs"), "pub fn rust_smoke() -> bool { true }\n");
    write(path.join(root, "Dockerfile"), "FROM alpine\n");
    write(path.join(root, "deploy", "service.yaml"), "name: smoke\n");
    const setup = spawnSync(process.execPath, [
      path.join(__dirname, "..", "cadre-lsp-setup.js"),
      "--root",
      root,
      "--write",
      "--json",
    ], { encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const parsed = JSON.parse(setup.stdout);
    assert.equal(parsed.root, root);
    assert.ok(Array.isArray(parsed.recommended));
    for (const id of ["typescript", "python", "rust", "dockerfile", "yaml"]) {
      assert.ok(parsed.recommended.some((entry) => entry.id === id), `expected ${id} recommendation`);
      assert.ok(parsed.added.includes(id), `expected ${id} to be written`);
    }
    const config = JSON.parse(fs.readFileSync(path.join(root, "cadre", "lsp.json"), "utf8"));
    const docker = config.servers.find((server) => server.id === "dockerfile");
    assert.deepEqual(docker.filenames, ["Dockerfile", "Containerfile"]);
    assert.equal(docker.languageIds.Dockerfile, "dockerfile");

    const status = await requestDaemon(daemon, "status");
    assert.equal(status.ok, true);
    assert.deepEqual(status.servers, []);
    const shutdown = await requestDaemon(daemon, "shutdown");
    assert.equal(shutdown.ok, true);
  } finally {
    daemon.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP root resolution rejects harness skill directories without project state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-server-test-"));
  const { server, request } = startServer();
  try {
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });
    const tools = await request("tools/list", {});
    const names = tools.tools.map((tool) => tool.name);
    for (const name of [
      "cadre_workflow",
      "cadre_project",
      "cadre_status",
      "cadre_track",
      "cadre_parallel",
      "cadre_mutate",
      "cadre_complete_task",
      "cadre_beads",
      "cadre_job",
      "cadre_review",
      "cadre_intel",
    ]) {
      assert.ok(names.includes(name), `expected ${name} in tools/list`);
    }
    const workflowTool = tools.tools.find((tool) => tool.name === "cadre_workflow");
    const workflowActions = workflowTool.inputSchema.properties.workflow.enum;
    for (const action of ["setup", "newtrack", "implement", "status", "review", "validate", "ship", "land", "archive", "handoff"]) {
      assert.ok(workflowActions.includes(action), `expected ${action} workflow`);
    }
    const projectTool = tools.tools.find((tool) => tool.name === "cadre_project");
    const projectActions = projectTool.inputSchema.properties.action.enum;
    assert.ok(projectActions.includes("tech_stack_summary"));
    const trackTool = tools.tools.find((tool) => tool.name === "cadre_track");
    const trackActions = trackTool.inputSchema.properties.action.enum;
    assert.ok(trackActions.includes("plan_assist"));
    assert.ok(trackActions.includes("worktree_plan"));
    const parallelTool = tools.tools.find((tool) => tool.name === "cadre_parallel");
    const parallelActions = parallelTool.inputSchema.properties.action.enum;
    assert.ok(parallelActions.includes("next_wave"));
    assert.ok(parallelActions.includes("setup_workers"));
    const reviewTool = tools.tools.find((tool) => tool.name === "cadre_review");
    const reviewActions = reviewTool.inputSchema.properties.action.enum;
    assert.ok(reviewActions.includes("provider_evidence"));
    const intelTool = tools.tools.find((tool) => tool.name === "cadre_intel");
    const intelActions = intelTool.inputSchema.properties.action.enum;
    assert.ok(intelActions.includes("lsp_setup"));
    assert.ok(intelActions.includes("workspace_diagnostics"));
    assert.ok(intelActions.includes("test_impact"));
    assert.ok(intelActions.includes("dependency_graph"));
    const statusTool = tools.tools.find((tool) => tool.name === "cadre_status");
    const statusActions = statusTool.inputSchema.properties.action.enum;
    assert.ok(statusActions.includes("fleet"));
    assert.ok(statusActions.includes("beads_summary"));
    const resources = await request("resources/list", {});
    const uris = resources.resources.map((resource) => resource.uri);
    assert.ok(uris.includes("cadre://fleet-board"));
    assert.ok(uris.includes("cadre://beads-summary"));
    assert.ok(uris.includes("cadre://review-evidence"));
    assert.ok(uris.includes("cadre://workspace-diagnostics"));
    assert.ok(uris.includes("cadre://lsp-status"));
    assert.ok(uris.includes("cadre://repo-topology"));
    assert.ok(uris.includes("cadre://provider-actions"));
    assert.ok(uris.includes("cadre://ship-plan"));
    assert.ok(uris.includes("cadre://land-plan"));
    assert.ok(uris.includes("cadre://release-plan"));
    assert.ok(uris.includes("cadre://my-next-actions"));
    assert.ok(uris.includes("cadre://review-queue"));
    assert.ok(uris.includes("cadre://parallel-state"));
    assert.ok(uris.includes("cadre://quality-gate"));
    const templates = await request("resources/templates/list", {});
    const templateUris = templates.resourceTemplates.map((template) => template.uriTemplate);
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://track-context")));

    write(path.join(root, "harness", "skills", "cadre", "SKILL.md"), "# Harness copy\n");
    await assert.rejects(
      request("tools/call", {
        name: "cadre_project",
        arguments: { action: "root", root: path.join(root, "harness", "skills", "cadre") },
      }),
      /requires \{ root \}/
    );

    write(path.join(root, "project", "cadre", "setup_state.json"), "{}\n");
    const valid = await request("tools/call", {
      name: "cadre_project",
      arguments: { action: "root", root: path.join(root, "project", "cadre") },
    });
    assert.equal(parseTextJson(valid).data.root, path.join(root, "project"));

    const doctor = await request("tools/call", {
      name: "cadre_project",
      arguments: { action: "doctor", root: path.join(root, "harness", "skills", "cadre") },
    });
    assert.equal(parseTextJson(doctor).data.checks.cadre_project.ok, false);

    const setupAssist = await request("tools/call", {
      name: "cadre_workflow",
      arguments: { workflow: "setup", root: path.join(root, "uninitialized") },
    });
    const parsedSetupAssist = parseTextJson(setupAssist);
    assert.equal(parsedSetupAssist.data.ok, true);
    assert.equal(parsedSetupAssist.data.packet_only, true);
    assert.equal(parsedSetupAssist.data.workflow, "setup");

    const job = await request("tools/call", {
      name: "cadre_job",
      arguments: {
        action: "start",
        type: "coverage",
        root: path.join(root, "project"),
        args: { command: "printf 'Statements : 91%%\\n'", coverageThreshold: 80 },
      },
    });
    const jobId = parseTextJson(job).job.id;
    const completed = await waitForJob(request, jobId);
    assert.equal(completed.ok, true);
    assert.equal(completed.data.result.coverage, 91);
    assert.equal(fs.existsSync(path.join(root, "project", "cadre", "jobs", `${jobId}.json`)), true);
    const jobResource = await request("resources/read", {
      uri: `cadre://job-result?root=${encodeURIComponent(path.join(root, "project"))}&jobId=${jobId}`,
    });
    assert.equal(JSON.parse(jobResource.contents[0].text).data.status, "succeeded");
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP team-scale workflow packets compose on one track", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-server-packets-test-"));
  const { server, request } = startServer();
  try {
    spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "reviewer@example.com"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "Reviewer"], { cwd: root, encoding: "utf8" });
    write(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
    write(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    write(path.join(root, "src", "app.ts"), "export const app = true;\n");
    write(path.join(root, "src", "app.test.ts"), "test('app', () => {});\n");
    writeTrack(root, "packets_20260618", `# Plan: packets_20260618

## Phase 1: Packet Flow
<!-- execution: parallel -->

- [ ] Task 1: Update app
  <!-- files: src/app.ts -->

- [ ] Task 2: Update test
  <!-- files: src/app.test.ts -->
`);

    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test" } });

    const planAssist = parseTextJson(await request("tools/call", {
      name: "cadre_track",
      arguments: { root, action: "plan_assist", trackId: "packets_20260618" },
    }));
    assert.equal(planAssist.data.ok, true);
    assert.ok(planAssist.data.likely_tests.includes("src/app.test.ts"));

    const wave = parseTextJson(await request("tools/call", {
      name: "cadre_parallel",
      arguments: { root, action: "next_wave", trackId: "packets_20260618" },
    }));
    assert.equal(wave.data.ok, true);
    assert.equal(wave.data.workers.length, 2);

    const fleet = parseTextJson(await request("tools/call", {
      name: "cadre_status",
      arguments: { root, action: "fleet", includeCollisions: false },
    }));
    assert.equal(fleet.data.ok, true);
    assert.ok(fleet.data.repos.some((repo) => repo.name === "."));

    const workflowStatus = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "status", mode: "fleet", includeCollisions: false },
    }));
    assert.equal(workflowStatus.data.ok, true);
    assert.equal(workflowStatus.data.packet_only, true);
    assert.equal(workflowStatus.data.status.ok, true);

    const workflowValidate = parseTextJson(await request("tools/call", {
      name: "cadre_workflow",
      arguments: { root, workflow: "validate", trackId: "packets_20260618" },
    }));
    assert.equal(workflowValidate.data.ok, true);
    assert.equal(workflowValidate.data.packet_only, true);
    assert.equal(workflowValidate.data.integrity.ok, true);

    const diagnostics = parseTextJson(await request("tools/call", {
      name: "cadre_intel",
      arguments: { root, action: "workspace_diagnostics" },
    }));
    assert.equal(diagnostics.data.ok, true);
    assert.ok(diagnostics.data.adapters.some((adapter) => adapter.id === "node"));

    const lspSetup = parseTextJson(await request("tools/call", {
      name: "cadre_intel",
      arguments: { root, action: "lsp_setup" },
    }));
    assert.equal(lspSetup.data.ok, true);
    assert.equal(lspSetup.data.dry_run, true);
    assert.ok(lspSetup.data.recommended.some((entry) => entry.id === "typescript"));

    const evidence = parseTextJson(await request("tools/call", {
      name: "cadre_review",
      arguments: {
        root,
        action: "provider_evidence",
        trackId: "packets_20260618",
        provider: "github",
        fetch: false,
        evidence: { pr: 7 },
        findings: [{ severity: "blocking", message: "example" }],
      },
    }));
    assert.equal(evidence.data.ok, true);
    assert.equal(evidence.data.entry.blocking_count, 1);

    const resource = await request("resources/read", {
      uri: `cadre://review-evidence?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    const parsedResource = JSON.parse(resource.contents[0].text);
    assert.equal(parsedResource.data.evidence.entries.length, 1);

    const topologyResource = await request("resources/read", {
      uri: `cadre://repo-topology?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(topologyResource.contents[0].text).data.ok, true);

    const lspResource = await request("resources/read", {
      uri: `cadre://lsp-status?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(lspResource.contents[0].text).data.ok, true);

    const releaseResource = await request("resources/read", {
      uri: `cadre://release-plan?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(releaseResource.contents[0].text).data.workflow, "release");

    const parallelResource = await request("resources/read", {
      uri: `cadre://parallel-state?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    assert.equal(JSON.parse(parallelResource.contents[0].text).data.track_id, "packets_20260618");

    const gateResource = await request("resources/read", {
      uri: `cadre://quality-gate?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    assert.equal(JSON.parse(gateResource.contents[0].text).data.review_gate.track_id, "packets_20260618");

    const actionsResource = await request("resources/read", {
      uri: `cadre://my-next-actions?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(actionsResource.contents[0].text).data.ok, true);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
