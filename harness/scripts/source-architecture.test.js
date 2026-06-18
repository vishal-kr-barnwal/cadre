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

test("source architecture keeps domain pure and MCP away from core infrastructure", () => {
  const files = walk(srcRoot);
  const domainRoot = path.join(srcRoot, "core", "domain");
  const infrastructureRoot = path.join(srcRoot, "core", "infrastructure");
  const mcpRoot = path.join(srcRoot, "mcp");

  for (const file of files.filter((candidate) => isInside(candidate, domainRoot))) {
    for (const specifier of importsFor(file)) {
      const resolved = resolveImport(file, specifier);
      assert.equal(specifier.startsWith("node:"), false, `${path.relative(root, file)} imports Node API ${specifier}`);
      assert.equal(isInside(resolved, infrastructureRoot), false, `${path.relative(root, file)} imports infrastructure ${specifier}`);
      assert.equal(isInside(resolved, mcpRoot), false, `${path.relative(root, file)} imports MCP ${specifier}`);
    }
  }

  for (const file of files.filter((candidate) => isInside(candidate, mcpRoot))) {
    for (const specifier of importsFor(file)) {
      const resolved = resolveImport(file, specifier);
      assert.equal(isInside(resolved, infrastructureRoot), false, `${path.relative(root, file)} imports core infrastructure ${specifier}`);
    }
  }
});

test("generated cadre-core bundle preserves the public runtime API", () => {
  const core = require("./cadre-core");
  const expected = [
    "STATUS_MARKERS",
    "acquireLock",
    "availableWork",
    "beadsSummary",
    "beadsTaskWrite",
    "claimTrack",
    "completeTask",
    "collisionScan",
    "createBeadsTree",
    "doctor",
    "fleetStatus",
    "gitIdentity",
    "implementationPrep",
    "dependencyGraph",
    "isCadreProjectRoot",
    "isIgnoredRepoMapFile",
    "listTracks",
    "liveStatus",
    "loadTopology",
    "lspConfigStatus",
    "lspImpact",
    "lspReview",
    "lspSetup",
    "metadataPatch",
    "parallelWorkflow",
    "parsePlanFile",
    "parsePlanText",
    "phaseSchedule",
    "planClaims",
    "planAssist",
    "planIntegrity",
    "polyrepoPreflight",
    "prCiStatus",
    "providerEvidence",
    "recordParallelWorker",
    "recordReview",
    "recordTaskResult",
    "regenIndex",
    "repoMap",
    "reviewAssist",
    "reviewEvidence",
    "reviewGate",
    "reviewMachineGate",
    "releaseLock",
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
    "workflowPacket",
    "workspaceDiagnostics",
    "withLock",
    "withTrackLock",
  ];

  for (const name of expected) {
    assert.equal(Object.prototype.hasOwnProperty.call(core, name), true, `missing public export ${name}`);
  }
});
