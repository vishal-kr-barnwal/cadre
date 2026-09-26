/**
 * Post-merge Cadre version bump.
 *
 * `planRelease` is pure: it turns a snapshot of the release files into exact before/after contents.
 * `applyReleasePlan` rechecks every file against that snapshot, stages all writes, and then renames
 * them into place. The tool never stages, commits, tags, pushes, publishes, or installs anything.
 *
 *   node --import tsx scripts/release-version.ts <version> [--date YYYY-MM-DD] [--dry-run] [--root PATH]
 */
import {
  chmodSync, lstatSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, type Stats
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { findNodeAtLocation, parseTree, type ParseError } from "jsonc-parser/lib/esm/main.js";
import {
  datedChangelog, githubReleaseBody, hasReleaseHeading, insertReleaseNotes, unreleasedSection
} from "./release-documents.js";

/** Repository-relative files that carry or describe the release version. */
export const RELEASE_FILES = {
  harnessPackage: "harness/package.json",
  docsPackage: "docs/package.json",
  codexManifest: "harness/.codex-plugin/plugin.json",
  claudeManifest: "harness/.claude-plugin/plugin.json",
  runtime: "harness/src/domain/version.ts",
  changelog: "harness/CHANGELOG.md",
  releaseNotes: "docs/content/release-notes.md"
} as const;
export type ReleaseFileKey = keyof typeof RELEASE_FILES;
export const GITHUB_RELEASES_DIRECTORY = ".github/releases";

const VERSIONED_JSON_FILES = [
  "harnessPackage", "docsPackage", "codexManifest", "claudeManifest"
] as const satisfies readonly ReleaseFileKey[];
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const USAGE = "Usage: node --import tsx scripts/release-version.ts <version> [--date YYYY-MM-DD] [--dry-run] [--root PATH]";

export interface ReleaseSnapshot {
  readonly files: Readonly<Record<ReleaseFileKey, string>>;
  /** Entry names in `.github/releases`. */
  readonly githubReleases: readonly string[];
}

export interface ReleaseRequest {
  readonly version: string;
  readonly date: string;
}

export interface ReleaseChange {
  readonly path: string;
  readonly summary: string;
  /** Exact content the plan was computed from; null when the file is created. */
  readonly before: string | null;
  readonly after: string;
}

export interface ReleasePlan {
  readonly previousVersion: string;
  readonly version: string;
  readonly date: string;
  /** Whether CONTINUABLE_EXECUTION_RELEASES already names the previous release. */
  readonly previousReleaseContinuable: boolean;
  readonly changes: readonly ReleaseChange[];
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Versions and dates

export type VersionParts = readonly [number, number, number];
const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Parse strict MAJOR.MINOR.PATCH: no prefix, leading zeros, pre-release, or build metadata. */
export function parseReleaseVersion(value: string, label = "version"): VersionParts {
  const match = STRICT_VERSION.exec(value);
  const parts = match ? [Number(match[1]), Number(match[2]), Number(match[3])] as const : null;
  if (!parts || !parts.every((part) => Number.isSafeInteger(part))) {
    fail(`${label} must be strict MAJOR.MINOR.PATCH (for example 3.10.0); found ${JSON.stringify(value)}`);
  }
  return parts;
}

/** Numeric comparison of strict versions: negative, zero, or positive. */
export function compareVersions(left: string, right: string): number {
  const a = parseReleaseVersion(left), b = parseReleaseVersion(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Accept only a real calendar date written as YYYY-MM-DD. */
export function parseReleaseDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return value;
  }
  return fail(`--date must be a calendar date formatted YYYY-MM-DD; found ${JSON.stringify(value)}`);
}

export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// JSON manifests

function jsonVersion(path: string, text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return fail(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(value) || typeof value.version !== "string") return fail(`${path}: missing a top-level "version" string`);
  return value.version;
}

/** Replace only the top-level `version` string token and verify nothing else changed. */
export function setJsonVersion(path: string, text: string, version: string): string {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  const node = tree && errors.length === 0 ? findNodeAtLocation(tree, ["version"]) : undefined;
  if (!node || node.type !== "string") return fail(`${path}: cannot locate the top-level "version" string`);
  const after = `${text.slice(0, node.offset)}${JSON.stringify(version)}${text.slice(node.offset + node.length)}`;
  const expected = { ...(JSON.parse(text) as Record<string, unknown>), version };
  if (!isDeepStrictEqual(JSON.parse(after), expected)) fail(`${path}: the targeted edit changed more than the top-level version`);
  return after;
}

/** Browsable GitHub URL derived from harness/package.json `repository`. */
export function repositoryWebUrl(packageJson: string): string {
  const manifest: unknown = JSON.parse(packageJson);
  const repository = isRecord(manifest) ? manifest.repository : undefined;
  const raw = typeof repository === "string"
    ? repository
    : isRecord(repository) && typeof repository.url === "string" ? repository.url : "";
  const url = raw.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url)) {
    return fail(`${RELEASE_FILES.harnessPackage}: repository.url must name an https GitHub repository; found ${JSON.stringify(raw)}`);
  }
  return url;
}

