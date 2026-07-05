import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  isSmokeExecutionRunId,
  isTurnExecutionRunId,
  sortExecutionAdviceGraphCandidatesByModifiedTime,
  type ExecutionAdviceGraphCandidate,
} from "./execution-advice.js";
import {
  EXECUTION_EVENT_VERSION,
  LocalStore,
  MigakiRuntime,
  stableExecutionDigest,
  stableExecutionHash,
  type Artifact,
  type ExecutionClock,
  type ExecutionEvent,
  type ExecutionNodeStatus,
  type ExecutionStore,
} from "./execution.js";

export const MANUAL_EXEC_ADAPTER_VERSION = "migaki.manual-exec.v0";
export const MANUAL_FILE_PATH_FINGERPRINT_VERSION = "manual.file_path.v0";

export type ManualCommandStdio = "ignore" | "inherit";

export interface ManualCommandRunOptions {
  readonly attachLatestRunning?: boolean;
  readonly clock?: ExecutionClock;
  readonly commandArgs: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly finishAttachedRun?: boolean;
  readonly runId?: string;
  readonly stdio?: ManualCommandStdio;
  readonly store?: ExecutionStore;
  readonly storeDirectory?: string;
}

export interface ManualCommandRunResult {
  readonly attachedToRunningTurn: boolean;
  readonly exitCode: number;
  readonly finishedRun: boolean;
  readonly operationId: string;
  readonly runId: string;
  readonly signal?: NodeJS.Signals;
  readonly status: Extract<ExecutionNodeStatus, "error" | "ok">;
}

export interface ManualFinishRunOptions {
  readonly clock?: ExecutionClock;
  readonly runId?: string;
  readonly store?: ExecutionStore;
  readonly storeDirectory?: string;
}

export interface ManualFinishRunResult {
  readonly finished: boolean;
  readonly runId?: string;
}

export class ManualRunTargetNotFoundError extends Error {
  constructor() {
    super("No running Codex turn was available to attach.");
    this.name = "ManualRunTargetNotFoundError";
  }
}

interface ManualRunTarget {
  readonly attachedToRunningTurn: boolean;
  readonly completeRun: boolean;
  readonly runId: string;
}

interface ChildResult {
  readonly errorCode?: string;
  readonly exitCode: number;
  readonly signal?: NodeJS.Signals;
}

const defaultClock: ExecutionClock = {
  now() {
    return new Date();
  },
};
const supportedReadCommandNames = new Set([
  "cat",
  "head",
  "nl",
  "sed",
  "tail",
  "wc",
]);
const maxContentFingerprintBytes = 10 * 1024 * 1024;

export async function runManualCommand(
  options: ManualCommandRunOptions,
): Promise<ManualCommandRunResult> {
  if (options.commandArgs.length === 0) {
    throw new Error("Manual Migaki command requires at least one command arg.");
  }

  const clock = options.clock ?? defaultClock;
  const cwd = options.cwd ?? process.cwd();
  const storeDirectory = options.storeDirectory ?? ".migaki";
  const target = selectManualRunTarget({
    attachLatestRunning: options.attachLatestRunning === true,
    clock,
    finishAttachedRun: options.finishAttachedRun === true,
    storeDirectory,
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
  });
  const runtime = new MigakiRuntime({
    store: options.store ?? new LocalStore(storeDirectory),
  });
  const startedAt = clock.now();
  const commandFingerprint = stableExecutionHash({
    args: options.commandArgs,
    kind: "manual.command.v0",
  });
  const operationId = `manual-shell-${stableExecutionDigest({
    commandFingerprint,
    pid: process.pid,
    startedAt: startedAt.toISOString(),
  }).slice(0, 16)}`;
  const fileArtifacts = manualFileArtifacts({
    commandArgs: options.commandArgs,
    cwd,
    operationId,
  });
  const startedEvent = createManualCommandEvent({
    commandArgs: options.commandArgs,
    commandFingerprint,
    cwd,
    eventIdSuffix: "start",
    fileArtifacts,
    lifecycle: "start",
    occurredAt: startedAt,
    operationId,
    runId: target.runId,
  });

  await runtime.onExecutionEvent(startedEvent);

  const childResult = await runChildCommand({
    commandArgs: options.commandArgs,
    cwd,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });
  const endedAt = clock.now();
  const status = childResult.exitCode === 0 ? "ok" : "error";
  const runStatus = target.completeRun ? status : undefined;
  const finishedEvent = createManualCommandEvent({
    commandArgs: options.commandArgs,
    commandFingerprint,
    cwd,
    eventIdSuffix: "finish",
    fileArtifacts,
    lifecycle: "finish",
    occurredAt: endedAt,
    operationId,
    runId: target.runId,
    status,
    toolResult: childResult,
    ...(runStatus !== undefined ? { runStatus } : {}),
  });

  await runtime.onExecutionEvent(finishedEvent);

  return {
    attachedToRunningTurn: target.attachedToRunningTurn,
    exitCode: childResult.exitCode,
    finishedRun: target.completeRun,
    operationId,
    runId: target.runId,
    ...(childResult.signal !== undefined ? { signal: childResult.signal } : {}),
    status,
  };
}

