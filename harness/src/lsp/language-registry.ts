import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { shouldIgnore } from "./ignore-policy";

export interface LanguageRule {
  id: string;
  label: string;
  extensions: string[];
  filenames?: string[];
  command: string;
  args: string[];
  install: string;
  languageIds?: Record<string, string>;
}

export interface WorkspaceScanResult {
  counts: Map<string, number>;
  samples: Map<string, string[]>;
  filenameCounts: Map<string, number>;
  filenameSamples: Map<string, string[]>;
}

const EXTENSION_LANGUAGE_IDS: Record<string, string> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".dart": "dart",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".less": "css",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".toml": "toml",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ksh": "shell",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".hcl": "terraform",
  ".ex": "elixir",
  ".exs": "elixir",
  ".scala": "scala",
  ".sc": "scala",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".zig": "zig",
  ".nix": "nix",
  ".elm": "elm",
  ".vue": "vue",
  ".svelte": "svelte",
  ".xml": "xml",
  ".xsd": "xml",
  ".xsl": "xml",
  ".xslt": "xml",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".prisma": "prisma",
  ".proto": "protobuf",
  ".c": "c-cpp",
  ".h": "c-cpp",
  ".cc": "c-cpp",
  ".cpp": "c-cpp",
  ".cxx": "c-cpp",
  ".hpp": "c-cpp",
  ".m": "c-cpp",
  ".mm": "c-cpp",
  ".cs": "csharp",
};

const FILE_LANGUAGE_IDS: Record<string, string> = {
  Dockerfile: "dockerfile",
  Containerfile: "dockerfile",
};

export const LANGUAGE_RULES: LanguageRule[] = [
  {
    id: "typescript",
    label: "TypeScript / JavaScript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    command: "typescript-language-server",
    args: ["--stdio"],
    install: "npm install -g typescript-language-server typescript",
  },
  {
    id: "python",
    label: "Python",
    extensions: [".py", ".pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
    install: "npm install -g pyright",
  },
  { id: "go", label: "Go", extensions: [".go"], command: "gopls", args: [], install: "go install golang.org/x/tools/gopls@latest" },
  { id: "rust", label: "Rust", extensions: [".rs"], command: "rust-analyzer", args: [], install: "rustup component add rust-analyzer" },
  { id: "java", label: "Java", extensions: [".java"], command: "jdtls", args: [], install: "brew install jdtls  # or install Eclipse JDT LS for your platform" },
  { id: "kotlin", label: "Kotlin", extensions: [".kt", ".kts"], command: "kotlin-language-server", args: [], install: "brew install fwcd/kotlin-language-server/kotlin-language-server" },
  { id: "swift", label: "Swift", extensions: [".swift"], command: "sourcekit-lsp", args: [], install: "Install Xcode or Swift toolchain; sourcekit-lsp ships with it" },
  { id: "c-cpp", label: "C / C++ / Objective-C", extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".m", ".mm"], command: "clangd", args: [], install: "brew install llvm  # or install clangd for your platform" },
  { id: "csharp", label: "C#", extensions: [".cs"], command: "csharp-ls", args: [], install: "dotnet tool install --global csharp-ls" },
  { id: "php", label: "PHP", extensions: [".php"], command: "intelephense", args: ["--stdio"], install: "npm install -g intelephense" },
  { id: "ruby", label: "Ruby", extensions: [".rb"], command: "ruby-lsp", args: [], install: "gem install ruby-lsp" },
  { id: "dart", label: "Dart / Flutter", extensions: [".dart"], command: "dart", args: ["language-server", "--protocol=lsp"], install: "Install the Dart or Flutter SDK and ensure `dart` is on PATH" },
  { id: "html", label: "HTML", extensions: [".html", ".htm"], command: "vscode-html-language-server", args: ["--stdio"], install: "npm install -g vscode-langservers-extracted" },
  { id: "css", label: "CSS / Sass / Less", extensions: [".css", ".scss", ".sass", ".less"], command: "vscode-css-language-server", args: ["--stdio"], install: "npm install -g vscode-langservers-extracted" },
  { id: "json", label: "JSON", extensions: [".json", ".jsonc"], command: "vscode-json-language-server", args: ["--stdio"], install: "npm install -g vscode-langservers-extracted" },
  { id: "yaml", label: "YAML", extensions: [".yaml", ".yml"], command: "yaml-language-server", args: ["--stdio"], install: "npm install -g yaml-language-server" },
  { id: "markdown", label: "Markdown", extensions: [".md", ".mdx"], command: "marksman", args: ["server"], install: "brew install marksman  # or download Marksman for your platform" },
  { id: "toml", label: "TOML", extensions: [".toml"], command: "taplo", args: ["lsp", "stdio"], install: "cargo install taplo-cli --locked" },
  { id: "lua", label: "Lua", extensions: [".lua"], command: "lua-language-server", args: [], install: "brew install lua-language-server  # or install LuaLS for your platform" },
  { id: "shell", label: "Shell", extensions: [".sh", ".bash", ".zsh", ".ksh"], command: "bash-language-server", args: ["start"], install: "npm install -g bash-language-server" },
  { id: "terraform", label: "Terraform / HCL", extensions: [".tf", ".tfvars", ".hcl"], command: "terraform-ls", args: ["serve"], install: "brew install hashicorp/tap/terraform-ls" },
  { id: "elixir", label: "Elixir", extensions: [".ex", ".exs"], command: "elixir-ls", args: [], install: "Install ElixirLS and ensure `elixir-ls` is on PATH" },
  { id: "scala", label: "Scala", extensions: [".scala", ".sc"], command: "metals", args: [], install: "coursier install metals" },
  { id: "clojure", label: "Clojure", extensions: [".clj", ".cljs", ".cljc", ".edn"], command: "clojure-lsp", args: [], install: "brew install clojure-lsp/brew/clojure-lsp-native" },
  { id: "haskell", label: "Haskell", extensions: [".hs", ".lhs"], command: "haskell-language-server-wrapper", args: ["--lsp"], install: "ghcup install hls" },
  { id: "ocaml", label: "OCaml", extensions: [".ml", ".mli"], command: "ocamllsp", args: [], install: "opam install ocaml-lsp-server" },
  { id: "zig", label: "Zig", extensions: [".zig"], command: "zls", args: [], install: "Install zls and ensure it is on PATH" },
  { id: "nix", label: "Nix", extensions: [".nix"], command: "nil", args: [], install: "nix profile install nixpkgs#nil" },
  { id: "elm", label: "Elm", extensions: [".elm"], command: "elm-language-server", args: ["--stdio"], install: "npm install -g @elm-tooling/elm-language-server" },
  { id: "vue", label: "Vue", extensions: [".vue"], command: "vue-language-server", args: ["--stdio"], install: "npm install -g @vue/language-server" },
  { id: "svelte", label: "Svelte", extensions: [".svelte"], command: "svelteserver", args: ["--stdio"], install: "npm install -g svelte-language-server" },
  { id: "dockerfile", label: "Dockerfile", extensions: [], filenames: ["Dockerfile", "Containerfile"], command: "docker-langserver", args: ["--stdio"], install: "npm install -g dockerfile-language-server-nodejs", languageIds: { Dockerfile: "dockerfile", Containerfile: "dockerfile" } },
  { id: "xml", label: "XML", extensions: [".xml", ".xsd", ".xsl", ".xslt"], command: "lemminx", args: [], install: "Install Eclipse LemMinX and ensure `lemminx` is on PATH" },
  { id: "graphql", label: "GraphQL", extensions: [".graphql", ".gql"], command: "graphql-lsp", args: ["server", "-m", "stream"], install: "npm install -g graphql-language-service-cli" },
  { id: "prisma", label: "Prisma", extensions: [".prisma"], command: "prisma-language-server", args: ["--stdio"], install: "npm install -g @prisma/language-server" },
  { id: "protobuf", label: "Protocol Buffers", extensions: [".proto"], command: "buf", args: ["beta", "lsp", "--timeout=0"], install: "brew install bufbuild/buf/buf" },
];

