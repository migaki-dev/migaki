import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createExecutionAdviceGraphCandidate,
  createExecutionAdviceGraphCandidateSelection,
  executionAdviceGraphCandidateSkipReasons,
  isSmokeHarnessExecutionRun,
  isSmokeExecutionRunId,
  isTurnExecutionRunId,
  MIGAKI_SMOKE_REAL_TURN_MARKER,
  sortExecutionAdviceGraphCandidatesByModifiedTime,
  type ExecutionAdviceGraphCandidate,
  type ExecutionAdviceGraphCandidateSelection,
  type ExecutionAdviceGraphCandidateSkipReason,
} from "./execution-advice.js";

export interface DogfoodDoctorReportOptions {
  readonly bridgeRunId?: string;
  readonly codexConfigPath?: string;
  readonly hookConfigPath: string;
  readonly hookEntrypointPath: string;
  readonly includeSmoke?: boolean;
  readonly maxRealAgeMs?: number;
  readonly nowMs?: number;
  readonly runsDirectory: string;
  readonly strict?: boolean;
}

export interface DogfoodReadinessEvaluation {
  readonly mode: "bridge-active" | "bridge-required" | "organic-native";
  readonly ok: boolean;
  readonly report: string;
}

interface ReadCandidatesResult {
  readonly candidates: readonly ExecutionAdviceGraphCandidate[];
  readonly unreadableGraphs: number;
}

interface NamedCount {
  readonly count: number;
  readonly name: string;
}

interface HookCoverage {
  readonly eventCount: number;
  readonly eventLogStatus: "missing" | "ok";
  readonly hookEventCounts: readonly NamedCount[];
  readonly sourceAdapterCounts: readonly NamedCount[];
  readonly toolFinishCount: number;
  readonly toolStartCount: number;
  readonly turnCompletionCount: number;
  readonly unreadableLineCount: number;
}

interface HookConfigInspection {
  readonly expectedCommandCount: number;
  readonly fingerprint?: string;
  readonly hookCommandCount: number;
  readonly missingRequiredEvents: readonly string[];
  readonly registeredEvents: readonly string[];
  readonly status: "missing" | "ok" | "unreadable";
  readonly unexpectedCommandCount: number;
}

interface HookTrustInspection {
  readonly matchingRecordCount: number;
  readonly missingRequiredEvents: readonly string[];
  readonly status: "missing" | "ok" | "unreadable";
  readonly trustedRequiredEvents: readonly string[];
}

interface NativeCompleteTurn {
  readonly candidate: ExecutionAdviceGraphCandidate;
  readonly coverage: HookCoverage;
}

interface HookProbeTurn {
  readonly candidate: ExecutionAdviceGraphCandidate;
  readonly coverage: HookCoverage;
}

interface SmokeHarnessTurn {
  readonly candidate: ExecutionAdviceGraphCandidate;
  readonly coverage: HookCoverage;
}

interface RecentRealTurn {
  readonly candidate: ExecutionAdviceGraphCandidate;
  readonly coverage: HookCoverage;
}

interface DogfoodDoctorInspection {
  readonly candidates: readonly ExecutionAdviceGraphCandidate[];
  readonly hookTrustInspection?: HookTrustInspection;
  readonly hookConfigExists: boolean;
  readonly hookConfigInspection: HookConfigInspection;
  readonly hookEntrypointExists: boolean;
  readonly latestHookProbeTurn?: HookProbeTurn;
  readonly latestNativeCompleteTurn?: NativeCompleteTurn;
  readonly latestSmokeHarnessTurn?: SmokeHarnessTurn;
  readonly latestTurn?: ExecutionAdviceGraphCandidate;
  readonly latestTurnHookCoverage?: HookCoverage;
  readonly nowMs: number;
  readonly readCandidatesResult: ReadCandidatesResult;
  readonly recentRealTurns: readonly RecentRealTurn[];
  readonly selection: ExecutionAdviceGraphCandidateSelection;
}

interface StrictEvaluation {
  readonly failures: readonly string[];
  readonly ok: boolean;
}

interface BridgeEvidence {
  readonly candidate?: ExecutionAdviceGraphCandidate;
  readonly coverage?: HookCoverage;
  readonly isActive: boolean;
  readonly isFresh: boolean;
  readonly runId: string;
}

const hookProbeRunIdPattern = /^codex-turn-migaki-smoke-hook-probe-/u;
const recentRealTurnLimit = 5;
const expectedHookCommand =
  'node "$(git rev-parse --show-toplevel)/packages/codex/dist/hook.js"';
const expectedHookCommands = new Set([
  expectedHookCommand,
  `MIGAKI_CODEX_LOCAL_CONTEXT=1 ${expectedHookCommand}`,
]);
const requiredDogfoodHookEvents = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
] as const;

const hookEventDisplayOrder = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "Stop",
] as const;

export function createDogfoodDoctorReport(
  options: DogfoodDoctorReportOptions,
): string {
  const inspection = inspectDogfoodDoctor(options);
  const {
    candidates,
    hookConfigExists,
    hookConfigInspection,
    hookEntrypointExists,
    hookTrustInspection,
    latestHookProbeTurn,
    latestNativeCompleteTurn,
    latestSmokeHarnessTurn,
    latestTurn,
    latestTurnHookCoverage,
    nowMs,
    readCandidatesResult,
    recentRealTurns,
    selection,
  } = inspection;
  const strictOptions = strictEvaluationOptions(options.maxRealAgeMs);
  const strictEvaluation =
    options.strict === true
      ? evaluateStrictDogfoodDoctor(inspection, strictOptions)
      : undefined;
  const bridgeEvidence = inspectBridgeEvidence(inspection, options);
  const selectedAdviceCandidate = selectDoctorAdviceCandidate(
    selection,
    options,
  );
  const lines: string[] = [
    "# Migaki Dogfood Doctor",
    "",
    "Paths:",
    `- Runs directory: ${existsSync(options.runsDirectory) ? "found" : "missing"}`,
    `- Hook config: ${hookConfigExists ? "found" : "missing"}`,
    `- Hook entrypoint: ${hookEntrypointExists ? "found" : "missing"}`,
    "",
    "Advice Candidate:",
  ];

  if (selectedAdviceCandidate === undefined) {
    lines.push("- Selected: none");
  } else {
    lines.push(`- Selected: ${formatCandidate(selectedAdviceCandidate)}`);
    lines.push(
      `- Selected updated: ${formatCandidateRecency(selectedAdviceCandidate, nowMs)}`,
    );
    lines.push(`- Graph: ${selectedAdviceCandidate.graphPath}`);

    const selectionNote = formatDoctorAdviceSelectionNote({
      selected: selectedAdviceCandidate,
      ...(options.bridgeRunId !== undefined
        ? { bridgeRunId: options.bridgeRunId }
        : {}),
      ...(latestTurn !== undefined ? { latestTurn } : {}),
    });

    if (selectionNote !== undefined) {
      lines.push(`- Selection note: ${selectionNote}`);
    }
  }

  lines.push(
    "",
    "Candidate Scan:",
    `- Graphs read: ${candidates.length}`,
    `- Unreadable graphs: ${readCandidatesResult.unreadableGraphs}`,
    `- Eligible by default: ${selection.eligibleCandidates.length}`,
    `- Skipped smoke: ${countSkipReason(selection, "smoke_run")}`,
    `- Skipped smoke-harness: ${countSkipReason(selection, "smoke_harness_run")}`,
    `- Skipped session-boundary: ${countSkipReason(selection, "session_run")}`,
    `- Skipped running: ${countSkipReason(selection, "running_run")}`,
    "",
    "Latest Turn Signal:",
  );

  if (latestTurn === undefined) {
    lines.push(
      "- Status: missing",
      "- Detail: no organic non-smoke codex-turn graph was found.",
    );
  } else {
    const skipReasons = executionAdviceGraphCandidateSkipReasons(latestTurn, {
      includeSmoke: options.includeSmoke === true,
    });

    lines.push(
      `- Latest turn: ${formatCandidate(latestTurn)}`,
      `- Latest turn updated: ${formatCandidateRecency(latestTurn, nowMs)}`,
      `- Advice eligibility: ${
        skipReasons.length === 0
          ? "eligible"
          : `skipped (${skipReasons.join(", ")})`
      }`,
      `- Tool observability: ${formatToolObservability(latestTurn)}`,
    );
  }

  lines.push("", "Hook Coverage:");
  lines.push(...formatHookCoverageLines(latestTurn, latestTurnHookCoverage));
  lines.push("", "Hook Config:");
  lines.push(...formatHookConfigLines(hookConfigInspection));
  if (hookTrustInspection !== undefined) {
    lines.push("", "Codex Hook Trust:");
    lines.push(...formatHookTrustLines(hookTrustInspection));
  }
  lines.push("", "Hook Probe:");
  lines.push(...formatHookProbeLines(latestHookProbeTurn, nowMs));
  lines.push("", "Smoke Harness:");
  lines.push(...formatSmokeHarnessLines(latestSmokeHarnessTurn, nowMs));
  lines.push("", "Native Baseline:");
  lines.push(...formatNativeBaselineLines(latestNativeCompleteTurn, nowMs));
  lines.push("", "Recent Organic Turns:");
  lines.push(...formatRecentRealTurnSummaryLines(recentRealTurns));
  lines.push(...formatRecentRealTurnLines(recentRealTurns, nowMs));

  if (strictEvaluation !== undefined) {
    lines.push("", "Strict Verification:");
    lines.push(...formatStrictEvaluationLines(strictEvaluation));
  }

  const desktopVerificationLines = formatDesktopVerificationLines({
    hookConfigExists,
    hookConfigInspection,
    hookEntrypointExists,
    hookTrustInspection,
    latestHookProbeTurn,
    latestTurn,
    latestTurnHookCoverage,
    maxRealAgeMs: options.maxRealAgeMs,
    nowMs,
  });

  if (desktopVerificationLines.length > 0) {
    lines.push("", "Desktop Verification:");
    lines.push(...desktopVerificationLines);
  }

  const surfaceRealityLines = formatSurfaceRealityLines({
    latestHookProbeTurn,
    latestSmokeHarnessTurn,
    latestTurn,
    latestTurnHookCoverage,
    maxRealAgeMs: options.maxRealAgeMs,
    nowMs,
  });

  if (surfaceRealityLines.length > 0) {
    lines.push("", "Surface Reality:");
    lines.push(...surfaceRealityLines);
  }

  lines.push("", "Bridge Evidence:");
  lines.push(...formatBridgeEvidenceLines(bridgeEvidence, nowMs));

  lines.push(
    "",
    "Next Practical Move:",
    nextPracticalMove({
      hookConfigExists,
      hookConfigInspection,
      hookCoverage: latestTurnHookCoverage,
      hookEntrypointExists,
      hookTrustInspection,
      latestHookProbeTurn,
      latestNativeCompleteTurn,
      latestTurn,
      selected: selectedAdviceCandidate,
    }),
    "",
  );

  return lines.join("\n");
}

