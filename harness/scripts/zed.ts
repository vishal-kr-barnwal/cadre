import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const CADRE_WORKFLOWS = [
  "create", "track", "implement", "review", "revise",
  "archive", "refresh", "revert", "status", "wisp"
] as const;

const ZED_COMPATIBILITY = `## Zed compatibility

Zed Agent consumes Cadre templates through tools rather than MCP resource discovery. Whenever this workflow calls \`template_get_many\`, include \`contentMode: "text"\`. Use known template IDs and descriptor tools such as \`styleguide_resolve\`; do not attempt to list or read MCP resources directly.`;

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function zedSettingsPath(): string {
  return join(homedir(), ".config", "zed", "settings.json");
}

export function zedSkillsRoot(): string {
  return join(homedir(), ".agents", "skills");
}

export function zedAdapterRoot(marketplaceRoot: string): string {
  return join(resolve(marketplaceRoot), "plugins", "cadre", "zed-skills");
}

export function createZedSkillAdapters(pluginRoot: string): void {
  const adapterRoot = join(pluginRoot, "zed-skills");
  if (existsSync(adapterRoot)) throw new Error(`Zed skill adapter output already exists: ${adapterRoot}`);
  mkdirSync(adapterRoot, { recursive: true });

  for (const workflow of CADRE_WORKFLOWS) {
    const source = join(pluginRoot, "skills", workflow);
    const target = join(adapterRoot, `cadre-${workflow}`);
    cpSync(source, target, { recursive: true });
    const skillPath = join(target, "SKILL.md");
    const body = readFileSync(skillPath, "utf8");
    const expectedName = `name: ${workflow}`;
    const namePattern = new RegExp(`^${expectedName}$`, "m");
    if (!namePattern.test(body)) throw new Error(`${skillPath}: expected ${expectedName}`);
    const renamed = body.replace(namePattern, `name: cadre-${workflow}`);
    const frontmatterEnd = renamed.indexOf("\n---\n", 4);
    if (frontmatterEnd === -1) throw new Error(`${skillPath}: invalid skill frontmatter`);
    const insertionPoint = frontmatterEnd + "\n---\n".length;
    const adapted = `${renamed.slice(0, insertionPoint)}\n${ZED_COMPATIBILITY}\n${renamed.slice(insertionPoint)}`;
    writeFileSync(skillPath, adapted);
  }
}

function expectedSkillLink(marketplaceRoot: string, workflow: typeof CADRE_WORKFLOWS[number]) {
  return {
    destination: join(zedSkillsRoot(), `cadre-${workflow}`),
    target: join(zedAdapterRoot(marketplaceRoot), `cadre-${workflow}`)
  };
}

function linkTarget(path: string): string | null {
  if (!pathExists(path) || !lstatSync(path).isSymbolicLink()) return null;
  return resolve(dirname(path), readlinkSync(path));
}

export function preflightZedSkillLinks(marketplaceRoot: string): void {
  for (const workflow of CADRE_WORKFLOWS) {
    const link = expectedSkillLink(marketplaceRoot, workflow);
    if (!pathExists(link.destination)) continue;
    if (linkTarget(link.destination) !== link.target) {
      throw new Error(
        `${link.destination} already exists and is not owned by Cadre; move it before installing Zed support`
      );
    }
  }
}

export function installZedSkillLinks(marketplaceRoot: string): string[] {
  preflightZedSkillLinks(marketplaceRoot);
  mkdirSync(zedSkillsRoot(), { recursive: true });
  const installed: string[] = [];
  for (const workflow of CADRE_WORKFLOWS) {
    const link = expectedSkillLink(marketplaceRoot, workflow);
    if (!pathExists(link.destination)) {
      symlinkSync(link.target, link.destination, process.platform === "win32" ? "junction" : "dir");
    }
    installed.push(link.destination);
  }
  return installed;
}

export function removeZedSkillLinks(marketplaceRoot: string): { removed: string[]; retained: string[] } {
  const removed: string[] = [];
  const retained: string[] = [];
  for (const workflow of CADRE_WORKFLOWS) {
    const link = expectedSkillLink(marketplaceRoot, workflow);
    if (!pathExists(link.destination)) continue;
    if (linkTarget(link.destination) === link.target) {
      unlinkSync(link.destination);
      removed.push(link.destination);
    } else {
      retained.push(link.destination);
    }
  }
  return { removed, retained };
}
