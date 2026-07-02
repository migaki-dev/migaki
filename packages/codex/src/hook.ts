#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { stdin as processStdin } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXECUTION_EVENT_VERSION,
  LocalStore,
  MigakiRuntime,
  stableExecutionDigest,
  stableExecutionHash,
  type Artifact,
  type ExecutionClock,
  type ExecutionEvent,
  type ExecutionStore,
  type Metadata,
} from "@migaki/runtime";

export const CODEX_HOOK_ADAPTER_VERSION = "migaki.codex-hooks.v0";

export interface CodexHookRunOptions {
  readonly clock?: ExecutionClock;
  readonly store?: ExecutionStore;
  readonly storeDirectory?: string;
}

export interface CodexHookResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

type SupportedCodexHookEventName =
  | "PostToolUse"
  | "PreToolUse"
  | "Stop"
  | "UserPromptSubmit";

interface CodexHookInputBase {
  readonly [key: string]: unknown;
  readonly cwd?: string;
  readonly hook_event_name: string;
  readonly model?: string;
  readonly permission_mode?: string;
  readonly session_id?: string;
  readonly transcript_path?: string | null;
  readonly turn_id?: string;
}

interface SupportedCodexHookInput extends CodexHookInputBase {
  readonly hook_event_name: SupportedCodexHookEventName;
}

const supportedHookEvents = new Set<string>([
  "PostToolUse",
  "PreToolUse",
  "Stop",
  "UserPromptSubmit",
]);

export async function runCodexHook(
  stdin: string,
  options: CodexHookRunOptions = {},
): Promise<CodexHookResult> {
  try {
    const parsed = parseCodexHookInput(stdin);

    if (parsed === undefined) {
      return success();
    }

    const event = codexHookInputToExecutionEvent(parsed);

    if (event === undefined) {
      return success();
    }

    const runtime = new MigakiRuntime({
      ...(options.clock !== undefined ? { clock: options.clock } : {}),
      store:
        options.store ?? new LocalStore(options.storeDirectory ?? ".migaki"),
    });

    await runtime.onExecutionEvent(event);

    return success();
  } catch {
    return success();
  }
}

export function codexHookInputToExecutionEvent(
  input: SupportedCodexHookInput,
): ExecutionEvent | undefined {
  if (typeof input.turn_id !== "string" || input.turn_id.trim() === "") {
    return undefined;
  }

  const runId = codexRunId(input.turn_id);
  const metadata = codexMetadata(input);

  if (input.hook_event_name === "UserPromptSubmit") {
    const prompt = readString(input, "prompt");

    if (prompt === undefined) {
      return undefined;
    }

    const promptFingerprint = stableExecutionHash({
      hookEventName: input.hook_event_name,
      prompt,
    });

    return {
      version: EXECUTION_EVENT_VERSION,
      id: `codex:${safeIdentifier(input.turn_id)}:prompt:${stableExecutionDigest(prompt).slice(0, 16)}`,
      lifecycle: "point",
      operation: {
        fingerprint: promptFingerprint,
        id: "prompt",
        kind: "user_prompt",
        name: "User prompt",
      },
      artifacts: [
        redactedArtifact({
          fingerprint: promptFingerprint,
          id: "prompt-input",
          kind: "prompt",
          reason: "Raw Codex prompt text is not persisted by default.",
        }),
      ],
      metadata,
      runId,
      status: "ok",
    };
  }

  if (
    input.hook_event_name === "PreToolUse" ||
    input.hook_event_name === "PostToolUse"
  ) {
    const toolUseId = readString(input, "tool_use_id");
    const toolName = readString(input, "tool_name");

    if (toolUseId === undefined || toolName === undefined) {
      return undefined;
    }

    const toolInput = readUnknown(input, "tool_input");
    const toolInputFingerprint = stableExecutionHash({
      toolInput,
      toolName,
    });
    const operationId = `tool-${safeIdentifier(toolUseId)}`;
    const toolMetadata = {
      ...metadata,
      codex: {
        ...readRecord(metadata.codex),
        toolName,
        toolUseId,
      },
    };

    if (input.hook_event_name === "PreToolUse") {
      return {
        version: EXECUTION_EVENT_VERSION,
        id: `codex:${safeIdentifier(input.turn_id)}:${safeIdentifier(toolUseId)}:start`,
        lifecycle: "start",
        operation: {
          fingerprint: toolInputFingerprint,
          id: operationId,
          kind: "tool_call",
          name: toolName,
        },
        artifacts: [
          redactedArtifact({
            fingerprint: toolInputFingerprint,
            id: `${operationId}-input`,
            kind: "tool_input",
            reason: "Raw Codex tool input is not persisted by default.",
          }),
        ],
        metadata: toolMetadata,
        runId,
      };
    }

    const toolResponse = readUnknown(input, "tool_response");
    const toolResponseFingerprint = stableExecutionHash({
      toolResponse,
      toolName,
    });
    const status = isErrorLikeToolResponse(toolResponse) ? "error" : "ok";

    return {
      version: EXECUTION_EVENT_VERSION,
      id: `codex:${safeIdentifier(input.turn_id)}:${safeIdentifier(toolUseId)}:finish`,
      lifecycle: "finish",
      operation: {
        fingerprint: toolInputFingerprint,
        id: operationId,
        kind: "tool_call",
        name: toolName,
      },
      artifacts: [
        redactedArtifact({
          fingerprint: toolResponseFingerprint,
          id: `${operationId}-output`,
          kind: "tool_result",
          reason: "Raw Codex tool output is not persisted by default.",
        }),
      ],
      metadata: toolMetadata,
      runId,
      status,
    };
  }

  if (input.hook_event_name === "Stop") {
    const lastAssistantMessage = readString(input, "last_assistant_message");
    const artifacts: Artifact[] =
      lastAssistantMessage === undefined
        ? []
        : [
            redactedArtifact({
              fingerprint: stableExecutionHash({
                lastAssistantMessage,
              }),
              id: "last-assistant-message",
              kind: "assistant_message",
              reason:
                "Raw Codex assistant message text is not persisted by default.",
            }),
          ];

    return {
      version: EXECUTION_EVENT_VERSION,
      id: `codex:${safeIdentifier(input.turn_id)}:stop`,
      lifecycle: "point",
      operation: {
        id: "turn",
        kind: "turn",
        name: "Turn completed",
      },
      artifacts,
      metadata: {
        ...metadata,
        codex: {
          ...readRecord(metadata.codex),
          stopHookActive: readBoolean(input, "stop_hook_active"),
        },
      },
      runId,
      runStatus: "ok",
      status: "ok",
    };
  }

  return undefined;
}

