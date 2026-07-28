import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMcp } from "./build.js";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredEntries = [
  "skills", "templates", "dist", ".mcp.json", ".mcp.codex.json", "LICENSE", "README.md"
];
const optionalEntries = ["hooks", "hooks.json", ".app.json", "assets", "commands", "agents"];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function withCachebuster(version: string, product: string, cachebuster: string): string {
  const base = version.split("+", 1)[0];
  return `${base}+${product}.${cachebuster}`;
}

function defaultCachebuster(): string {
  return `local-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

interface Manifest { version: string; [key: string]: unknown }

export interface PackageResult {
  targetRoot: string;
  pluginRoot: string;
  cachebuster: string;
}

export function packagePluginMarketplace(
  outputRoot: string,
  requestedCachebuster = defaultCachebuster()
): PackageResult {
  buildMcp();
  const targetRoot = resolve(outputRoot);
  const cachebuster = requestedCachebuster.trim();
  if (!/^[0-9A-Za-z-]+$/.test(cachebuster)) {
    throw new Error("cachebuster must contain only letters, digits, and hyphens");
  }

  const pluginRoot = join(targetRoot, "plugins", "cadre");
  if (existsSync(pluginRoot)) throw new Error(`plugin output already exists: ${pluginRoot}`);
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

  const codexManifest = readJson<Manifest>(join(sourceRoot, ".codex-plugin", "plugin.json"));
  codexManifest.version = withCachebuster(codexManifest.version, "codex", cachebuster);
  writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), codexManifest);

  const claudeManifest = readJson<Manifest>(join(sourceRoot, ".claude-plugin", "plugin.json"));
  claudeManifest.version = withCachebuster(claudeManifest.version, "claude", cachebuster);
  writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), claudeManifest);

  writeJson(
    join(targetRoot, ".agents", "plugins", "marketplace.json"),
    readJson<unknown>(join(sourceRoot, "marketplace", "codex.json"))
  );
  writeJson(
    join(targetRoot, ".claude-plugin", "marketplace.json"),
    readJson<unknown>(join(sourceRoot, "marketplace", "claude.json"))
  );

  return { targetRoot, pluginRoot, cachebuster };
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const output = option(args, "--output");
    if (!output) throw new Error("Usage: package-plugin.ts --output PATH [--cachebuster TOKEN]");
    const result = packagePluginMarketplace(output, option(args, "--cachebuster") ?? undefined);
    process.stdout.write(`Packaged Cadre plugin marketplace at ${result.targetRoot}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