export function selectManualRunTarget(input: {
  readonly attachLatestRunning: boolean;
  readonly clock?: ExecutionClock;
  readonly finishAttachedRun?: boolean;
  readonly runId?: string;
  readonly storeDirectory?: string;
}): ManualRunTarget {
  if (input.runId !== undefined) {
    return {
      attachedToRunningTurn: false,
      completeRun: true,
      runId: input.runId,
    };
  }

  if (input.attachLatestRunning) {
    const latestRunning = findLatestRunningCodexTurnRunId({
      ...(input.storeDirectory !== undefined
        ? { storeDirectory: input.storeDirectory }
        : {}),
    });

    if (latestRunning !== undefined) {
      return {
        attachedToRunningTurn: true,
        completeRun: input.finishAttachedRun === true,
        runId: latestRunning,
      };
    }

    throw new ManualRunTargetNotFoundError();
  }

  return {
    attachedToRunningTurn: false,
    completeRun: true,
    runId: createManualRunId(input.clock ?? defaultClock),
  };
}

export function findLatestRunningCodexTurnRunId(
  input: {
    readonly storeDirectory?: string;
  } = {},
): string | undefined {
  const storeDirectory = input.storeDirectory ?? ".migaki";
  const runsDirectory = join(storeDirectory, "runs");

  if (!existsSync(runsDirectory)) {
    return undefined;
  }

  const candidates: ExecutionAdviceGraphCandidate[] = [];

  for (const entry of readdirSync(runsDirectory, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !isTurnExecutionRunId(entry.name) ||
      isSmokeExecutionRunId(entry.name)
    ) {
      continue;
    }

    const graphPath = join(runsDirectory, entry.name, "graph.json");

    if (!existsSync(graphPath)) {
      continue;
    }

    try {
      const graph = JSON.parse(readFileSync(graphPath, "utf8")) as unknown;

      if (!isRecord(graph) || graph.status !== "running") {
        continue;
      }

      candidates.push({
        graphPath,
        modifiedAtMs: statSync(graphPath).mtimeMs,
        runId: entry.name,
        status: "running",
      });
    } catch {
      continue;
    }
  }

  return sortExecutionAdviceGraphCandidatesByModifiedTime(candidates)[0]?.runId;
}

