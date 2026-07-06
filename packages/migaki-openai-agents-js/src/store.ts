import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serializeStableJson, stableHash } from "./hash.js";
import type {
  MigakiCacheKey,
  MigakiArtifactStore,
  MigakiEvent,
  MigakiGraph,
} from "./types.js";

export class LocalMigakiStore implements MigakiArtifactStore {
  readonly #rootDirectory: string;

  constructor(rootDirectory = ".migaki") {
    this.#rootDirectory = rootDirectory;
  }

  async appendEvent(runId: string, event: MigakiEvent): Promise<void> {
    const runDirectory = await this.#ensureRunDirectory(runId);

    await appendFile(
      join(runDirectory, "events.jsonl"),
      `${serializeStableJson(event)}\n`,
      "utf8",
    );
  }

  async writeGraph(runId: string, graph: MigakiGraph): Promise<void> {
    const runDirectory = await this.#ensureRunDirectory(runId);

    await writeFile(
      join(runDirectory, "graph.json"),
      `${serializeStableJson(graph, 2)}\n`,
      "utf8",
    );
  }

  async writeReport(runId: string, report: string): Promise<void> {
    const runDirectory = await this.#ensureRunDirectory(runId);

    await writeFile(
      join(runDirectory, "report.md"),
      report.endsWith("\n") ? report : `${report}\n`,
      "utf8",
    );
  }

  async writeArtifact(
    runId: string,
    name: string,
    content: string,
  ): Promise<void> {
    assertSafeArtifactName(name);

    const runDirectory = await this.#ensureRunDirectory(runId);

    await writeFile(
      join(runDirectory, "artifacts", name),
      content.endsWith("\n") ? content : `${content}\n`,
      "utf8",
    );
  }

  async getCachedOutput(key: MigakiCacheKey): Promise<unknown | undefined> {
    const path = this.#cachePath(key);

    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  async putCachedOutput(key: MigakiCacheKey, value: unknown): Promise<void> {
    const cacheDirectory = join(this.#rootDirectory, "cache");

    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(
      this.#cachePath(key),
      `${serializeStableJson(value, 2)}\n`,
      "utf8",
    );
  }

  async #ensureRunDirectory(runId: string): Promise<string> {
    assertSafeRunId(runId);

    const runDirectory = join(this.#rootDirectory, "runs", runId);

    await mkdir(join(runDirectory, "artifacts"), { recursive: true });

    return runDirectory;
  }

  #cachePath(key: MigakiCacheKey): string {
    return join(this.#rootDirectory, "cache", `${stableHash(key)}.json`);
  }
}

export function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(
      "Migaki runId may contain only letters, numbers, dots, underscores, and hyphens.",
    );
  }
}

function assertSafeArtifactName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(
      "Migaki artifact names may contain only letters, numbers, dots, underscores, and hyphens.",
    );
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
