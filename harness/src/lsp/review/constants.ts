import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "../../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "../../guards";
import { isIgnoredFile, normalizeRel, shouldIgnore } from "../ignore-policy";

export const DEFAULT_STARTUP_TIMEOUT_MS = 10000;

export const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2000;

export const MAX_TEXT_REFERENCE_RESULTS = 50;

export const MAX_SCAN_FILE_BYTES = 1024 * 1024;
