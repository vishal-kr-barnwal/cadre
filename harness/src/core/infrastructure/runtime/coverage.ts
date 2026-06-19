import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { CoverageResult } from "../../application/runtime/contracts";
import { fileExists, readJson } from "./json-store";
import { configuredCoverageCommand, loadTopology, parseCoveragePercent } from "./project-config";
import { runCommand } from "./system";

export function parseLcovCoverage(root: string): number | null {
  const candidates = [
    path.join(root, "coverage", "lcov.info"),
    path.join(root, "lcov.info"),
  ];
  for (const file of candidates) {
    if (!fileExists(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    let found = 0;
    let hit = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("LF:")) found += Number(line.slice(3)) || 0;
      if (line.startsWith("LH:")) hit += Number(line.slice(3)) || 0;
    }
    if (found > 0) return Math.round((hit / found) * 10000) / 100;
  }
  return null;
}

export function coverageThreshold(root: string): number {
  const topology = loadTopology(root);
  const config = topology.config || {};
  for (const key of ["coverage_threshold", "minimum_coverage", "min_coverage"]) {
    const value = Number(config[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const workflowPath = path.join(root, "cadre", "workflow.json");
  const workflow = readJson<JsonObject | null>(workflowPath, null);
  if (workflow) {
    const text = JSON.stringify(workflow);
    const match = text.match(/(?:coverage|test coverage)[^%]{0,120}?([0-9]+(?:\.[0-9]+)?)\s*%/i);
    if (match?.[1]) return Number(match[1]);
  }
  return 80;
}

export function runCoverage(root: string, args: RuntimeArgs = {}, workingRoot = root): CoverageResult {
  const command = configuredCoverageCommand(root, args, workingRoot);
  if (!command) {
    return {
      ok: false,
      available: false,
      command: null,
      coverage: null,
      reason: "No coverage/test command configured or detected",
      hints: [
        "Set cadre/config.json coverage_command",
        "Add package.json scripts.coverage or scripts.test:coverage",
        "Pass { command } explicitly to cadre_complete_task",
      ],
    };
  }
  const timeoutMs = Number(args.timeoutMs || 10 * 60 * 1000);
  const result = runCommand(command, [], {
    cwd: workingRoot,
    shell: true,
    timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const parsed = parseCoveragePercent(combined);
  const lcov = parsed == null ? parseLcovCoverage(workingRoot) : null;
  const coverage = parsed == null ? lcov : parsed;
  return {
    ok: result.ok,
    available: true,
    command,
    cwd: workingRoot,
    status: result.status,
    signal: result.signal,
    coverage,
    coverage_source: parsed == null && lcov != null ? "lcov" : (parsed != null ? "output" : null),
    timed_out: result.signal === "SIGTERM" || result.signal === "SIGKILL",
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
    result,
  };
}

export function parseIsoTime(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function staleInfo(value: unknown, now = Date.now()): { stale: boolean; age_minutes: number | null } {
  const time = parseIsoTime(value);
  if (!time) return { stale: false, age_minutes: null };
  const ageMs = Math.max(0, now - time);
  return {
    stale: ageMs > STALE_LEASE_MS,
    age_minutes: Math.floor(ageMs / 60000),
  };
}
