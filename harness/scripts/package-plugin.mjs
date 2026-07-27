#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredEntries = ["skills", "LICENSE", "README.md"];
const optionalEntries = [
  "hooks", "hooks.json", ".mcp.json", ".app.json", "assets", "commands",
  "agents", "servers", "scripts", "package.json"
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function withCachebuster(version, product, cachebuster) {
  const base = version.split("+", 1)[0];
  return `${base}+${product}.${cachebuster}`;
}

function defaultCachebuster() {
  return `local-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

export function packagePluginMarketplace(outputRoot, requestedCachebuster = defaultCachebuster()) {
  const targetRoot = resolve(outputRoot);
  const cachebuster = requestedCachebuster.trim();
  if (!/^[0-9A-Za-z-]+$/.test(cachebuster)) {
    throw new Error("cachebuster must contain only letters, digits, and hyphens");
  }

  const pluginRoot = join(targetRoot, "plugins", "cadre");
  mkdirSync(pluginRoot, { recursive: true });
  for (const entry of requiredEntries) {
    const source = join(sourceRoot, entry);
    if (!existsSync(source)) throw new Error(`required plugin entry is missing: ${entry}`);
    cpSync(source, join(pluginRoot, entry), { recursive: true });
  }
  for (const entry of optionalEntries) {
    const source = join(sourceRoot, entry);
    if (existsSync(source)) cpSync(source, join(pluginRoot, entry), { recursive: true });
  }

  const codexManifest = readJson(join(sourceRoot, ".codex-plugin", "plugin.json"));
  codexManifest.version = withCachebuster(codexManifest.version, "codex", cachebuster);
  writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), codexManifest);

  const claudeManifest = readJson(join(sourceRoot, ".claude-plugin", "plugin.json"));
  claudeManifest.version = withCachebuster(claudeManifest.version, "claude", cachebuster);
  writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), claudeManifest);

  writeJson(
    join(targetRoot, ".agents", "plugins", "marketplace.json"),
    readJson(join(sourceRoot, "marketplace", "codex.json"))
  );
  writeJson(
    join(targetRoot, ".claude-plugin", "marketplace.json"),
    readJson(join(sourceRoot, "marketplace", "claude.json"))
  );

  return { targetRoot, pluginRoot, cachebuster };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const output = option(args, "--output");
    if (!output) throw new Error("Usage: package-plugin.mjs --output PATH [--cachebuster TOKEN]");
    const result = packagePluginMarketplace(output, option(args, "--cachebuster") ?? undefined);
    process.stdout.write(`Packaged Cadre plugin marketplace at ${result.targetRoot}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
