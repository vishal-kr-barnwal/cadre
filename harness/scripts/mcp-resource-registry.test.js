#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const esbuild = require("esbuild");

const harnessRoot = path.resolve(__dirname, "..");
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-resource-registry-"));

function loadTypeScriptModule(relativeEntry, name) {
  const outfile = path.join(bundleRoot, `${name}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(harnessRoot, relativeEntry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "silent",
  });
  return require(outfile);
}

const catalog = loadTypeScriptModule("src/mcp/domain/resource-catalog.ts", "resource-catalog");
const resources = loadTypeScriptModule("src/mcp/application/resources-service.ts", "resources-service");
const sourceReader = loadTypeScriptModule("src/mcp/infrastructure/project-source-reader.ts", "project-source-reader");
const capabilities = loadTypeScriptModule("src/mcp/application/project-source-capabilities.ts", "project-source-capabilities");

test.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

test("resource registry separates fixed resources from templates", () => {
  const fixed = catalog.resourceList().resources;
  assert.deepEqual(fixed.map((resource) => resource.uri), ["cadre://template-inventory"]);

  const templates = catalog.resourceTemplatesList().resourceTemplates;
  const templateUris = templates.map((template) => template.uriTemplate.split("{")[0]);
  assert.equal(templates.length, catalog.RESOURCE_SPECS.length - 1);
  assert.ok(templateUris.includes("cadre://dependency-graph"));
  for (const obsolete of [
    "cadre://skill-contract",
    "cadre://workflow-protocols",
    "cadre://workflow-protocol",
    "cadre://agent-references",
    "cadre://agent-reference",
  ]) {
    assert.equal(templateUris.includes(obsolete), false);
    assert.equal(catalog.resourceSpecForUri(obsolete), null);
  }
  assert.equal(catalog.resourceSpecForUri("cadre://release-plan"), null);

  const uris = catalog.RESOURCE_SPECS.map((spec) => spec.uri);
  const handlers = catalog.RESOURCE_SPECS.map((spec) => spec.handler);
  assert.equal(new Set(uris).size, uris.length);
  assert.equal(new Set(handlers).size, handlers.length);
  assert.equal(
    catalog.resourceSpecForUri("cadre://dependency-graph?root=%2Ftmp")?.handler,
    "dependency-graph",
  );
  for (const setupSafe of [
    "workspace-health",
    "workspace-diagnostics",
    "dependency-graph",
    "repo-map",
    "repo-topology",
    "lsp-status",
    "dap-status",
    "integrations",
    "mcp-readiness",
  ]) {
    assert.equal(catalog.resourceSpecForUri(`cadre://${setupSafe}`)?.rootPolicy, "candidate");
  }
  assert.equal(catalog.resourceSpecForUri("cadre://team-board")?.rootPolicy, "cadre");
});

test("resource registry validates required groups and query formats", () => {
  assert.throws(
    () => catalog.parseResourceUri("cadre://dependency-graph"),
    (error) => error.code === -32602 && /requires query parameter 'root'/.test(error.message),
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://workspace-health?root=%2Ftmp&detail=yes"),
    /must be true or false/,
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://workspace-health?root=%2Ftmp&unknown=1"),
    /does not accept query parameter 'unknown'/,
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://workspace-health?root=%2Ftmp&root=%2Fother"),
    /must appear only once/,
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://test-impact?root=%2Ftmp"),
    /requires one of: files OR base \+ head/,
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://test-impact?root=%2Ftmp&base=main"),
    /requires one of: files OR base \+ head/,
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://provider-actions?root=%2Ftmp&trackId=t1&workflow=release"),
    /must be one of: ship, land/,
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://project-skills?root=%2Ftmp&workflow=setup&skillRuleBudget=1.5"),
    /must be a positive integer/,
  );
  assert.throws(
    () => catalog.parseResourceUri("cadre://project-skill-source?root=%2Ftmp&path=notes%2Frules.md"),
    /requires query parameter 'token'/,
  );

  const files = catalog.parseResourceUri("cadre://test-impact?root=%2Ftmp&files=src%2Fa.ts%2Csrc%2Fb.ts");
  assert.deepEqual(files.files, ["src/a.ts", "src/b.ts"]);
  const range = catalog.validateResourceUri("cadre://test-impact?root=%2Ftmp&base=main&head=HEAD");
  assert.equal(range.baseRef, "main");
  assert.equal(range.headRef, "HEAD");
  const skills = catalog.parseResourceUri("cadre://project-skills?root=%2Ftmp&workflow=setup&skillRuleBudget=5000");
  assert.equal(skills.skillRuleBudget, 5000);
});

