import { readFile as readTextFile } from "node:fs/promises";

import {
  EVIDENCE_BUNDLE_VERSION,
  MOCK_TRACE_ARTIFACT_VERSION,
  parseEvidenceBundle,
  parseMockExecutionTraceArtifact,
  replayMockExecutionTrace,
  type EvidenceBundle,
  type EstimateEvidenceEvent,
  type MockExecutionTraceArtifact,
  type MockExecutionTraceReplayResult,
  type PassWarning,
  type RoutingDecisionEvidenceEvent,
  type ValidatorResultEvidenceEvent,
} from "@migaki/runtime";

export const cliPackageName = "@migaki/cli";
export const cliPackageResponsibility =
  "Developer-facing report and replay command surfaces.";

export const CLI_REPORT_VERSION = "migaki.cli-report.v0";
export const CLI_REPLAY_VERSION = "migaki.cli-replay.v0";

export type CliReportVersion = typeof CLI_REPORT_VERSION;
export type CliReplayVersion = typeof CLI_REPLAY_VERSION;

export type CliReportFormat = "human" | "json";

export interface CliIo {
  readonly readFile: (path: string) => Promise<string> | string;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface ReportArgs {
  readonly format: CliReportFormat;
  readonly input: string;
}

interface EstimateReport {
  readonly subjectRef: string;
  readonly unit: string;
  readonly value?: number;
}

interface EvidenceReport {
  readonly artifactKind: "evidence_bundle";
  readonly costEstimates: readonly EstimateReport[];
  readonly passCount: number;
  readonly passes: readonly PassReport[];
  readonly planDiffChangeCount: number;
  readonly plans: {
    readonly optimized: string;
    readonly original: string;
  };
  readonly replay: {
    readonly handles: readonly string[];
    readonly mode: EvidenceBundle["replay"]["mode"];
  };
  readonly reportWarnings: readonly string[];
  readonly routingDecisions: readonly RoutingDecisionReport[];
  readonly runId: string;
  readonly tokenEstimates: readonly EstimateReport[];
  readonly validatorResults: readonly ValidatorReport[];
  readonly version: CliReportVersion;
  readonly warnings: readonly WarningReport[];
}

interface MockTraceReport {
  readonly artifactKind: "mock_trace";
  readonly backend: MockExecutionTraceArtifact["backend"]["provider"];
  readonly evidenceBundleRef?: string;
  readonly planId: string;
  readonly reportWarnings: readonly string[];
  readonly resultStatus: MockExecutionTraceArtifact["result"]["status"];
  readonly stepCount: number;
  readonly timing: {
    readonly durationMs?: number;
  };
  readonly traceId: string;
  readonly validatorResults: readonly ValidatorReport[];
  readonly version: CliReportVersion;
}

interface ReplayReport {
  readonly artifactKind: "mock_trace_replay";
  readonly backend: MockExecutionTraceArtifact["backend"]["provider"];
  readonly mismatchCount: number;
  readonly mismatches: readonly string[];
  readonly outputCount: number;
  readonly planId: string;
  readonly replayStatus: MockExecutionTraceReplayResult["status"];
  readonly resultStatus: MockExecutionTraceReplayResult["result"]["status"];
  readonly traceId: string;
  readonly validatorResults: readonly ValidatorReport[];
  readonly version: CliReplayVersion;
}

interface PassReport {
  readonly enabled: boolean;
  readonly name: string;
  readonly version: string;
}

interface RoutingDecisionReport {
  readonly nodeId: string;
  readonly reason: string;
  readonly target: string;
}

interface ValidatorReport {
  readonly status: string;
  readonly validatorId: string;
}

interface WarningReport {
  readonly code: string;
  readonly message: string;
  readonly severity: PassWarning["severity"];
}

const defaultIo: CliIo = {
  readFile(path) {
    return readTextFile(path, "utf8");
  },
};

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
): Promise<CliResult> {
  const command = argv[0];

  if (command === "report") {
    return runReportCommand(argv.slice(1), io);
  }

  if (command === "replay") {
    return runReplayCommand(argv.slice(1), io);
  }

  return fail(
    "Usage: migaki <report|replay> --input <artifact.json> [--format human|json]",
  );
}