function selectDoctorAdviceCandidate(
  selection: ExecutionAdviceGraphCandidateSelection,
  options: DogfoodDoctorReportOptions,
): ExecutionAdviceGraphCandidate | undefined {
  const bridgeRunId = options.bridgeRunId;

  if (bridgeRunId === undefined) {
    return selection.selected;
  }

  return (
    selection.eligibleCandidates.find(
      (candidate) => candidate.runId === bridgeRunId,
    ) ?? selection.selected
  );
}

function formatDoctorAdviceSelectionNote(input: {
  readonly bridgeRunId?: string;
  readonly latestTurn?: ExecutionAdviceGraphCandidate;
  readonly selected: ExecutionAdviceGraphCandidate;
}): string | undefined {
  if (
    input.bridgeRunId !== undefined &&
    input.selected.runId === input.bridgeRunId &&
    input.latestTurn?.runId !== input.selected.runId
  ) {
    return "selected advice is the requested bridge run; strict organic dogfood status is reported separately below.";
  }

  return formatAdviceSelectionNote(input.selected, input.latestTurn);
}

export function createDogfoodAdviceStatus(
  options: DogfoodDoctorReportOptions,
): string | undefined {
  const inspection = inspectDogfoodDoctor(options);
  const surfaceRealityLines = formatSurfaceRealityLines({
    latestHookProbeTurn: inspection.latestHookProbeTurn,
    latestSmokeHarnessTurn: inspection.latestSmokeHarnessTurn,
    latestTurn: inspection.latestTurn,
    latestTurnHookCoverage: inspection.latestTurnHookCoverage,
    maxRealAgeMs: options.maxRealAgeMs,
    nowMs: inspection.nowMs,
  });

  if (surfaceRealityLines.length === 0) {
    return undefined;
  }

  const bridgeEvidence = inspectBridgeEvidence(inspection, options);
  const bridgeCommandPattern = formatBridgeCommandPattern(bridgeEvidence.runId);

  return [
    "Dogfood Status:",
    `- Mode: ${bridgeEvidence.isActive ? "bridge-active" : "bridge-required"}.`,
    ...surfaceRealityLines,
    ...(bridgeEvidence.candidate !== undefined &&
    bridgeEvidence.coverage !== undefined
      ? [
          formatBridgeProofLine(
            bridgeEvidence.candidate,
            bridgeEvidence.coverage,
            inspection.nowMs,
          ),
        ]
      : []),
    `- Bridge run id: \`${bridgeEvidence.runId}\`.`,
    `- Command pattern: run shell work through \`${bridgeCommandPattern}\` until native app hooks appear.`,
    formatBridgeShellSetupPattern(bridgeEvidence.runId),
    formatBridgeDiagnosticPattern(bridgeEvidence.runId),
    "",
  ].join("\n");
}

function formatBridgeEvidenceLines(
  bridgeEvidence: BridgeEvidence,
  nowMs: number,
): readonly string[] {
  const lines = [
    `- Mode: ${bridgeEvidence.isActive ? "bridge-active" : "bridge-required"}`,
    ...(bridgeEvidence.candidate !== undefined &&
    bridgeEvidence.coverage !== undefined
      ? [
          formatBridgeProofLine(
            bridgeEvidence.candidate,
            bridgeEvidence.coverage,
            nowMs,
          ),
        ]
      : [`- Bridge run id: \`${bridgeEvidence.runId}\``]),
    `- Result: ${formatBridgeEvidenceResult(bridgeEvidence, nowMs)}`,
    `- Command pattern: run shell work through \`${formatBridgeCommandPattern(
      bridgeEvidence.runId,
    )}\` until native app hooks appear.`,
    formatBridgeShellSetupPattern(bridgeEvidence.runId),
    formatBridgeDiagnosticPattern(bridgeEvidence.runId),
  ];

  return lines;
}

function formatBridgeEvidenceResult(
  bridgeEvidence: BridgeEvidence,
  nowMs: number,
): string {
  const candidate = bridgeEvidence.candidate;
  const coverage = bridgeEvidence.coverage;

  if (bridgeEvidence.isActive) {
    return "ok: bridge evidence is fresh, completed, and manual-exec-backed.";
  }

  if (candidate === undefined) {
    return "missing: no graph exists for this bridge run.";
  }

  if (!bridgeEvidence.isFresh) {
    return `stale: bridge graph is ${formatDurationMs(
      nowMs - candidate.modifiedAtMs,
    )} old.`;
  }

  if (candidate.status !== "ok") {
    return `inactive: bridge graph status is ${candidate.status ?? "unknown"}.`;
  }

  if ((candidate.toolCalls ?? 0) === 0) {
    return "inactive: bridge graph has no recorded command evidence.";
  }

  if (coverage === undefined || coverage.eventLogStatus !== "ok") {
    return "inactive: bridge event log is missing or unreadable.";
  }

  if (!hasSourceAdapter(coverage, "manual-exec")) {
    return "inactive: bridge graph is not manual-exec-backed.";
  }

  return "inactive: bridge evidence did not satisfy the ready gate.";
}

function formatBridgeCommandPattern(runId: string): string {
  return runId === "codex-app-bridge"
    ? "mise run migaki:bridge -- -- <command> [args...]"
    : `mise run migaki:bridge -- --run ${formatShellSingleQuoted(runId)} -- <command> [args...]`;
}

function formatBridgeShellSetupPattern(runId: string): string {
  return `- Shell setup: run \`eval "$(mise run migaki:bridge-session -- --shell --run ${formatShellSingleQuoted(runId)})"\`, then \`mgb <command> [args...]\`.`;
}

function formatShellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatBridgeDiagnosticPattern(runId: string): string {
  const quotedRunId = formatShellSingleQuoted(runId);

  return `- Diagnostic pattern: run \`export MIGAKI_BRIDGE_RUN_ID=${quotedRunId}\` once, or pass \`--bridge-run ${quotedRunId}\` to migaki:advise, migaki:ready, migaki:doctor, and migaki:dogfood.`;
}

export function evaluateDogfoodReadiness(
  options: DogfoodDoctorReportOptions,
): DogfoodReadinessEvaluation {
  const inspection = inspectDogfoodDoctor(options);
  const strictEvaluation = evaluateStrictDogfoodDoctor(
    inspection,
    strictEvaluationOptions(options.maxRealAgeMs),
  );
  const bridgeEvidence = inspectBridgeEvidence(inspection, options);

  if (strictEvaluation.ok) {
    return createReadinessEvaluation({
      lines: [
        "# Migaki Ready Gate",
        "",
        "- Result: ok",
        "- Mode: organic-native",
        "- Strict dogfood: ok",
        "- Bridge: not required",
      ],
      mode: "organic-native",
      ok: true,
    });
  }

  if (bridgeEvidence.isActive) {
    return createReadinessEvaluation({
      lines: [
        "# Migaki Ready Gate",
        "",
        "- Result: ok",
        "- Mode: bridge-active",
        "- Strict dogfood: failed",
        ...strictEvaluation.failures.map(
          (failure) => `- Strict failure: ${failure}`,
        ),
        ...(bridgeEvidence.candidate !== undefined &&
        bridgeEvidence.coverage !== undefined
          ? [
              formatBridgeProofLine(
                bridgeEvidence.candidate,
                bridgeEvidence.coverage,
                inspection.nowMs,
              ),
            ]
          : []),
        formatBridgeShellSetupPattern(bridgeEvidence.runId),
        formatBridgeDiagnosticPattern(bridgeEvidence.runId),
        "- Note: strict migaki:dogfood still requires fresh organic native hooks.",
      ],
      mode: "bridge-active",
      ok: true,
    });
  }

  return createReadinessEvaluation({
    lines: [
      "# Migaki Ready Gate",
      "",
      "- Result: failed",
      "- Mode: bridge-required",
      "- Strict dogfood: failed",
      ...strictEvaluation.failures.map(
        (failure) => `- Strict failure: ${failure}`,
      ),
      `- Bridge run id: \`${bridgeEvidence.runId}\``,
      "- Bridge: missing, stale, failed, or has no recorded command evidence.",
      `- Next: run \`${formatBridgeCommandPattern(bridgeEvidence.runId)}\`, then rerun this gate.`,
      formatBridgeShellSetupPattern(bridgeEvidence.runId),
      formatBridgeDiagnosticPattern(bridgeEvidence.runId),
    ],
    mode: "bridge-required",
    ok: false,
  });
}

function createReadinessEvaluation(input: {
  readonly lines: readonly string[];
  readonly mode: DogfoodReadinessEvaluation["mode"];
  readonly ok: boolean;
}): DogfoodReadinessEvaluation {
  return {
    mode: input.mode,
    ok: input.ok,
    report: `${input.lines.join("\n")}\n`,
  };
}

function inspectBridgeEvidence(
  inspection: DogfoodDoctorInspection,
  options: DogfoodDoctorReportOptions,
): BridgeEvidence {
  const runId = options.bridgeRunId ?? "codex-app-bridge";
  const candidate = inspection.candidates.find(
    (graphCandidate) => graphCandidate.runId === runId,
  );
  const coverage =
    candidate === undefined ? undefined : readHookCoverage(candidate);
  const isFresh =
    candidate !== undefined &&
    (options.maxRealAgeMs === undefined ||
      inspection.nowMs - candidate.modifiedAtMs <= options.maxRealAgeMs);
  const isActive =
    candidate !== undefined &&
    coverage !== undefined &&
    candidate.status === "ok" &&
    (candidate.toolCalls ?? 0) > 0 &&
    coverage.eventLogStatus === "ok" &&
    hasSourceAdapter(coverage, "manual-exec") &&
    isFresh;

  return {
    ...(candidate !== undefined ? { candidate } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
    isActive,
    isFresh,
    runId,
  };
}

function inspectDogfoodDoctor(
  options: DogfoodDoctorReportOptions,
): DogfoodDoctorInspection {
  const includeSmoke = options.includeSmoke === true;
  const nowMs = options.nowMs ?? Date.now();
  const readCandidatesResult = readCandidates(options.runsDirectory);
  const candidates = readCandidatesResult.candidates;
  const selection = createExecutionAdviceGraphCandidateSelection(candidates, {
    includeSmoke,
  });
  const turnCandidates = sortExecutionAdviceGraphCandidatesByModifiedTime(
    candidates.filter(
      (candidate) =>
        isTurnExecutionRunId(candidate.runId) &&
        (includeSmoke ||
          (!isSmokeExecutionRunId(candidate.runId) &&
            !isSmokeHarnessExecutionRun(candidate))),
    ),
  );
  const hookCoverageByRunId = new Map<string, HookCoverage>();
  const hookCoverageFor = (
    candidate: ExecutionAdviceGraphCandidate,
  ): HookCoverage => {
    const existing = hookCoverageByRunId.get(candidate.runId);

    if (existing !== undefined) {
      return existing;
    }

    const coverage = readHookCoverage(candidate);

    hookCoverageByRunId.set(candidate.runId, coverage);

    return coverage;
  };
  const latestTurn = turnCandidates[0];
  const latestTurnHookCoverage =
    latestTurn === undefined ? undefined : hookCoverageFor(latestTurn);
  const latestNativeCompleteTurn = findLatestNativeCompleteTurn(
    turnCandidates,
    hookCoverageFor,
  );
  const latestHookProbeTurn = findLatestHookProbeTurn(
    candidates,
    hookCoverageFor,
  );
  const latestSmokeHarnessTurn = findLatestSmokeHarnessTurn(
    candidates,
    hookCoverageFor,
  );
  const recentRealTurns = turnCandidates
    .slice(0, recentRealTurnLimit)
    .map((candidate) => ({
      candidate,
      coverage: hookCoverageFor(candidate),
    }));
  const hookConfigInspection = inspectHookConfig(options.hookConfigPath);
  const hookTrustInspection =
    options.codexConfigPath === undefined
      ? undefined
      : inspectHookTrustState({
          codexConfigPath: options.codexConfigPath,
          hookConfigPath: options.hookConfigPath,
        });

  return {
    candidates,
    hookConfigExists: existsSync(options.hookConfigPath),
    hookConfigInspection,
    hookEntrypointExists: existsSync(options.hookEntrypointPath),
    ...(hookTrustInspection !== undefined ? { hookTrustInspection } : {}),
    ...(latestHookProbeTurn !== undefined ? { latestHookProbeTurn } : {}),
    ...(latestNativeCompleteTurn !== undefined
      ? { latestNativeCompleteTurn }
      : {}),
    ...(latestSmokeHarnessTurn !== undefined ? { latestSmokeHarnessTurn } : {}),
    ...(latestTurn !== undefined ? { latestTurn } : {}),
    ...(latestTurnHookCoverage !== undefined ? { latestTurnHookCoverage } : {}),
    nowMs,
    readCandidatesResult,
    recentRealTurns,
    selection,
  };
}

function findLatestHookProbeTurn(
  candidates: readonly ExecutionAdviceGraphCandidate[],
  hookCoverageFor: (candidate: ExecutionAdviceGraphCandidate) => HookCoverage,
): HookProbeTurn | undefined {
  const latestHookProbeCandidate =
    sortExecutionAdviceGraphCandidatesByModifiedTime(
      candidates.filter((candidate) =>
        hookProbeRunIdPattern.test(candidate.runId),
      ),
    )[0];

  if (latestHookProbeCandidate === undefined) {
    return undefined;
  }

  return {
    candidate: latestHookProbeCandidate,
    coverage: hookCoverageFor(latestHookProbeCandidate),
  };
}

function findLatestSmokeHarnessTurn(
  candidates: readonly ExecutionAdviceGraphCandidate[],
  hookCoverageFor: (candidate: ExecutionAdviceGraphCandidate) => HookCoverage,
): SmokeHarnessTurn | undefined {
  const latestSmokeHarnessCandidate =
    sortExecutionAdviceGraphCandidatesByModifiedTime(
      candidates.filter((candidate) => isSmokeHarnessExecutionRun(candidate)),
    )[0];

  if (latestSmokeHarnessCandidate === undefined) {
    return undefined;
  }

  return {
    candidate: latestSmokeHarnessCandidate,
    coverage: hookCoverageFor(latestSmokeHarnessCandidate),
  };
}

function findLatestNativeCompleteTurn(
  turnCandidates: readonly ExecutionAdviceGraphCandidate[],
  hookCoverageFor: (candidate: ExecutionAdviceGraphCandidate) => HookCoverage,
): NativeCompleteTurn | undefined {
  for (const candidate of turnCandidates) {
    if (candidate.status === "running" || (candidate.toolCalls ?? 0) === 0) {
      continue;
    }

    const coverage = hookCoverageFor(candidate);

    if (isNativeHookCoverageComplete(candidate, coverage)) {
      return {
        candidate,
        coverage,
      };
    }
  }

  return undefined;
}

export function runDogfoodDoctorCli(args: readonly string[]): number {
  const [
    runsDirectory,
    hookConfigPath,
    hookEntrypointPath,
    includeSmoke,
    strict,
    maxRealAgeMinutes,
    codexConfigPath,
    bridgeRunId,
  ] = args;

  if (
    runsDirectory === undefined ||
    hookConfigPath === undefined ||
    hookEntrypointPath === undefined
  ) {
    throw new Error(
      "runs directory, hook config, and hook entrypoint are required",
    );
  }

  const maxRealAgeMs = parseMaxRealAgeMs(maxRealAgeMinutes);

  process.stdout.write(
    createDogfoodDoctorReport({
      ...(bridgeRunId !== undefined && bridgeRunId !== ""
        ? { bridgeRunId }
        : {}),
      hookConfigPath,
      hookEntrypointPath,
      includeSmoke: includeSmoke === "1",
      ...(codexConfigPath !== undefined && codexConfigPath !== ""
        ? { codexConfigPath }
        : {}),
      ...(maxRealAgeMs !== undefined ? { maxRealAgeMs } : {}),
      runsDirectory,
      strict: strict === "1",
    }),
  );

  if (strict !== "1") {
    return 0;
  }

  return evaluateStrictDogfoodDoctor(
    inspectDogfoodDoctor({
      hookConfigPath,
      hookEntrypointPath,
      includeSmoke: includeSmoke === "1",
      ...(codexConfigPath !== undefined && codexConfigPath !== ""
        ? { codexConfigPath }
        : {}),
      runsDirectory,
    }),
    strictEvaluationOptions(maxRealAgeMs),
  ).ok
    ? 0
    : 1;
}

function readCandidates(directory: string): ReadCandidatesResult {
  if (!existsSync(directory)) {
    return {
      candidates: [],
      unreadableGraphs: 0,
    };
  }

  let unreadableGraphs = 0;
  const candidates = readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry) => {
      if (!entry.isDirectory()) {
        return [];
      }

      const graphPath = join(directory, entry.name, "graph.json");

      if (!existsSync(graphPath)) {
        return [];
      }

      try {
        const graph = JSON.parse(readFileSync(graphPath, "utf8")) as unknown;
        const runDirectory = join(directory, entry.name);

        return [
          createExecutionAdviceGraphCandidate({
            graph,
            graphPath,
            modifiedAtMs: statSync(graphPath).mtimeMs,
            runId: entry.name,
            smokeHarness: existsSync(
              join(runDirectory, MIGAKI_SMOKE_REAL_TURN_MARKER),
            ),
          }),
        ];
      } catch {
        unreadableGraphs += 1;
        return [];
      }
    },
  );

  return {
    candidates,
    unreadableGraphs,
  };
}

