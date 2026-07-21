import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";
import type { CadreTrack, JsonObject } from "../../../types";

import { utcNow } from "../../infrastructure/runtime/json-store";
import { runCommand } from "../../infrastructure/runtime/system";
import type { CoreResult, WorkingRoot } from "./contracts";
import { gitCommitMembership } from "./git-commit-membership";
import { traceResultFingerprint } from "./git-change-fingerprint";
import { patchCompletionJournal } from "./manual-verification";

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function markCompletionProductIntegrityFailed(
  track: CadreTrack,
  key: string,
  commitSha: string,
  expectedFiles: string[],
  actualFiles: string[],
  reason: string,
): JsonObject {
  return patchCompletionJournal(track, key, (current) => ({
    ...current,
    stage: "product_commit_integrity_failed",
    commit_sha: commitSha,
    expected_files: unique(expectedFiles),
    actual_files: unique(actualFiles),
    error: reason,
    failed_at: utcNow(),
  }));
}

export function taskProductCommitFailure(productCommit: CoreResult, workingRoot: WorkingRoot): CoreResult {
  const integrityFailure = productCommit.stage === "git_commit_integrity";
  const rollback = asJsonObject(productCommit.rollback);
  const indexRestore = asJsonObject(productCommit.index_restore);
  const safelyRolledBack = integrityFailure && rollback.ok === true;
  const indexDamaged = String(productCommit.stage || "").includes("index_restore")
    || (Object.keys(indexRestore).length > 0 && indexRestore.ok === false)
    || (rollback.rolled_back === true && rollback.ok === false);
  return {
    ...productCommit,
    stage: integrityFailure ? "product_commit_integrity" : "product_commit",
    blocked: true,
    recovery_required: indexDamaged || (integrityFailure && !safelyRolledBack),
    retry_ready: !indexDamaged && (safelyRolledBack || !integrityFailure),
    working_root: workingRoot,
  };
}

export function productCommitIntegrity(
  cwd: string,
  commitSha: string,
  expectedParent: string,
  expectedFiles: string[],
  expectedResultFingerprint: string,
): CoreResult {
  const membership = gitCommitMembership(cwd, commitSha);
  const head = runCommand("git", ["rev-parse", "HEAD"], { cwd });
  const actualHead = head.ok ? head.stdout.trim() : "";
  const expected = unique(expectedFiles);
  const actual = unique(asStringArray(membership.files));
  if (
    membership.ok === false
    || asStringArray(membership.parent_shas).length !== 1
    || actualHead !== commitSha
    || asOptionalString(membership.parent_sha) !== expectedParent
    || JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    return {
      ok: false,
      stage: "product_commit_integrity",
      expected_parent: expectedParent,
      expected_head: commitSha,
      actual_head: actualHead || null,
      actual_parent: asOptionalString(membership.parent_sha) || null,
      expected_files: expected,
      actual_files: actual,
      membership,
      reason: "The product commit does not contain exactly the task paths that passed completion checks.",
    };
  }
  const fingerprint = traceResultFingerprint(cwd, expected, commitSha);
  if (
    fingerprint.ok === false
    || asOptionalString(fingerprint.fingerprint) !== expectedResultFingerprint
  ) {
    return {
      ok: false,
      stage: "product_commit_integrity",
      expected_result_fingerprint: expectedResultFingerprint || null,
      actual_result_fingerprint: asOptionalString(fingerprint.fingerprint) || null,
      fingerprint,
      reason: "The committed tree does not match the product bytes that passed completion checks.",
    };
  }
  return { ok: true, files: actual, parent_sha: expectedParent, fingerprint };
}