test("resource resolution is separate from native resources/read wrapping", () => {
  let cadreRootCalls = 0;
  const deps = {
    core: {
      dependencyGraph: (root, args) => ({ ok: true, root, repos: args.repos || [] }),
      teamBoard: (root) => ({ ok: true, root, board: true }),
    },
    jobs: {},
    projectSourceReader: {
      issue: () => ({ ok: false, error: "unused" }),
      readText: () => ({ ok: false, error: "unused" }),
    },
    rootResolver: {
      rootFromCandidate: (root) => ({ root, has_cadre: false }),
      requireCadreRoot: ({ root }) => {
        cadreRootCalls += 1;
        return root;
      },
    },
  };

  const uri = "cadre://dependency-graph?root=%2Fproject&repos=web%2Capi";
  const resolved = resources.resolveResource(uri, deps);
  assert.equal(Object.hasOwn(resolved, "contents"), false);
  assert.deepEqual(resolved.data, { ok: true, root: "/project", repos: ["web", "api"] });
  assert.equal(cadreRootCalls, 0, "setup-safe resources use candidate-root policy");

  const native = resources.resourceRead(uri, deps);
  assert.deepEqual(JSON.parse(native.contents[0].text), resolved);
  resources.resolveResource("cadre://team-board?root=%2Fproject", deps);
  assert.equal(cadreRootCalls, 1, "control-plane resources require a Cadre root");
});

test("track-plan returns the parsed plan already present in track context", () => {
  const plan = { version: 1, schema: "cadre.plan.v1", track_id: "track-1", phases: [] };
  const deps = {
    core: {
      trackContext: () => ({
        ok: true,
        track: { track_id: "track-1", plan_path: "cadre/tracks/track-1/plan.json" },
        plan,
      }),
    },
    jobs: {},
    projectSourceReader: {
      issue: () => ({ ok: false, error: "unused" }),
      readText: () => ({ ok: false, error: "unused" }),
    },
    rootResolver: {
      rootFromCandidate: (root) => ({ root, has_cadre: true }),
      requireCadreRoot: ({ root }) => root,
    },
  };
  const resolved = resources.resolveResource(
    "cadre://track-plan?root=%2Fproject&trackId=track-1",
    deps,
  );
  assert.deepEqual(resolved.data, plan);
});

test("job-result resources fail closed for interrupted persisted jobs", () => {
  const jobId = "job_00000000-0000-0000-0000-000000000000";
  const deps = {
    core: {},
    jobs: {
      loadPersisted: () => ({ id: jobId, status: "running", persisted: true, stale: true }),
    },
    projectSourceReader: {
      issue: () => ({ ok: false, error: "unused" }),
      readText: () => ({ ok: false, error: "unused" }),
    },
    rootResolver: {
      rootFromCandidate: (root) => ({ root, has_cadre: true }),
      requireCadreRoot: ({ root }) => root,
    },
  };
  const resolved = resources.resolveResource(
    `cadre://job-result?root=%2Fproject&jobId=${jobId}`,
    deps,
  );
  assert.equal(resolved.ok, false);
  assert.equal(resolved.data.stale, true);
  assert.match(resolved.errors.join(" "), /interrupted.*restart/i);
});

