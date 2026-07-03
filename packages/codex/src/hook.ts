#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { stdin as processStdin } from "node:process";
import { isAbsolute, normalize, resolve } from "node:path";
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

const CODEX_FILE_PATH_FINGERPRINT_VERSION = "codex.file_path.v0";

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
  | "PermissionRequest"
  | "PostToolUse"
  | "PostCompact"
  | "PreCompact"
  | "PreToolUse"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
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
  "PermissionRequest",
  "PostCompact",
  "PostToolUse",
  "PreCompact",
  "PreToolUse",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "UserPromptSubmit",
]);

const filePathFieldByToolName = new Map<string, string>([
  ["Grep", "path"],
  ["Glob", "path"],
  ["LS", "path"],
  ["Read", "file_path"],
]);

const supportedBashReadPrefixTokens = [
  [".", "scripts/env", "&&"],
  ["source", "scripts/env", "&&"],
] as const;

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

  if (input.hook_event_name === "PermissionRequest") {
    if (!hasPermissionRequestSignal(input)) {
      return undefined;
    }

    const requestId =
      readString(input, "permission_request_id") ??
      readString(input, "request_id") ??
      readString(input, "tool_use_id");
    const permissionFingerprint = stableExecutionHash({
      hookEventName: input.hook_event_name,
      permissionRequest: permissionRequestFingerprintPayload(input),
    });
    const operationId = permissionRequestOperationId({
      permissionFingerprint,
      requestId,
    });
    const status = isDeniedPermissionRequest(input) ? "error" : "ok";

    return {
      version: EXECUTION_EVENT_VERSION,
      id: `codex:${safeIdentifier(input.turn_id)}:${operationId}`,
      lifecycle: "point",
      operation: {
        fingerprint: permissionFingerprint,
        id: operationId,
        kind: "permission_request",
        name: "Permission request",
      },
      artifacts: permissionRequestArtifacts(input, permissionFingerprint),
      metadata: {
        ...metadata,
        codex: {
          ...readRecord(metadata.codex),
          ...permissionRequestMetadata(input),
        },
      },
      runId,
      status,
    };
  }

  if (
    input.hook_event_name === "PreCompact" ||
    input.hook_event_name === "PostCompact"
  ) {
    if (!hasCompactSignal(input)) {
      return undefined;
    }

    const phase = input.hook_event_name === "PreCompact" ? "pre" : "post";
    const compactFingerprint = stableExecutionHash({
      hookEventName: input.hook_event_name,
      compact: compactFingerprintPayload(input),
    });
    const operationId = compactOperationId({
      compactFingerprint,
      compactId:
        readString(input, "compaction_id") ?? readString(input, "compact_id"),
    });

    return {
      version: EXECUTION_EVENT_VERSION,
      id: `codex:${safeIdentifier(input.turn_id)}:${operationId}:${phase}`,
      lifecycle: phase === "pre" ? "start" : "finish",
      operation: {
        fingerprint: compactFingerprint,
        id: operationId,
        kind: "context_compaction",
        name: "Context compaction",
      },
      artifacts: compactArtifacts(input, compactFingerprint, phase),
      metadata: {
        ...metadata,
        codex: {
          ...readRecord(metadata.codex),
          compactPhase: phase,
          ...compactMetadata(input),
        },
      },
      runId,
      ...(phase === "post" ? { status: "ok" } : {}),
    };
  }

  if (
    input.hook_event_name === "SubagentStart" ||
    input.hook_event_name === "SubagentStop"
  ) {
    if (!hasSubagentSignal(input)) {
      return undefined;
    }

    const phase = input.hook_event_name === "SubagentStart" ? "start" : "stop";
    const subagentFingerprint = stableExecutionHash({
      hookEventName: input.hook_event_name,
      subagent: subagentFingerprintPayload(input),
    });
    const operationId = subagentOperationId({
      subagentFingerprint,
      subagentId:
        readString(input, "subagent_id") ??
        readString(input, "agent_id") ??
        readString(input, "task_id"),
    });

    return {
      version: EXECUTION_EVENT_VERSION,
      id: `codex:${safeIdentifier(input.turn_id)}:${operationId}:${phase}`,
      lifecycle: phase === "start" ? "start" : "finish",
      operation: {
        fingerprint: subagentFingerprint,
        id: operationId,
        kind: "subagent",
        name: "Subagent work",
      },
      artifacts: subagentArtifacts(input),
      metadata: {
        ...metadata,
        codex: {
          ...readRecord(metadata.codex),
          subagentPhase: phase,
          workScope: "subagent",
          ...subagentMetadata(input),
        },
      },
      runId,
      ...(phase === "stop" ? { status: subagentStatus(input) } : {}),
    };
  }

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
    const filePathArtifacts = codexFilePathArtifacts({
      cwd: input.cwd,
      operationId,
      toolInput,
      toolName,
    });
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
          ...filePathArtifacts,
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
        ...filePathArtifacts,
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