function readHookCoverage(
  candidate: ExecutionAdviceGraphCandidate,
): HookCoverage {
  const eventsPath = join(dirname(candidate.graphPath), "events.jsonl");

  if (!existsSync(eventsPath)) {
    return {
      eventCount: 0,
      eventLogStatus: "missing",
      hookEventCounts: [],
      sourceAdapterCounts: [],
      toolFinishCount: 0,
      toolStartCount: 0,
      turnCompletionCount: 0,
      unreadableLineCount: 0,
    };
  }

  const hookEventCounts = new Map<string, number>();
  const sourceAdapterCounts = new Map<string, number>();
  let eventCount = 0;
  let toolFinishCount = 0;
  let toolStartCount = 0;
  let turnCompletionCount = 0;
  let unreadableLineCount = 0;

  for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      unreadableLineCount += 1;
      continue;
    }

    if (!isRecord(parsed)) {
      unreadableLineCount += 1;
      continue;
    }

    eventCount += 1;

    const metadata = readRecord(parsed.metadata);
    const source = readRecord(metadata.source);
    const codex = readRecord(metadata.codex);
    const hookEventName =
      readString(source, "hookEventName") ?? readString(codex, "hookEventName");
    const sourceAdapter = readString(source, "adapter");
    const operation = readRecord(parsed.operation);
    const operationKind = readString(operation, "kind");
    const lifecycle = readString(parsed, "lifecycle");

    if (hookEventName !== undefined) {
      incrementCount(hookEventCounts, hookEventName);
    }

    if (sourceAdapter !== undefined) {
      incrementCount(sourceAdapterCounts, sourceAdapter);
    }

    if (operationKind === "tool_call" && lifecycle === "start") {
      toolStartCount += 1;
    }

    if (operationKind === "tool_call" && lifecycle === "finish") {
      toolFinishCount += 1;
    }

    if (operationKind === "turn") {
      turnCompletionCount += 1;
    }
  }

  return {
    eventCount,
    eventLogStatus: "ok",
    hookEventCounts: sortHookEventCounts(hookEventCounts),
    sourceAdapterCounts: sortNamedCounts(sourceAdapterCounts),
    toolFinishCount,
    toolStartCount,
    turnCompletionCount,
    unreadableLineCount,
  };
}

function inspectHookConfig(hookConfigPath: string): HookConfigInspection {
  if (!existsSync(hookConfigPath)) {
    return {
      expectedCommandCount: 0,
      hookCommandCount: 0,
      missingRequiredEvents: [...requiredDogfoodHookEvents],
      registeredEvents: [],
      status: "missing",
      unexpectedCommandCount: 0,
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(hookConfigPath, "utf8")) as unknown;
  } catch {
    return {
      expectedCommandCount: 0,
      hookCommandCount: 0,
      missingRequiredEvents: [...requiredDogfoodHookEvents],
      registeredEvents: [],
      status: "unreadable",
      unexpectedCommandCount: 0,
    };
  }

  const hooks = readRecord(readRecord(parsed).hooks);
  const registeredEvents = Object.keys(hooks).sort();
  const missingRequiredEvents = requiredDogfoodHookEvents.filter(
    (eventName) => !registeredEvents.includes(eventName),
  );
  const hookCommandEntries = registeredEvents.flatMap((eventName) =>
    collectHookCommands(hooks[eventName]).map((command) => ({
      command,
      eventName,
    })),
  );
  const hookCommands = hookCommandEntries.map((entry) => entry.command);
  const expectedCommandCount = hookCommands.filter((command) =>
    expectedHookCommands.has(command),
  ).length;

  return {
    expectedCommandCount,
    fingerprint: hookConfigFingerprint(hookCommandEntries),
    hookCommandCount: hookCommands.length,
    missingRequiredEvents,
    registeredEvents,
    status: "ok",
    unexpectedCommandCount: hookCommands.length - expectedCommandCount,
  };
}

function inspectHookTrustState(input: {
  readonly codexConfigPath: string;
  readonly hookConfigPath: string;
}): HookTrustInspection {
  if (!existsSync(input.codexConfigPath)) {
    return {
      matchingRecordCount: 0,
      missingRequiredEvents: [...requiredDogfoodHookEvents],
      status: "missing",
      trustedRequiredEvents: [],
    };
  }

  let config: string;

  try {
    config = readFileSync(input.codexConfigPath, "utf8");
  } catch {
    return {
      matchingRecordCount: 0,
      missingRequiredEvents: [...requiredDogfoodHookEvents],
      status: "unreadable",
      trustedRequiredEvents: [],
    };
  }

  const trustedKeys = parseTrustedCodexHookStateKeys(config);
  const matchingKeys = trustedKeys.filter((key) =>
    key.startsWith(`${input.hookConfigPath}:`),
  );
  const trustedRequiredEvents = requiredDogfoodHookEvents.filter((eventName) =>
    matchingKeys.some((key) =>
      key.startsWith(
        `${input.hookConfigPath}:${codexHookStateEventName(eventName)}:`,
      ),
    ),
  );
  const missingRequiredEvents = requiredDogfoodHookEvents.filter(
    (eventName) => !trustedRequiredEvents.includes(eventName),
  );

  return {
    matchingRecordCount: matchingKeys.length,
    missingRequiredEvents,
    status: "ok",
    trustedRequiredEvents,
  };
}