async function runReportCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<CliResult> {
  const args = parseReportArgs(argv);

  if (typeof args === "string") {
    return fail(args);
  }

  let artifactText: string;

  try {
    artifactText = await io.readFile(args.input);
  } catch (error) {
    return fail(`Could not read input artifact: ${errorMessage(error)}`);
  }

  const version = readArtifactVersion(artifactText);

  if (typeof version === "string") {
    try {
      if (version === EVIDENCE_BUNDLE_VERSION) {
        const bundle = parseEvidenceBundle(artifactText);
        const report = createEvidenceReport(bundle);

        return succeed(renderReport(report, args.format));
      }

      if (version === MOCK_TRACE_ARTIFACT_VERSION) {
        const trace = parseMockExecutionTraceArtifact(artifactText);
        const report = createMockTraceReport(trace);

        return succeed(renderReport(report, args.format));
      }
    } catch (error) {
      return fail(`Invalid input artifact: ${errorMessage(error)}`);
    }
  }

  return fail("Unsupported input artifact version.");
}

async function runReplayCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<CliResult> {
  const args = parseReportArgs(argv);

  if (typeof args === "string") {
    return fail(args);
  }

  let artifactText: string;

  try {
    artifactText = await io.readFile(args.input);
  } catch (error) {
    return fail(`Could not read input artifact: ${errorMessage(error)}`);
  }

  let trace: MockExecutionTraceArtifact;

  try {
    trace = parseMockExecutionTraceArtifact(artifactText);
  } catch (error) {
    return fail(`Invalid input artifact: ${errorMessage(error)}`);
  }

  const replay = await replayMockExecutionTrace(trace);
  const report = createReplayReport(trace, replay);

  return {
    exitCode: replay.status === "matched" ? 0 : 1,
    stderr: "",
    stdout: renderReplayReport(report, args.format),
  };
}

function parseReportArgs(argv: readonly string[]): ReportArgs | string {
  let format: CliReportFormat = "human";
  let input: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Missing value for --input.";
      }

      input = value;
      index += 1;
      continue;
    }

    if (arg === "--format") {
      const value = argv[index + 1];

      if (value !== "human" && value !== "json") {
        return "Expected --format to be human or json.";
      }

      format = value;
      index += 1;
      continue;
    }

    return `Unknown report argument: ${String(arg)}.`;
  }

  if (input === undefined) {
    return "Missing required --input argument.";
  }

  return { format, input };
}

function createEvidenceReport(bundle: EvidenceBundle): EvidenceReport {
  const tokenEstimates = bundle.estimates
    .filter((event) => event.estimate.estimateKind === "token")
    .map(toEstimateReport);
  const costEstimates = bundle.costEstimates.map(toEstimateReport);
  const routingDecisions = bundle.routingDecisions.map(toRoutingReport);
  const validatorResults = bundle.validatorResults.map(toValidatorReport);
  const replayHandles = bundle.replay.handles.map((handle) => handle.ref);

  return {
    artifactKind: "evidence_bundle",
    costEstimates,
    passCount: bundle.passes.length,
    passes: bundle.passes.map((pass) => ({
      enabled: pass.enabled,
      name: pass.name,
      version: pass.version,
    })),
    planDiffChangeCount: bundle.planDiff.changes.length,
    plans: {
      optimized: bundle.optimizedPlan.planId,
      original: bundle.originalPlan.planId,
    },
    replay: {
      handles: replayHandles,
      mode: bundle.replay.mode,
    },
    reportWarnings: missingEvidenceSections({
      costEstimates,
      replayHandles,
      routingDecisions,
      tokenEstimates,
      validatorResults,
    }),
    routingDecisions,
    runId: bundle.runId,
    tokenEstimates,
    validatorResults,
    version: CLI_REPORT_VERSION,
    warnings: bundle.warnings.map(toWarningReport),
  };
}