// Runtime identity

const RUNTIME_DECLARATION = /^export const CADRE_RUNTIME_VERSION = "([^"\n]*)";$/gm;
const LEGACY_DECLARATION = /^export const LEGACY_RUNTIME_VERSIONS = \[([^\]\n]*)\] as const;$/gm;

interface Declaration {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

function declaration(source: string, pattern: RegExp, name: string): Declaration {
  const matches = [...source.matchAll(pattern)];
  const match = matches[0];
  if (matches.length !== 1 || !match || match.index === undefined) {
    return fail(`${RELEASE_FILES.runtime}: expected exactly one ${name} declaration; found ${matches.length}`);
  }
  return { start: match.index, end: match.index + match[0].length, value: match[1] ?? "" };
}

function legacyVersions(list: string): string[] {
  return (list.trim() ? list.split(",") : []).map((item) => {
    const version = /^"([^"]+)"$/.exec(item.trim())?.[1];
    if (!version) fail(`${RELEASE_FILES.runtime}: LEGACY_RUNTIME_VERSIONS must list string literals; found ${item.trim()}`);
    parseReleaseVersion(version, "LEGACY_RUNTIME_VERSIONS entry");
    return version;
  });
}

function runtimeVersion(source: string): string {
  return declaration(source, RUNTIME_DECLARATION, "CADRE_RUNTIME_VERSION").value;
}

/** Set CADRE_RUNTIME_VERSION and record the previous identity first in LEGACY_RUNTIME_VERSIONS. */
export function setRuntimeVersion(source: string, previous: string, version: string): string {
  const runtime = declaration(source, RUNTIME_DECLARATION, "CADRE_RUNTIME_VERSION");
  const legacy = declaration(source, LEGACY_DECLARATION, "LEGACY_RUNTIME_VERSIONS");
  const legacyList = legacyVersions(legacy.value);
  if (runtime.value !== previous) fail(`${RELEASE_FILES.runtime}: CADRE_RUNTIME_VERSION is ${runtime.value}, not ${previous}`);
  for (const known of [previous, version]) {
    if (legacyList.includes(known)) fail(`${RELEASE_FILES.runtime}: LEGACY_RUNTIME_VERSIONS already contains ${known}`);
  }
  const expectedLegacy = [previous, ...legacyList];
  const replacements = [
    { ...runtime, text: `export const CADRE_RUNTIME_VERSION = ${JSON.stringify(version)};` },
    { ...legacy, text: `export const LEGACY_RUNTIME_VERSIONS = [${expectedLegacy.map((item) => JSON.stringify(item)).join(", ")}] as const;` }
  ].sort((left, right) => right.start - left.start);
  let after = source;
  for (const { start, end, text } of replacements) after = `${after.slice(0, start)}${text}${after.slice(end)}`;
  const editedLegacy = legacyVersions(declaration(after, LEGACY_DECLARATION, "LEGACY_RUNTIME_VERSIONS").value);
  if (runtimeVersion(after) !== version || !isDeepStrictEqual(editedLegacy, expectedLegacy)) {
    fail(`${RELEASE_FILES.runtime}: the runtime version edit did not verify`);
  }
  return after;
}

// Planning