function hasPermissionRequestSignal(
  input: Readonly<Record<string, unknown>>,
): boolean {
  return (
    readString(input, "approval_status") !== undefined ||
    readString(input, "approval_policy") !== undefined ||
    readString(input, "outcome") !== undefined ||
    readString(input, "reason") !== undefined ||
    readString(input, "permission_decision") !== undefined ||
    readString(input, "permission_request_id") !== undefined ||
    readString(input, "pause_reason") !== undefined ||
    readString(input, "request_id") !== undefined ||
    readString(input, "status") !== undefined ||
    readString(input, "sandbox_mode") !== undefined ||
    readUnknown(input, "sandbox_permissions") !== undefined ||
    readString(input, "tool_name") !== undefined ||
    readString(input, "tool_use_id") !== undefined ||
    readUnknown(input, "tool_input") !== undefined
  );
}

function hasCompactSignal(input: Readonly<Record<string, unknown>>): boolean {
  return (
    readString(input, "acceptance_criteria") !== undefined ||
    readString(input, "compact_id") !== undefined ||
    readString(input, "compaction_id") !== undefined ||
    readNumberValue(input, "context_window_percent") !== undefined ||
    readNumberValue(input, "input_tokens") !== undefined ||
    readString(input, "inspected_files_summary") !== undefined ||
    readString(input, "reason") !== undefined ||
    readString(input, "summary") !== undefined ||
    readNumberValue(input, "token_count") !== undefined ||
    readString(input, "trigger") !== undefined
  );
}

function hasSubagentSignal(input: Readonly<Record<string, unknown>>): boolean {
  return (
    readString(input, "agent_id") !== undefined ||
    readString(input, "agent_name") !== undefined ||
    readString(input, "delegated_prompt") !== undefined ||
    readString(input, "parent_session_id") !== undefined ||
    readString(input, "parent_turn_id") !== undefined ||
    readString(input, "prompt") !== undefined ||
    readString(input, "result") !== undefined ||
    readString(input, "status") !== undefined ||
    readString(input, "subagent_id") !== undefined ||
    readString(input, "task") !== undefined ||
    readString(input, "task_id") !== undefined ||
    readString(input, "transcript") !== undefined ||
    readUnknown(input, "tool_input") !== undefined ||
    readUnknown(input, "tool_response") !== undefined
  );
}

function subagentFingerprintPayload(
  input: Readonly<Record<string, unknown>>,
): unknown {
  return {
    agentId: readUnknown(input, "agent_id"),
    agentName: readUnknown(input, "agent_name"),
    delegatedPrompt:
      readUnknown(input, "delegated_prompt") ?? readUnknown(input, "prompt"),
    parentSessionId: readUnknown(input, "parent_session_id"),
    parentTurnId: readUnknown(input, "parent_turn_id"),
    result: readUnknown(input, "result"),
    status: readUnknown(input, "status"),
    subagentId: readUnknown(input, "subagent_id"),
    task: readUnknown(input, "task"),
    taskId: readUnknown(input, "task_id"),
    toolInput: readUnknown(input, "tool_input"),
    toolResponse: readUnknown(input, "tool_response"),
    transcript: readUnknown(input, "transcript"),
  };
}

