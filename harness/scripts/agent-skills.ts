/**
 * Pure Agent Skills conformance checks (https://agentskills.io/specification)
 * for one SKILL.md body and the name of its parent directory.
 *
 * Frontmatter is read as the small YAML subset skills need: top-level
 * `key: value` entries with plain, single-line quoted, or `|`/`>` block
 * scalars, plus a one-level `metadata` map. Syntax outside that subset is
 * reported instead of guessed.
 */

export const AGENT_SKILL_FRONTMATTER_KEYS = [
  "name", "description", "license", "compatibility", "metadata", "allowed-tools"
] as const;

export const AGENT_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const AGENT_SKILL_LIMITS = {
  nameLength: 64,
  descriptionLength: 1024,
  compatibilityLength: 500,
  bodyLines: 500
} as const;

interface FrontmatterEntry {
  readonly key: string;
  readonly inline: string;
  readonly continuation: string[];
}

/** `value: null` is an empty YAML scalar; `error` describes unsupported syntax. */
type ScalarResult = { readonly value: string | null } | { readonly error: string };

const ALLOWED_KEYS: ReadonlySet<string> = new Set(AGENT_SKILL_FRONTMATTER_KEYS);
const ENTRY = /^([^\s#:][^:]*?):(?:[ \t]+(.*?))?[ \t]*$/;
const NESTED_ENTRY = /^([ \t]+)([^\s#:][^:]*?):(?:[ \t]+(.*?))?[ \t]*$/;
const PLAIN_INDICATOR = /^(?:[-?:](?:[ \t]|$)|[,[\]{}#&*!|>'"%@`])/;

function characterCount(value: string): number {
  return [...value].length;
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

/** Folding changes only separators, so character counts match YAML either way. */
function fold(rows: readonly string[]): string {
  let value = rows[0] ?? "";
  let breaks = 0;
  for (const row of rows.slice(1)) {
    if (row === "") {
      breaks += 1;
      continue;
    }
    value += breaks ? "\n".repeat(breaks) : " ";
    value += row;
    breaks = 0;
  }
  return value;
}

function parseQuoted(text: string): ScalarResult {
  if (text.startsWith("'")) {
    const single = /^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/.exec(text);
    return single ? { value: single[1]!.replace(/''/g, "'") } : { error: "has an invalid single-quoted scalar" };
  }
  const double = /^("(?:[^"\\]|\\.)*")(?:[ \t]+#.*)?$/.exec(text);
  if (!double) return { error: "has an invalid double-quoted scalar" };
  try {
    return { value: JSON.parse(double[1]!) as string };
  } catch {
    return { error: "uses a double-quoted escape outside the supported JSON-compatible subset" };
  }
}

function parsePlain(first: string, continuation: readonly string[]): ScalarResult {
  const rows = [first, ...continuation.map((line) => line.trim())];
  while (rows[0] === "") rows.shift();
  while (rows.at(-1) === "") rows.pop();
  if (!rows.length) return { value: null };
  if (rows.length === 1) rows[0] = rows[0]!.replace(/[ \t]+#.*$/, "");
  const text = rows.join("\n");
  if (PLAIN_INDICATOR.test(rows[0]!)) return { error: "must be quoted because it starts with a YAML indicator" };
  if (/:(?:[ \t]|$)/m.test(text)) return { error: "must be quoted because it contains a mapping colon" };
  if (/(?:^|[ \t])#/m.test(text)) return { error: "must be quoted because it contains a comment marker" };
  return { value: fold(rows) };
}

function parseBlock(header: string, continuation: readonly string[]): ScalarResult {
  const match = /^([|>])([+-]?)(?:[ \t]+#.*)?$/.exec(header);
  if (!match) return { error: "uses an unsupported block scalar header" };
  const [, style, chomping] = match;
  const first = continuation.find((line) => line.trim() !== "");
  if (first === undefined) return { value: "" };
  const indent = indentation(first);
  const rows: string[] = [];
  for (const line of continuation) {
    if (line.trim() === "") rows.push("");
    else if (indentation(line) < indent) return { error: "has inconsistent block scalar indentation" };
    else rows.push(line.slice(indent));
  }
  let trailingBlankRows = 0;
  while (rows.at(-1) === "") {
    rows.pop();
    trailingBlankRows += 1;
  }
  const text = style === "|" ? rows.join("\n") : fold(rows);
  const ending = chomping === "-" ? "" : "\n".repeat(chomping === "+" ? trailingBlankRows + 1 : 1);
  return { value: `${text}${ending}` };
}

function parseScalar(entry: FrontmatterEntry): ScalarResult {
  const { continuation } = entry;
  // After "key: ", a leading # starts a comment rather than a value.
  const inline = entry.inline.startsWith("#") ? "" : entry.inline;
  if (inline.startsWith("|") || inline.startsWith(">")) return parseBlock(inline, continuation);
  if (inline.startsWith("'") || inline.startsWith("\"")) {
    if (continuation.some((line) => line.trim() !== "")) return { error: "uses an unsupported multi-line quoted scalar" };
    return parseQuoted(inline);
  }
  return parsePlain(inline, continuation);
}

function metadataError(entry: FrontmatterEntry): string | null {
  const invalid = "metadata must map string keys to string values";
  const rows = entry.continuation.filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  const inline = entry.inline.startsWith("#") ? "" : entry.inline;
  if (inline === "{}" && !rows.length) return null;
  if (inline !== "" || !rows.length) return invalid;
  const indent = indentation(rows[0]!);
  const keys = new Set<string>();
  for (const row of rows) {
    const match = NESTED_ENTRY.exec(row);
    if (!match || match[1]!.length !== indent) return invalid;
    const key = match[2]!.trimEnd();
    if (keys.has(key)) return `metadata repeats key ${key}`;
    keys.add(key);
    const value = parseScalar({ key, inline: match[3] ?? "", continuation: [] });
    if ("error" in value || value.value === null) return `metadata.${key} must be a string`;
  }
  return null;
}

function checkLength(errors: string[], field: string, value: string, maximum: number): number {
  const count = characterCount(value);
  if (count < 1 || count > maximum) errors.push(`${field} must be 1-${maximum} characters, found ${count}`);
  return count;
}

/** Returns every conformance problem; an empty list means the skill conforms. */
export function validateAgentSkill(content: string, directoryName: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return ["frontmatter must open the file with a \"---\" line"];
  const closing = lines.indexOf("---", 1);
  if (closing === -1) return ["frontmatter is missing its closing \"---\" line"];

  const errors: string[] = [];
  const entries = new Map<string, FrontmatterEntry>();
  let current: FrontmatterEntry | null = null;
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    if (line.trim() === "") {
      current?.continuation.push("");
      continue;
    }
    if (/^[ \t]/.test(line)) {
      if (/^ *\t/.test(line)) errors.push(`frontmatter line ${lineNumber} uses tab indentation`);
      else if (current) current.continuation.push(line);
      else errors.push(`frontmatter line ${lineNumber} is indented without a parent key`);
      continue;
    }
    if (line.startsWith("#")) continue;
    const match = ENTRY.exec(line);
    if (!match) {
      errors.push(`frontmatter line ${lineNumber} is not a top-level "key: value" entry`);
      current = null;
      continue;
    }
    const key = match[1]!.trimEnd();
    current = { key, inline: match[2] ?? "", continuation: [] };
    if (entries.has(key)) errors.push(`frontmatter repeats key ${key}`);
    else {
      entries.set(key, current);
      if (!ALLOWED_KEYS.has(key)) {
        errors.push(`frontmatter key ${key} is not allowed; use only ${AGENT_SKILL_FRONTMATTER_KEYS.join(", ")}`);
      }
    }
  }

  const scalar = (key: string): string | null => {
    const entry = entries.get(key);
    if (!entry) return null;
    const parsed = parseScalar(entry);
    if ("error" in parsed) {
      errors.push(`${key} ${parsed.error}`);
      return null;
    }
    return parsed.value ?? "";
  };

  const name = scalar("name");
  if (!entries.has("name")) errors.push("name is required");
  else if (name !== null) {
    const count = checkLength(errors, "name", name, AGENT_SKILL_LIMITS.nameLength);
    if (count > 0 && !AGENT_SKILL_NAME_PATTERN.test(name)) {
      errors.push("name must use only lowercase letters, digits, and single hyphens, without a leading or trailing hyphen");
    }
    if (name !== directoryName) {
      errors.push(`name ${JSON.stringify(name)} must match its parent directory ${JSON.stringify(directoryName)}`);
    }
  }

  const description = scalar("description");
  if (!entries.has("description")) errors.push("description is required");
  else if (description !== null) checkLength(errors, "description", description, AGENT_SKILL_LIMITS.descriptionLength);

  const compatibility = scalar("compatibility");
  if (compatibility !== null) {
    checkLength(errors, "compatibility", compatibility, AGENT_SKILL_LIMITS.compatibilityLength);
  }
  // Other optional scalars have no length limit but must still parse.
  scalar("license");
  scalar("allowed-tools");
  const metadata = entries.get("metadata");
  const metadataProblem = metadata ? metadataError(metadata) : null;
  if (metadataProblem) errors.push(metadataProblem);

  const body = lines.slice(closing + 1);
  if (body.at(-1) === "") body.pop();
  if (body.length > AGENT_SKILL_LIMITS.bodyLines) {
    errors.push(`body has ${body.length} lines; keep it at most ${AGENT_SKILL_LIMITS.bodyLines} lines`);
  }
  return errors;
}
