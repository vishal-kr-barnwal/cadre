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

function git(root, args) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (args[0] === "init") {
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: root, encoding: "utf8" });
    spawnSync("git", ["config", "tag.gpgsign", "false"], { cwd: root, encoding: "utf8" });
  }
  return result;
}

function sampleSpec(id) {
  return {
    version: 1,
    schema: "cadre.spec.v1",
    track_id: id,
    title: `Spec: ${id}`,
    description: `Spec for ${id}`,
    acceptance_criteria: [{ heading: "Works", body: "The work is complete." }],
  };
}

function planTask(phaseIndex, taskIndex, title, files = [], extra = {}) {
  return {
    task_index: taskIndex,
    task_key: `phase${phaseIndex}_task${taskIndex}`,
    title,
    status: "pending",
    files,
    depends_on: [],
    commit_shas: [],
    repo_shas: {},
    ...extra,
  };
}

function renderPlanProjection(plan) {
  const lines = [`<!-- cadre:generated from="cadre/tracks/${plan.track_id}/plan.json" schema="cadre.plan.v1" hash="test" -->`, `# Plan: ${plan.track_id}`, ""];
  for (const phase of plan.phases || []) {
    lines.push(`## ${phase.title}`, "");
    for (const task of phase.tasks || []) {
      lines.push(`- [ ] Task ${task.task_index}: ${task.title}`);
      if (task.files?.length) lines.push(`  <!-- files: ${task.files.join(", ")} -->`);
      if (task.repo) lines.push(`  <!-- repo: ${task.repo} -->`);
      lines.push("");
    }
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function writeTrack(root, id, plan, metadata = {}) {
  write(path.join(root, "cadre", "tracks.json"), JSON.stringify({
    version: 1,
    schema: "cadre.tracks_index.v1",
    generated_at: "2026-06-17T00:00:00.000Z",
    counts: { new: 1, in_progress: 0, completed: 0, blocked: 0, skipped: 0 },
    tracks: [],
  }, null, 2));
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
  write(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  write(path.join(dir, "spec.json"), JSON.stringify(sampleSpec(id), null, 2));
  write(path.join(dir, "plan.md"), renderPlanProjection(plan));
  write(path.join(dir, "spec.md"), `<!-- cadre:generated from="cadre/tracks/${id}/spec.json" schema="cadre.spec.v1" hash="test" -->\n# Spec: ${id}\n`);
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
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd).toString("utf8").replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
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
    server.stdin.write(`${body}\n`);
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
    const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });
    assert.match(initialized.instructions, /root/);
    assert.match(initialized.instructions, /compact/);
    assert.match(initialized.instructions, /packet-owned/);
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
      "cadre_artifact",
    ]) {
      assert.ok(names.includes(name), `expected ${name} in tools/list`);
    }
    const workflowTool = tools.tools.find((tool) => tool.name === "cadre_workflow");
    const workflowActions = workflowTool.inputSchema.properties.workflow.enum;
    for (const action of ["setup", "newtrack", "implement", "status", "review", "validate", "ship", "land", "archive", "handoff", "artifacts", "artifact_sync"]) {
      assert.ok(workflowActions.includes(action), `expected ${action} workflow`);
    }
    const artifactTool = tools.tools.find((tool) => tool.name === "cadre_artifact");
    const artifactActions = artifactTool.inputSchema.properties.action.enum;
    for (const action of ["catalog", "schema", "validate", "render", "diff", "sync"]) {
      assert.ok(artifactActions.includes(action), `expected ${action} artifact action`);
    }
    assert.equal(artifactActions.includes("import"), false);
    assert.ok(workflowTool.inputSchema.allOf.some((entry) => entry.not?.anyOf?.some((item) => item.required?.includes("planText"))));
    const projectTool = tools.tools.find((tool) => tool.name === "cadre_project");
    const projectActions = projectTool.inputSchema.properties.action.enum;
    assert.ok(projectActions.includes("tech_stack_summary"));
    assert.ok(projectActions.includes("integrations"));
    const trackTool = tools.tools.find((tool) => tool.name === "cadre_track");
    const trackActions = trackTool.inputSchema.properties.action.enum;
    assert.ok(trackActions.includes("plan_assist"));
    assert.ok(trackActions.includes("worktree_plan"));
    const parallelTool = tools.tools.find((tool) => tool.name === "cadre_parallel");
    const parallelActions = parallelTool.inputSchema.properties.action.enum;
    assert.ok(parallelActions.includes("next_wave"));
    assert.ok(parallelActions.includes("setup_workers"));
    assert.ok(parallelTool.inputSchema.required.includes("root"));
    assert.ok(parallelTool.inputSchema.required.includes("action"));
    assert.ok(parallelTool.inputSchema.anyOf.some((entry) => entry.required.includes("trackId")));
    const reviewTool = tools.tools.find((tool) => tool.name === "cadre_review");
    const reviewActions = reviewTool.inputSchema.properties.action.enum;
    assert.ok(reviewActions.includes("provider_evidence"));
    assert.ok(reviewTool.inputSchema.allOf.some((entry) => entry.then && entry.then.anyOf));
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
    assert.ok(uris.includes("cadre://workspace-health"));
    assert.ok(uris.includes("cadre://integrations"));
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
    assert.ok(uris.includes("cadre://artifact-catalog"));
    assert.ok(uris.includes("cadre://artifact-schema"));
    assert.ok(uris.includes("cadre://artifact-preview"));
    assert.ok(uris.includes("cadre://artifact-sync-plan"));
    assert.ok(uris.includes("cadre://track-spec"));
    assert.ok(uris.includes("cadre://styleguide-selection"));
    const templates = await request("resources/templates/list", {});
    const templateUris = templates.resourceTemplates.map((template) => template.uriTemplate);
    assert.ok(templateUris.some((uri) => uri.startsWith("cadre://track-context")));
    const templateByUri = new Map(templates.resourceTemplates.map((template) => [template.uriTemplate.split("{")[0], template]));
    assert.deepEqual(templateByUri.get("cadre://provider-actions").required, ["root", "trackId", "workflow"]);
    assert.deepEqual(templateByUri.get("cadre://workspace-health").optional, ["responseMode", "detail", "compact"]);
    assert.deepEqual(templateByUri.get("cadre://integrations").optional, ["responseMode", "detail", "compact"]);
    assert.ok(templateByUri.get("cadre://workspace-health").uriTemplate.includes("responseMode"));
    assert.ok(templateByUri.get("cadre://repo-map").optional.includes("symbol"));
    assert.deepEqual(templateByUri.get("cadre://ship-plan").required, ["root", "trackId"]);
    assert.deepEqual(templateByUri.get("cadre://land-plan").required, ["root", "trackId"]);
    assert.deepEqual(templateByUri.get("cadre://job-result").required, ["root", "jobId"]);
    assert.deepEqual(templateByUri.get("cadre://test-impact").required, ["root"]);
    assert.deepEqual(templateByUri.get("cadre://test-impact").requiredAny, [["files"], ["base", "head"]]);
    assert.deepEqual(templateByUri.get("cadre://artifact-preview").required, ["root", "artifact"]);
    assert.deepEqual(templateByUri.get("cadre://artifact-sync-plan").optional, ["scope", "artifact", "includeArchive"]);
    assert.deepEqual(templateByUri.get("cadre://track-spec").required, ["root", "trackId"]);

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

    const integrations = await request("tools/call", {
      name: "cadre_project",
      arguments: { action: "integrations", root: path.join(root, "project") },
    });
    assert.equal(parseTextJson(integrations).data.ok, true);

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