function subagentOperationId(input: {
  readonly subagentFingerprint: string;
  readonly subagentId: string | undefined;
}): string {
  if (input.subagentId !== undefined && isSafeMetadataToken(input.subagentId)) {
    return `subagent-${safeIdentifier(input.subagentId)}`;
  }

  return `subagent-${stableExecutionDigest(input.subagentFingerprint).slice(0, 16)}`;
}

function subagentArtifacts(
  input: Readonly<Record<string, unknown>>,
): readonly Artifact[] {
  return [
    ...subagentStringArtifact(input, {
      fallbackSourceKey: "prompt",
      id: "subagent-delegated-prompt",
      kind: "delegated_prompt",
      reason:
        "Raw Codex delegated subagent prompt is not persisted by default.",
      sourceKey: "delegated_prompt",
    }),
    ...subagentStringArtifact(input, {
      id: "subagent-task",
      kind: "subagent_task",
      reason: "Raw Codex subagent task text is not persisted by default.",
      sourceKey: "task",
    }),
    ...subagentStringArtifact(input, {
      id: "subagent-result",
      kind: "subagent_result",
      reason: "Raw Codex subagent result text is not persisted by default.",
      sourceKey: "result",
    }),
    ...subagentStringArtifact(input, {
      id: "subagent-transcript",
      kind: "transcript",
      reason: "Raw Codex subagent transcript text is not persisted by default.",
      sourceKey: "transcript",
    }),
    ...subagentUnknownArtifact(input, {
      id: "subagent-tool-intent",
      kind: "tool_intent",
      reason: "Raw Codex subagent tool intent is not persisted by default.",
      sourceKey: "tool_input",
    }),
    ...subagentUnknownArtifact(input, {
      id: "subagent-tool-result",
      kind: "tool_result",
      reason: "Raw Codex subagent tool result is not persisted by default.",
      sourceKey: "tool_response",
    }),
  ];
}

function subagentStringArtifact(
  input: Readonly<Record<string, unknown>>,
  artifact: {
    readonly fallbackSourceKey?: string;
    readonly id: string;
    readonly kind: string;
    readonly reason: string;
    readonly sourceKey: string;
  },
): readonly Artifact[] {
  const value =
    readString(input, artifact.sourceKey) ??
    (artifact.fallbackSourceKey === undefined
      ? undefined
      : readString(input, artifact.fallbackSourceKey));

  if (value === undefined) {
    return [];
  }

  return [
    redactedArtifact({
      fingerprint: stableExecutionHash({
        [artifact.sourceKey]: value,
      }),
      id: artifact.id,
      kind: artifact.kind,
      reason: artifact.reason,
    }),
  ];
}

function subagentUnknownArtifact(
  input: Readonly<Record<string, unknown>>,
  artifact: {
    readonly id: string;
    readonly kind: string;
    readonly reason: string;
    readonly sourceKey: string;
  },
): readonly Artifact[] {
  const value = readUnknown(input, artifact.sourceKey);

  if (value === undefined) {
    return [];
  }

  return [
    redactedArtifact({
      fingerprint: stableExecutionHash({
        [artifact.sourceKey]: value,
      }),
      id: artifact.id,
      kind: artifact.kind,
      reason: artifact.reason,
    }),
  ];
}

function subagentMetadata(input: Readonly<Record<string, unknown>>): Metadata {
  return {
    ...safeMetadataString(input, "agent_id", "agentId"),
    ...safeMetadataString(input, "agent_name", "agentName"),
    ...safeMetadataString(input, "parent_session_id", "parentSessionId"),
    ...safeMetadataString(input, "parent_turn_id", "parentTurnId"),
    ...safeMetadataString(input, "status", "subagentStatus"),
    ...safeMetadataString(input, "subagent_id", "subagentId"),
    ...safeMetadataString(input, "task_id", "taskId"),
  };
}

function subagentStatus(
  input: Readonly<Record<string, unknown>>,
): Extract<ExecutionEvent["status"], "error" | "ok"> {
  const status = readString(input, "status")?.toLowerCase();

  return status === "error" ||
    status === "failed" ||
    status === "failure" ||
    status === "timeout" ||
    status === "timed_out"
    ? "error"
    : "ok";
}

