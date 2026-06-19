import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "../../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "../../guards";
import { isIgnoredFile, normalizeRel, shouldIgnore } from "../ignore-policy";

import { LspServerConfig } from "./types";

export const DEFAULT_LANGUAGE_IDS: Record<string, string> = {
  ".bash": "shellscript",
  ".c": "c",
  ".cc": "cpp",
  ".clj": "clojure",
  ".cljc": "clojure",
  ".cljs": "clojure",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".cxx": "cpp",
  ".dart": "dart",
  ".edn": "clojure",
  ".elm": "elm",
  ".ex": "elixir",
  ".exs": "elixir",
  ".go": "go",
  ".gql": "graphql",
  ".graphql": "graphql",
  ".h": "c",
  ".hcl": "terraform",
  ".hpp": "cpp",
  ".hs": "haskell",
  ".html": "html",
  ".htm": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "jsonc",
  ".jsx": "javascriptreact",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".less": "less",
  ".lhs": "haskell",
  ".lua": "lua",
  ".m": "objective-c",
  ".md": "markdown",
  ".mdx": "markdown",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".mm": "objective-cpp",
  ".nix": "nix",
  ".php": "php",
  ".prisma": "prisma",
  ".proto": "proto",
  ".py": "python",
  ".pyi": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sass": "sass",
  ".scala": "scala",
  ".sc": "scala",
  ".scss": "scss",
  ".sh": "shellscript",
  ".svelte": "svelte",
  ".swift": "swift",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".vue": "vue",
  ".xml": "xml",
  ".xsd": "xml",
  ".xsl": "xml",
  ".xslt": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zig": "zig",
  ".zsh": "shellscript",
  "containerfile": "dockerfile",
  "dockerfile": "dockerfile",
};

export function languageId(file: string, server?: LspServerConfig): string {
  const ext = path.extname(file);
  const basename = path.basename(file).toLowerCase();
  const overrides = server ? asJsonObject(server.languageIds) : {};
  return asOptionalString(overrides[ext])
    || asOptionalString(overrides[basename])
    || DEFAULT_LANGUAGE_IDS[ext]
    || DEFAULT_LANGUAGE_IDS[basename]
    || "plaintext";
}
