import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PROJECT_SKILL_MAX_FILE_BYTES } from "../../domain/project-skill-policy";

export type ProjectSkillFileContent = string | Buffer;

export function normalizeReferenceContent(file: string, content: string): string {
  let normalized = content.replace(/\r\n?/g, "\n");
  if (Buffer.byteLength(normalized, "utf8") > PROJECT_SKILL_MAX_FILE_BYTES) throw new Error(`reference exceeds ${PROJECT_SKILL_MAX_FILE_BYTES} bytes: ${file}`);
  if (Buffer.from(normalized).subarray(0, 8192).includes(0)) throw new Error(`binary reference is not supported: ${file}`);
  if (path.extname(file).toLowerCase() === ".json") {
    try { normalized = JSON.stringify(JSON.parse(normalized), null, 2); } catch { throw new Error(`invalid JSON reference: ${file}`); }
  }
  return `${normalized.replace(/\n*$/, "")}\n`;
}

function copyIfExists(source: string, target: string): void {
  if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
}

export function atomicSkillMutation(root: string, sourceId: string, targetId: string | null, files: ReadonlyMap<string, ProjectSkillFileContent>): { written: string[]; removed: string[]; rollback: () => void; finish: () => void } {
  const catalog = path.join(root, "cadre", "skills");
  const source = path.join(catalog, sourceId);
  const target = targetId ? path.join(catalog, targetId) : null;
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "cadre-skill-backup-"));
  const writtenFiles: string[] = [];
  const removedFiles: string[] = [];
  copyIfExists(source, path.join(backup, "source"));
  if (target && target !== source) copyIfExists(target, path.join(backup, "target"));
  const rollback = () => {
    fs.rmSync(source, { recursive: true, force: true });
    if (target && target !== source) fs.rmSync(target, { recursive: true, force: true });
    copyIfExists(path.join(backup, "source"), source);
    if (target && target !== source) copyIfExists(path.join(backup, "target"), target);
  };
  try {
    fs.mkdirSync(catalog, { recursive: true });
    if (!target) fs.rmSync(source, { recursive: true, force: true });
    else {
      if (source !== target && fs.existsSync(source) && !fs.existsSync(target)) fs.renameSync(source, target);
      fs.mkdirSync(target, { recursive: true });
      const desired = new Set(files.keys());
      for (const [relative, content] of files) {
        const destination = path.join(target, relative);
        const intended = Buffer.isBuffer(content) ? content : Buffer.from(content);
        if (fs.existsSync(destination) && fs.lstatSync(destination).isFile() && fs.readFileSync(destination).equals(intended)) continue;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const temporary = `${destination}.tmp-${process.pid}`;
        fs.writeFileSync(temporary, content);
        fs.renameSync(temporary, destination);
        writtenFiles.push(relative);
      }
      for (const existing of walkFiles(target)) {
        const relative = path.relative(target, existing).split(path.sep).join("/");
        if (!desired.has(relative)) {
          fs.rmSync(existing, { force: true });
          removedFiles.push(relative);
        }
      }
      if (source !== target) fs.rmSync(source, { recursive: true, force: true });
    }
  } catch (error) { rollback(); fs.rmSync(backup, { recursive: true, force: true }); throw error; }
  return {
    written: target ? writtenFiles.map((file) => `cadre/skills/${targetId}/${file}`).sort() : [],
    removed: !target
      ? [`cadre/skills/${sourceId}`]
      : sourceId !== targetId
        ? [`cadre/skills/${sourceId}`]
        : removedFiles.map((file) => `cadre/skills/${targetId}/${file}`).sort(),
    rollback,
    finish: () => fs.rmSync(backup, { recursive: true, force: true }),
  };
}

function walkFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(file) : [file];
  });
}
