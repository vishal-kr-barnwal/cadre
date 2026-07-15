import path from "node:path";

import { asOptionalString } from "../../../guards";
import { approvalRestoreBeforeFiles, approvalRestoreSnapshots } from "./approval-session-ancillary";
import type { ApprovalSession } from "./approval-session-model";

export interface ApprovalJournalTarget {
  path: string;
  before: string | null;
  preview: string | null;
}

interface OwnedTarget {
  path: string;
  before: string | null;
  preview: string;
}

function safeRelativePath(value: string): boolean {
  return value.length > 0
    && !value.includes("\0")
    && !path.isAbsolute(value)
    && !path.win32.isAbsolute(value)
    && !value.split(/[\\/]+/).includes("..");
}

function ownedTargets(session: ApprovalSession): { targets: Map<string, OwnedTarget>; error: string | null } {
  const beforeByPath = new Map(approvalRestoreBeforeFiles(session).map((entry) => [entry.path, entry]));
  const targets = new Map<string, OwnedTarget>();
  for (const snapshot of approvalRestoreSnapshots(session)) {
    if (snapshot.missing === true) continue;
    const before = beforeByPath.get(snapshot.path);
    if (!safeRelativePath(snapshot.path) || !before || targets.has(snapshot.path)) {
      return {
        targets: new Map(),
        error: `Approval session has an invalid or duplicate recovery target: ${snapshot.path}`,
      };
    }
    targets.set(snapshot.path, {
      path: snapshot.path,
      before: before.existed ? before.content : null,
      preview: snapshot.content,
    });
  }
  return { targets, error: null };
}

function exactStringSet(actual: string[], expected: string[]): boolean {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return actualSet.size === actual.length
    && expectedSet.size === expected.length
    && actualSet.size === expectedSet.size
    && Array.from(actualSet).every((entry) => expectedSet.has(entry));
}

function intentOwnershipError(session: ApprovalSession, owned: Map<string, OwnedTarget>): string | null {
  if (!exactStringSet(session.intent_to_add_paths, Array.from(new Set(session.intent_to_add_paths)))) {
    return `Approval session has duplicate Git intent paths: ${session.session_id}`;
  }
  const unsafe = session.intent_to_add_paths.find((entry) => !safeRelativePath(entry) || !owned.has(entry));
  return unsafe ? `Approval session Git intent is not owned by a recovery snapshot: ${unsafe}` : null;
}

function targetMap(targets: ApprovalJournalTarget[]): Map<string, ApprovalJournalTarget> | null {
  const mapped = new Map<string, ApprovalJournalTarget>();
  for (const target of targets) {
    if (!safeRelativePath(target.path) || mapped.has(target.path)) return null;
    mapped.set(target.path, target);
  }
  return mapped;
}

function targetMode(session: ApprovalSession): boolean {
  const outputMode = asOptionalString(session.payload.reviewOutputMode || session.payload.review_output_mode);
  const explicitDirectory = asOptionalString(
    session.payload.reviewBundleDir
      || session.payload.review_bundle_dir
      || session.payload.reviewDir
      || session.payload.review_dir,
  );
  return !explicitDirectory && !["bundle", "temp", "temporary"].includes(outputMode || "");
}

export function cancellationJournalOwnershipError(
  session: ApprovalSession,
  targets: ApprovalJournalTarget[],
  intentPaths: string[],
): string | null {
  const owned = ownedTargets(session);
  if (owned.error) return owned.error;
  const intentError = intentOwnershipError(session, owned.targets);
  if (intentError) return intentError;
  if (!exactStringSet(intentPaths, session.intent_to_add_paths)) {
    return "Cancellation journal Git intent does not match its approval session";
  }

  const expectedPaths = new Set<string>();
  if (targetMode(session)) {
    for (const preview of session.preview_files) {
      if (preview.missing === true) continue;
      const previewPath = asOptionalString(preview.path);
      if (!previewPath || !owned.targets.has(previewPath)) {
        return `Approval preview is not owned by a recovery snapshot: ${previewPath || "(missing path)"}`;
      }
      expectedPaths.add(previewPath);
    }
  }
  const nativeIgnore = owned.targets.get("cadre/.gitignore");
  const optionalNativeIgnore = nativeIgnore
    && nativeIgnore.preview !== nativeIgnore.before
    && !expectedPaths.has(nativeIgnore.path)
    ? nativeIgnore
    : null;

  const actual = targetMap(targets);
  const expectedSize = expectedPaths.size + (optionalNativeIgnore && actual?.has(optionalNativeIgnore.path) ? 1 : 0);
  if (!actual || actual.size !== expectedSize) {
    return "Cancellation journal targets do not match its approval session";
  }
  for (const expectedPath of expectedPaths) {
    const expected = owned.targets.get(expectedPath)!;
    const candidate = actual.get(expectedPath);
    if (!candidate || candidate.before !== expected.before || candidate.preview !== expected.preview) {
      return `Cancellation journal target does not match its approval snapshot: ${expectedPath}`;
    }
  }
  if (optionalNativeIgnore && actual.has(optionalNativeIgnore.path)) {
    const candidate = actual.get(optionalNativeIgnore.path)!;
    if (candidate.before !== optionalNativeIgnore.before || candidate.preview !== optionalNativeIgnore.preview) {
      return `Cancellation journal target does not match its approval snapshot: ${optionalNativeIgnore.path}`;
    }
  }
  return null;
}

export function supersessionJournalOwnershipError(
  sessions: ApprovalSession[],
  targets: ApprovalJournalTarget[],
  intentPaths: string[],
): string | null {
  const ownedSessions: Array<Map<string, OwnedTarget>> = [];
  for (const session of sessions) {
    const owned = ownedTargets(session);
    if (owned.error) return owned.error;
    const intentError = intentOwnershipError(session, owned.targets);
    if (intentError) return intentError;
    ownedSessions.push(owned.targets);
  }
  const expectedIntent = Array.from(new Set(sessions.flatMap((session) => session.intent_to_add_paths)));
  if (!exactStringSet(intentPaths, expectedIntent)) {
    return "Supersession journal Git intent does not match its approval sessions";
  }

  const expectedPaths = new Set(ownedSessions.flatMap((owned) => Array.from(owned.keys())));
  const actual = targetMap(targets);
  if (!actual || actual.size !== expectedPaths.size) {
    return "Supersession journal targets do not match its approval sessions";
  }
  for (const expectedPath of expectedPaths) {
    const candidate = actual.get(expectedPath);
    if (!candidate) return `Supersession journal target is missing: ${expectedPath}`;
    let virtual = candidate.preview;
    for (const owned of ownedSessions) {
      const entry = owned.get(expectedPath);
      if (!entry) continue;
      if (virtual !== entry.preview && virtual !== entry.before) {
        return `Supersession journal preview is not owned by its session chain: ${expectedPath}`;
      }
      virtual = entry.before;
    }
    if (candidate.before !== virtual) {
      return `Supersession journal baseline does not match its session chain: ${expectedPath}`;
    }
  }
  return null;
}