/** Validate the snapshot and compute every release edit without touching the filesystem. */
export function planRelease(snapshot: ReleaseSnapshot, request: ReleaseRequest): ReleasePlan {
  const { files } = snapshot, { version } = request;
  parseReleaseVersion(version);
  const date = parseReleaseDate(request.date);
  const sources = [
    ...VERSIONED_JSON_FILES.map((key) => ({ label: RELEASE_FILES[key], version: jsonVersion(RELEASE_FILES[key], files[key]) })),
    { label: `${RELEASE_FILES.runtime} CADRE_RUNTIME_VERSION`, version: runtimeVersion(files.runtime) }
  ];
  const previousVersion = sources[0]!.version;
  if (sources.some((source) => source.version !== previousVersion)) {
    fail(`Version sources must agree before bumping: ${sources.map((source) => `${source.label}=${source.version}`).join(", ")}`);
  }
  parseReleaseVersion(previousVersion, "current version");
  if (compareVersions(version, previousVersion) <= 0) fail(`${version} must be greater than the current version ${previousVersion}`);
  const unreleased = unreleasedSection(files.changelog, RELEASE_FILES.changelog);
  const existing = [
    ...(hasReleaseHeading(files.changelog, version) ? [RELEASE_FILES.changelog] : []),
    ...(hasReleaseHeading(files.releaseNotes, version) ? [RELEASE_FILES.releaseNotes] : []),
    ...(snapshot.githubReleases.includes(`${version}.md`) ? [`${GITHUB_RELEASES_DIRECTORY}/${version}.md`] : [])
  ];
  if (existing.length) fail(`${version} already exists in ${existing.join(", ")}`);
  const repositoryUrl = repositoryWebUrl(files.harnessPackage);
  const update = (key: ReleaseFileKey, after: string, summary: string): ReleaseChange =>
    ({ path: RELEASE_FILES[key], summary, before: files[key], after });
  return {
    previousVersion,
    version,
    date,
    previousReleaseContinuable: files.runtime.includes(`runtimeVersion: ${JSON.stringify(previousVersion)}`),
    changes: [
      ...VERSIONED_JSON_FILES.map((key) =>
        update(key, setJsonVersion(RELEASE_FILES[key], files[key], version), `version ${previousVersion} -> ${version}`)),
      update("runtime", setRuntimeVersion(files.runtime, previousVersion, version),
        `CADRE_RUNTIME_VERSION ${previousVersion} -> ${version}; prepend ${previousVersion} to LEGACY_RUNTIME_VERSIONS`),
      update("changelog", datedChangelog(files.changelog, unreleased, version, date),
        `rename ## [Unreleased] to ## [${version}] - ${date}`),
      update("releaseNotes", insertReleaseNotes(files.releaseNotes, RELEASE_FILES.releaseNotes, { version, date, body: unreleased.body }),
        `insert ## ${version} - ${date} with the Unreleased body after # Release Notes`),
      {
        path: `${GITHUB_RELEASES_DIRECTORY}/${version}.md`,
        summary: "GitHub release body with the generated Upgrade and compatibility section",
        before: null,
        after: githubReleaseBody(unreleased.body, { version, previousVersion, repositoryUrl, changelogPath: RELEASE_FILES.changelog })
      }
    ]
  };
}

// Filesystem boundary

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Refuse release paths that traverse a symbolic link inside the repository root. */
function assertNoSymlinks(root: string, path: string): void {
  let current = root;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    if (lstatOrNull(current)?.isSymbolicLink()) fail(`${path}: refusing to follow the symbolic link ${current}`);
  }
}

export function readReleaseSnapshot(rootInput: string): ReleaseSnapshot {
  const root = resolve(rootInput);
  const files = {} as Record<ReleaseFileKey, string>;
  for (const key of Object.keys(RELEASE_FILES) as ReleaseFileKey[]) {
    const path = RELEASE_FILES[key];
    assertNoSymlinks(root, path);
    if (!lstatOrNull(join(root, path))?.isFile()) fail(`${path}: missing regular file under ${root}`);
    files[key] = readFileSync(join(root, path), "utf8");
  }
  assertNoSymlinks(root, GITHUB_RELEASES_DIRECTORY);
  const releases = join(root, GITHUB_RELEASES_DIRECTORY);
  if (!lstatOrNull(releases)?.isDirectory()) fail(`${GITHUB_RELEASES_DIRECTORY}: missing directory under ${root}`);
  return { files, githubReleases: readdirSync(releases).sort() };
}

/** Write a plan only if every file still matches the planned snapshot; created files never replace anything. */
export function applyReleasePlan(rootInput: string, plan: ReleasePlan): void {
  const root = resolve(rootInput);
  for (const change of plan.changes) {
    assertNoSymlinks(root, change.path);
    const target = join(root, change.path), current = lstatOrNull(target);
    const unchanged = change.before === null
      ? current === null
      : current?.isFile() === true && readFileSync(target, "utf8") === change.before;
    if (!unchanged) fail(`${change.path} changed after planning; nothing was written. Rerun release:version.`);
  }
  const staged: Array<{ readonly path: string; readonly temporary: string; readonly target: string }> = [];
  try {
    for (const change of plan.changes) {
      if (change.before === null) continue;
      const target = join(root, change.path);
      const temporary = join(dirname(target), `.${basename(target)}.release-${process.pid}.tmp`);
      writeFileSync(temporary, change.after, { encoding: "utf8", flag: "wx" });
      chmodSync(temporary, statSync(target).mode);
      staged.push({ path: change.path, temporary, target });
    }
    const applied: string[] = [];
    for (const change of plan.changes) {
      if (change.before !== null) continue;
      writeFileSync(join(root, change.path), change.after, { encoding: "utf8", flag: "wx" });
      applied.push(change.path);
    }
    for (const entry of staged) {
      try {
        renameSync(entry.temporary, entry.target);
      } catch (error) {
        fail(`Release edits were only partly applied (${applied.join(", ")}); ${entry.path} failed: `
          + `${error instanceof Error ? error.message : String(error)}. Restore those files before retrying.`);
      }
      applied.push(entry.path);
    }
  } finally {
    for (const { temporary } of staged) if (lstatOrNull(temporary)) unlinkSync(temporary);
  }
}

