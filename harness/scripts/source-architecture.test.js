#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "src");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });
}

function importsFor(file) {
  const text = fs.readFileSync(file, "utf8");
  const imports = [];
  const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(text))) imports.push(match[1]);
  return imports;
}

function resolveImport(file, specifier) {
  if (!specifier.startsWith(".")) return specifier;
  return path.normalize(path.resolve(path.dirname(file), specifier));
}

function isInside(candidate, dir) {
  const relative = path.relative(dir, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertLayerImports(files, fileRoot, forbiddenRoots, { forbidNode = false } = {}) {
  for (const file of files.filter((candidate) => isInside(candidate, fileRoot))) {
    for (const specifier of importsFor(file)) {
      const resolved = resolveImport(file, specifier);
      if (forbidNode) {
        assert.equal(specifier.startsWith("node:"), false, `${path.relative(root, file)} imports Node API ${specifier}`);
      }
      for (const forbiddenRoot of forbiddenRoots) {
        assert.equal(isInside(resolved, forbiddenRoot), false, `${path.relative(root, file)} imports ${path.relative(root, forbiddenRoot)} ${specifier}`);
      }
    }
  }
}

test("source files stay below the large-file threshold", () => {
  const files = walk(srcRoot);
  const oversized = files
    .map((file) => ({
      file: path.relative(root, file),
      lines: fs.readFileSync(file, "utf8").split(/\r?\n/).length,
    }))
    .filter((entry) => entry.lines > 500);

  assert.deepEqual(oversized, []);
});

test("source architecture keeps domain pure and MCP layered", () => {
  const files = walk(srcRoot);
  const domainRoot = path.join(srcRoot, "core", "domain");
  const infrastructureRoot = path.join(srcRoot, "core", "infrastructure");
  const mcpDomainRoot = path.join(srcRoot, "mcp", "domain");
  const mcpApplicationRoot = path.join(srcRoot, "mcp", "application");
  const mcpInfrastructureRoot = path.join(srcRoot, "mcp", "infrastructure");
  const mcpPresentationRoot = path.join(srcRoot, "mcp", "presentation");

  assertLayerImports(files, domainRoot, [infrastructureRoot, path.join(srcRoot, "mcp")], { forbidNode: true });
  assertLayerImports(files, mcpDomainRoot, [mcpApplicationRoot, mcpInfrastructureRoot, mcpPresentationRoot], { forbidNode: true });
  assertLayerImports(files, mcpApplicationRoot, [mcpInfrastructureRoot, mcpPresentationRoot]);
  assertLayerImports(files, mcpInfrastructureRoot, [mcpApplicationRoot, mcpPresentationRoot]);
});

test("generated cadre-core bundle preserves the public runtime API", () => {
  const core = require("./cadre-core");
  const expected = [
    "artifactCatalog",
    "artifactPacket",
    "artifactRender",
    "artifactSchema",
    "artifactSync",
    "availableWork",
    "appendCadreEvent",
    "appendCadreMessage",
    "claimTrack",
    "completeTask",
    "collisionScan",
    "dapSetup",
    "dapSnapshot",
    "dapStatus",
    "doctor",
    "ensureNativeState",
    "fleetStatus",
    "implementationPrep",
    "dependencyGraph",
    "integrationInventory",
    "isCadreProjectRoot",
    "liveStatus",
    "loadTopology",
    "lspConfigStatus",
    "lspImpact",
    "lspReview",
    "lspSetup",
    "metadataPatch",
    "nativeStateSummary",
    "parallelWorkflow",
    "parsePlanFile",
    "parsePlanJson",
    "phaseSchedule",
    "planAssist",
    "planIntegrity",
    "polyrepoPreflight",
    "prCiStatus",
    "providerEvidence",
    "recordParallelWorker",
    "readCadreEvents",
    "readCadreMessages",
    "recordReview",
    "recordTaskResult",
    "regenIndex",
    "repoMap",
    "reviewAssist",
    "reviewEvidence",
    "reviewGate",
    "reviewMachineGate",
    "setTrackStatus",
    "syncControlPlane",
    "teamBoard",
    "teamStatus",
    "techStackSummary",
    "testCoverage",
    "heartbeatTrack",
    "trackContext",
    "testImpact",
    "worktreePlan",
    "workflowFormula",
    "workflowPacket",
    "workspaceHealth",
    "workspaceDiagnostics",
  ];

  const removedInternals = [
    "STATUS_MARKERS",
    "acquireLock",
    "artifactValidate",
    "gitIdentity",
    "isIgnoredRepoMapFile",
    "listTracks",
    "planClaims",
    "releaseLock",
    "withLock",
    "withTrackLock",
  ];

  for (const name of expected) {
    assert.equal(Object.prototype.hasOwnProperty.call(core, name), true, `missing public export ${name}`);
  }
  for (const name of removedInternals) {
    assert.equal(Object.prototype.hasOwnProperty.call(core, name), false, `internal export leaked ${name}`);
  }
});
