#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const agent = option("--agent", "all");
const scope = option("--scope", "project");
const force = args.includes("--force");
const target = resolve(option("--target", process.cwd()));

if (!["all", "codex", "claude"].includes(agent)) {
  throw new Error("--agent must be all, codex, or claude");
}
if (!["project", "user"].includes(scope)) {
  throw new Error("--scope must be project or user");
}

const destinations = [];
if (agent === "all" || agent === "codex") {
  destinations.push(scope === "user" ? join(homedir(), ".agents", "skills") : join(target, ".agents", "skills"));
}
if (agent === "all" || agent === "claude") {
  destinations.push(scope === "user" ? join(homedir(), ".claude", "skills") : join(target, ".claude", "skills"));
}

for (const destination of destinations) {
  mkdirSync(destination, { recursive: true });
  for (const skill of [
    "cadre-create", "cadre-track", "cadre-implement", "cadre-review", "cadre-revise",
    "cadre-archive", "cadre-refresh", "cadre-revert", "cadre-status", "cadre-wisp"
  ]) {
    const source = join(root, "skills", skill);
    const output = join(destination, skill);
    if (existsSync(output) && !force) {
      throw new Error(`${output} already exists; review it and rerun with --force to replace it`);
    }
    cpSync(source, output, { recursive: true, force, errorOnExist: !force });
  }
  process.stdout.write(`Installed Cadre skills in ${realpathSync(destination)}\n`);
}