// Presentation and CLI

function changedLines(change: ReleaseChange): string[] {
  const format = (sign: string) => (line: string) => `  ${sign} ${line}`.trimEnd();
  if (change.before === null) return change.after.replace(/\n$/, "").split("\n").map(format("+"));
  const left = change.before.split("\n"), right = change.after.split("\n");
  let start = 0, leftEnd = left.length, rightEnd = right.length;
  while (start < leftEnd && start < rightEnd && left[start] === right[start]) start++;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }
  return [...left.slice(start, leftEnd).map(format("-")), ...right.slice(start, rightEnd).map(format("+"))];
}

export function releaseManualSteps(plan: ReleasePlan, dryRun: boolean): string[] {
  const release = `${GITHUB_RELEASES_DIRECTORY}/${plan.version}.md`, tag = `release-${plan.version}`;
  return [
    ...(dryRun ? ["Rerun without --dry-run to write these edits."] : []),
    `Review the edits with git diff, including ${RELEASE_FILES.changelog}, ${RELEASE_FILES.releaseNotes}, and ${release}; `
      + "update the README release blurb if needed.",
    plan.previousReleaseContinuable
      ? `CONTINUABLE_EXECUTION_RELEASES in ${RELEASE_FILES.runtime} already lists ${plan.previousVersion}; keep its template set pairs accurate.`
      : `If this release changes the active template set, add ${plan.previousVersion} and its template set to `
        + `CONTINUABLE_EXECUTION_RELEASES in ${RELEASE_FILES.runtime}.`,
    "Run all release gates and the native three-client installer checks from the root AGENTS.md, and record the results in "
      + `docs/development/cadre-${plan.version}-release.md.`,
    `Commit the release as "chore(release): prepare ${plan.version}".`,
    `Create the signed tag ${tag} and publish the GitHub release from ${release}. Publishing runs the release workflow, `
      + "which requires the tag to match harness/package.json, publishes npm, and deploys the docs."
  ];
}

export function formatReleasePlan(plan: ReleasePlan, options: { readonly dryRun: boolean; readonly root: string }): string {
  const lines = [
    `Cadre release ${plan.previousVersion} -> ${plan.version} (${plan.date}) in ${options.root}`,
    options.dryRun
      ? "Dry run: no files were written."
      : `Applied ${plan.changes.length} file changes. Nothing was staged, committed, tagged, pushed, or published.`,
    ""
  ];
  for (const change of plan.changes) {
    lines.push(`${change.before === null ? "create" : "update"} ${change.path}: ${change.summary}`, ...changedLines(change));
  }
  lines.push("", "Remaining manual steps:", ...releaseManualSteps(plan, options.dryRun).map((step, index) => `  ${index + 1}. ${step}`));
  return `${lines.join("\n")}\n`;
}

export interface ReleaseCliOptions {
  readonly version: string;
  readonly date: string | undefined;
  readonly dryRun: boolean;
  readonly root: string | undefined;
}

export function parseReleaseArgs(args: readonly string[]): ReleaseCliOptions {
  const seen = new Set<string>();
  let version: string | undefined, date: string | undefined, root: string | undefined, dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") continue;
    if (!arg.startsWith("-")) {
      if (version !== undefined) fail(`Unexpected argument ${JSON.stringify(arg)}\n${USAGE}`);
      version = arg;
      continue;
    }
    if (seen.has(arg)) fail(`${arg} may be given only once\n${USAGE}`);
    seen.add(arg);
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg !== "--date" && arg !== "--root") fail(`Unknown option ${arg}\n${USAGE}`);
    const value = args[++index];
    if (value === undefined || value.startsWith("-")) fail(`${arg} requires a value\n${USAGE}`);
    if (arg === "--date") date = value;
    else root = value;
  }
  if (version === undefined) fail(`Missing <version>\n${USAGE}`);
  return { version, date, dryRun, root };
}

export interface ReleaseRunResult {
  readonly plan: ReleasePlan;
  readonly written: boolean;
  readonly output: string;
}

/** Plan and, unless --dry-run, apply a release. `now` supplies the default UTC date. */
export function runReleaseVersion(args: readonly string[], now: Date = new Date()): ReleaseRunResult {
  const options = parseReleaseArgs(args);
  const root = resolve(options.root ?? DEFAULT_ROOT);
  const plan = planRelease(readReleaseSnapshot(root), { version: options.version, date: options.date ?? utcToday(now) });
  if (!options.dryRun) applyReleasePlan(root, plan);
  return { plan, written: !options.dryRun, output: formatReleasePlan(plan, { dryRun: options.dryRun, root }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    try {
      process.stdout.write(runReleaseVersion(args).output);
    } catch (error) {
      process.stderr.write(`release:version: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
