export function normalizeClaimPath(file: unknown): string {
  let normalized = String(file || "").trim();
  if (
    normalized.length >= 2
    && ((normalized.startsWith('"') && normalized.endsWith('"'))
      || (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1);
  }
  return normalized
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

export function claimPathError(file: unknown): string | null {
  const raw = String(file || "");
  const trimmed = raw.trim();
  if (raw.includes("\0")) return "File claim cannot contain NUL";
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) return `File claim must be repository-relative: ${raw}`;
  const normalized = normalizeClaimPath(raw);
  if (!normalized || normalized === ".") return "File claim cannot be empty or repository-wide";
  if (normalized.split("/").some((segment) => segment === "..")) return `File claim cannot escape the repository: ${raw}`;
  return null;
}

export function concreteGitPathError(file: unknown): string | null {
  const raw = String(file ?? "");
  if (!raw) return "Git path cannot be empty";
  if (raw.includes("\0")) return "Git path cannot contain NUL";
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return `Git path must be repository-relative: ${raw}`;
  if (raw.split("/").some((segment) => segment === "..")) return `Git path cannot escape the repository: ${raw}`;
  return null;
}

export function globToRegExp(glob: string): RegExp {
  const normalized = normalizeClaimPath(glob);
  let out = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    const afterNext = normalized[i + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      out += "(?:.*/)?";
      i += 2;
    } else if (char === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else if (char && "\\^$+?.()|{}[]".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`);
}

export function isGlobClaim(file: string): boolean {
  return /[*?]/.test(file);
}

export function claimMatchesPath(claimValue: unknown, fileValue: unknown): boolean {
  if (claimPathError(claimValue) || claimPathError(fileValue)) return false;
  const claim = normalizeClaimPath(claimValue);
  const file = normalizeClaimPath(fileValue);
  if (claim === file) return true;
  if (isGlobClaim(claim)) return globToRegExp(claim).test(file);
  return file.startsWith(`${claim}/`);
}

export function claimMatchesConcretePath(claimValue: unknown, fileValue: unknown): boolean {
  if (claimPathError(claimValue) || concreteGitPathError(fileValue)) return false;
  const claim = normalizeClaimPath(claimValue);
  const file = String(fileValue);
  if (claim === file) return true;
  if (isGlobClaim(claim)) return globToRegExp(claim).test(file);
  return file.startsWith(`${claim}/`);
}

export function claimsOverlap(leftValue: unknown, rightValue: unknown): boolean {
  const left = normalizeClaimPath(leftValue);
  const right = normalizeClaimPath(rightValue);
  if (!left || !right || claimPathError(left) || claimPathError(right)) return false;
  if (isGlobClaim(left) && isGlobClaim(right)) {
    const leftPrefix = left.slice(0, left.search(/[*?]/));
    const rightPrefix = right.slice(0, right.search(/[*?]/));
    return !leftPrefix || !rightPrefix
      || leftPrefix.startsWith(rightPrefix)
      || rightPrefix.startsWith(leftPrefix);
  }
  return claimMatchesPath(left, right) || claimMatchesPath(right, left);
}

export function resolveClaimsToPaths(claims: string[], paths: string[]): { files: string[]; errors: string[] } {
  const errors = [
    ...claims.flatMap((claim) => {
      const error = claimPathError(claim);
      return error ? [error] : [];
    }),
    ...paths.flatMap((file) => {
      const error = concreteGitPathError(file);
      return error ? [error] : [];
    }),
  ];
  if (errors.length > 0) return { files: [], errors };
  const files = paths
    .filter((file) => claims.some((claim) => claimMatchesConcretePath(claim, file)));
  return { files: Array.from(new Set(files)).sort(), errors: [] };
}
