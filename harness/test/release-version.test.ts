import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  CADRE_RUNTIME_VERSION, CONTINUABLE_EXECUTION_RELEASES, LEGACY_RUNTIME_VERSIONS, TEMPLATE_SET_VERSION
} from "../src/domain/version.js";
import {
  GITHUB_RELEASES_DIRECTORY, RELEASE_FILES, applyReleasePlan, compareVersions, parseReleaseArgs, planRelease,
  readReleaseSnapshot, runReleaseVersion
} from "../scripts/release-version.js";

const harness = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(harness, "..");
const DATE = "2026-10-01";
const [MAJOR, MINOR] = CADRE_RUNTIME_VERSION.split(".").map(Number) as [number, number];
/** The next minor release of the copied files, for example 3.10.0 while 3.9.0 is current. */
const NEXT = `${MAJOR}.${MINOR + 1}.0`;
const FIXTURE_REPOSITORY = "https://github.com/example/cadre-fixture";
const BODY = [
  "Cadre fixture release summary.",
  "",
  "### Added",
  "",
  "- Add the fixture capability.",
  "",
  "```bash",
  "### a shell comment, not a heading",
  "## nor a changelog section boundary",
  "```",
  "",
  "### Upgrade and compatibility",
  "",
  "- Executions started by the previous release may continue to a safe boundary before the approved refresh."
].join("\n");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const releaseFile = `${GITHUB_RELEASES_DIRECTORY}/${NEXT}.md`;
const realReleases = readdirSync(join(repository, GITHUB_RELEASES_DIRECTORY));

/** A disposable repository holding only the files release:version reads or writes; never the real one. */
function copy(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), "cadre-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of Object.values(RELEASE_FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(repository, path), join(root, path));
  }
  cpSync(join(repository, GITHUB_RELEASES_DIRECTORY), join(root, GITHUB_RELEASES_DIRECTORY), { recursive: true });
  // A fixed Unreleased section keeps the test independent of whatever the real changelog has pending.
  const changelog = readFileSync(join(root, RELEASE_FILES.changelog), "utf8");
  writeFileSync(join(root, RELEASE_FILES.changelog),
    `# Changelog\n\n## [Unreleased]\n\n${BODY}\n\n${changelog.slice(changelog.search(/^## \[\d/m))}`);
  const manifestPath = join(root, RELEASE_FILES.harnessPackage), manifest = readFileSync(manifestPath, "utf8");
  const url = (JSON.parse(manifest) as { repository: { url: string } }).repository.url;
  writeFileSync(manifestPath, manifest.replace(JSON.stringify(url), JSON.stringify(`git+${FIXTURE_REPOSITORY}.git`)));
  return root;
}

/** Every file under root keyed by relative path, to prove exactly what was written. */
function tree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(root, path), readFileSync(path, "utf8"));
    }
  };
  walk(root);
  return files;
}

const bump = (root: string, version = NEXT, ...extra: string[]) =>
  runReleaseVersion([version, "--date", DATE, "--root", root, ...extra]);

