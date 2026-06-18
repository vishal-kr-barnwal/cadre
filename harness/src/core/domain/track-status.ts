export const STATUS_MARKERS = {
  new: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  blocked: "[!]",
  skipped: "[-]",
} as const;

export const VALID_STATUSES = new Set(Object.keys(STATUS_MARKERS));

export type DomainTrackStatus = keyof typeof STATUS_MARKERS;

export function markerForDomainStatus(status: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_MARKERS, status)
    ? STATUS_MARKERS[status as DomainTrackStatus]
    : STATUS_MARKERS.new;
}