function parseTrustedCodexHookStateKeys(config: string): readonly string[] {
  const keys: string[] = [];
  let currentHookStateKey: string | undefined;
  let currentHookStateHasTrustedHash = false;

  const flushCurrent = (): void => {
    if (currentHookStateKey !== undefined && currentHookStateHasTrustedHash) {
      keys.push(currentHookStateKey);
    }
  };

  for (const rawLine of config.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const tableMatch = /^\[hooks\.state\."(?<key>(?:\\.|[^"])*)"\]$/u.exec(
      line,
    );

    if (tableMatch?.groups?.key !== undefined) {
      flushCurrent();
      currentHookStateKey = unescapeTomlBasicString(tableMatch.groups.key);
      currentHookStateHasTrustedHash = false;
      continue;
    }

    if (/^\[.+\]$/u.test(line)) {
      flushCurrent();
      currentHookStateKey = undefined;
      currentHookStateHasTrustedHash = false;
      continue;
    }

    if (
      currentHookStateKey !== undefined &&
      /^trusted_hash\s*=\s*"sha256:[a-f0-9]{64}"$/u.test(line)
    ) {
      currentHookStateHasTrustedHash = true;
    }
  }

  flushCurrent();

  return keys.sort();
}

function unescapeTomlBasicString(value: string): string {
  return value.replace(/\\(["\\])/gu, "$1");
}

function codexHookStateEventName(eventName: string): string {
  return eventName.replace(
    /[A-Z]/gu,
    (character, offset) =>
      `${offset === 0 ? "" : "_"}${character.toLowerCase()}`,
  );
}

function collectHookCommands(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      return [];
    }

    return entry.hooks.flatMap((hook) => {
      if (!isRecord(hook)) {
        return [];
      }

      const command = readString(hook, "command");

      return command === undefined ? [] : [command];
    });
  });
}

function hookConfigFingerprint(
  hookCommandEntries: readonly {
    readonly command: string;
    readonly eventName: string;
  }[],
): string {
  const canonicalPayload = hookCommandEntries
    .map((entry) => ({
      command: entry.command,
      eventName: entry.eventName,
    }))
    .sort(
      (left, right) =>
        left.eventName.localeCompare(right.eventName) ||
        left.command.localeCompare(right.command),
    );

  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex")}`;
}

function countSkipReason(
  selection: ExecutionAdviceGraphCandidateSelection,
  reason: ExecutionAdviceGraphCandidateSkipReason,
): number {
  return selection.rejectedCandidates.filter((rejection) =>
    rejection.reasons.includes(reason),
  ).length;
}

function formatCandidate(candidate: ExecutionAdviceGraphCandidate): string {
  return [
    candidate.runId,
    `status=${candidate.status ?? "unknown"}`,
    `nodes=${candidate.nodeCount ?? "unknown"}`,
    `tools=${candidate.toolCalls ?? "unknown"}`,
    `opportunities=${candidate.opportunityCount ?? "unknown"}`,
  ].join(" ");
}

function formatAdviceSelectionNote(
  selected: ExecutionAdviceGraphCandidate,
  latestTurn: ExecutionAdviceGraphCandidate | undefined,
): string | undefined {
  if (latestTurn === undefined || selected.runId === latestTurn.runId) {
    return undefined;
  }

  const selectedHasSignal = (selected.opportunityCount ?? 0) > 0;
  const latestHasSignal = (latestTurn.opportunityCount ?? 0) > 0;

  if (selected.modifiedAtMs < latestTurn.modifiedAtMs) {
    if (selectedHasSignal && !latestHasSignal) {
      return "selected advice is older than the latest organic turn because it has actionable signal and the latest organic turn has none.";
    }

    return "selected advice is older than the latest organic turn; compare this with Latest Turn Signal before treating advice as current-session evidence.";
  }

  if (selected.modifiedAtMs > latestTurn.modifiedAtMs) {
    return "selected advice is newer than the latest organic turn, which usually means include-smoke or filtering options changed the candidate pool.";
  }

  return "selected advice differs from the latest organic turn.";
}

function formatToolObservability(
  candidate: ExecutionAdviceGraphCandidate,
): string {
  if (candidate.status === "running" && (candidate.toolCalls ?? 0) === 0) {
    return "warning: latest turn is running with no observed tool calls yet.";
  }

  if ((candidate.toolCalls ?? 0) === 0) {
    return "warning: latest turn has no observed tool calls.";
  }

  return `ok: latest turn observed ${candidate.toolCalls} tool call(s).`;
}

function formatHookCoverageLines(
  latestTurn: ExecutionAdviceGraphCandidate | undefined,
  coverage: HookCoverage | undefined,
): readonly string[] {
  if (latestTurn === undefined || coverage === undefined) {
    return ["- Status: missing latest turn."];
  }

  if (coverage.eventLogStatus === "missing") {
    return [
      "- Event log: missing",
      "- Hook events: unavailable",
      "- Tool lifecycle: unavailable",
      "- Native hook coverage: warning: latest turn graph has no events.jsonl.",
    ];
  }

  return [
    `- Event log: ok (${coverage.eventCount} events${coverage.unreadableLineCount > 0 ? `, ${coverage.unreadableLineCount} unreadable lines` : ""})`,
    `- Hook events: ${formatNamedCounts(coverage.hookEventCounts)}`,
    `- Event sources: ${formatNamedCounts(coverage.sourceAdapterCounts)}`,
    `- Tool lifecycle: starts ${coverage.toolStartCount}, finishes ${coverage.toolFinishCount}, completed turns ${coverage.turnCompletionCount}`,
    `- Native hook coverage: ${formatNativeHookCoverage(latestTurn, coverage)}`,
  ];
}

function formatHookConfigLines(
  inspection: HookConfigInspection,
): readonly string[] {
  if (inspection.status === "missing") {
    return [
      "- Status: missing",
      "- Required events: missing UserPromptSubmit, PreToolUse, PostToolUse, Stop",
      "- Hook commands: unavailable",
    ];
  }

  if (inspection.status === "unreadable") {
    return [
      "- Status: unreadable",
      "- Required events: unavailable",
      "- Hook commands: unavailable",
    ];
  }

  return [
    `- Status: ok (${inspection.registeredEvents.length} events registered)`,
    `- Required events: ${
      inspection.missingRequiredEvents.length === 0
        ? `ok (${requiredDogfoodHookEvents.join(", ")})`
        : `missing ${inspection.missingRequiredEvents.join(", ")}`
    }`,
    `- Hook commands: ${inspection.expectedCommandCount}/${inspection.hookCommandCount} use the expected Migaki hook entrypoint command`,
    `- Unexpected commands: ${inspection.unexpectedCommandCount}`,
    `- Trust fingerprint: ${inspection.fingerprint ?? "unavailable"}`,
    "- Trust note: Codex trust is per hook definition; changed hook commands must be reviewed again with /hooks.",
  ];
}

function formatHookTrustLines(
  inspection: HookTrustInspection,
): readonly string[] {
  if (inspection.status === "missing") {
    return [
      "- Config: missing",
      "- Required trust records: missing UserPromptSubmit, PreToolUse, PostToolUse, Stop",
    ];
  }

  if (inspection.status === "unreadable") {
    return ["- Config: unreadable", "- Required trust records: unavailable"];
  }

  return [
    `- Config: found (${inspection.matchingRecordCount} trusted hook record(s) for this hook file)`,
    `- Required trust records: ${
      inspection.missingRequiredEvents.length === 0
        ? `ok (${requiredDogfoodHookEvents.join(", ")})`
        : `missing ${inspection.missingRequiredEvents.join(", ")}`
    }`,
    "- Trust note: this checks local Codex trusted-hash records only; review /hooks after hook definition changes.",
  ];
}