export function codexRunId(turnId: string): string {
  return `codex-turn-${safeIdentifier(turnId)}`;
}

export function safeIdentifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "-");
  const trimmed = normalized.replace(/^-+|-+$/g, "");

  if (trimmed !== "") {
    return trimmed.length <= 96
      ? trimmed
      : `${trimmed.slice(0, 80)}-${stableExecutionDigest(value).slice(0, 12)}`;
  }

  return stableExecutionDigest(value).slice(0, 32);
}

function parseCodexHookInput(
  stdin: string,
): SupportedCodexHookInput | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stdin);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || typeof parsed.hook_event_name !== "string") {
    return undefined;
  }

  if (!supportedHookEvents.has(parsed.hook_event_name)) {
    return undefined;
  }

  return parsed as unknown as SupportedCodexHookInput;
}

function codexMetadata(input: CodexHookInputBase): Metadata {
  return {
    codex: {
      ...(input.cwd !== undefined
        ? { cwdFingerprint: stableExecutionHash(input.cwd) }
        : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.permission_mode !== undefined
        ? { permissionMode: input.permission_mode }
        : {}),
      ...(input.session_id !== undefined
        ? { sessionId: input.session_id }
        : {}),
      ...(input.transcript_path !== undefined && input.transcript_path !== null
        ? {
            transcriptPathFingerprint: stableExecutionHash(
              input.transcript_path,
            ),
          }
        : {}),
      ...(input.turn_id !== undefined ? { turnId: input.turn_id } : {}),
    },
    sequence: {
      scope:
        input.turn_id === undefined
          ? "codex-turn-unknown"
          : codexRunId(input.turn_id),
    },
    source: {
      adapter: "codex-hooks",
      adapterVersion: CODEX_HOOK_ADAPTER_VERSION,
      hookEventName: input.hook_event_name,
    },
  };
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

function isErrorLikeToolResponse(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.error !== undefined ||
    value.is_error === true ||
    value.isError === true ||
    value.ok === false ||
    value.success === false
  ) {
    return true;
  }

  const exitCode =
    readNumberValue(value, "exit_code") ?? readNumberValue(value, "exitCode");

  if (exitCode !== undefined && exitCode !== 0) {
    return true;
  }

  const statusCode =
    readNumberValue(value, "status_code") ??
    readNumberValue(value, "statusCode");

  if (statusCode !== undefined && (statusCode < 200 || statusCode >= 400)) {
    return true;
  }

  const status =
    readStringValue(value, "status") ?? readStringValue(value, "conclusion");

  return (
    status === "error" ||
    status === "failed" ||
    status === "failure" ||
    status === "timed_out" ||
    status === "timeout"
  );
}

function readUnknown(
  input: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return input[key];
}

function readString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];

  return typeof value === "string" ? value : undefined;
}

function readBoolean(
  input: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const value = input[key];

  return typeof value === "boolean" ? value : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function readNumberValue(
  input: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = input[key];

  return typeof value === "number" ? value : undefined;
}

function readStringValue(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];

  return typeof value === "string" ? value : undefined;
}

function success(): CodexHookResult {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "",
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of processStdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const result = await runCodexHook(await readStdin());

  if (result.stdout !== "") {
    process.stdout.write(result.stdout);
  }

  if (result.stderr !== "") {
    process.stderr.write(result.stderr);
  }

  process.exitCode = result.exitCode;
}

function isCliEntrypoint(): boolean {
  const invokedPath = process.argv[1];

  if (invokedPath === undefined) {
    return false;
  }

  const modulePath = fileURLToPath(import.meta.url);

  try {
    return realpathSync(invokedPath) === realpathSync(modulePath);
  } catch {
    return resolve(invokedPath) === modulePath;
  }
}

if (isCliEntrypoint()) {
  main().catch(() => {
    process.exitCode = 0;
  });
}