test("release:version applies every planned edit to a temporary copy, keeps it parseable, and refuses to repeat", async (t) => {
  const root = copy(t), before = tree(root);
  const original = (path: string) => before.get(path)!, read = (path: string) => readFileSync(join(root, path), "utf8");
  const plan = planRelease(readReleaseSnapshot(root), { version: NEXT, date: DATE });
  assert.equal(plan.previousVersion, CADRE_RUNTIME_VERSION);
  assert.deepEqual(plan.changes.map((change) => change.path), [
    RELEASE_FILES.harnessPackage, RELEASE_FILES.docsPackage, RELEASE_FILES.codexManifest, RELEASE_FILES.claudeManifest,
    RELEASE_FILES.runtime, RELEASE_FILES.changelog, RELEASE_FILES.releaseNotes, releaseFile
  ]);
  assert.deepEqual(tree(root), before, "planning never writes");
  applyReleasePlan(root, plan);

  // Only the top-level version token changes, so formatting survives and the manifests still parse.
  for (const path of [RELEASE_FILES.harnessPackage, RELEASE_FILES.docsPackage, RELEASE_FILES.codexManifest, RELEASE_FILES.claudeManifest]) {
    assert.equal(read(path), original(path).replace(`"version": "${CADRE_RUNTIME_VERSION}"`, `"version": "${NEXT}"`), path);
    assert.deepEqual(JSON.parse(read(path)), { ...JSON.parse(original(path)), version: NEXT }, path);
  }

  // Both runtime declarations change; the continuation table and everything else are untouched.
  const runtime = read(RELEASE_FILES.runtime);
  assert.equal(runtime, original(RELEASE_FILES.runtime)
    .replace(`export const CADRE_RUNTIME_VERSION = "${CADRE_RUNTIME_VERSION}";`, `export const CADRE_RUNTIME_VERSION = "${NEXT}";`)
    .replace("export const LEGACY_RUNTIME_VERSIONS = [", `export const LEGACY_RUNTIME_VERSIONS = ["${CADRE_RUNTIME_VERSION}", `));
  const bumped = await import(pathToFileURL(join(root, RELEASE_FILES.runtime)).href) as typeof import("../src/domain/version.js");
  assert.equal(bumped.CADRE_RUNTIME_VERSION, NEXT);
  assert.deepEqual(bumped.LEGACY_RUNTIME_VERSIONS, [CADRE_RUNTIME_VERSION, ...LEGACY_RUNTIME_VERSIONS]);
  assert.equal(bumped.TEMPLATE_SET_VERSION, TEMPLATE_SET_VERSION);
  assert.deepEqual(bumped.CONTINUABLE_EXECUTION_RELEASES, CONTINUABLE_EXECUTION_RELEASES);
  assert.equal(bumped.mayContinueExecution(NEXT, TEMPLATE_SET_VERSION), true);

  const changelog = read(RELEASE_FILES.changelog);
  assert.equal(changelog, original(RELEASE_FILES.changelog).replace("\n## [Unreleased]\n", `\n## [${NEXT}] - ${DATE}\n`));
  assert.doesNotMatch(changelog, /^## \[Unreleased\]/m);
  const notes = read(RELEASE_FILES.releaseNotes);
  assert.equal(notes, original(RELEASE_FILES.releaseNotes)
    .replace("\n# Release Notes\n\n", `\n# Release Notes\n\n## ${NEXT} - ${DATE}\n\n${BODY}\n\n`));
  // The docs content check's release invariants hold for the bumped copy.
  assert.equal(JSON.parse(read(RELEASE_FILES.harnessPackage)).version, JSON.parse(read(RELEASE_FILES.docsPackage)).version);
  assert.equal(runtime.match(/CADRE_RUNTIME_VERSION = "([^"]+)"/)?.[1], NEXT);
  assert.ok(notes.includes(`## ${NEXT} -`));

  assert.equal(read(releaseFile), [
    "Cadre fixture release summary.",
    "",
    "## Added",
    "",
    "- Add the fixture capability.",
    "",
    "```bash",
    "### a shell comment, not a heading",
    "## nor a changelog section boundary",
    "```",
    "",
    "## Upgrade and compatibility",
    "",
    "```bash",
    `npm install -g cadre-ai@${NEXT}`,
    "cadre-ai doctor",
    "cadre-ai install --target all --scope user",
    "```",
    "",
    "Start a new Codex task, reload Claude Code plugins, and open a new Zed Agent thread. Installation updates the runtime "
      + "and skills; it does not migrate project state or approve work. Migrate each existing project to runtime "
      + `${NEXT} through one approved refresh at a quiescent boundary.`,
    "",
    "- Executions started by the previous release may continue to a safe boundary before the approved refresh.",
    "",
    `Read the [package changelog](${FIXTURE_REPOSITORY}/blob/release-${NEXT}/harness/CHANGELOG.md) or the `
      + `[full comparison](${FIXTURE_REPOSITORY}/compare/release-${CADRE_RUNTIME_VERSION}...release-${NEXT}).`,
    ""
  ].join("\n"));
  const after = tree(root);
  assert.deepEqual([...after.keys()].sort(), [...before.keys(), releaseFile].sort());
  for (const [path, content] of before) {
    if (!plan.changes.some((change) => change.path === path)) assert.equal(after.get(path), content, path);
  }

  // Idempotence guards: repeating the bump, or bumping again before a new Unreleased section exists, writes nothing.
  assert.throws(() => bump(root), new RegExp(`${escape(NEXT)} must be greater than the current version ${escape(NEXT)}`));
  assert.throws(() => bump(root, `${MAJOR}.${MINOR + 2}.0`), /exactly one "## \[Unreleased\]" section; found 0/);
  assert.deepEqual(tree(root), after);
});

test("release:version --dry-run prints the plan and manual steps without writing anything", (t) => {
  const root = copy(t), before = tree(root);
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/release-version.ts", ...args],
    { cwd: harness, encoding: "utf8", timeout: 60_000 });
  const dryRun = run(NEXT, "--date", DATE, "--dry-run", "--root", root);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.deepEqual(tree(root), before);
  assert.equal(runReleaseVersion([NEXT, "--date", DATE, "--dry-run", "--root", root]).written, false);
  assert.deepEqual(tree(root), before);
  assert.match(dryRun.stdout, /^Dry run: no files were written\.$/m);
  for (const path of [...Object.values(RELEASE_FILES), releaseFile]) {
    assert.match(dryRun.stdout, new RegExp(`^(?:update|create) ${escape(path)}: `, "m"), path);
  }
  assert.match(dryRun.stdout, new RegExp(`^  \\+ export const CADRE_RUNTIME_VERSION = "${escape(NEXT)}";$`, "m"));
  assert.match(dryRun.stdout, new RegExp(`^  \\+ npm install -g cadre-ai@${escape(NEXT)}$`, "m"));
  assert.match(dryRun.stdout, /\nRemaining manual steps:\n {2}1\. Rerun without --dry-run to write these edits\.\n/);
  assert.match(dryRun.stdout, new RegExp(`Commit the release as "chore\\(release\\): prepare ${escape(NEXT)}"`));
  assert.match(dryRun.stdout, new RegExp(`signed tag release-${escape(NEXT)} and publish the GitHub release from ${escape(releaseFile)}`));

  const refused = run(CADRE_RUNTIME_VERSION, "--dry-run", "--root", root);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /must be greater than the current version/);
  assert.deepEqual(tree(root), before);
});