function formatHookProbeLines(
  latestHookProbeTurn: HookProbeTurn | undefined,
  nowMs: number,
): readonly string[] {
  if (latestHookProbeTurn === undefined) {
    return [
      "- Latest probe: none",
      "- Detail: run mise run migaki:hook-probe to verify the built hook entrypoint without affecting normal advice selection.",
    ];
  }

  return [
    `- Latest probe: ${formatCandidate(latestHookProbeTurn.candidate)}`,
    `- Probe updated: ${formatCandidateRecency(latestHookProbeTurn.candidate, nowMs)}`,
    `- Hook events: ${formatNamedCounts(latestHookProbeTurn.coverage.hookEventCounts)}`,
    `- Event sources: ${formatNamedCounts(latestHookProbeTurn.coverage.sourceAdapterCounts)}`,
    `- Probe result: ${formatHookProbeResult(latestHookProbeTurn)}`,
  ];
}

function formatHookProbeResult(probe: HookProbeTurn): string {
  if (isNativeHookCoverageComplete(probe.candidate, probe.coverage)) {
    return "ok: built hook entrypoint recorded native prompt, tool, and stop hooks.";
  }

  const missingHooks = missingNativeHooks(probe.candidate, probe.coverage);

  if (probe.coverage.eventLogStatus === "missing") {
    return "warning: probe graph has no events.jsonl.";
  }

  if (missingHooks.length > 0) {
    return `warning: missing ${missingHooks.join(", ")}.`;
  }

  if (hasSourceAdapter(probe.coverage, "manual-exec")) {
    return "warning: probe includes manual-exec supplementation.";
  }

  return "warning: probe did not produce complete native hook coverage.";
}

function evaluateStrictDogfoodDoctor(
  inspection: DogfoodDoctorInspection,
  options: {
    readonly maxRealAgeMs?: number;
  } = {},
): StrictEvaluation {
  const failures: string[] = [];

  if (!inspection.hookConfigExists) {
    failures.push("Hook config is missing.");
  }

  if (inspection.hookConfigInspection.status === "unreadable") {
    failures.push("Hook config is unreadable.");
  }

  if (inspection.hookConfigInspection.missingRequiredEvents.length > 0) {
    failures.push(
      `Hook config is missing required events: ${inspection.hookConfigInspection.missingRequiredEvents.join(", ")}.`,
    );
  }

  if (
    inspection.hookConfigInspection.status === "ok" &&
    inspection.hookConfigInspection.hookCommandCount === 0
  ) {
    failures.push("Hook config has no command hooks.");
  }

  if (inspection.hookConfigInspection.unexpectedCommandCount > 0) {
    failures.push("Hook config contains unexpected hook commands.");
  }

  if (!inspection.hookEntrypointExists) {
    failures.push("Built hook entrypoint is missing.");
  }

  if (inspection.latestTurn === undefined) {
    failures.push("No completed organic Codex turn was found.");
  } else if (
    inspection.latestTurnHookCoverage === undefined ||
    !isNativeHookCoverageComplete(
      inspection.latestTurn,
      inspection.latestTurnHookCoverage,
    )
  ) {
    failures.push("Latest organic Codex turn is not fully native.");
  }

  if (
    inspection.latestTurn !== undefined &&
    options.maxRealAgeMs !== undefined
  ) {
    const ageMs = inspection.nowMs - inspection.latestTurn.modifiedAtMs;

    if (ageMs > options.maxRealAgeMs) {
      failures.push(
        `Latest organic Codex turn is stale: ${formatDurationMs(ageMs)} old exceeds ${formatDurationMs(options.maxRealAgeMs)}.`,
      );
    }
  }

  if (
    inspection.latestHookProbeTurn !== undefined &&
    !isNativeHookCoverageComplete(
      inspection.latestHookProbeTurn.candidate,
      inspection.latestHookProbeTurn.coverage,
    )
  ) {
    failures.push("Latest hook probe did not record complete native coverage.");
  }

  return {
    failures,
    ok: failures.length === 0,
  };
}

function strictEvaluationOptions(maxRealAgeMs: number | undefined): {
  readonly maxRealAgeMs?: number;
} {
  return maxRealAgeMs === undefined ? {} : { maxRealAgeMs };
}

function formatStrictEvaluationLines(
  evaluation: StrictEvaluation,
): readonly string[] {
  if (evaluation.ok) {
    return ["- Result: ok", "- Failures: none"];
  }

  return [
    "- Result: failed",
    ...evaluation.failures.map((failure) => `- Failure: ${failure}`),
  ];
}

function formatDesktopVerificationLines(input: {
  readonly hookConfigExists: boolean;
  readonly hookConfigInspection: HookConfigInspection;
  readonly hookEntrypointExists: boolean;
  readonly hookTrustInspection: HookTrustInspection | undefined;
  readonly latestHookProbeTurn: HookProbeTurn | undefined;
  readonly latestTurn: ExecutionAdviceGraphCandidate | undefined;
  readonly latestTurnHookCoverage: HookCoverage | undefined;
  readonly maxRealAgeMs: number | undefined;
  readonly nowMs: number;
}): readonly string[] {
  if (
    !input.hookConfigExists ||
    input.hookConfigInspection.status !== "ok" ||
    input.hookConfigInspection.missingRequiredEvents.length > 0 ||
    input.hookConfigInspection.unexpectedCommandCount > 0 ||
    !input.hookEntrypointExists ||
    input.latestTurn === undefined
  ) {
    return [];
  }

  const latestTurnIsNativeComplete =
    input.latestTurnHookCoverage !== undefined &&
    isNativeHookCoverageComplete(
      input.latestTurn,
      input.latestTurnHookCoverage,
    );
  const latestTurnAgeMs = input.nowMs - input.latestTurn.modifiedAtMs;
  const latestTurnIsStale =
    input.maxRealAgeMs !== undefined && latestTurnAgeMs > input.maxRealAgeMs;

  if (latestTurnIsNativeComplete && !latestTurnIsStale) {
    return [];
  }

  return [
    `- State: ${formatDesktopVerificationState({
      coverage: input.latestTurnHookCoverage,
      isNativeComplete: latestTurnIsNativeComplete,
      isStale: latestTurnIsStale,
      latestTurn: input.latestTurn,
    })}`,
    formatDesktopTrustCheck(
      input.hookConfigInspection,
      input.hookTrustInspection,
    ),
    formatDesktopEntrypointCheck(input.latestHookProbeTurn),
    "- Fresh-turn check: start one normal Codex Desktop turn in this repository and ask it to run `. scripts/env && printf migaki-dogfood-fresh-turn >/dev/null`, then let the turn finish.",
    "- Gate: rerun mise run migaki:dogfood; success means the latest organic turn is native-complete and fresh.",
  ];
}

function formatDesktopVerificationState(input: {
  readonly coverage: HookCoverage | undefined;
  readonly isNativeComplete: boolean;
  readonly isStale: boolean;
  readonly latestTurn: ExecutionAdviceGraphCandidate;
}): string {
  const turnState =
    input.coverage === undefined
      ? "missing hook coverage"
      : formatRecentRealTurnVerdict({
          candidate: input.latestTurn,
          coverage: input.coverage,
        });

  if (!input.isNativeComplete && input.isStale) {
    return `latest organic turn is ${turnState} and stale for the strict window.`;
  }

  if (!input.isNativeComplete) {
    return `latest organic turn is ${turnState}, not native-complete.`;
  }

  return "latest organic turn is native-complete but stale for the strict window.";
}

function formatDesktopTrustCheck(
  hookConfigInspection: HookConfigInspection,
  hookTrustInspection: HookTrustInspection | undefined,
): string {
  if (hookTrustInspection?.status === "ok") {
    if (hookTrustInspection.missingRequiredEvents.length === 0) {
      return "- Trust check: local Codex config has trusted-hash records for the required Migaki hook events; if Desktop still prompts, re-review /hooks for the fingerprint shown above.";
    }

    return `- Trust check: in Codex Desktop, open /hooks and trust the missing Migaki hook events: ${hookTrustInspection.missingRequiredEvents.join(", ")}.`;
  }

  if (hookTrustInspection?.status === "missing") {
    return "- Trust check: local Codex config has no hook trust state yet; open /hooks in Codex Desktop and trust the Migaki project hooks.";
  }

  if (hookTrustInspection?.status === "unreadable") {
    return "- Trust check: local Codex config could not be read; open /hooks in Codex Desktop and confirm the Migaki project hooks are trusted.";
  }

  return `- Trust check: in Codex Desktop, open /hooks for this repository and confirm the Migaki hook definitions are trusted for fingerprint ${hookConfigInspection.fingerprint ?? "shown above"}.`;
}