function compactFingerprintPayload(
  input: Readonly<Record<string, unknown>>,
): unknown {
  return {
    acceptanceCriteria: readUnknown(input, "acceptance_criteria"),
    compactId: readUnknown(input, "compact_id"),
    compactionId: readUnknown(input, "compaction_id"),
    contextWindowPercent: readUnknown(input, "context_window_percent"),
    inputTokens: readUnknown(input, "input_tokens"),
    inspectedFilesSummary: readUnknown(input, "inspected_files_summary"),
    reason: readUnknown(input, "reason"),
    summary: readUnknown(input, "summary"),
    tokenCount: readUnknown(input, "token_count"),
    trigger: readUnknown(input, "trigger"),
  };
}

function compactOperationId(input: {
  readonly compactFingerprint: string;
  readonly compactId: string | undefined;
}): string {
  if (input.compactId !== undefined && isSafeMetadataToken(input.compactId)) {
    return `compaction-${safeIdentifier(input.compactId)}`;
  }

  return `compaction-${stableExecutionDigest(input.compactFingerprint).slice(0, 16)}`;
}

function compactArtifacts(
  input: Readonly<Record<string, unknown>>,
  compactFingerprint: string,
  phase: "post" | "pre",
): readonly Artifact[] {
  return [
    redactedArtifact({
      fingerprint: compactFingerprint,
      id: `compact-context-${phase}`,
      kind: "compact_context",
      reason: "Raw Codex compact hook payload is not persisted by default.",
    }),
    ...compactStringArtifact(input, {
      id: "compact-acceptance-criteria",
      kind: "acceptance_criteria",
      reason:
        "Raw Codex compact acceptance criteria are not persisted by default.",
      sourceKey: "acceptance_criteria",
    }),
    ...compactStringArtifact(input, {
      id: "compact-inspected-files-summary",
      kind: "inspected_files_summary",
      reason:
        "Raw Codex compact inspected-file summary is not persisted by default.",
      sourceKey: "inspected_files_summary",
    }),
    ...compactStringArtifact(input, {
      id: "compact-summary",
      kind: "summary",
      reason: "Raw Codex compact summary is not persisted by default.",
      sourceKey: "summary",
    }),
  ];
}

function compactStringArtifact(
  input: Readonly<Record<string, unknown>>,
  artifact: {
    readonly id: string;
    readonly kind: string;
    readonly reason: string;
    readonly sourceKey: string;
  },
): readonly Artifact[] {
  const value = readString(input, artifact.sourceKey);

  if (value === undefined) {
    return [];
  }

  return [
    redactedArtifact({
      fingerprint: stableExecutionHash({
        [artifact.sourceKey]: value,
      }),
      id: artifact.id,
      kind: artifact.kind,
      reason: artifact.reason,
    }),
  ];
}

function compactMetadata(input: Readonly<Record<string, unknown>>): Metadata {
  return {
    ...safeMetadataString(input, "compact_id", "compactId"),
    ...safeMetadataString(input, "compaction_id", "compactionId"),
    ...safeMetadataString(input, "trigger", "trigger"),
    ...numberMetadata(input, "context_window_percent", "contextWindowPercent"),
    ...numberMetadata(input, "input_tokens", "inputTokens"),
    ...numberMetadata(input, "token_count", "tokenCount"),
    ...(readString(input, "reason") !== undefined
      ? {
          reasonFingerprint: stableExecutionHash({
            reason: readString(input, "reason"),
          }),
        }
      : {}),
  };
}

function numberMetadata(
  input: Readonly<Record<string, unknown>>,
  sourceKey: string,
  metadataKey: string,
): Metadata {
  const value = readNumberValue(input, sourceKey);

  return value === undefined ? {} : { [metadataKey]: value };
}

function permissionRequestFingerprintPayload(
  input: Readonly<Record<string, unknown>>,
): unknown {
  return {
    approvalPolicy: readUnknown(input, "approval_policy"),
    approvalStatus: readUnknown(input, "approval_status"),
    outcome: readUnknown(input, "outcome"),
    pauseReason:
      readUnknown(input, "pause_reason") ?? readUnknown(input, "reason"),
    permissionDecision: readUnknown(input, "permission_decision"),
    permissionRequestId: readUnknown(input, "permission_request_id"),
    requestId: readUnknown(input, "request_id"),
    sandboxMode: readUnknown(input, "sandbox_mode"),
    sandboxPermissions: readUnknown(input, "sandbox_permissions"),
    status: readUnknown(input, "status"),
    toolInput: readUnknown(input, "tool_input"),
    toolName: readUnknown(input, "tool_name"),
    toolUseId: readUnknown(input, "tool_use_id"),
  };
}

