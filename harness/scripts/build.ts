import { buildSync } from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Bundle {
  entry: string;
  output: string;
  executable?: boolean;
}

const bundles: Bundle[] = [
  { entry: "src/mcp/server.ts", output: "dist/cadre-mcp.mjs" },
  { entry: "scripts/cli.ts", output: "dist/cadre-cli.mjs", executable: true }
];

export function buildRuntime(): string[] {
  return bundles.map((bundle) => {
    const output = resolve(projectRoot, bundle.output);
    mkdirSync(dirname(output), { recursive: true });
    buildSync({
      entryPoints: [resolve(projectRoot, bundle.entry)],
      outfile: output,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node18",
      sourcemap: false,
      minify: false,
      legalComments: "none",
      ...(bundle.executable ? { banner: { js: "#!/usr/bin/env node" } } : {})
    });
    if (bundle.executable) chmodSync(output, 0o755);
    return output;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputs = buildRuntime();
  process.stdout.write(`Built ${outputs.length} Cadre runtime bundles.\n`);
}