test("release:version rejects invalid, equal, and downgraded versions without writing", (t) => {
  const root = copy(t), before = tree(root);
  for (const version of [
    "", "latest", `${MAJOR}.${MINOR + 1}`, `v${NEXT}`, `${NEXT}-rc.1`, `${NEXT}+build.1`, `0${NEXT}`,
    `${MAJOR}.0${MINOR + 1}.0`, ` ${NEXT}`, `${NEXT}.0`
  ]) {
    assert.throws(() => bump(root, version), /strict MAJOR\.MINOR\.PATCH/, JSON.stringify(version));
  }
  for (const version of [CADRE_RUNTIME_VERSION, `${MAJOR - 1}.99.99`, ...(MINOR > 0 ? [`${MAJOR}.${MINOR - 1}.99`] : [])]) {
    assert.throws(() => bump(root, version), /must be greater than the current version/, version);
  }
  assert.deepEqual(tree(root), before);
  assert.ok(compareVersions("3.10.0", "3.9.0") > 0, "comparison is numeric, not lexical");
  assert.ok(compareVersions("3.9.10", "3.9.9") > 0 && compareVersions("10.0.0", "9.99.99") > 0);
  assert.equal(compareVersions(CADRE_RUNTIME_VERSION, CADRE_RUNTIME_VERSION), 0);
});