function permissionRequestOperationId(input: {
  readonly permissionFingerprint: string;
  readonly requestId: string | undefined;
}): string {
  if (input.requestId !== undefined && isSafeMetadataToken(input.requestId)) {
    return `permission-${safeIdentifier(input.requestId)}`;
  }

  return `permission-${stableExecutionDigest(input.permissionFingerprint).slice(0, 16)}`;
}

function permissionRequestArtifacts(
  input: Readonly<Record<string, unknown>>,
  permissionFingerprint: string,
): readonly Artifact[] {
  const toolInput = readUnknown(input, "tool_input");
  const pauseReason =
    readString(input, "pause_reason") ?? readString(input, "reason");
  const artifacts: Artifact[] = [
    redactedArtifact({
      fingerprint: permissionFingerprint,
      id: "permission-request",
      kind: "permission_request",
      reason:
        "Raw Codex permission request payload is not persisted by default.",
    }),
  ];

  if (toolInput !== undefined) {
    artifacts.push(
      redactedArtifact({
        fingerprint: stableExecutionHash({
          toolInput,
          toolName: readString(input, "tool_name"),
        }),
        id: "permission-tool-intent",
        kind: "tool_intent",
        reason: "Raw Codex permission tool intent is not persisted by default.",
      }),
    );
  }

  if (pauseReason !== undefined) {
    artifacts.push(
      redactedArtifact({
        fingerprint: stableExecutionHash({ pauseReason }),
        id: "permission-pause-reason",
        kind: "pause_reason",
        reason:
          "Raw Codex permission pause reason is not persisted by default.",
      }),
    );
  }

  return artifacts;
}

function permissionRequestMetadata(
  input: Readonly<Record<string, unknown>>,
): Metadata {
  return {
    ...safeMetadataString(input, "approval_policy", "approvalPolicy"),
    ...safeMetadataString(input, "approval_status", "approvalStatus"),
    ...safeMetadataString(input, "outcome", "outcome"),
    ...safeMetadataString(input, "permission_decision", "permissionDecision"),
    ...safeMetadataString(
      input,
      "permission_request_id",
      "permissionRequestId",
    ),
    ...safeMetadataString(input, "request_id", "requestId"),
    ...safeMetadataString(input, "sandbox_mode", "sandboxMode"),
    ...safeMetadataString(input, "sandbox_permissions", "sandboxPermissions"),
    ...safeMetadataString(input, "status", "status"),
    ...safeMetadataString(input, "tool_name", "toolName"),
    ...safeMetadataString(input, "tool_use_id", "toolUseId"),
    ...(readString(input, "pause_reason") !== undefined ||
    readString(input, "reason") !== undefined
      ? {
          pauseReasonFingerprint: stableExecutionHash({
            pauseReason:
              readString(input, "pause_reason") ?? readString(input, "reason"),
          }),
        }
      : {}),
  };
}

function safeMetadataString(
  input: Readonly<Record<string, unknown>>,
  sourceKey: string,
  metadataKey: string,
): Metadata {
  const value = readString(input, sourceKey);

  if (value === undefined) {
    return {};
  }

  if (isSafeMetadataToken(value)) {
    return {
      [metadataKey]: value,
    };
  }

  return {
    [`${metadataKey}Fingerprint`]: stableExecutionHash(value),
  };
}

function isDeniedPermissionRequest(
  input: Readonly<Record<string, unknown>>,
): boolean {
  const values = [
    readString(input, "approval_status"),
    readString(input, "permission_decision"),
    readString(input, "status"),
    readString(input, "outcome"),
  ];

  return values.some((value) => {
    const normalized = value?.toLowerCase();

    return (
      normalized === "denied" ||
      normalized === "deny" ||
      normalized === "rejected" ||
      normalized === "reject" ||
      normalized === "blocked" ||
      normalized === "error" ||
      normalized === "failed" ||
      normalized === "failure"
    );
  });
}