function createMockTraceReport(
  trace: MockExecutionTraceArtifact,
): MockTraceReport {
  const validatorResults = trace.validatorResults.map(toValidatorReport);
  const reportWarnings = [
    ...(trace.evidenceBundleRef === undefined
      ? ["Missing evidence bundle reference."]
      : []),
    ...(validatorResults.length === 0 ? ["Missing validator results."] : []),
  ];

  return {
    artifactKind: "mock_trace",
    backend: trace.backend.provider,
    ...(trace.evidenceBundleRef !== undefined
      ? { evidenceBundleRef: trace.evidenceBundleRef.ref }
      : {}),
    planId: trace.plan.planId,
    reportWarnings,
    resultStatus: trace.result.status,
    stepCount: trace.steps.length,
    timing: {
      ...(trace.timing.durationMs !== undefined
        ? { durationMs: trace.timing.durationMs }
        : {}),
    },
    traceId: trace.traceId,
    validatorResults,
    version: CLI_REPORT_VERSION,
  };
}

function createReplayReport(
  trace: MockExecutionTraceArtifact,
  replay: MockExecutionTraceReplayResult,
): ReplayReport {
  return {
    artifactKind: "mock_trace_replay",
    backend: trace.backend.provider,
    mismatchCount: replay.mismatches.length,
    mismatches: replay.mismatches,
    outputCount: replay.result.outputs.length,
    planId: trace.plan.planId,
    replayStatus: replay.status,
    resultStatus: replay.result.status,
    traceId: replay.traceId,
    validatorResults: replay.result.validatorResults.map(toValidatorReport),
    version: CLI_REPLAY_VERSION,
  };
}

function missingEvidenceSections(input: {
  readonly costEstimates: readonly EstimateReport[];
  readonly replayHandles: readonly string[];
  readonly routingDecisions: readonly RoutingDecisionReport[];
  readonly tokenEstimates: readonly EstimateReport[];
  readonly validatorResults: readonly ValidatorReport[];
}): readonly string[] {
  return [
    ...(input.tokenEstimates.length === 0 ? ["Missing token estimates."] : []),
    ...(input.costEstimates.length === 0 ? ["Missing cost estimates."] : []),
    ...(input.routingDecisions.length === 0
      ? ["Missing routing decisions."]
      : []),
    ...(input.validatorResults.length === 0
      ? ["Missing validator results."]
      : []),
    ...(input.replayHandles.length === 0 ? ["Missing replay handles."] : []),
  ];
}

function renderReport(
  report: EvidenceReport | MockTraceReport,
  format: CliReportFormat,
): string {
  if (format === "json") {
    return `${stableStringify(report)}\n`;
  }

  if (report.artifactKind === "evidence_bundle") {
    return renderEvidenceHumanReport(report);
  }

  return renderMockTraceHumanReport(report);
}

function renderReplayReport(
  report: ReplayReport,
  format: CliReportFormat,
): string {
  if (format === "json") {
    return `${stableStringify(report)}\n`;
  }

  return renderReplayHumanReport(report);
}

function renderEvidenceHumanReport(report: EvidenceReport): string {
  const lines = [
    "Migaki Report",
    "Artifact: evidence_bundle",
    `Run: ${report.runId}`,
    `Plans: ${report.plans.original} -> ${report.plans.optimized}`,
    `Plan diff: ${report.planDiffChangeCount} ${plural(
      report.planDiffChangeCount,
      "change",
    )}`,
    "Passes:",
    ...formatList(
      report.passes,
      (pass) =>
        `- ${pass.name}@${pass.version} ${pass.enabled ? "enabled" : "disabled"}`,
    ),
    "Warnings:",
    ...formatList(
      report.warnings,
      (warning) =>
        `- [${warning.severity}] ${warning.code}: ${warning.message}`,
    ),
    "Estimates:",
    ...formatList(report.tokenEstimates, (estimate) =>
      formatEstimateLine("token", estimate),
    ),
    ...report.costEstimates.map((estimate) =>
      formatEstimateLine("cost", estimate),
    ),
    "Routing:",
    ...formatList(
      report.routingDecisions,
      (decision) =>
        `- ${decision.nodeId} -> ${decision.target}: ${decision.reason}`,
    ),
    "Validators:",
    ...formatList(
      report.validatorResults,
      (result) => `- ${result.validatorId}: ${result.status}`,
    ),
    `Replay: ${report.replay.mode} ${formatReplayHandles(
      report.replay.handles,
    )}`,
    ...formatReportWarnings(report.reportWarnings),
  ];

  return `${lines.join("\n")}\n`;
}

