export const TRACK_TYPES = ["feature", "bug", "operation"] as const;

export type TrackType = (typeof TRACK_TYPES)[number];

const TRACK_TYPE_SET = new Set<string>(TRACK_TYPES);

export function isTrackType(value: unknown): value is TrackType {
  return typeof value === "string" && TRACK_TYPE_SET.has(value);
}
