import type { JsonObject, RuntimeArgs } from "../../types";
import type { JobRecord } from "../domain/protocol-types";
import type { ProjectSourceReaderPort } from "../domain/resource-types";

export type CoreApi = typeof import("../../core/application/api");

export interface JobManagerPort {
  start(type: string, root: string, args?: RuntimeArgs): JsonObject;
  get(root: string, id: string | null | undefined): JobRecord | null;
  summary(job: JobRecord): JsonObject;
  loadPersisted(root: string, id: string | null | undefined): JsonObject | null;
  result(root: string, id: string | null | undefined): JsonObject;
  cancel(root: string, id: string | null | undefined): JsonObject;
  list(root: string): JsonObject;
}

export interface LspDaemonPort {
  request(method: string, params?: JsonObject, timeoutMs?: number): Promise<unknown>;
  shutdown(): Promise<unknown>;
}

export interface RootResolverPort {
  rootFromCandidate(candidate: unknown): { root: string; has_cadre: boolean } | null;
  setupRootFromCandidate(candidate: unknown): { root: string; has_cadre: boolean } | null;
  requireCadreRoot(args?: RuntimeArgs): string;
}

export interface RuntimeDependencies {
  core: CoreApi;
  jobs: JobManagerPort;
  lspDaemon: LspDaemonPort;
  rootResolver: RootResolverPort;
  projectSourceReader: ProjectSourceReaderPort;
}
