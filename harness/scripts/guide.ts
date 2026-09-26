/**
 * Guide-only fallback for agents that are not supported Cadre integrations.
 * The command is intentionally static: it writes one Markdown block to stdout
 * and never reads or writes files, detects clients, or changes settings.
 */

export const GUIDE_ONLY_START_MARKER = "<!-- cadre:guide-only:start -->";
export const GUIDE_ONLY_END_MARKER = "<!-- cadre:guide-only:end -->";

export interface GuideOnlyPointer {
  readonly command: "cadre-ai guide";
  readonly stateful: false;
}

export const GUIDE_ONLY_POINTER: GuideOnlyPointer = { command: "cadre-ai guide", stateful: false };

/** An AGENTS.md-compatible block that can be appended to or replaced in project instructions. */
export function guideOnlyBlock(): string {
  return [
    GUIDE_ONLY_START_MARKER,
    "## Cadre guide-only instructions",
    "",
    "This agent is not a supported Cadre integration unless it can call the installed Cadre MCP tools.",
    "Without those tools, work in guide-only mode:",
    "",
    "- Read `.cadre/workflow.md` and the relevant `.cadre/` artifacts before explaining Cadre scope or status, and label that explanation unvalidated.",
    "- Do not create, edit, stage, promote, or delete anything under `.cadre/`.",
    "- Do not create commits with Cadre operation trailers (`Cadre-Operation`, `Cadre-Receipt`).",
    "- Do not claim that a Cadre track was planned, implemented, reviewed, completed, or archived.",
    "- Do not reconstruct Cadre runtime behavior, templates, or state transitions.",
    "- For stateful Cadre work, use a supported Cadre integration and run `cadre-ai doctor`.",
    GUIDE_ONLY_END_MARKER,
    ""
  ].join("\n");
}

export function runGuide(args: readonly string[]): number {
  if (args.length > 0) throw new Error(`Unknown guide option: ${args[0]}`);
  process.stdout.write(guideOnlyBlock());
  return 0;
}
