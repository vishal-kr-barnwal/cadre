import { asString } from "../../../guards";

import { loadTopology } from "../../infrastructure/runtime/project-config";
import { claimsOverlap, normalizeClaimPath } from "./claim-paths";
import type { Claim, CoreResult } from "./contracts";
import { listTracks, planClaims } from "./track-schedule";

export { claimsOverlap, globToRegExp, isGlobClaim, normalizeClaimPath } from "./claim-paths";

export function collisionScan(root: string): CoreResult {
  const topology = loadTopology(root);
  const active = listTracks(root).filter((track) =>
    ["new", "in_progress", "blocked"].includes(track.metadata.status || "new")
  );
  const claims: Claim[] = [];
  for (const track of active) {
    for (const claim of planClaims(root, track, topology)) {
      claims.push({
        ...claim,
        file: normalizeClaimPath(claim.file),
      });
    }
  }

  const collisions: CoreResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];
      if (!left || !right) continue;
      if (left.track_id === right.track_id) continue;
      if (left.repo !== right.repo) continue;
      if (!claimsOverlap(left.file, right.file)) continue;
      const trackIds = [left.track_id, right.track_id].sort();
      const files = [left.file, right.file].sort();
      const key = `${left.repo}\u0000${trackIds.join("\u0000")}\u0000${files.join("\u0000")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const collisionClaims: Claim[] = [left, right];
      collisions.push({
        repo: left.repo,
        file: left.file === right.file ? left.file : `${left.file} <-> ${right.file}`,
        kind: left.file === right.file ? "exact" : "overlap",
        claims: collisionClaims,
        track_ids: trackIds,
        owners: Array.from(new Set(collisionClaims.map((claim) => claim.owner).filter(Boolean))).sort(),
      });
    }
  }
  collisions.sort((a, b) => `${asString(a.repo)}${asString(a.file)}`.localeCompare(`${asString(b.repo)}${asString(b.file)}`));
  return {
    root,
    active_tracks: active.length,
    collisions,
  };
}