test("MCP async jobs survive restarts and persist list/result snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-job-restart-test-"));
  const projectRoot = path.join(root, "project");
  const first = startServer();
  try {
    write(path.join(projectRoot, "cadre", "setup_state.json"), "{}\n");
    write(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "project",
      private: true,
      type: "module",
    }, null, 2));
    write(path.join(projectRoot, "src", "index.ts"), "export const value = 1;\n");

    await first.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });
    const started = parseTextJson(await first.request("tools/call", {
      name: "cadre_job",
      arguments: {
        action: "start",
        type: "coverage",
        root: projectRoot,
        args: { command: "printf 'Statements : 91%%\\n'", coverageThreshold: 80 },
      },
    }));
    const jobId = started.job.id;
    assert.match(jobId, /^job_[0-9a-f-]{36}$/i);
    const completed = await waitForJob(first.request, jobId);
    assert.equal(completed.data.result.coverage, 91);

    const health = JSON.parse((await first.request("resources/read", {
      uri: `cadre://workspace-health?root=${encodeURIComponent(projectRoot)}`,
    })).contents[0].text);
    assert.equal(health.data.ok, true);
    assert.equal(health.data.root, projectRoot);
    assert.ok(Array.isArray(health.data.languages.detected));
    assert.equal(health.data.workspace.repo_count, 1);
    assert.ok(Array.isArray(health.data.integrations.optional_mcps));
    assert.equal(typeof health.data.parallel.available_count, "number");

    await new Promise((resolve) => {
      first.server.once("exit", resolve);
      first.server.kill("SIGTERM");
    });

    const second = startServer();
    try {
      await second.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });
      const listed = parseTextJson(await second.request("tools/call", {
        name: "cadre_job",
        arguments: { action: "list", root: projectRoot },
      }));
      const persisted = listed.data.jobs.find((job) => job.id === jobId);
      assert.equal(Boolean(persisted), true);
      assert.equal(persisted.persisted, true);
      assert.equal(persisted.stale, false);

      const result = parseTextJson(await second.request("tools/call", {
        name: "cadre_job",
        arguments: { action: "result", root: projectRoot, jobId },
      }));
      assert.equal(result.data.job.id, jobId);
      assert.equal(result.data.result.coverage, 91);

      const restarted = parseTextJson(await second.request("tools/call", {
        name: "cadre_job",
        arguments: {
          action: "start",
          type: "coverage",
          root: projectRoot,
          args: { command: "printf 'Statements : 88%%\\n'", coverageThreshold: 80 },
        },
      }));
      assert.notEqual(restarted.job.id, jobId);
      await waitForJob(second.request, restarted.job.id);
    } finally {
      await new Promise((resolve) => {
        second.server.once("exit", resolve);
        second.server.kill("SIGTERM");
      });
    }
  } finally {
    first.server.kill("SIGTERM");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP warm LSP review qualifies polyrepo findings with repo context", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-polyrepo-lsp-test-"));
  const appRoot = path.join(root, "products", "app");
  const { server, request } = startServer();
  try {
    write(path.join(root, "cadre", "setup_state.json"), "{}\n");
    write(path.join(root, "cadre", "repos.json"), JSON.stringify({
      mode: "polyrepo",
      default_repo: "app",
      repos: [
        { name: "app", submodule_path: "products/app", default_branch: "main" },
      ],
    }, null, 2));
    write(path.join(root, "cadre", "lsp.json"), JSON.stringify({
      servers: [
        {
          id: "javascript",
          command: "cadre-missing-js-language-server",
          args: ["--stdio"],
          extensions: [".js"],
        },
      ],
    }, null, 2));
    writeTrack(root, "poly_lsp", {
      version: 1,
      schema: "cadre.plan.v1",
      track_id: "poly_lsp",
      phases: [{
        phase_index: 1,
        title: "Phase 1: App",
        execution_mode: "sequential",
        depends_on: [],
        tasks: [planTask(1, 1, "Update app", ["src/app.js"], { repo: "app" })],
      }],
    }, {
      repos: {
        app: {
          submodule_path: "products/app",
          base_branch: "main",
          git_branch: "track/poly_lsp",
        },
      },
    });

    fs.mkdirSync(appRoot, { recursive: true });
    git(appRoot, ["init"]);
    git(appRoot, ["config", "user.email", "reviewer@example.com"]);
    git(appRoot, ["config", "user.name", "Reviewer"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() { return true; }\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "initial app"]);
    git(appRoot, ["branch", "-M", "main"]);
    git(appRoot, ["checkout", "-b", "track/poly_lsp"]);
    write(path.join(appRoot, "src", "app.js"), "export function app() { return 'changed'; }\n");
    git(appRoot, ["add", "."]);
    git(appRoot, ["commit", "-m", "change app"]);

    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });
    const review = parseTextJson(await request("tools/call", {
      name: "cadre_intel",
      arguments: {
        root,
        action: "lsp_warm_review",
        trackId: "poly_lsp",
        timeoutMs: 10000,
      },
    }));
    assert.equal(review.data.polyrepo, true);
    const appResult = review.data.repos.find((repo) => repo.repo === "app");
    assert.equal(appResult.path, "products/app");
    assert.equal(appResult.cwd, appRoot);
    assert.ok(review.data.findings.length > 0);
    for (const finding of review.data.findings) {
      assert.equal(finding.repo, "app");
      assert.equal(typeof finding.path, "string");
      assert.equal(finding.cwd, appRoot);
    }

    await request("tools/call", {
      name: "cadre_intel",
      arguments: { action: "lsp_daemon_shutdown" },
    });
  } finally {
    server.kill("SIGTERM");
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
    writeTrack(root, "packets_20260618", {
      version: 1,
      schema: "cadre.plan.v1",
      track_id: "packets_20260618",
      phases: [{
        phase_index: 1,
        title: "Phase 1: Packet Flow",
        execution_mode: "parallel",
        depends_on: [],
        tasks: [
          planTask(1, 1, "Update app", ["src/app.ts"]),
          planTask(1, 2, "Update test", ["src/app.test.ts"]),
        ],
      }],
    });

    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });

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

    const artifactCatalog = parseTextJson(await request("tools/call", {
      name: "cadre_artifact",
      arguments: { root, action: "catalog", scope: "track:packets_20260618" },
    }));
    assert.equal(artifactCatalog.data.ok, true);
    assert.ok(artifactCatalog.data.artifacts.some((artifact) => artifact.id === "track:packets_20260618:plan"));

    const artifactSync = parseTextJson(await request("tools/call", {
      name: "cadre_artifact",
      arguments: { root, action: "sync", scope: "track:packets_20260618" },
    }));
    assert.equal(artifactSync.data.ok, true);
    assert.equal(artifactSync.data.dry_run, true);
    assert.ok(artifactSync.data.artifacts.some((artifact) => artifact.artifact_id === "track:packets_20260618:plan"));

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

    const trackSpecResource = await request("resources/read", {
      uri: `cadre://track-spec?root=${encodeURIComponent(root)}&trackId=packets_20260618`,
    });
    assert.equal(JSON.parse(trackSpecResource.contents[0].text).data.ok, true);

    const artifactPreviewResource = await request("resources/read", {
      uri: `cadre://artifact-preview?root=${encodeURIComponent(root)}&artifact=${encodeURIComponent("track:packets_20260618:plan")}`,
    });
    assert.equal(JSON.parse(artifactPreviewResource.contents[0].text).data.ok, true);

    const artifactSyncResource = await request("resources/read", {
      uri: `cadre://artifact-sync-plan?root=${encodeURIComponent(root)}&scope=${encodeURIComponent("track:packets_20260618")}`,
    });
    assert.equal(JSON.parse(artifactSyncResource.contents[0].text).data.dry_run, true);

    const topologyResource = await request("resources/read", {
      uri: `cadre://repo-topology?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(topologyResource.contents[0].text).data.ok, true);

    const lspResource = await request("resources/read", {
      uri: `cadre://lsp-status?root=${encodeURIComponent(root)}`,
    });
    assert.equal(JSON.parse(lspResource.contents[0].text).data.ok, true);

    const healthResource = await request("resources/read", {
      uri: `cadre://workspace-health?root=${encodeURIComponent(root)}`,
    });
    const parsedHealth = JSON.parse(healthResource.contents[0].text);
    assert.equal(parsedHealth.data.response_mode, "compact");
    assert.equal(parsedHealth.data.workspace.repo_count, 1);
    assert.ok(Array.isArray(parsedHealth.data.languages.detected));
    assert.equal(typeof parsedHealth.data.parallel.available_count, "number");
    assert.ok(parsedHealth.data.integrations.optional_mcps.some((entry) => entry.kind === "code_search"));

    const healthDetailResource = await request("resources/read", {
      uri: `cadre://workspace-health?root=${encodeURIComponent(root)}&responseMode=detail`,
    });
    const parsedHealthDetail = JSON.parse(healthDetailResource.contents[0].text);
    assert.equal(parsedHealthDetail.data.response_mode, "detail");
    assert.ok(Array.isArray(parsedHealthDetail.data.workspace.adapters));

    const integrationsResource = await request("resources/read", {
      uri: `cadre://integrations?root=${encodeURIComponent(root)}&responseMode=detail`,
    });
    const parsedIntegrations = JSON.parse(integrationsResource.contents[0].text);
    assert.equal(parsedIntegrations.data.response_mode, "detail");
    assert.ok(Array.isArray(parsedIntegrations.data.optional_mcps));

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