function fileLanguageId(file: string): string | null {
  return FILE_LANGUAGE_IDS[path.basename(file)] || EXTENSION_LANGUAGE_IDS[path.extname(file).toLowerCase()] || null;
}

export function languageForFile(file: string): string | null {
  return fileLanguageId(file);
}

function normalizeWorkspaceFile(root: string, rel: string): string | null {
  const normalized = rel.replace(/\r/g, "").trim();
  if (!normalized) return null;
  const full = path.join(root, normalized);
  if (shouldIgnore(root, full, path.basename(normalized))) return null;
  return normalized;
}

function gitWorkspaceFiles(root: string): string[] {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout || result.stdout.length === 0) return [];
  return result.stdout
    .toString("utf8")
    .split("\0")
    .map((item) => normalizeWorkspaceFile(root, item))
    .filter((item): item is string => Boolean(item))
    .sort();
}

function walkWorkspaceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (shouldIgnore(root, full, entry.name)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  visit(root);
  return files.sort();
}

export function listWorkspaceFiles(root: string): string[] {
  const gitFiles = gitWorkspaceFiles(root);
  return gitFiles.length > 0 ? gitFiles : walkWorkspaceFiles(root);
}

export function scanWorkspaceFiles(root: string): WorkspaceScanResult {
  const counts = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const filenameCounts = new Map<string, number>();
  const filenameSamples = new Map<string, string[]>();

  for (const rel of listWorkspaceFiles(root)) {
    const full = path.join(root, rel);
    const name = path.basename(rel);
    if (shouldIgnore(root, full, name)) continue;
    const ext = path.extname(name).toLowerCase();
    if (ext) {
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
      const extSamples = samples.get(ext) ?? [];
      if (extSamples.length < 5) extSamples.push(rel);
      samples.set(ext, extSamples);
    }
    const lower = name.toLowerCase();
    filenameCounts.set(lower, (filenameCounts.get(lower) ?? 0) + 1);
    const nameSamples = filenameSamples.get(lower) ?? [];
    if (nameSamples.length < 5) nameSamples.push(rel);
    filenameSamples.set(lower, nameSamples);
  }

  return { counts, samples, filenameCounts, filenameSamples };
}
