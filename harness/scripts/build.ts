import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function buildMcp(): string {
  const output = resolve(projectRoot, "dist/cadre-mcp.mjs");
  mkdirSync(dirname(output), { recursive: true });
  buildSync({
    entryPoints: [resolve(projectRoot, "src/mcp/server.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    sourcemap: false,
    minify: false,
    legalComments: "none"
  });
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`Built ${buildMcp()}\n`);
}
