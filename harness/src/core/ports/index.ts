import type { CadreLock, CadreTrack, CommandResult, JsonObject, ParsedPlan, RuntimeArgs, Topology } from "../../types";

export interface CommandRunner {
  run(command: string, args: string[], options?: RuntimeArgs): CommandResult;
}

export interface JsonFileStore {
  read<T>(file: string, fallback: T): T;
  write(file: string, value: JsonObject): void;
  patch<T extends JsonObject>(file: string, patcher: (next: T, before: T) => T, options?: RuntimeArgs): JsonObject;
}

export interface LockService {
  acquire(root: string, name: string, options?: RuntimeArgs): CadreLock;
  release(lock: CadreLock | null | undefined): JsonObject;
  withLock<T>(root: string, name: string, operation: (lock: CadreLock) => T, options?: RuntimeArgs): JsonObject;
}

export interface TrackRepository {
  list(root: string): CadreTrack[];
  find(root: string, trackId: string | null | undefined): CadreTrack | null;
  parsePlan(track: CadreTrack): ParsedPlan;
}

export interface TopologyRepository {
  load(root: string): Topology;
}

export interface TemplateStore {
  text(relativePath: string, fallback: string): string;
  json(relativePath: string, fallback: JsonObject): JsonObject;
}

export interface BeadsGateway {
  run(root: string, args: string[]): JsonObject;
}

export interface ProviderGateway {
  mode(root: string, args?: RuntimeArgs): JsonObject;
  evidence(root: string, args?: RuntimeArgs): JsonObject;
}

export interface LspReviewGateway {
  review(root: string, args?: RuntimeArgs): JsonObject;
}