test("project source capabilities authorize only one canonical bounded text file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-project-source-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-project-source-outside-"));
  try {
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.writeFileSync(path.join(root, "notes", "rules.md"), "Keep changes scoped.\n");
    fs.writeFileSync(path.join(root, ".env"), "SECRET=do-not-read\n");
    fs.symlinkSync(path.join(root, ".env"), path.join(root, "notes", "secret.md"));
    fs.writeFileSync(path.join(root, "notes", "binary.bin"), Buffer.from([65, 0, 66]));
    fs.writeFileSync(path.join(outside, "secret.md"), "outside\n");
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "notes", "linked.md"));
    const reader = new sourceReader.NodeProjectSourceReader();

    assert.equal(reader.readText(root, "notes/rules.md", "").ok, false);
    assert.equal(reader.readText(root, "notes/rules.md", "invented-token").ok, false);
    const issued = reader.issue(root, "notes/rules.md");
    assert.equal(issued.ok, true);
    assert.match(issued.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.deepEqual(reader.readText(root, "notes/rules.md", issued.token), {
      ok: true,
      path: "notes/rules.md",
      bytes: 21,
      content: "Keep changes scoped.\n",
    });
    fs.writeFileSync(path.join(root, "notes", "rules.md"), "Changed after authorization.\n");
    assert.equal(reader.readText(root, "notes/rules.md", issued.token).ok, false);
    assert.equal(reader.readText(root, ".env", issued.token).ok, false);
    assert.equal(reader.issue(root, "../secret.md").ok, false);
    assert.equal(reader.issue(root, ".env").ok, false);
    assert.equal(reader.issue(root, "notes/secret.md").ok, false);
    assert.equal(reader.issue(root, "notes/linked.md").ok, false);
    assert.equal(reader.issue(root, "notes/binary.bin").ok, false);

    let now = Date.parse("2026-07-14T00:00:00.000Z");
    const expiringReader = new sourceReader.NodeProjectSourceReader(100, () => now);
    const expiring = expiringReader.issue(root, "notes/rules.md");
    assert.equal(expiring.ok, true);
    now += 101;
    assert.equal(expiringReader.readText(root, "notes/rules.md", expiring.token).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("workflow source URIs carry capabilities and resolve through the registry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-project-source-packet-"));
  try {
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.writeFileSync(path.join(root, "notes", "rules.md"), "Packet-authorized rules.\n");
    fs.writeFileSync(path.join(root, ".env"), "SECRET=still-private\n");
    const reader = new sourceReader.NodeProjectSourceReader();
    const rawUri = `cadre://project-skill-source?root=${encodeURIComponent(root)}&path=notes%2Frules.md`;
    const packet = capabilities.authorizeProjectSourceResources(reader, root, {
      ok: true,
      data: {},
      warnings: [],
      errors: [],
      resources: [rawUri],
      next: { tool: "cadre_read", arguments: { uri: rawUri } },
    });
    const authorizedUri = packet.resources[0];
    assert.equal(packet.next.arguments.uri, authorizedUri);
    const parsed = catalog.parseResourceUri(authorizedUri);
    assert.equal(parsed.path, "notes/rules.md");
    assert.match(parsed.token, /^[A-Za-z0-9_-]{40,}$/);

    const deps = {
      core: {},
      jobs: {},
      projectSourceReader: reader,
      rootResolver: {
        rootFromCandidate: (candidate) => ({ root: candidate, has_cadre: true }),
        requireCadreRoot: ({ root: candidate }) => candidate,
      },
    };
    const resolved = resources.resolveResource(authorizedUri, deps);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.data.content, "Packet-authorized rules.\n");

    const wrongToken = new URL(authorizedUri);
    wrongToken.searchParams.set("token", "invented-token");
    assert.equal(resources.resolveResource(wrongToken.toString(), deps).ok, false);
    const wrongPath = new URL(authorizedUri);
    wrongPath.searchParams.set("path", ".env");
    assert.equal(resources.resolveResource(wrongPath.toString(), deps).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
