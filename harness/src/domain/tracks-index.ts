import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { safeProjectRoot } from "./paths.js";

export interface TracksIndexEntry {
  id: string;
  title?: string;
  type: string;
  status: string;
  revision?: number;
}

export function buildTracks(tracks: TracksIndexEntry[]): string {
  const lines = [
    "# Tracks",
    "",
    "Generated from track-local `state.json` files by the Cadre MCP server.",
    "",
    "| Track | Type | Status | Revision |",
    "| --- | --- | --- | ---: |"
  ];
  for (const track of tracks) {
    lines.push(`| \`${track.id}\` ${track.title ?? ""} | ${track.type} | ${track.status} | ${track.revision ?? 1} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderTracksWithState(
  projectRoot: string,
  statePath: string,
  proposedState: Record<string, unknown>
): { tracksPath: string; tracksBody: string; tracksContent: string } {
  const root = join(safeProjectRoot(projectRoot), ".cadre");
  const resolvedStatePath = resolve(statePath);
  const tracks: TracksIndexEntry[] = [];
  const ids = new Set<string>();
  let overrideFound = false;
  for (const directory of ["tracks", "archive"]) {
    const directoryRoot = join(root, directory);
    if (!existsSync(directoryRoot)) continue;
    for (const entry of readdirSync(directoryRoot, { withFileTypes: true })
      .filter((candidate) => candidate.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directoryRoot, entry.name, "state.json");
      let state: Record<string, unknown>;
      if (resolve(path) === resolvedStatePath) {
        overrideFound = true;
        state = proposedState;
      } else {
        state = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      }
      const id = String(state.trackId ?? "");
      if (!id || id !== entry.name) throw new Error(`invalid track identity at ${path}`);
      if (ids.has(id)) throw new Error(`duplicate track state for ${id}`);
      ids.add(id);
      tracks.push({
        id,
        type: String(state.type ?? ""),
        status: String(state.status ?? ""),
        ...(typeof state.title === "string" ? { title: state.title } : {}),
        ...(typeof state.revision === "number" ? { revision: state.revision } : {})
      });
    }
  }
  if (!overrideFound) throw new Error("execution track state is outside the active track index");
  tracks.sort((left, right) => left.id.localeCompare(right.id));
  const tracksPath = join(root, "tracks.md");
  return {
    tracksPath,
    tracksBody: readFileSync(tracksPath, "utf8"),
    tracksContent: buildTracks(tracks)
  };
}
