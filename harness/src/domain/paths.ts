import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { parse, resolve } from "node:path";

export function safeProjectRoot(input: string): string {
  const root = resolve(input);
  if (root === parse(root).root || root === resolve(homedir())) {
    throw new Error(`Refusing broad project root ${root}`);
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Project root is not an existing directory: ${root}`);
  }
  return root;
}