export async function finishManualRun(
  options: ManualFinishRunOptions = {},
): Promise<ManualFinishRunResult> {
  const storeDirectory = options.storeDirectory ?? ".migaki";
  const runId =
    options.runId ??
    findLatestRunningCodexTurnRunId({
      storeDirectory,
    });

  if (runId === undefined) {
    return {
      finished: false,
    };
  }

  const clock = options.clock ?? defaultClock;
  const runtime = new MigakiRuntime({
    store: options.store ?? new LocalStore(storeDirectory),
  });

  await runtime.onExecutionEvent({
    version: EXECUTION_EVENT_VERSION,
    id: `manual:${runId}:finish-turn`,
    lifecycle: "point",
    metadata: {
      manualExec: {
        adapterVersion: MANUAL_EXEC_ADAPTER_VERSION,
        finishOnly: true,
      },
      sequence: {
        scope: runId,
      },
      source: {
        adapter: "manual-exec",
        adapterVersion: MANUAL_EXEC_ADAPTER_VERSION,
      },
    },
    occurredAt: clock.now().toISOString(),
    operation: {
      id: "turn",
      kind: "turn",
      name: "Turn completed",
    },
    runId,
    runStatus: "ok",
    status: "ok",
  });

  return {
    finished: true,
    runId,
  };
}

export function manualFileArtifacts(input: {
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly operationId: string;
}): readonly Artifact[] {
  const observation = manualReadLikeFileObservation(
    input.commandArgs,
    input.cwd,
  );

  if (observation === undefined) {
    return [];
  }

  return [
    {
      fingerprint: stableExecutionHash({
        kind: MANUAL_FILE_PATH_FINGERPRINT_VERSION,
        path: observation.normalizedPath,
      }),
      id: `${input.operationId}-file-path`,
      kind: "file",
      metadata: {
        codex: {
          contentFingerprint: observation.contentFingerprint,
          fileMtimeMs: observation.fileMtimeMs,
          fileSizeBytes: observation.fileSizeBytes,
          fingerprintVersion: MANUAL_FILE_PATH_FINGERPRINT_VERSION,
          sourceCommand: observation.sourceCommand,
          sourceField: "argv",
          toolName: "Shell",
        },
        redaction: {
          mode: "omitted",
          reason:
            "Raw Migaki manual-exec file path is not persisted by default.",
        },
      },
    },
  ];
}

function createManualCommandEvent(input: {
  readonly commandArgs: readonly string[];
  readonly commandFingerprint: string;
  readonly cwd: string;
  readonly eventIdSuffix: "finish" | "start";
  readonly fileArtifacts: readonly Artifact[];
  readonly lifecycle: "finish" | "start";
  readonly occurredAt: Date;
  readonly operationId: string;
  readonly runId: string;
  readonly runStatus?: "error" | "ok";
  readonly status?: Extract<ExecutionNodeStatus, "error" | "ok">;
  readonly toolResult?: ChildResult;
}): ExecutionEvent {
  const safeCommandName = safeCommandToken(
    basename(input.commandArgs[0] ?? ""),
  );
  const event: ExecutionEvent = {
    version: EXECUTION_EVENT_VERSION,
    id: `manual:${input.runId}:${input.operationId}:${input.eventIdSuffix}`,
    lifecycle: input.lifecycle,
    operation: {
      fingerprint: input.commandFingerprint,
      id: input.operationId,
      kind: "tool_call",
      name:
        safeCommandName === undefined ? "Shell" : `Shell ${safeCommandName}`,
    },
    artifacts:
      input.lifecycle === "start"
        ? [
            redactedArtifact({
              fingerprint: input.commandFingerprint,
              id: `${input.operationId}-input`,
              kind: "tool_input",
              reason:
                "Raw Migaki manual-exec command args are not persisted by default.",
            }),
            ...input.fileArtifacts,
          ]
        : [
            redactedArtifact({
              fingerprint: stableExecutionHash({
                errorCode: input.toolResult?.errorCode,
                exitCode: input.toolResult?.exitCode,
                signal: input.toolResult?.signal,
              }),
              id: `${input.operationId}-output`,
              kind: "tool_result",
              reason:
                "Raw Migaki manual-exec command output is not captured or persisted.",
            }),
            ...input.fileArtifacts,
          ],
    metadata: {
      manualExec: {
        adapterVersion: MANUAL_EXEC_ADAPTER_VERSION,
        commandArgCount: input.commandArgs.length,
        ...(safeCommandName !== undefined
          ? { commandName: safeCommandName }
          : {}),
        cwdFingerprint: stableExecutionHash({
          cwd: resolve(input.cwd),
        }),
      },
      sequence: {
        scope: input.runId,
      },
      source: {
        adapter: "manual-exec",
        adapterVersion: MANUAL_EXEC_ADAPTER_VERSION,
      },
    },
    occurredAt: input.occurredAt.toISOString(),
    runId: input.runId,
    ...(input.runStatus !== undefined ? { runStatus: input.runStatus } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };

  return event;
}

function redactedArtifact(input: {
  readonly fingerprint: string;
  readonly id: string;
  readonly kind: string;
  readonly reason: string;
}): Artifact {
  return {
    fingerprint: input.fingerprint,
    id: input.id,
    kind: input.kind,
    metadata: {
      redaction: {
        mode: "omitted",
        reason: input.reason,
      },
    },
  };
}

function runChildCommand(input: {
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: ManualCommandStdio;
}): Promise<ChildResult> {
  return new Promise((resolveResult) => {
    const child = spawn(
      input.commandArgs[0] ?? "",
      input.commandArgs.slice(1),
      {
        cwd: input.cwd,
        env: input.env,
        stdio: input.stdio,
      },
    );
    let settled = false;

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }

      settled = true;
      resolveResult({
        exitCode: 127,
        ...(error.code !== undefined ? { errorCode: error.code } : {}),
      });
    });

    child.on("exit", (exitCode, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      resolveResult({
        exitCode: exitCode ?? 1,
        ...(signal !== null ? { signal } : {}),
      });
    });
  });
}