function isSafeMetadataToken(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,96}$/u.test(value);
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

function codexFilePathArtifacts(input: {
  readonly cwd: string | undefined;
  readonly operationId: string;
  readonly toolInput: unknown;
  readonly toolName: string;
}): readonly Artifact[] {
  const observations = codexFilePathObservations(input);

  return observations.map((observation, index) =>
    codexFilePathArtifact({
      ...observation,
      operationId: input.operationId,
      toolName: input.toolName,
      ...(observations.length > 1 ? { sourceIndex: index + 1 } : {}),
    }),
  );
}

function codexFilePathObservations(input: {
  readonly cwd: string | undefined;
  readonly toolInput: unknown;
  readonly toolName: string;
}): readonly {
  readonly normalizedPath: string;
  readonly sourceCommand?: string;
  readonly sourceField: string;
}[] {
  if (!isRecord(input.toolInput)) {
    return [];
  }

  const sourceField = filePathFieldByToolName.get(input.toolName);

  if (sourceField !== undefined) {
    const normalizedPath = normalizeCodexFilePath(
      readStringValue(input.toolInput, sourceField),
      input.cwd,
    );

    return normalizedPath === undefined
      ? []
      : [
          {
            normalizedPath,
            sourceField,
          },
        ];
  }

  if (input.toolName !== "Bash") {
    return [];
  }

  return bashReadLikeFilePathObservations(
    readStringValue(input.toolInput, "command"),
    input.cwd,
  );
}

function codexFilePathArtifact(input: {
  readonly normalizedPath: string;
  readonly operationId: string;
  readonly sourceCommand?: string;
  readonly sourceField: string;
  readonly sourceIndex?: number;
  readonly toolName: string;
}): Artifact {
  return {
    fingerprint: stableExecutionHash({
      kind: CODEX_FILE_PATH_FINGERPRINT_VERSION,
      path: input.normalizedPath,
    }),
    id:
      input.sourceIndex === undefined
        ? `${input.operationId}-file-path`
        : `${input.operationId}-file-path-${input.sourceIndex}`,
    kind: "file",
    metadata: {
      codex: {
        fingerprintVersion: CODEX_FILE_PATH_FINGERPRINT_VERSION,
        ...(input.sourceCommand !== undefined
          ? { sourceCommand: input.sourceCommand }
          : {}),
        sourceField: input.sourceField,
        ...(input.sourceIndex !== undefined
          ? { sourceIndex: input.sourceIndex }
          : {}),
        toolName: input.toolName,
      },
      redaction: {
        mode: "omitted",
        reason: "Raw Codex file path is not persisted by default.",
      },
    },
  };
}

function bashReadLikeFilePathObservations(
  command: string | undefined,
  cwd: string | undefined,
): readonly {
  readonly normalizedPath: string;
  readonly sourceCommand: string;
  readonly sourceField: string;
}[] {
  const parsed = parseSupportedBashReadLikeCommand(command);

  if (parsed === undefined) {
    return [];
  }

  const normalizedPaths = uniqueStrings(
    parsed.pathTokens.flatMap((pathToken) => {
      const normalizedPath = normalizeCodexFilePath(pathToken, cwd);

      return normalizedPath === undefined ? [] : [normalizedPath];
    }),
  );

  return normalizedPaths.map((normalizedPath) => ({
    normalizedPath,
    sourceCommand: parsed.commandName,
    sourceField: "command",
  }));
}