function formatDesktopEntrypointCheck(
  latestHookProbeTurn: HookProbeTurn | undefined,
): string {
  if (
    latestHookProbeTurn !== undefined &&
    isNativeHookCoverageComplete(
      latestHookProbeTurn.candidate,
      latestHookProbeTurn.coverage,
    )
  ) {
    return "- Entrypoint check: latest hook probe is native-complete, so focus on Desktop trust/context rather than hook code.";
  }

  return "- Entrypoint check: run mise run migaki:hook-probe and expect native prompt, tool, and stop coverage.";
}

function formatSurfaceRealityLines(input: {
  readonly latestHookProbeTurn: HookProbeTurn | undefined;
  readonly latestSmokeHarnessTurn: SmokeHarnessTurn | undefined;
  readonly latestTurn: ExecutionAdviceGraphCandidate | undefined;
  readonly latestTurnHookCoverage: HookCoverage | undefined;
  readonly maxRealAgeMs: number | undefined;
  readonly nowMs: number;
}): readonly string[] {
  const latestTurnIsNativeComplete =
    input.latestTurn !== undefined &&
    input.latestTurnHookCoverage !== undefined &&
    isNativeHookCoverageComplete(
      input.latestTurn,
      input.latestTurnHookCoverage,
    );
  const latestTurnIsStale =
    input.latestTurn !== undefined &&
    input.maxRealAgeMs !== undefined &&
    input.nowMs - input.latestTurn.modifiedAtMs > input.maxRealAgeMs;
  const organicProofIsCurrent =
    latestTurnIsNativeComplete && !latestTurnIsStale;

  if (organicProofIsCurrent) {
    return [];
  }

  const infrastructureProofs: string[] = [];

  if (
    input.latestHookProbeTurn !== undefined &&
    isNativeHookCoverageComplete(
      input.latestHookProbeTurn.candidate,
      input.latestHookProbeTurn.coverage,
    )
  ) {
    infrastructureProofs.push("hook probe is native-complete");
  }

  if (
    input.latestSmokeHarnessTurn !== undefined &&
    isNativeHookCoverageComplete(
      input.latestSmokeHarnessTurn.candidate,
      input.latestSmokeHarnessTurn.coverage,
    )
  ) {
    infrastructureProofs.push("smoke harness is native-complete");
  }

  if (infrastructureProofs.length === 0) {
    return [];
  }

  const organicProof =
    input.latestTurn === undefined
      ? "no organic turn was found."
      : formatDesktopVerificationState({
          coverage: input.latestTurnHookCoverage,
          isNativeComplete: latestTurnIsNativeComplete,
          isStale: latestTurnIsStale,
          latestTurn: input.latestTurn,
        });

  return [
    `- Infrastructure proof: ${infrastructureProofs.join("; ")}.`,
    `- Organic proof: ${organicProof}`,
    "- Interpretation: hook plumbing works in controlled probes, but no fresh organic Codex turn is reaching the dogfood gate yet.",
    "- App-surface check: if you just ran a tool in this Codex app thread, this surface is not emitting project hooks for those tool calls; use migaki:bridge as an explicit bridge while fixing native emission.",
  ];
}

function formatBridgeProofLine(
  candidate: ExecutionAdviceGraphCandidate,
  coverage: HookCoverage,
  nowMs: number,
): string {
  return `- Bridge proof: ${formatCandidate(candidate)} updated ${formatCandidateRecency(candidate, nowMs)}; sources ${formatNamedCounts(coverage.sourceAdapterCounts)}.`;
}

function formatSmokeHarnessLines(
  latestSmokeHarnessTurn: SmokeHarnessTurn | undefined,
  nowMs: number,
): readonly string[] {
  if (latestSmokeHarnessTurn === undefined) {
    return [
      "- Latest smoke harness turn: none",
      "- Detail: run mise run migaki:smoke when you want CLI smoke proof; strict dogfood still requires organic Codex work.",
    ];
  }

  return [
    `- Latest smoke harness turn: ${formatCandidate(latestSmokeHarnessTurn.candidate)}`,
    `- Harness updated: ${formatCandidateRecency(latestSmokeHarnessTurn.candidate, nowMs)}`,
    `- Hook events: ${formatNamedCounts(latestSmokeHarnessTurn.coverage.hookEventCounts)}`,
    `- Event sources: ${formatNamedCounts(latestSmokeHarnessTurn.coverage.sourceAdapterCounts)}`,
    `- Harness result: ${formatSmokeHarnessResult(latestSmokeHarnessTurn)}`,
  ];
}

function formatSmokeHarnessResult(turn: SmokeHarnessTurn): string {
  if (isNativeHookCoverageComplete(turn.candidate, turn.coverage)) {
    return "ok: smoke-created CLI proof recorded native hooks; this is not accepted as organic dogfood evidence.";
  }

  const missingHooks = missingNativeHooks(turn.candidate, turn.coverage);

  if (turn.coverage.eventLogStatus === "missing") {
    return "warning: smoke-created CLI proof has no events.jsonl.";
  }

  if (missingHooks.length > 0) {
    return `warning: smoke-created CLI proof is missing ${missingHooks.join(", ")}.`;
  }

  return "warning: smoke-created CLI proof did not produce complete native hook coverage.";
}

function formatNativeBaselineLines(
  latestNativeCompleteTurn: NativeCompleteTurn | undefined,
  nowMs: number,
): readonly string[] {
  if (latestNativeCompleteTurn === undefined) {
    return [
      "- Latest native-complete turn: none",
      "- Detail: no completed organic turn has native prompt, tool, and stop hooks yet.",
    ];
  }

  return [
    `- Latest native-complete turn: ${formatCandidate(latestNativeCompleteTurn.candidate)}`,
    `- Native baseline updated: ${formatCandidateRecency(latestNativeCompleteTurn.candidate, nowMs)}`,
    `- Hook events: ${formatNamedCounts(latestNativeCompleteTurn.coverage.hookEventCounts)}`,
    `- Event sources: ${formatNamedCounts(latestNativeCompleteTurn.coverage.sourceAdapterCounts)}`,
  ];
}

function formatRecentRealTurnLines(
  turns: readonly RecentRealTurn[],
  nowMs: number,
): readonly string[] {
  if (turns.length === 0) {
    return ["- none"];
  }

  return turns.map(
    (turn) =>
      `- ${turn.candidate.runId}: ${formatRecentRealTurnVerdict(turn)}; updated ${formatCandidateRecency(turn.candidate, nowMs)}; hooks ${formatNamedCounts(turn.coverage.hookEventCounts)}; sources ${formatNamedCounts(turn.coverage.sourceAdapterCounts)}`,
  );
}

function formatRecentRealTurnSummaryLines(
  turns: readonly RecentRealTurn[],
): readonly string[] {
  if (turns.length === 0) {
    return [];
  }

  const verdicts = turns.map((turn) => formatRecentRealTurnVerdict(turn));
  const newestVerdict = verdicts[0];
  const newestStreak = verdicts.findIndex(
    (verdict) => verdict !== newestVerdict,
  );
  const newestStreakLength =
    newestStreak === -1 ? verdicts.length : newestStreak;
  const nativeCompleteCount = verdicts.filter(
    (verdict) => verdict === "native-complete",
  ).length;
  const verdictCounts = countNames(verdicts);
  const pattern =
    newestVerdict === "native-complete"
      ? "ok: newest organic turn is native-complete."
      : nativeCompleteCount > 0
        ? `recent-regression: newest ${newestStreakLength} organic turn(s) are ${newestVerdict}; older native-complete evidence exists.`
        : `warning: no native-complete turn appears in the ${turns.length} most recent organic turn(s).`;

  return [
    `- Verdicts: ${formatNamedCounts(verdictCounts)}`,
    `- Newest streak: ${newestVerdict} x${newestStreakLength}`,
    `- Pattern: ${pattern}`,
  ];
}