function createManualRunId(clock: ExecutionClock): string {
  const timestamp = clock
    .now()
    .toISOString()
    .replace(/[-:.]/gu, "")
    .replace("T", "t")
    .replace("Z", "z");

  return `codex-manual-${timestamp}-${process.pid}`;
}

function manualReadLikeFileObservation(
  commandArgs: readonly string[],
  cwd: string,
):
  | {
      readonly contentFingerprint: string;
      readonly fileMtimeMs: number;
      readonly fileSizeBytes: number;
      readonly normalizedPath: string;
      readonly sourceCommand: string;
    }
  | undefined {
  const commandName = safeCommandToken(basename(commandArgs[0] ?? ""));

  if (
    commandName === undefined ||
    !supportedReadCommandNames.has(commandName)
  ) {
    return undefined;
  }

  const normalizedPath = findLastPlainExistingFile(commandArgs.slice(1), cwd);

  if (normalizedPath === undefined) {
    return undefined;
  }

  const stats = statSync(normalizedPath);

  return {
    contentFingerprint:
      stats.size <= maxContentFingerprintBytes
        ? fileContentFingerprint(normalizedPath)
        : "unavailable:too_large",
    fileMtimeMs: Math.trunc(stats.mtimeMs),
    fileSizeBytes: stats.size,
    normalizedPath,
    sourceCommand: commandName,
  };
}

function findLastPlainExistingFile(
  args: readonly string[],
  cwd: string,
): string | undefined {
  for (const arg of [...args].reverse()) {
    if (!isPlainPathToken(arg)) {
      continue;
    }

    const path = isAbsolute(arg) ? arg : resolve(cwd, arg);

    try {
      const normalizedPath = realpathSync(path);
      const stats = statSync(normalizedPath);

      if (stats.isFile()) {
        return normalizedPath;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function fileContentFingerprint(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function safeCommandToken(value: string): string | undefined {
  return /^[A-Za-z0-9._+-]+$/u.test(value) ? value : undefined;
}

function isPlainPathToken(value: string): boolean {
  if (value === "" || value.startsWith("-")) {
    return false;
  }

  return !/[?*[\]{}$`|;&<>\n\r]/u.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
