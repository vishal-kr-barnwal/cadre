import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { JsonObject } from "../../types";
import { asJsonObject, asNumber, asOptionalString, asStringArray, errorMessage, isRecord } from "../../guards";
import { isIgnoredFile, normalizeRel, shouldIgnore } from "../ignore-policy";

import { LspClient } from "./client";
import { commandAvailability } from "./command-availability";
import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_STARTUP_TIMEOUT_MS } from "./constants";
import { changedEntries, changedSymbolCandidates } from "./git-diff";
import { diagnosticFinding, externalReferenceFinding, flattenSymbols, lspRefToLocation, nearbyFileHints, optionalLocations, scanTextReferences, serverFileMatch, skipFinding } from "./scanners";
import { LspServerConfig, RelativeLocation, RunReviewOptions, ServerReport, SymbolCandidate } from "./types";
import { positiveInt, withTimeout } from "./utils";

export async function runReview(options: RunReviewOptions = {}) {
  const args = {
    base: options.base || "main",
    head: options.head || "HEAD",
    config: options.config || "cadre/lsp.json",
  };
  const root = options.root || process.cwd();
  const clientPool = options.clientPool || null;
  const configPath = path.resolve(root, args.config);
  if (!fs.existsSync(configPath)) {
    return {
      available: false,
      reason: `No LSP config found at ${args.config}`,
      changedFiles: [],
      changedEntries: [],
      servers: [],
      findings: [],
    };
  }
  const entries = changedEntries(root, args.base, args.head);
  const files = entries.map((entry) => entry.path);
  const config = asJsonObject(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const servers: LspServerConfig[] = Array.isArray(config.servers)
    ? config.servers
      .map((server) => asJsonObject(server))
      .map((server) => ({
        ...server,
        id: asOptionalString(server.id),
        command: asOptionalString(server.command) || "",
        args: asStringArray(server.args),
        extensions: asStringArray(server.extensions),
        filenames: asStringArray(server.filenames),
        languageIds: asJsonObject(server.languageIds),
        requestTimeoutMs: asNumber(server.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
        startupTimeoutMs: asNumber(server.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS),
        diagnosticsDelayMs: asNumber(server.diagnosticsDelayMs, 250),
      }))
    : [];
  const findings: JsonObject[] = [];
  const serverReports: ServerReport[] = [];
  const changedSet = new Set<string>();
  for (const entry of entries) {
    if (entry.path) changedSet.add(path.resolve(root, entry.path));
    if (entry.oldPath) changedSet.add(path.resolve(root, entry.oldPath));
  }

  for (const server of servers) {
    const serverEntries = entries.filter((entry) => {
      return serverFileMatch(entry.path, server)
        || (entry.oldPath ? serverFileMatch(entry.oldPath, server) : false);
    });
    if (serverEntries.length === 0) continue;
    const availability = commandAvailability(server.command);
    const serverReport: ServerReport = {
      id: server.id || server.command || "unknown",
      command: server.command || null,
      availability,
      files: serverEntries.map((entry) => ({
        path: entry.path,
        oldPath: entry.oldPath,
        status: entry.status,
        kind: entry.kind,
        exists: entry.exists,
      })),
      candidates: [],
      skipped: false,
    };
    serverReports.push(serverReport);
    const allCandidates = new Map<string, SymbolCandidate>();
    for (const entry of serverEntries) {
      for (const candidate of changedSymbolCandidates(root, args.base, args.head, entry)) {
        const key = `${candidate.name}\0${candidate.changedFile}\0${candidate.oldPath || ""}`;
        allCandidates.set(key, candidate);
      }
    }
    serverReport.candidates = Array.from(allCandidates.values()).map((candidate) => ({
      name: candidate.name,
      changeType: candidate.changeType,
      status: candidate.status,
      changedFile: candidate.changedFile,
      oldPath: candidate.oldPath,
    }));
    if (availability.state !== "available") {
      serverReport.skipped = true;
      findings.push(skipFinding(
        server,
        availability.state === "invalid" ? "server_invalid" : "server_missing",
        availability.message || `LSP server command ${server.command} is unavailable`,
        { availability }
      ));
      for (const candidate of allCandidates.values()) {
        if (candidate.changeType !== "removed") continue;
        const refs = scanTextReferences(root, candidate.name, changedSet, server);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
      continue;
    }
    let pooled: { client: LspClient } | null = null;
    let client: LspClient | null = null;
    try {
      pooled = clientPool ? await clientPool.get(root, server) : null;
      client = pooled ? pooled.client : new LspClient(root, server);
      if (!pooled) {
        const startupTimeoutMs = positiveInt(server.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
        await withTimeout(
          client.start(),
          startupTimeoutMs,
          `${server.command} did not spawn within ${startupTimeoutMs}ms`
        );
        await withTimeout(
          client.initialize(),
          startupTimeoutMs,
          `${server.command} did not initialize within ${startupTimeoutMs}ms`
        );
      }
      serverReport.warm = Boolean(pooled);
      const openFiles = Array.from(new Set(
        serverEntries
          .filter((entry) => entry.exists)
          .map((entry) => entry.path)
      ));
      for (const file of openFiles) client.open(file);
      await new Promise((resolve) => setTimeout(resolve, positiveInt(server.diagnosticsDelayMs, 250)));
      serverReport.diagnostics = [];
      serverReport.symbolEvidence = [];
      for (const file of openFiles) {
        for (const diagnostic of client.diagnostics(file)) {
          const item = {
            file,
            line: diagnostic.range && diagnostic.range.start ? diagnostic.range.start.line + 1 : null,
            severity: diagnostic.severity || null,
            code: diagnostic.code || null,
            message: diagnostic.message || "",
          };
          serverReport.diagnostics.push(item);
          if (diagnostic.severity === 1 || diagnostic.severity === 2) {
            findings.push(diagnosticFinding(server, file, diagnostic));
          }
        }
      }

      for (const file of openFiles) {
        const candidates = Array.from(allCandidates.values())
          .filter((candidate) => candidate.changedFile === file);
        if (candidates.length === 0) continue;
        const symbols = flattenSymbols(await client.documentSymbols(file));
        for (const candidate of candidates) {
          const symbol = symbols.find((item) => item.name === candidate.name);
          if (!symbol) {
            const refs = scanTextReferences(root, candidate.name, changedSet, server);
            if (refs.length > 0) {
              findings.push(externalReferenceFinding(server, candidate, refs, "text"));
            }
            continue;
          }
          const rawRefs = await client.references(file, symbol.selectionRange.start);
          const refs = Array.isArray(rawRefs) ? rawRefs : [];
          const definitions = await optionalLocations(client, "definition", file, symbol.selectionRange.start, root);
          const typeDefinitions = await optionalLocations(client, "typeDefinition", file, symbol.selectionRange.start, root);
          const implementations = await optionalLocations(client, "implementation", file, symbol.selectionRange.start, root);
          serverReport.symbolEvidence.push({
            symbol: candidate.name,
            file,
            definitions,
            typeDefinitions,
            implementations,
          });
          const externalRefs = refs
            .map((ref) => lspRefToLocation(root, ref))
            .filter((ref): ref is RelativeLocation => ref !== null)
            .filter((ref) => !changedSet.has(path.resolve(ref.file)))
            .filter((ref) => !isIgnoredFile(root, ref.relativeFile));
          if (externalRefs.length > 0) {
            findings.push(externalReferenceFinding(server, candidate, externalRefs, "lsp"));
          }
        }
      }

      for (const candidate of allCandidates.values()) {
        if (candidate.changeType !== "removed") continue;
        if (candidate.changedFile && fs.existsSync(path.join(root, candidate.changedFile))) continue;
        const refs = scanTextReferences(root, candidate.name, changedSet, server);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
    } catch (error) {
      serverReport.skipped = true;
      findings.push(skipFinding(server, "server_unavailable", `LSP scan skipped: ${errorMessage(error)}`));
      if (clientPool && pooled) await clientPool.drop(root, server);
      for (const candidate of allCandidates.values()) {
        if (candidate.changeType !== "removed") continue;
        const refs = scanTextReferences(root, candidate.name, changedSet, server);
        if (refs.length > 0) {
          findings.push(externalReferenceFinding(server, candidate, refs, "text"));
        }
      }
    } finally {
      if (!clientPool && client) await client.shutdown();
    }
  }

  return {
    available: true,
    base: args.base,
    head: args.head,
    config: args.config,
    changedFiles: files,
    changedEntries: entries,
    fileHints: nearbyFileHints(root, files),
    servers: serverReports,
    findings,
  };
}