test("release:version requires exactly one non-empty Unreleased section before released history", (t) => {
  const root = copy(t), path = join(root, RELEASE_FILES.changelog), changelog = readFileSync(path, "utf8");
  const released = changelog.slice(changelog.search(/^## \[\d/m));
  for (const [content, expected] of [
    [`# Changelog\n\n${released}`, /exactly one "## \[Unreleased\]" section; found 0/],
    [changelog.replace("## [Unreleased]\n", "## [Unreleased]\n\n- Draft.\n\n## [Unreleased]\n"), /exactly one "## \[Unreleased\]" section; found 2/],
    [`# Changelog\n\n## [Unreleased]\n\n### Added\n\n${released}`, /"## \[Unreleased\]" is empty/],
    [changelog.replace("## [Unreleased]", "## Unreleased"), /must be exactly "## \[Unreleased\]"/],
    [`# Changelog\n\n## [0.0.1] - 2020-01-01\n\n- Initial.\n\n## [Unreleased]\n\n${BODY}\n`, /must precede every released section/]
  ] as const) {
    writeFileSync(path, content);
    const before = tree(root);
    assert.throws(() => bump(root), expected);
    assert.deepEqual(tree(root), before);
  }
});

test("release:version refuses a version already present in the changelog, release notes, or GitHub releases", (t) => {
  for (const [location, publish] of [
    [RELEASE_FILES.changelog, (text: string) => text.replace(/^## \[\d/m, `## [${NEXT}] - 2026-09-30\n\n- Published.\n\n$&`)],
    [RELEASE_FILES.releaseNotes, (text: string) => text.replace("\n# Release Notes\n\n", `\n# Release Notes\n\n## ${NEXT} - 2026-09-30\n\nPublished.\n\n`)],
    [releaseFile, (_text: string) => "Published.\n"]
  ] as const) {
    const root = copy(t), path = join(root, location);
    writeFileSync(path, publish(existsSync(path) ? readFileSync(path, "utf8") : ""));
    const before = tree(root);
    assert.throws(() => bump(root), new RegExp(`${escape(NEXT)} already exists in ${escape(location)}$`));
    assert.deepEqual(tree(root), before);
  }
});

test("release:version validates version agreement, dates, and arguments", (t) => {
  const root = copy(t), before = tree(root);
  // The default date is today's UTC date, not the local one.
  assert.equal(runReleaseVersion([NEXT, "--dry-run", "--root", root], new Date("2026-10-02T23:30:00-05:00")).plan.date, "2026-10-03");
  for (const date of ["2026-13-01", "2026-02-30", "2026-9-01", "26-10-01", "2026/10/01", "2026-10-01T00:00:00Z"]) {
    assert.throws(() => runReleaseVersion([NEXT, "--date", date, "--dry-run", "--root", root]), /YYYY-MM-DD/, date);
  }
  const sources = [RELEASE_FILES.harnessPackage, RELEASE_FILES.docsPackage, RELEASE_FILES.codexManifest, RELEASE_FILES.claudeManifest];
  for (const path of sources) {
    const file = join(root, path), original = readFileSync(file, "utf8");
    writeFileSync(file, original.replace(`"version": "${CADRE_RUNTIME_VERSION}"`, `"version": "${NEXT}"`));
    assert.throws(() => bump(root), new RegExp(`must agree before bumping: .*${escape(path)}=${escape(NEXT)}`), path);
    writeFileSync(file, original);
  }
  const runtime = join(root, RELEASE_FILES.runtime), source = readFileSync(runtime, "utf8");
  writeFileSync(runtime, source.replace(`CADRE_RUNTIME_VERSION = "${CADRE_RUNTIME_VERSION}"`, `CADRE_RUNTIME_VERSION = "${NEXT}"`));
  assert.throws(() => bump(root), new RegExp(`CADRE_RUNTIME_VERSION=${escape(NEXT)}`));
  writeFileSync(runtime, source);
  assert.deepEqual(tree(root), before);

  assert.throws(() => parseReleaseArgs([]), /Missing <version>/);
  assert.throws(() => parseReleaseArgs([NEXT, NEXT]), /Unexpected argument/);
  assert.throws(() => parseReleaseArgs([NEXT, "--date"]), /--date requires a value/);
  assert.throws(() => parseReleaseArgs([NEXT, "--root", "--dry-run"]), /--root requires a value/);
  assert.throws(() => parseReleaseArgs([NEXT, "--force"]), /Unknown option --force/);
  assert.throws(() => parseReleaseArgs([NEXT, "--dry-run", "--dry-run"]), /only once/);
  assert.deepEqual(parseReleaseArgs(["--", NEXT, "--date", DATE, "--dry-run", "--root", root]),
    { version: NEXT, date: DATE, dryRun: true, root });
});

test("release:version tests never write to the real repository", () => {
  assert.deepEqual(readdirSync(join(repository, GITHUB_RELEASES_DIRECTORY)), realReleases);
  assert.equal(existsSync(join(repository, releaseFile)), false);
  assert.equal(JSON.parse(readFileSync(join(repository, RELEASE_FILES.harnessPackage), "utf8")).version, CADRE_RUNTIME_VERSION);
});
