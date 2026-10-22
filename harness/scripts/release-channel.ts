import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const core = "(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)";
const betaTag = new RegExp(`^beta-(${core})(?:-beta\\.(0|[1-9][0-9]*))?$`);
const stableTag = new RegExp(`^(?:v|release-)?(${core})$`);

/** Resolve the channel from the event and tag, never from a caller-supplied npm tag. */
export function releaseChannel(event: string, tag: string, packageVersion: string): { version: string; channel: "beta" | "latest" } {
  let version: string, channel: "beta" | "latest";
  if (event === "push") {
    const match = betaTag.exec(tag);
    if (!match) throw new Error("Beta publication requires beta-X.Y.Z or beta-X.Y.Z-beta.N");
    version = `${match[1]}-beta.${match[5] ?? "0"}`;
    channel = "beta";
  } else if (event === "release") {
    const match = stableTag.exec(tag);
    if (!match) throw new Error("Stable publication requires a stable version tag; beta tags publish only on push");
    version = match[1]!;
    channel = "latest";
  } else throw new Error(`Unsupported publication event: ${event}`);
  if (version !== packageVersion) throw new Error(`Tag resolves to ${version}, but cadre-ai is ${packageVersion}; update and validate the candidate versions first`);
  return { version, channel };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const metadata = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
  const result = releaseChannel(process.env.GITHUB_EVENT_NAME ?? "", process.env.RELEASE_TAG ?? "", metadata.version);
  if (!process.env.GITHUB_OUTPUT) throw new Error("GitHub Actions output file is required");
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nchannel=${result.channel}\n`);
  process.stdout.write(`Publishing cadre-ai@${result.version} to ${result.channel}\n`);
}