function renderReplayHumanReport(report: ReplayReport): string {
  const lines = [
    "Migaki Replay",
    "Artifact: mock_trace",
    `Trace: ${report.traceId}`,
    `Plan: ${report.planId}`,
    `Backend: ${report.backend}`,
    `Replay: ${report.replayStatus}`,
    `Result: ${report.resultStatus}`,
    "Mismatches:",
    ...formatList(report.mismatches, (mismatch) => `- ${mismatch}`),
    "Validators:",
    ...formatList(
      report.validatorResults,
      (result) => `- ${result.validatorId}: ${result.status}`,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function renderMockTraceHumanReport(report: MockTraceReport): string {
  const lines = [
    "Migaki Report",
    "Artifact: mock_trace",
    `Trace: ${report.traceId}`,
    `Plan: ${report.planId}`,
    `Backend: ${report.backend}`,
    `Result: ${report.resultStatus}`,
    `Steps: ${report.stepCount}`,
    `Duration: ${
      report.timing.durationMs === undefined
        ? "unknown"
        : `${report.timing.durationMs} ms`
    }`,
    "Validators:",
    ...formatList(
      report.validatorResults,
      (result) => `- ${result.validatorId}: ${result.status}`,
    ),
    ...formatReportWarnings(report.reportWarnings),
  ];

  return `${lines.join("\n")}\n`;
}

function toEstimateReport(event: EstimateEvidenceEvent): EstimateReport {
  return {
    subjectRef: event.estimate.subjectRef,
    unit: event.estimate.unit,
    ...(event.estimate.value !== undefined
      ? { value: event.estimate.value }
      : {}),
  };
}

function toRoutingReport(
  event: RoutingDecisionEvidenceEvent,
): RoutingDecisionReport {
  return {
    nodeId: event.routingDecision.nodeId,
    reason: event.routingDecision.reason,
    target: event.routingDecision.target,
  };
}

function toValidatorReport(
  event:
    | ValidatorResultEvidenceEvent
    | MockExecutionTraceArtifact["validatorResults"][number],
): ValidatorReport {
  if ("validatorResult" in event) {
    return {
      status: event.validatorResult.status,
      validatorId: event.validatorResult.validatorId,
    };
  }

  return {
    status: event.status,
    validatorId: event.validatorId,
  };
}

function toWarningReport(warning: PassWarning): WarningReport {
  return {
    code: warning.code,
    message: warning.message,
    severity: warning.severity,
  };
}

function formatEstimateLine(kind: string, estimate: EstimateReport): string {
  const value =
    estimate.value === undefined ? "unknown" : String(estimate.value);

  return `- ${kind} ${estimate.subjectRef}: ${value} ${estimate.unit}`;
}

function formatReplayHandles(handles: readonly string[]): string {
  if (handles.length === 0) {
    return "none";
  }

  return handles.join(", ");
}

function formatReportWarnings(warnings: readonly string[]): readonly string[] {
  if (warnings.length === 0) {
    return ["Report warnings: none"];
  }

  return ["Report warnings:", ...warnings.map((warning) => `- ${warning}`)];
}

function formatList<T>(
  items: readonly T[],
  formatItem: (item: T) => string,
): readonly string[] {
  if (items.length === 0) {
    return ["- none"];
  }

  return items.map(formatItem);
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function readArtifactVersion(serialized: string): string | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  const version = parsed["version"];

  return typeof version === "string" ? version : undefined;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    sorted[key] = toStableJsonValue(value[key]);
  }

  return sorted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function succeed(stdout: string): CliResult {
  return {
    exitCode: 0,
    stderr: "",
    stdout,
  };
}

function fail(stderr: string): CliResult {
  return {
    exitCode: 1,
    stderr: `${stderr}\n`,
    stdout: "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