function parseSupportedBashReadLikeCommand(
  command: string | undefined,
):
  | { readonly commandName: string; readonly pathTokens: readonly string[] }
  | undefined {
  if (command === undefined || command.trim() === "") {
    return undefined;
  }

  const tokens = parseShellWords(command);
  const readTokens = stripSupportedBashReadPrefix(tokens);

  if (readTokens.length === 0) {
    return undefined;
  }

  if (readTokens.some(isUnsafeShellToken)) {
    return undefined;
  }

  const commandName = readTokens[0];
  const args = readTokens.slice(1);
  let pathTokens: readonly string[] | undefined;

  switch (commandName) {
    case "cat":
      pathTokens = readOptionOnlyCommandPathTokens(args, {
        optionsWithValues: new Set(),
      });
      break;
    case "head":
    case "tail":
      pathTokens = readOptionOnlyCommandPathTokens(args, {
        optionsWithValues: new Set(["-c", "-n", "--bytes", "--lines"]),
      });
      break;
    case "nl":
      pathTokens = readOptionOnlyCommandPathTokens(args, {
        optionsWithValues: new Set(["-d", "-i", "-l", "-n", "-s", "-v", "-w"]),
      });
      break;
    case "sed":
      pathTokens = readSedCommandPathTokens(args);
      break;
    case "wc":
      pathTokens = readOptionOnlyCommandPathTokens(args, {
        optionsWithValues: new Set(["--files0-from"]),
      });
      break;
    default:
      return undefined;
  }

  if (pathTokens === undefined || pathTokens.length === 0) {
    return undefined;
  }

  if (!pathTokens.every(isSafeLiteralPathToken)) {
    return undefined;
  }

  return {
    commandName,
    pathTokens,
  };
}

function parseShellWords(command: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (const character of command.trim()) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/u.test(character)) {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (quote !== undefined) {
    return [];
  }

  if (current !== "") {
    tokens.push(current);
  }

  return tokens;
}

function stripSupportedBashReadPrefix(
  tokens: readonly string[],
): readonly string[] {
  for (const prefix of supportedBashReadPrefixTokens) {
    if (
      prefix.every((token, index) => tokens[index] === token) &&
      tokens.length > prefix.length
    ) {
      return tokens.slice(prefix.length);
    }
  }

  return tokens;
}

function readOptionOnlyCommandPathTokens(
  args: readonly string[],
  options: {
    readonly optionsWithValues: ReadonlySet<string>;
  },
): readonly string[] | undefined {
  const paths: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      return undefined;
    }

    if (arg === "--") {
      paths.push(...args.slice(index + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const optionName = arg.split("=", 1)[0];

      if (
        optionName !== undefined &&
        options.optionsWithValues.has(optionName) &&
        !arg.includes("=")
      ) {
        index += 1;
      }

      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      if (options.optionsWithValues.has(arg)) {
        index += 1;
      }

      continue;
    }

    paths.push(arg);
  }

  return paths;
}

function readSedCommandPathTokens(
  args: readonly string[],
): readonly string[] | undefined {
  const paths: string[] = [];
  let hasScript = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined) {
      return undefined;
    }

    if (arg === "--") {
      if (!hasScript) {
        return undefined;
      }

      paths.push(...args.slice(index + 1));
      break;
    }

    if (!hasScript && (arg === "-n" || arg === "-E" || arg === "-r")) {
      continue;
    }

    if (!hasScript && (arg === "-e" || arg === "--expression")) {
      if (args[index + 1] === undefined) {
        return undefined;
      }

      hasScript = true;
      index += 1;
      continue;
    }

    if (!hasScript && arg.startsWith("-e") && arg.length > 2) {
      hasScript = true;
      continue;
    }

    if (!hasScript && arg.startsWith("-")) {
      return undefined;
    }

    if (!hasScript) {
      hasScript = true;
      continue;
    }

    paths.push(arg);
  }

  return hasScript ? paths : undefined;
}

function isUnsafeShellToken(token: string): boolean {
  return /[\n\r\0|&;<>`$(){}\\]/u.test(token);
}

function isSafeLiteralPathToken(token: string): boolean {
  return (
    token !== "" &&
    token !== "-" &&
    token !== "." &&
    token !== ".." &&
    !token.startsWith("-") &&
    !token.includes("://") &&
    !/[*?[\]{}]/u.test(token)
  );
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function normalizeCodexFilePath(
  value: string | undefined,
  cwd: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return undefined;
  }

  if (isAbsolute(trimmed)) {
    return normalize(trimmed);
  }

  const trimmedCwd = cwd?.trim();

  if (trimmedCwd === undefined || trimmedCwd === "") {
    return normalize(trimmed);
  }

  return normalize(resolve(trimmedCwd, trimmed));
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