function formatRecentRealTurnVerdict(turn: RecentRealTurn): string {
  if (turn.candidate.status === "running") {
    return "running";
  }

  if (turn.coverage.eventLogStatus === "missing") {
    return "missing-events";
  }

  if (isNativeHookCoverageComplete(turn.candidate, turn.coverage)) {
    return "native-complete";
  }

  if (hasSourceAdapter(turn.coverage, "manual-exec")) {
    return "mixed-manual";
  }

  if ((turn.candidate.toolCalls ?? 0) === 0) {
    return "no-tool-evidence";
  }

  const missingHooks = missingNativeHooks(turn.candidate, turn.coverage);

  if (missingHooks.length > 0) {
    return `native-incomplete missing ${missingHooks.join(", ")}`;
  }

  return "unknown";
}

function formatCandidateRecency(
  candidate: ExecutionAdviceGraphCandidate,
  nowMs: number,
): string {
  if (!Number.isFinite(candidate.modifiedAtMs)) {
    return "unavailable";
  }

  const modifiedAt = new Date(candidate.modifiedAtMs).toISOString();
  const diffMs = nowMs - candidate.modifiedAtMs;

  if (diffMs < 0) {
    return `${modifiedAt} (in ${formatDurationMs(Math.abs(diffMs))})`;
  }

  return `${modifiedAt} (${formatDurationMs(diffMs)} ago)`;
}

function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 && parts.length < 2) {
    parts.push(`${minutes}m`);
  }

  if (parts.length === 0 || (seconds > 0 && parts.length < 2)) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

function parseMaxRealAgeMs(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const minutes = Number(value);

  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error("--max-real-age-minutes must be a non-negative number.");
  }

  return minutes * 60_000;
}

function formatNativeHookCoverage(
  latestTurn: ExecutionAdviceGraphCandidate,
  coverage: HookCoverage,
): string {
  const missingHooks = missingNativeHooks(latestTurn, coverage);

  if (missingHooks.length === 0) {
    return "ok: prompt, tool, and stop hooks observed for the latest turn.";
  }

  if (
    coverage.sourceAdapterCounts.some((count) => count.name === "manual-exec")
  ) {
    return `warning: missing ${missingHooks.join(", ")}; latest turn includes manual-exec supplementation.`;
  }

  return `warning: missing ${missingHooks.join(", ")}.`;
}

function isNativeHookCoverageComplete(
  candidate: ExecutionAdviceGraphCandidate,
  coverage: HookCoverage,
): boolean {
  return (
    coverage.eventLogStatus === "ok" &&
    missingNativeHooks(candidate, coverage).length === 0 &&
    hasSourceAdapter(coverage, "codex-hooks") &&
    !hasSourceAdapter(coverage, "manual-exec")
  );
}

function missingNativeHooks(
  candidate: ExecutionAdviceGraphCandidate,
  coverage: HookCoverage,
): readonly string[] {
  const observedHooks = new Set(
    coverage.hookEventCounts.map((count) => count.name),
  );
  const missingHooks: string[] = [];

  if (!observedHooks.has("UserPromptSubmit")) {
    missingHooks.push("UserPromptSubmit");
  }

  if ((candidate.toolCalls ?? 0) > 0) {
    if (!observedHooks.has("PreToolUse")) {
      missingHooks.push("PreToolUse");
    }

    if (!observedHooks.has("PostToolUse")) {
      missingHooks.push("PostToolUse");
    }
  }

  if (candidate.status !== "running" && !observedHooks.has("Stop")) {
    missingHooks.push("Stop");
  }

  return missingHooks;
}

function hasSourceAdapter(coverage: HookCoverage, adapter: string): boolean {
  return coverage.sourceAdapterCounts.some((count) => count.name === adapter);
}

function nextPracticalMove(input: {
  readonly hookConfigExists: boolean;
  readonly hookConfigInspection: HookConfigInspection;
  readonly hookCoverage: HookCoverage | undefined;
  readonly hookEntrypointExists: boolean;
  readonly hookTrustInspection: HookTrustInspection | undefined;
  readonly latestHookProbeTurn: HookProbeTurn | undefined;
  readonly latestNativeCompleteTurn: NativeCompleteTurn | undefined;
  readonly latestTurn: ExecutionAdviceGraphCandidate | undefined;
  readonly selected: ExecutionAdviceGraphCandidate | undefined;
}): string {
  if (!input.hookConfigExists) {
    return "- Restore .codex/hooks.json so Codex can load the project hooks.";
  }

  if (
    input.hookConfigInspection.status !== "ok" ||
    input.hookConfigInspection.missingRequiredEvents.length > 0 ||
    input.hookConfigInspection.unexpectedCommandCount > 0
  ) {
    return "- Fix .codex/hooks.json so prompt, tool, and stop hooks point at the built Migaki hook entrypoint.";
  }

  if (!input.hookEntrypointExists) {
    return "- Run mise run build, then review/trust the project hooks in Codex.";
  }

  if (input.hookTrustInspection?.status === "missing") {
    return "- Open /hooks in Codex Desktop and trust the Migaki project hooks for this repository.";
  }

  if (input.hookTrustInspection?.status === "unreadable") {
    return "- Open /hooks in Codex Desktop and confirm the Migaki project hooks are trusted; local trust state could not be read.";
  }

  if (
    input.hookTrustInspection?.status === "ok" &&
    input.hookTrustInspection.missingRequiredEvents.length > 0
  ) {
    return `- Trust missing Migaki hook events in Codex Desktop with /hooks: ${input.hookTrustInspection.missingRequiredEvents.join(", ")}.`;
  }

  if (input.latestTurn === undefined) {
    return "- Run a normal Codex turn in this repository, then rerun migaki:doctor.";
  }

  if (
    input.hookCoverage !== undefined &&
    formatNativeHookCoverage(input.latestTurn, input.hookCoverage).startsWith(
      "warning:",
    )
  ) {
    if (
      input.latestHookProbeTurn !== undefined &&
      isNativeHookCoverageComplete(
        input.latestHookProbeTurn.candidate,
        input.latestHookProbeTurn.coverage,
      )
    ) {
      if (
        input.hookTrustInspection?.status === "ok" &&
        input.hookTrustInspection.missingRequiredEvents.length === 0
      ) {
        return "- Local hook trust records and the hook probe are ok; run a fresh normal Desktop turn with a tool call, then rerun migaki:dogfood.";
      }

      return "- Latest organic turn is not fully native, but the hook probe proves the current built entrypoint works; verify Desktop hook trust/context for tool and stop events.";
    }

    if (input.latestNativeCompleteTurn !== undefined) {
      return `- Latest turn is not fully native, but ${input.latestNativeCompleteTurn.candidate.runId} proves native tool hooks can work; compare Desktop trust/context against that run.`;
    }

    return "- Keep using migaki:exec attachment as a bridge while verifying native Codex hook coverage above.";
  }

  if ((input.latestTurn.toolCalls ?? 0) === 0) {
    if (
      input.selected !== undefined &&
      !isTurnExecutionRunId(input.selected.runId) &&
      (input.selected.toolCalls ?? 0) > 0
    ) {
      return "- Keep using migaki:exec for command evidence while verifying Desktop PreToolUse/PostToolUse emission.";
    }

    return "- Verify Desktop is emitting PreToolUse/PostToolUse hooks; the latest turn has no tool evidence.";
  }

  if (input.selected === undefined) {
    return "- Rerun after the current turn completes, or inspect skipped candidates above.";
  }

  return "- Use migaki:advise before the next turn; the selected candidate has real tool evidence.";
}

function incrementCount(counts: Map<string, number>, name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function countNames(names: readonly string[]): readonly NamedCount[] {
  const counts = new Map<string, number>();

  for (const name of names) {
    incrementCount(counts, name);
  }

  return [...counts.entries()].map(([name, count]) => ({
    count,
    name,
  }));
}

function sortHookEventCounts(
  counts: ReadonlyMap<string, number>,
): readonly NamedCount[] {
  const order = new Map<string, number>(
    hookEventDisplayOrder.map((name, index) => [name, index]),
  );

  return [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .sort(
      (left, right) =>
        (order.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.name) ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name),
    );
}

function sortNamedCounts(
  counts: ReadonlyMap<string, number>,
): readonly NamedCount[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function formatNamedCounts(counts: readonly NamedCount[]): string {
  if (counts.length === 0) {
    return "none";
  }

  return counts.map((count) => `${count.name} ${count.count}`).join(", ");
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function readString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];

  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runDogfoodDoctorCli(process.argv.slice(2));
}
