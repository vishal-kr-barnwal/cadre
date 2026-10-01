export interface CandidateStateChange {
  field: string;
  action: "set" | "append";
  value: unknown;
}

/** Explain runtime-derived fields without repeating the authored candidate body. */
export function candidateStateChanges(before: Record<string, unknown>, after: Record<string, unknown>): CandidateStateChange[] {
  return Object.entries(after).flatMap(([field, value]): CandidateStateChange[] => {
    const previous = before[field];
    if (JSON.stringify(previous) === JSON.stringify(value)) return [];
    if (Array.isArray(previous) && Array.isArray(value) && value.length >= previous.length
      && JSON.stringify(value.slice(0, previous.length)) === JSON.stringify(previous)) {
      return [{ field, action: "append", value: value.slice(previous.length) }];
    }
    return [{ field, action: "set", value }];
  });
}
