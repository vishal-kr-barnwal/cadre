/**
 * Pure Markdown transforms for release documents: the package changelog, the docs release notes,
 * and the GitHub release body. Fenced code is never read as document structure.
 */

function fail(message: string): never {
  throw new Error(message);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface MarkdownLine {
  readonly text: string;
  /** Inside a fenced code block, including its fence lines. */
  readonly fenced: boolean;
}

function markdownLines(markdown: string): MarkdownLine[] {
  let fence: string | null = null;
  return markdown.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null) {
      if (marker !== undefined) fence = marker;
      return { text: line, fenced: marker !== undefined };
    }
    if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    return { text: line, fenced: true };
  });
}

const LEVEL_TWO_HEADING = /^##\s/;

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0, end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}

export interface UnreleasedSection {
  /** Line index of the `## [Unreleased]` heading. */
  readonly heading: number;
  /** Section body without surrounding blank lines. */
  readonly body: string;
}

/** Locate the single, non-empty `## [Unreleased]` section that precedes every released section. */
export function unreleasedSection(changelog: string, path: string): UnreleasedSection {
  const lines = markdownLines(changelog);
  const found = lines.flatMap((line, index) => !line.fenced && /^##\s+\[?unreleased\b/i.test(line.text) ? [index] : []);
  if (found.length !== 1) fail(`${path}: expected exactly one "## [Unreleased]" section; found ${found.length}`);
  const heading = found[0]!;
  if (lines[heading]!.text !== "## [Unreleased]") {
    fail(`${path}: the Unreleased heading must be exactly "## [Unreleased]"; found ${JSON.stringify(lines[heading]!.text)}`);
  }
  if (lines.slice(0, heading).some((line) => !line.fenced && LEVEL_TWO_HEADING.test(line.text))) {
    fail(`${path}: "## [Unreleased]" must precede every released section`);
  }
  const next = lines.findIndex((line, index) => index > heading && !line.fenced && LEVEL_TWO_HEADING.test(line.text));
  const section = lines.slice(heading + 1, next === -1 ? lines.length : next);
  if (!section.some((line) => line.text.trim() !== "" && (line.fenced || !/^#{1,6}\s/.test(line.text)))) {
    fail(`${path}: "## [Unreleased]" is empty; describe the release before bumping`);
  }
  return { heading, body: trimBlankLines(section.map((line) => line.text)).join("\n") };
}

/** Whether a `## <version>` or `## [<version>]` heading already exists outside code fences. */
export function hasReleaseHeading(markdown: string, version: string): boolean {
  const pattern = new RegExp(`^##\\s+\\[?${escapeRegExp(version)}\\]?(?:\\s|$)`);
  return markdownLines(markdown).some((line) => !line.fenced && pattern.test(line.text));
}

/** Rename the Unreleased heading to `## [<version>] - <date>` and leave every other line untouched. */
export function datedChangelog(changelog: string, section: UnreleasedSection, version: string, date: string): string {
  const lines = changelog.split("\n");
  lines[section.heading] = `## [${version}] - ${date}`;
  return lines.join("\n");
}

export interface ReleaseEntry {
  readonly version: string;
  readonly date: string;
  readonly body: string;
}

/** Insert `## <version> - <date>` and the body immediately after the `# Release Notes` heading. */
export function insertReleaseNotes(notes: string, path: string, entry: ReleaseEntry): string {
  const lines = notes.split("\n");
  const frontmatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (lines[0] === "---" && frontmatterEnd === -1) fail(`${path}: unterminated frontmatter`);
  const found = markdownLines(notes)
    .flatMap((line, index) => index > frontmatterEnd && !line.fenced && line.text === "# Release Notes" ? [index] : []);
  if (found.length !== 1) fail(`${path}: expected exactly one "# Release Notes" heading; found ${found.length}`);
  const heading = found[0]!;
  let rest = heading + 1;
  while (rest < lines.length && lines[rest]!.trim() === "") rest++;
  return [
    ...lines.slice(0, heading + 1), "", `## ${entry.version} - ${entry.date}`, "", ...entry.body.split("\n"), "", ...lines.slice(rest)
  ].join("\n");
}

export interface GithubReleaseContext {
  readonly version: string;
  readonly previousVersion: string;
  /** Browsable repository URL, for example https://github.com/owner/repo. */
  readonly repositoryUrl: string;
  /** Repository-relative changelog path, linked at the release tag. */
  readonly changelogPath: string;
}

/**
 * GitHub release notes: the Unreleased body with `###` promoted to `##` outside code fences, then a
 * generated Upgrade and compatibility section. Guidance under the body's own `### Upgrade and
 * compatibility` heading is folded into that section rather than producing a duplicate heading.
 */
export function githubReleaseBody(body: string, context: GithubReleaseContext): string {
  const promoted: string[] = [], guidance: string[] = [];
  let target = promoted, upgradeSections = 0;
  for (const line of markdownLines(body)) {
    const title = line.fenced ? undefined : /^###\s+(.*)$/.exec(line.text)?.[1];
    if (title === undefined) {
      target.push(line.text);
    } else if (/^upgrade and compatibility$/i.test(title.trim())) {
      upgradeSections++;
      target = guidance;
    } else {
      target = promoted;
      promoted.push(`## ${title}`);
    }
  }
  if (upgradeSections > 1) fail(`${context.changelogPath}: "## [Unreleased]" has more than one "### Upgrade and compatibility" section`);
  const intro = trimBlankLines(promoted), folded = trimBlankLines(guidance), tag = `release-${context.version}`;
  return [
    ...(intro.length ? [...intro, ""] : []),
    "## Upgrade and compatibility",
    "",
    "```bash",
    `npm install -g cadre-ai@${context.version}`,
    "cadre-ai doctor",
    "cadre-ai install --target all --scope user",
    "```",
    "",
    "Start a new Codex task, reload Claude Code plugins, and open a new Zed Agent thread. Installation updates the "
      + "runtime and skills; it does not migrate project state or approve work. Migrate each existing project to "
      + `runtime ${context.version} through one approved refresh at a quiescent boundary.`,
    ...(folded.length ? ["", ...folded] : []),
    "",
    `Read the [package changelog](${context.repositoryUrl}/blob/${tag}/${context.changelogPath}) or the `
      + `[full comparison](${context.repositoryUrl}/compare/release-${context.previousVersion}...${tag}).`,
    ""
  ].join("\n");
}
