import {
  mkdir as makeDirectory,
  readFile as readTextFile,
  writeFile as writeTextFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  EXECUTION_EVENT_VERSION,
  EXECUTION_GRAPH_VERSION,
  EVIDENCE_BUNDLE_VERSION,
  MOCK_TRACE_ARTIFACT_VERSION,
  REUSE_DECISION_ARTIFACT_VERSION,
  compareObservedExecutionGraphs,
  createReuseDecisionArtifact,
  parseEvidenceBundle,
  parseMockExecutionTraceArtifact,
  renderExecutionReport,
  renderReuseDecisionArtifact,
  replayMockExecutionTrace,
  stableExecutionHash,
  type EvidenceBundle,
  type ExecutionGraph,
  type ExecutionNode,
  type EstimateEvidenceEvent,
  type MockExecutionTraceArtifact,
  type MockExecutionTraceReplayResult,
  type ObservedTrajectoryComparison,
  type PassWarning,
  type ReuseDecisionArtifact,
  type RoutingDecisionEvidenceEvent,
  type ValidatorResultEvidenceEvent,
} from "@migaki/runtime";

export const cliPackageName = "@migaki/cli";
export const cliPackageResponsibility =
  "Developer-facing report and replay command surfaces.";

export const CLI_REPORT_VERSION = "migaki.cli-report.v0";
export const CLI_REPLAY_VERSION = "migaki.cli-replay.v0";
export const CLI_TASK_SUITE_VERSION = "migaki.cli-task-suite.v0";

export type CliReportVersion = typeof CLI_REPORT_VERSION;
export type CliReplayVersion = typeof CLI_REPLAY_VERSION;
export type CliTaskSuiteVersion = typeof CLI_TASK_SUITE_VERSION;

export type CliReportFormat = "human" | "json";

export interface CliIo {
  readonly mkdir?: (path: string) => Promise<void> | void;
  readonly readFile: (path: string) => Promise<string> | string;
  readonly writeFile?: (path: string, contents: string) => Promise<void> | void;
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

interface TaskSuiteListArgs {
  readonly command: "list";
  readonly format: CliReportFormat;
}

interface TaskSuiteRunArgs {
  readonly command: "run";
  readonly format: CliReportFormat;
  readonly outputDir: string;
  readonly suite: string;
}

type StrictDogfoodStatus = "failed" | "not_checked" | "passed";

interface TaskSuiteMvpGateArgs {
  readonly command: "mvp-gate";
  readonly format: CliReportFormat;
  readonly outputDir: string;
  readonly strictDogfoodStatus: StrictDogfoodStatus;
}

type TaskSuiteArgs =
  | TaskSuiteListArgs
  | TaskSuiteMvpGateArgs
  | TaskSuiteRunArgs;

interface TaskSuiteDefinition {
  readonly description: string;
  readonly fixtureFamilies: readonly RepoAgentFixtureFamilyId[];
  readonly id: string;
}

interface TaskSuiteListReport {
  readonly artifactKind: "task_suite_list";
  readonly suites: readonly TaskSuiteListEntry[];
  readonly version: CliTaskSuiteVersion;
}

interface TaskSuiteListEntry {
  readonly description: string;
  readonly fixtureCount: number;
  readonly id: string;
  readonly missingRequiredFamilies: readonly RepoAgentFixtureFamilyId[];
}

interface TaskSuiteRunReport {
  readonly artifactKind: "task_suite_run";
  readonly coverage: TaskSuiteCoverageReport;
  readonly fixtures: readonly TaskSuiteFixtureReport[];
  readonly success: boolean;
  readonly suiteId: string;
  readonly version: CliTaskSuiteVersion;
  readonly warnings: readonly string[];
}

interface MvpRepoAgentGateReport {
  readonly artifactKind: "mvp_repo_agent_gate";
  readonly deterministicTaskSuiteSuccess: boolean;
  readonly fixtureArtifacts: readonly MvpGateFixtureArtifactSummary[];
  readonly strictDogfood: {
    readonly command: "mise run migaki:dogfood";
    readonly gatesDeterministicTaskSuite: false;
    readonly status: StrictDogfoodStatus;
  };
  readonly success: boolean;
  readonly suiteId: string;
  readonly summary: MvpRepoAgentGateSummary;
  readonly version: CliTaskSuiteVersion;
  readonly warnings: readonly string[];
}

interface MvpGateFixtureArtifactSummary {
  readonly artifacts: TaskSuiteFixtureArtifacts;
  readonly familyId: RepoAgentFixtureFamilyId;
}

interface MvpRepoAgentGateSummary {
  readonly blockedReasons: readonly MvpBlockedReasonSummary[];
  readonly coverage: TaskSuiteCoverageReport;
  readonly privacy: MvpPrivacySummary;
  readonly realizedSavings: {
    readonly actualSkippedActions: number;
    readonly status: "failed" | "passed";
  };
  readonly reuseDecisions: ReuseDecisionArtifact["summary"];
  readonly validators: {
    readonly required: readonly string[];
  };
}

interface MvpBlockedReasonSummary {
  readonly code: string;
  readonly count: number;
}

interface MvpPrivacyLeak {
  readonly artifact: string;
  readonly markers: readonly string[];
}

interface MvpPrivacySummary {
  readonly checkedArtifactCount: number;
  readonly leakedArtifacts: readonly MvpPrivacyLeak[];
  readonly metadataOnlyArtifactCount: number;
  readonly prohibitedMarkers: readonly string[];
  readonly status: "failed" | "passed";
}

interface TaskSuiteCoverageReport {
  readonly fixtureCount: number;
  readonly missingRequiredFamilies: readonly RepoAgentFixtureFamilyId[];
  readonly status: "complete" | "missing";
}

interface TaskSuiteFixtureArtifacts {
  readonly comparisonJson: string;
  readonly eventsJsonl: string;
  readonly graphJson: string;
  readonly reportMd: string;
  readonly reuseDecisionJson: string;
}

interface TaskSuiteFixtureReport {
  readonly artifacts: TaskSuiteFixtureArtifacts;
  readonly comparison: {
    readonly blockedCandidates: ObservedTrajectoryComparison["blockedCandidates"];
    readonly changedNodes: ObservedTrajectoryComparison["changedNodes"];
    readonly privacyPolicy: ObservedTrajectoryComparison["privacyPolicy"];
    readonly reusableModelCalls: ObservedTrajectoryComparison["reusableModelCalls"];
    readonly reusableToolCalls: ObservedTrajectoryComparison["reusableToolCalls"];
    readonly summary: ObservedTrajectoryComparison["summary"];
    readonly warnings: readonly { readonly code: string }[];
  };
  readonly familyId: RepoAgentFixtureFamilyId;
  readonly metrics: TaskSuiteMetricsReport;
  readonly reuseDecision: {
    readonly privacyPolicy: ReuseDecisionArtifact["privacyPolicy"];
    readonly redaction: ReuseDecisionArtifact["redaction"];
    readonly summary: ReuseDecisionArtifact["summary"];
  };
}

interface TaskSuiteMetricsReport {
  readonly actualSkippedActions: 0;
  readonly allowed: number;
  readonly blocked: number;
  readonly changedNodes: number;
  readonly estimatedAvoidableCostUsd?: number;
  readonly estimatedAvoidableLatencyMs?: number;
  readonly estimatedAvoidableTokens?: number;
  readonly needsReview: number;
  readonly totalCandidates: number;
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

interface ReuseDecisionReport {
  readonly allowed: number;
  readonly artifactKind: "reuse_decision";
  readonly blocked: number;
  readonly comparison: {
    readonly currentRunId: string;
    readonly previousRunId: string;
  };
  readonly decisions: readonly ReuseDecisionSummaryReport[];
  readonly needsReview: number;
  readonly version: CliReportVersion;
}

interface ReuseDecisionSummaryReport {
  readonly nodeId: string;
  readonly operationKind: string;
  readonly reasons: readonly string[];
  readonly status: string;
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
  mkdir(path) {
    return makeDirectory(path, { recursive: true }).then(() => undefined);
  },
  readFile(path) {
    return readTextFile(path, "utf8");
  },
  writeFile(path, contents) {
    return writeTextFile(path, contents, "utf8");
  },
};

const repoAgentFixtureFamilyIds = [
  "read-only-reconnaissance",
  "implementation-and-debug",
  "ci-and-toolchain-triage",
  "docs-and-wiki-alignment",
  "issue-planning-and-blocker-maintenance",
  "pr-review-and-merge-readiness",
  "evidence-promotion-and-handoff",
] as const;

type RepoAgentFixtureFamilyId = (typeof repoAgentFixtureFamilyIds)[number];

const mvpRepoAgentSuiteId = "repo-agent-mvp";

const prohibitedDefaultArtifactMarkers = [
  { id: "raw_prompt", marker: "raw customer prompt" },
  { id: "tool_input", marker: "tool-input-secret" },
  { id: "tool_output", marker: "tool-output-secret" },
  { id: "provider_response", marker: "provider-response-secret" },
  { id: "credential", marker: "sk-live-promotion-fixture" },
  { id: "local_machine_path", marker: "/Users/" },
] as const;

const taskSuites: readonly TaskSuiteDefinition[] = [
  {
    description: "No repo-agent fixtures; useful for coverage gates.",
    fixtureFamilies: [],
    id: "repo-agent-empty",
  },
  {
    description: "One read-only repo-agent fixture.",
    fixtureFamilies: ["read-only-reconnaissance"],
    id: "repo-agent-readonly",
  },
  {
    description: "One implementation-and-debug repo-agent fixture.",
    fixtureFamilies: ["implementation-and-debug"],
    id: "repo-agent-implementation-debug",
  },
  {
    description: "One CI and toolchain triage repo-agent fixture.",
    fixtureFamilies: ["ci-and-toolchain-triage"],
    id: "repo-agent-ci-toolchain-triage",
  },
  {
    description: "One docs and wiki alignment repo-agent fixture.",
    fixtureFamilies: ["docs-and-wiki-alignment"],
    id: "repo-agent-docs-wiki-alignment",
  },
  {
    description:
      "One issue planning and blocker maintenance repo-agent fixture.",
    fixtureFamilies: ["issue-planning-and-blocker-maintenance"],
    id: "repo-agent-issue-planning-blockers",
  },
  {
    description: "One PR review and merge-readiness repo-agent fixture.",
    fixtureFamilies: ["pr-review-and-merge-readiness"],
    id: "repo-agent-pr-review-merge-readiness",
  },
  {
    description: "One evidence promotion and handoff repo-agent fixture.",
    fixtureFamilies: ["evidence-promotion-and-handoff"],
    id: "repo-agent-evidence-promotion-handoff",
  },
  {
    description: "All MVP repo-agent task ladder fixture families.",
    fixtureFamilies: repoAgentFixtureFamilyIds,
    id: mvpRepoAgentSuiteId,
  },
];

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

  if (command === "task-suite") {
    return runTaskSuiteCommand(argv.slice(1), io);
  }

  return fail(
    "Usage: migaki <report|replay|task-suite> --input <artifact.json> [--format human|json]",
  );
}

async function runTaskSuiteCommand(
  argv: readonly string[],
  io: CliIo,
): Promise<CliResult> {
  const args = parseTaskSuiteArgs(argv);

  if (typeof args === "string") {
    return fail(args);
  }

  if (args.command === "list") {
    return succeed(
      renderTaskSuiteListReport(createTaskSuiteListReport(), args.format),
    );
  }

  if (args.command === "mvp-gate") {
    const suite = requireTaskSuite(mvpRepoAgentSuiteId);
    const privacyIo = createPrivacyCheckingIo(io);

    let report: TaskSuiteRunReport;

    try {
      report = await createTaskSuiteRunReport(suite, args.outputDir, privacyIo);
    } catch (error) {
      return fail(`Could not run MVP repo-agent gate: ${errorMessage(error)}`);
    }

    const gate = createMvpRepoAgentGateReport(
      report,
      privacyIo.leakedArtifacts,
      args.strictDogfoodStatus,
    );

    return {
      exitCode: gate.success ? 0 : 1,
      stderr: "",
      stdout: renderMvpRepoAgentGateReport(gate, args.format),
    };
  }

  const suite = taskSuites.find((candidate) => candidate.id === args.suite);

  if (suite === undefined) {
    return fail(`Unknown task suite: ${args.suite}.`);
  }

  let report: TaskSuiteRunReport;

  try {
    report = await createTaskSuiteRunReport(suite, args.outputDir, io);
  } catch (error) {
    return fail(`Could not run task suite: ${errorMessage(error)}`);
  }

  return {
    exitCode: report.success ? 0 : 1,
    stderr: "",
    stdout: renderTaskSuiteRunReport(report, args.format),
  };
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

      if (version === REUSE_DECISION_ARTIFACT_VERSION) {
        const artifact = parseReuseDecisionArtifact(artifactText);

        if (args.format === "human") {
          return succeed(renderReuseDecisionArtifact(artifact, "human"));
        }

        return succeed(
          `${stableStringify(createReuseDecisionReport(artifact))}\n`,
        );
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

function parseTaskSuiteArgs(argv: readonly string[]): TaskSuiteArgs | string {
  const subcommand = argv[0];

  if (
    subcommand !== "list" &&
    subcommand !== "run" &&
    subcommand !== "mvp-gate"
  ) {
    return "Usage: migaki task-suite <list|run|mvp-gate> [--suite suite-id] [--output-dir dir] [--format human|json] [--strict-dogfood-status passed|failed|not_checked]";
  }

  let format: CliReportFormat = "human";
  let outputDir = ".migaki/task-suites";
  let suite: string | undefined;
  let strictDogfoodStatus: StrictDogfoodStatus = "not_checked";

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--format") {
      const value = argv[index + 1];

      if (value !== "human" && value !== "json") {
        return "Expected --format to be human or json.";
      }

      format = value;
      index += 1;
      continue;
    }

    if (arg === "--suite" && subcommand === "run") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Missing value for --suite.";
      }

      suite = value;
      index += 1;
      continue;
    }

    if (arg === "--output-dir" && subcommand === "run") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Missing value for --output-dir.";
      }

      outputDir = value;
      index += 1;
      continue;
    }

    if (arg === "--output-dir" && subcommand === "mvp-gate") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return "Missing value for --output-dir.";
      }

      outputDir = value;
      index += 1;
      continue;
    }

    if (arg === "--strict-dogfood-status" && subcommand === "mvp-gate") {
      const value = argv[index + 1];

      if (value !== "failed" && value !== "not_checked" && value !== "passed") {
        return "Expected --strict-dogfood-status to be passed, failed, or not_checked.";
      }

      strictDogfoodStatus = value;
      index += 1;
      continue;
    }

    return `Unknown task-suite argument: ${String(arg)}.`;
  }

  if (subcommand === "list") {
    return { command: "list", format };
  }

  if (subcommand === "mvp-gate") {
    return {
      command: "mvp-gate",
      format,
      outputDir,
      strictDogfoodStatus,
    };
  }

  if (suite === undefined) {
    return "Missing required --suite argument.";
  }

  return {
    command: "run",
    format,
    outputDir,
    suite,
  };
}

function requireTaskSuite(id: string): TaskSuiteDefinition {
  const suite = taskSuites.find((candidate) => candidate.id === id);

  if (suite === undefined) {
    throw new Error(`Missing task suite: ${id}.`);
  }

  return suite;
}

function createPrivacyCheckingIo(io: CliIo): CliIo & {
  readonly leakedArtifacts: readonly MvpPrivacyLeak[];
} {
  const leakedArtifacts: MvpPrivacyLeak[] = [];
  const mkdir = io.mkdir;

  return {
    ...(mkdir === undefined ? {} : { mkdir }),
    leakedArtifacts,
    readFile: io.readFile,
    async writeFile(path, contents): Promise<void> {
      const markers = prohibitedDefaultArtifactMarkers
        .filter(({ marker }) => contents.includes(marker))
        .map(({ id }) => id);

      if (markers.length > 0) {
        leakedArtifacts.push({ artifact: path, markers });
      }

      if (io.writeFile === undefined) {
        throw new Error("Task-suite run requires a writeFile-capable CLI IO.");
      }

      await io.writeFile(path, contents);
    },
  };
}

function createTaskSuiteListReport(): TaskSuiteListReport {
  return {
    artifactKind: "task_suite_list",
    suites: taskSuites.map((suite) => ({
      description: suite.description,
      fixtureCount: suite.fixtureFamilies.length,
      id: suite.id,
      missingRequiredFamilies: missingRequiredFamilies(suite.fixtureFamilies),
    })),
    version: CLI_TASK_SUITE_VERSION,
  };
}

async function createTaskSuiteRunReport(
  suite: TaskSuiteDefinition,
  outputDir: string,
  io: CliIo,
): Promise<TaskSuiteRunReport> {
  const fixtures: TaskSuiteFixtureReport[] = [];

  for (const familyId of suite.fixtureFamilies) {
    fixtures.push(await runRepoAgentFixture(suite.id, familyId, outputDir, io));
  }

  const missing = missingRequiredFamilies(suite.fixtureFamilies);
  const coverage: TaskSuiteCoverageReport = {
    fixtureCount: fixtures.length,
    missingRequiredFamilies: missing,
    status: missing.length === 0 ? "complete" : "missing",
  };
  const warnings =
    missing.length === 0
      ? []
      : [`Missing fixture coverage for ${missing.join(", ")}.`];

  return {
    artifactKind: "task_suite_run",
    coverage,
    fixtures,
    success: warnings.length === 0,
    suiteId: suite.id,
    version: CLI_TASK_SUITE_VERSION,
    warnings,
  };
}

async function runRepoAgentFixture(
  suiteId: string,
  familyId: RepoAgentFixtureFamilyId,
  outputDir: string,
  io: CliIo,
): Promise<TaskSuiteFixtureReport> {
  const fixture = createRepoAgentFixture(familyId);
  const comparison = compareObservedExecutionGraphs(
    fixture.previousGraph,
    fixture.currentGraph,
  );
  const reuseDecision = createReuseDecisionArtifact(comparison, {
    createdAt: "2026-01-01T00:00:02.000Z",
  });
  const artifacts = fixtureArtifactPaths(outputDir, suiteId, familyId);
  const report = renderTaskSuiteFixtureReport({
    artifacts,
    comparison,
    familyId,
    graph: fixture.currentGraph,
    reuseDecision,
  });

  await writeTaskSuiteArtifact(io, artifacts.eventsJsonl, fixture.eventsJsonl);
  await writeTaskSuiteArtifact(
    io,
    artifacts.graphJson,
    `${stableStringify(fixture.currentGraph)}\n`,
  );
  await writeTaskSuiteArtifact(
    io,
    artifacts.comparisonJson,
    `${stableStringify(comparison)}\n`,
  );
  await writeTaskSuiteArtifact(
    io,
    artifacts.reuseDecisionJson,
    renderReuseDecisionArtifact(reuseDecision, "json"),
  );
  await writeTaskSuiteArtifact(io, artifacts.reportMd, report);

  return {
    artifacts,
    comparison: {
      blockedCandidates: comparison.blockedCandidates,
      changedNodes: comparison.changedNodes,
      privacyPolicy: comparison.privacyPolicy,
      reusableModelCalls: comparison.reusableModelCalls,
      reusableToolCalls: comparison.reusableToolCalls,
      summary: comparison.summary,
      warnings: comparison.warnings.map((warning) => ({
        code: warning.code,
      })),
    },
    familyId,
    metrics: {
      actualSkippedActions: 0,
      allowed: reuseDecision.summary.allowed,
      blocked: reuseDecision.summary.blocked,
      changedNodes: comparison.summary.changedNodes,
      ...(comparison.summary.totalEstimatedAvoidableCostUsd === undefined
        ? {}
        : {
            estimatedAvoidableCostUsd:
              comparison.summary.totalEstimatedAvoidableCostUsd,
          }),
      ...(comparison.summary.totalEstimatedAvoidableLatencyMs === undefined
        ? {}
        : {
            estimatedAvoidableLatencyMs:
              comparison.summary.totalEstimatedAvoidableLatencyMs,
          }),
      ...(comparison.summary.totalEstimatedAvoidableTokens === undefined
        ? {}
        : {
            estimatedAvoidableTokens:
              comparison.summary.totalEstimatedAvoidableTokens,
          }),
      needsReview: reuseDecision.summary.needsReview,
      totalCandidates: reuseDecision.summary.totalCandidates,
    },
    reuseDecision: {
      privacyPolicy: reuseDecision.privacyPolicy,
      redaction: reuseDecision.redaction,
      summary: reuseDecision.summary,
    },
  };
}

function createRepoAgentFixture(familyId: RepoAgentFixtureFamilyId): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  if (familyId === "read-only-reconnaissance") {
    return createReadOnlyReconnaissanceFixture(familyId);
  }

  if (familyId === "implementation-and-debug") {
    return createImplementationAndDebugFixture(familyId);
  }

  if (familyId === "ci-and-toolchain-triage") {
    return createCiAndToolchainTriageFixture(familyId);
  }

  if (familyId === "docs-and-wiki-alignment") {
    return createDocsAndWikiAlignmentFixture(familyId);
  }

  if (familyId === "issue-planning-and-blocker-maintenance") {
    return createIssuePlanningAndBlockerMaintenanceFixture(familyId);
  }

  if (familyId === "pr-review-and-merge-readiness") {
    return createPrReviewAndMergeReadinessFixture(familyId);
  }

  if (familyId === "evidence-promotion-and-handoff") {
    return createEvidencePromotionAndHandoffFixture(familyId);
  }

  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;
  const previousGraph = graph(previousRunId, familyId, [
    modelNode(`${familyId}-model-summary`, familyId, "model-summary"),
    toolNode(`${familyId}-tool-read`, familyId, "tool-read", {
      artifacts: [fileArtifact(`${familyId}-file`, "file-v1", "verified")],
      sideEffectClass: "read_only",
    }),
    toolNode(`${familyId}-tool-unknown`, familyId, "tool-unknown", {
      sideEffectClass: "unknown",
    }),
    modelNode(`${familyId}-model-changed`, familyId, "model-changed-v1"),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    modelNode(`${familyId}-model-summary`, familyId, "model-summary"),
    toolNode(`${familyId}-tool-read`, familyId, "tool-read", {
      artifacts: [fileArtifact(`${familyId}-file`, "file-v1", "verified")],
      sideEffectClass: "read_only",
    }),
    toolNode(`${familyId}-tool-unknown`, familyId, "tool-unknown", {
      sideEffectClass: "unknown",
    }),
    modelNode(`${familyId}-model-changed`, familyId, "model-changed-v2"),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function createEvidencePromotionAndHandoffFixture(
  familyId: RepoAgentFixtureFamilyId,
): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;
  const rawRunPrevious = {
    evidencePromotion: {
      candidateRunId: "codex-turn-evidence-promotion-a",
      sourceArtifact:
        ".migaki/runs/codex-turn-evidence-promotion-a/events.jsonl",
      stateBoundary: "short_lived_local_session_state",
      stage: "raw_run_inspection",
    },
  };
  const rawRunCurrent = {
    evidencePromotion: {
      candidateRunId: "codex-turn-evidence-promotion-b",
      sourceArtifact:
        ".migaki/runs/codex-turn-evidence-promotion-b/events.jsonl",
      stateBoundary: "short_lived_local_session_state",
      stage: "raw_run_inspection",
    },
  };
  const manifestMetadata = {
    evidencePromotion: {
      artifact: "manifest.json",
      omittedFields: [
        "prompt",
        "tool_input",
        "tool_output",
        "provider_response",
        "credential",
        "local_machine_path",
      ],
      privacyPolicy: "migaki.evidence-privacy-policy.v0",
      stage: "manifest_metadata",
      stateBoundary: "promoted_project_knowledge",
    },
  };
  const graphSummaryMetadata = {
    evidencePromotion: {
      artifact: "graph-summary.json",
      redactionStatus: "passed",
      stage: "graph_summary",
      stateBoundary: "promoted_project_knowledge",
    },
  };
  const redactionAuditMetadata = {
    evidencePromotion: {
      explicitOmissionRecords: [
        "prompt",
        "tool_input",
        "tool_output",
        "provider_response",
        "credential",
        "local_machine_path",
      ],
      stage: "redaction_audit",
      status: "passed",
    },
  };
  const adviceMetadata = {
    evidencePromotion: {
      adviceArtifact: "advice.json",
      omissionRecordsInherited: true,
      privacyMode: "metadata_only",
      stage: "reuse_advice",
    },
  };
  const provenanceMetadata = {
    evidencePromotion: {
      artifactProvenance: "source fingerprints only",
      localPathPolicy: "omit",
      stage: "artifact_provenance_summary",
    },
  };
  const handoffPrevious = {
    handoff: {
      checksBlocked: ["github-code-quality-pending-pr"],
      checksRun: ["focused-task-suite-test"],
      completedWork: ["manifest-metadata", "graph-summary"],
      nextEligibleIssue: "#158",
      remainingBlockers: ["#159 blocked by #158"],
      stage: "handoff_summary",
    },
  };
  const handoffCurrent = {
    handoff: {
      checksBlocked: ["github-code-quality-pending-pr"],
      checksRun: ["focused-task-suite-test", "mise-run-check"],
      completedWork: ["manifest-metadata", "graph-summary", "reuse-advice"],
      nextEligibleIssue: "#159 after #158 merges",
      remainingBlockers: ["#159 blocked by #158"],
      stage: "handoff_summary",
    },
  };
  const promotionCommandMetadata = {
    evidencePromotion: {
      command: "migaki:promote",
      stage: "promotion_command",
      writesProjectArtifacts: true,
    },
    reuse: {
      policyAllowed: true,
      sideEffectClass: "approval_required",
    },
  };

  const previousGraph = graph(previousRunId, familyId, [
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-raw-run-inspection`,
      familyId,
      "raw-run-selection:a",
      rawRunPrevious,
    ),
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-promote-manifest`,
      familyId,
      "manifest:redacted:v1",
      manifestMetadata,
      {
        artifacts: [
          {
            fingerprint: stableExecutionHash({
              artifact: "manifest",
              omittedFields: "privacy-contract-v1",
            }),
            id: `${familyId}-manifest`,
            kind: "manifest",
            metadata: {
              redaction: {
                mode: "omitted",
                reason:
                  "Raw prompts, tool payloads, provider responses, credentials, and local paths are omitted.",
              },
            },
          },
        ],
      },
    ),
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-graph-summary`,
      familyId,
      "graph-summary:redacted:v1",
      graphSummaryMetadata,
    ),
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-redaction-audit`,
      familyId,
      "redaction-audit:passed:v1",
      redactionAuditMetadata,
    ),
    evidencePromotionModelNode(
      `${familyId}-model-reuse-advice`,
      familyId,
      "reuse-advice:metadata-only:v1",
      adviceMetadata,
    ),
    evidencePromotionModelNode(
      `${familyId}-model-artifact-provenance`,
      familyId,
      "artifact-provenance:v1",
      provenanceMetadata,
    ),
    evidencePromotionToolNode(
      `${familyId}-tool-promote-command`,
      familyId,
      "promotion-command:v1",
      promotionCommandMetadata,
    ),
    evidencePromotionModelNode(
      `${familyId}-model-handoff-summary`,
      familyId,
      "handoff-summary:before-check:v1",
      handoffPrevious,
    ),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-raw-run-inspection`,
      familyId,
      "raw-run-selection:b",
      rawRunCurrent,
    ),
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-promote-manifest`,
      familyId,
      "manifest:redacted:v1",
      manifestMetadata,
      {
        artifacts: [
          {
            fingerprint: stableExecutionHash({
              artifact: "manifest",
              omittedFields: "privacy-contract-v1",
            }),
            id: `${familyId}-manifest`,
            kind: "manifest",
            metadata: {
              redaction: {
                mode: "omitted",
                reason:
                  "Raw prompts, tool payloads, provider responses, credentials, and local paths are omitted.",
              },
            },
          },
        ],
      },
    ),
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-graph-summary`,
      familyId,
      "graph-summary:redacted:v1",
      graphSummaryMetadata,
    ),
    evidencePromotionReadOnlyToolNode(
      `${familyId}-tool-redaction-audit`,
      familyId,
      "redaction-audit:passed:v1",
      redactionAuditMetadata,
    ),
    evidencePromotionModelNode(
      `${familyId}-model-reuse-advice`,
      familyId,
      "reuse-advice:metadata-only:v1",
      adviceMetadata,
    ),
    evidencePromotionModelNode(
      `${familyId}-model-artifact-provenance`,
      familyId,
      "artifact-provenance:v1",
      provenanceMetadata,
    ),
    evidencePromotionToolNode(
      `${familyId}-tool-promote-command`,
      familyId,
      "promotion-command:v1",
      promotionCommandMetadata,
    ),
    evidencePromotionModelNode(
      `${familyId}-model-handoff-summary`,
      familyId,
      "handoff-summary:after-check:v1",
      handoffCurrent,
    ),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function createIssuePlanningAndBlockerMaintenanceFixture(
  familyId: RepoAgentFixtureFamilyId,
): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;
  const skippedStatusLabels = [
    "status:blocked",
    "status:claimed",
    "status:in-review",
  ] as const;
  const previousSnapshotMetadata = {
    issuePlanning: {
      blockerGraphFingerprint: "blocker-graph-before-155-close",
      deterministicScmMetadata: true,
      milestone: "MVP repo-agent task ladder",
      openBlockers: ["#155"],
      readyIssues: ["#154", "#156", "#157"],
      stage: "issue_metadata_snapshot",
    },
  };
  const currentSnapshotMetadata = {
    issuePlanning: {
      blockerGraphFingerprint: "blocker-graph-after-155-close",
      closedBlockers: ["#155"],
      deterministicScmMetadata: true,
      milestone: "MVP repo-agent task ladder",
      readyIssues: ["#154", "#156", "#157"],
      stage: "issue_metadata_snapshot",
    },
  };
  const previousBlockerSummaryMetadata = {
    issuePlanning: {
      beforeBlockerClosureEligibleIssues: ["#154"],
      blockerReferences: [{ blocker: "#155", issue: "#156" }],
      openBlockers: ["#155"],
      skippedOpenBlockers: ["#156", "#157"],
      stage: "blocker_graph_summary",
    },
  };
  const currentBlockerSummaryMetadata = {
    issuePlanning: {
      afterBlockerClosureEligibleIssues: ["#156"],
      beforeBlockerClosureEligibleIssues: ["#154"],
      blockerReferences: [{ blocker: "#155", issue: "#156" }],
      closedBlockers: ["#155"],
      skippedOpenBlockers: ["#157"],
      stage: "blocker_graph_summary",
    },
  };
  const statusLabelMetadata = {
    issuePlanning: {
      skippedIssues: ["#160", "#158", "#161"],
      skippedStatusLabels,
      stage: "status_label_scan",
    },
  };
  const openWorkMetadata = {
    issuePlanning: {
      activeClaimIssue: "#158",
      openPrIssue: "#159",
      stage: "open_work_scan",
    },
  };
  const adoptionGateMetadata = {
    issuePlanning: {
      activeClaimIssue: "#158",
      adoptionDecision: "adopt_existing_work_before_new_issue",
      openPrIssue: "#159",
      stage: "adoption_gate",
    },
  };
  const issueBodyMetadata = {
    issuePlanning: {
      blockedByLines: ["Blocked by: #156"],
      bodyFields: [
        "project_purpose",
        "acceptance_criteria",
        "labels",
        "validation",
        "blocked_by",
      ],
      labels: ["status:ready", "priority:p0", "stage:v0"],
      stage: "issue_body_draft",
      validation: [". scripts/env && mise run check"],
    },
  };

  const previousGraph = graph(previousRunId, familyId, [
    issuePlanningReadOnlyToolNode(
      `${familyId}-tool-issue-metadata-snapshot`,
      familyId,
      "issue-snapshot:blocker-open:v1",
      previousSnapshotMetadata,
    ),
    issuePlanningModelNode(
      `${familyId}-model-blocker-summary`,
      familyId,
      "blocker-summary:#155-open:v1",
      previousBlockerSummaryMetadata,
    ),
    issuePlanningReadOnlyToolNode(
      `${familyId}-tool-status-label-scan`,
      familyId,
      "status-label-scan:v1",
      statusLabelMetadata,
    ),
    issuePlanningReadOnlyToolNode(
      `${familyId}-tool-open-work-scan`,
      familyId,
      "open-work-scan:v1",
      openWorkMetadata,
    ),
    issuePlanningDecisionNode(
      `${familyId}-tool-adoption-gate`,
      familyId,
      "adoption-gate:open-work-first:v1",
      adoptionGateMetadata,
    ),
    issuePlanningModelNode(
      `${familyId}-model-issue-body-draft`,
      familyId,
      "issue-body-template:v1",
      issueBodyMetadata,
    ),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    issuePlanningReadOnlyToolNode(
      `${familyId}-tool-issue-metadata-snapshot`,
      familyId,
      "issue-snapshot:blocker-closed:v1",
      currentSnapshotMetadata,
    ),
    issuePlanningModelNode(
      `${familyId}-model-blocker-summary`,
      familyId,
      "blocker-summary:#155-closed:v1",
      currentBlockerSummaryMetadata,
    ),
    issuePlanningReadOnlyToolNode(
      `${familyId}-tool-status-label-scan`,
      familyId,
      "status-label-scan:v1",
      statusLabelMetadata,
    ),
    issuePlanningReadOnlyToolNode(
      `${familyId}-tool-open-work-scan`,
      familyId,
      "open-work-scan:v1",
      openWorkMetadata,
    ),
    issuePlanningDecisionNode(
      `${familyId}-tool-adoption-gate`,
      familyId,
      "adoption-gate:open-work-first:v1",
      adoptionGateMetadata,
    ),
    issuePlanningModelNode(
      `${familyId}-model-issue-body-draft`,
      familyId,
      "issue-body-template:v1",
      issueBodyMetadata,
    ),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function createDocsAndWikiAlignmentFixture(
  familyId: RepoAgentFixtureFamilyId,
): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;
  const repoContractMetadata = {
    docsWikiAlignment: {
      claimStatus: "aligned",
      destination: "docs/README.md",
      evidenceKind: "source_excerpt",
      freshnessLabel: "verified",
      sourceIdentity: "repo:docs/README.md",
      sourceKind: "repo_contract_doc",
    },
  };
  const wikiRoadmapMetadata = {
    docsWikiAlignment: {
      claimStatus: "aligned",
      destination: "wiki:v0-Roadmap",
      evidenceKind: "wiki_excerpt",
      freshnessLabel: "verified",
      sourceIdentity: "wiki:v0-Roadmap",
      sourceKind: "wiki_roadmap",
    },
  };
  const staleWikiMetadata = {
    docsWikiAlignment: {
      claimStatus: "stale",
      destination: "docs/README.md",
      evidenceKind: "wiki_excerpt",
      freshnessLabel: "needs_review",
      sourceIdentity: "wiki:v0-Roadmap",
      sourceKind: "wiki_roadmap",
    },
  };
  const previousStaleReadmeMetadata = {
    docsWikiAlignment: {
      claimStatus: "stale",
      destination: "README.md",
      evidenceKind: "repo_excerpt",
      freshnessLabel: "verified",
      sourceIdentity: "repo:README.md",
      sourceKind: "repo_readme",
    },
  };
  const currentStaleReadmeMetadata = {
    docsWikiAlignment: {
      claimStatus: "stale",
      decision: "change_repo_docs",
      destination: "README.md",
      evidenceKind: "repo_excerpt",
      freshnessLabel: "verified",
      sourceIdentity: "repo:README.md",
      sourceKind: "repo_readme",
    },
  };
  const whitepaperMetadata = {
    docsWikiAlignment: {
      claimStatus: "whitepaper_only",
      decision: "do_not_copy_to_repo_contract_docs",
      destination: "wiki:whitepaper",
      evidenceKind: "external_excerpt",
      freshnessLabel: "verified",
      sourceIdentity: "external:whitepaper:v0.4",
      sourceKind: "whitepaper_note",
    },
  };
  const summaryMetadata = {
    docsWikiAlignment: {
      alignedClaimCount: 2,
      changeDocs: ["README.md"],
      doNotChangeDocs: ["docs/evidence-bundles-v0.md"],
      staleClaimCount: 1,
      stage: "claim_alignment_summary",
      transformedSummary: true,
      whitepaperOnlyClaimCount: 1,
    },
  };

  const previousGraph = graph(previousRunId, familyId, [
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-repo-contract-claim`,
      familyId,
      "read:repo-contract-docs:docs-readme:v1",
      repoContractMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-repo-contract-claim`,
            "repo-contract-docs-readme-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "repo-docs-readme-claim-v1",
                sourceIdentity: "repo:docs/README.md",
                sourceLabel: "Repository docs README excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-wiki-roadmap-claim`,
      familyId,
      "read:wiki-roadmap:v0:v1",
      wikiRoadmapMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-wiki-roadmap-claim`,
            "wiki-roadmap-v0-claim-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "wiki-roadmap-v0-claim-v1",
                sourceIdentity: "wiki:v0-Roadmap",
                sourceLabel: "Wiki v0 Roadmap excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-stale-wiki-claim`,
      familyId,
      "read:wiki-roadmap:stale-docs-claim:v1",
      staleWikiMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-stale-wiki-claim`,
            "wiki-stale-docs-claim-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "wiki-stale-docs-claim-v1",
                sourceIdentity: "wiki:v0-Roadmap",
                sourceLabel: "Wiki stale docs claim excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-stale-readme-claim`,
      familyId,
      "read:repo-readme:stale-claim:v1",
      previousStaleReadmeMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-stale-readme-claim`,
            "repo-readme-stale-claim-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "repo-readme-stale-claim-v1",
                sourceIdentity: "repo:README.md",
                sourceLabel: "Repository README stale claim excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-whitepaper-only-claim`,
      familyId,
      "read:whitepaper:v0.4:long-term-note:v1",
      whitepaperMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-whitepaper-only-claim`,
            "whitepaper-v0.4-note-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "whitepaper-v0.4-note-v1",
                sourceIdentity: "external:whitepaper:v0.4",
                sourceLabel: "Whitepaper v0.4 notes excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiModelNode(
      `${familyId}-model-claim-alignment-summary`,
      familyId,
      "claim-alignment-summary:v1",
      summaryMetadata,
    ),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-repo-contract-claim`,
      familyId,
      "read:repo-contract-docs:docs-readme:v1",
      repoContractMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-repo-contract-claim`,
            "repo-contract-docs-readme-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "repo-docs-readme-claim-v1",
                sourceIdentity: "repo:docs/README.md",
                sourceLabel: "Repository docs README excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-wiki-roadmap-claim`,
      familyId,
      "read:wiki-roadmap:v0:v1",
      wikiRoadmapMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-wiki-roadmap-claim`,
            "wiki-roadmap-v0-claim-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "wiki-roadmap-v0-claim-v1",
                sourceIdentity: "wiki:v0-Roadmap",
                sourceLabel: "Wiki v0 Roadmap excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-stale-wiki-claim`,
      familyId,
      "read:wiki-roadmap:stale-docs-claim:v1",
      staleWikiMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-stale-wiki-claim`,
            "wiki-stale-docs-claim-v1",
            "unknown",
            {
              codex: {
                excerptFingerprint: "wiki-stale-docs-claim-v1",
                sourceIdentity: "wiki:v0-Roadmap",
                sourceLabel: "Wiki stale docs claim excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-stale-readme-claim`,
      familyId,
      "read:repo-readme:stale-claim:v2",
      currentStaleReadmeMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-stale-readme-claim`,
            "repo-readme-stale-claim-v2",
            "verified",
            {
              codex: {
                excerptFingerprint: "repo-readme-stale-claim-v2",
                sourceIdentity: "repo:README.md",
                sourceLabel: "Repository README stale claim excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiReadOnlyToolNode(
      `${familyId}-tool-read-whitepaper-only-claim`,
      familyId,
      "read:whitepaper:v0.4:long-term-note:v1",
      whitepaperMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-whitepaper-only-claim`,
            "whitepaper-v0.4-note-v1",
            "verified",
            {
              codex: {
                excerptFingerprint: "whitepaper-v0.4-note-v1",
                sourceIdentity: "external:whitepaper:v0.4",
                sourceLabel: "Whitepaper v0.4 notes excerpt",
              },
            },
          ),
        ],
      },
    ),
    docsWikiModelNode(
      `${familyId}-model-claim-alignment-summary`,
      familyId,
      "claim-alignment-summary:v1",
      summaryMetadata,
    ),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function createImplementationAndDebugFixture(
  familyId: RepoAgentFixtureFamilyId,
): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;

  const previousGraph = graph(previousRunId, familyId, [
    implementationToolNode(
      `${familyId}-tool-context-search`,
      familyId,
      "search:implementation-debug:repo-fingerprint-a",
      {
        implementationDebug: {
          repositoryFingerprint: "repo-fingerprint-a",
          stage: "context_search",
        },
      },
    ),
    implementationToolNode(
      `${familyId}-tool-context-read`,
      familyId,
      "read:packages/cli/src/index.ts:task-suite:repo-fingerprint-a",
      {
        implementationDebug: {
          pathFingerprint: "packages-cli-index-task-suite",
          range: "task-suite",
          repositoryFingerprint: "repo-fingerprint-a",
          stage: "context_read",
        },
      },
      {
        artifacts: [
          fileArtifact(
            `${familyId}-context-file`,
            "context-file-a",
            "verified",
            {
              codex: {
                fileContentFingerprint: "cli-task-suite-fixture-a",
                sourceEquivalenceKey:
                  "read:packages/cli/src/index.ts:task-suite",
                sourceLabel:
                  "Read packages/cli/src/index.ts task-suite section",
              },
            },
          ),
        ],
      },
    ),
    implementationModelNode(
      `${familyId}-model-patch-plan`,
      familyId,
      "patch-plan:two-step-debug:v1",
      {
        implementationDebug: {
          stage: "patch_planning",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-apply-patch-initial`,
      familyId,
      "apply-patch:add-failing-test:v1",
      "non_idempotent_mutation",
      {
        implementationDebug: {
          patchFingerprint: "patch-add-failing-test",
          stage: "apply_patch_initial",
        },
        retryBoundary: {
          attempt: 1,
          boundaryId: "implementation-debug-red-green",
          outcome: "patch_applied",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-focused-test-fail`,
      familyId,
      "focused-test:task-suite:red:v1",
      "approval_required",
      {
        implementationDebug: {
          commandFingerprint: "test-packages-cli-task-suite",
          stage: "focused_test",
          testOutputFingerprint: "vitest-task-suite-failing-output-a",
          testStatus: "failed",
        },
        retryBoundary: {
          attempt: 1,
          boundaryId: "implementation-debug-red-green",
          outcome: "failed",
        },
      },
    ),
    implementationModelNode(
      `${familyId}-model-debug-diagnosis`,
      familyId,
      "debug-diagnosis:test-output-a:patch-a:fixture-a",
      {
        implementationDebug: {
          fixtureFingerprint: "fixture-shape-a",
          patchFingerprint: "patch-add-failing-test",
          stage: "failure_diagnosis",
          testOutputFingerprint: "vitest-task-suite-failing-output-a",
        },
        retryBoundary: {
          attempt: 2,
          boundaryId: "implementation-debug-red-green",
          outcome: "diagnosed",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-apply-patch-retry`,
      familyId,
      "apply-patch:fix-fixture:v1",
      "non_idempotent_mutation",
      {
        implementationDebug: {
          patchFingerprint: "patch-fix-fixture-a",
          stage: "apply_patch_retry",
        },
        retryBoundary: {
          attempt: 2,
          boundaryId: "implementation-debug-red-green",
          outcome: "patch_applied",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-focused-test-pass`,
      familyId,
      "focused-test:task-suite:green:v1",
      "approval_required",
      {
        implementationDebug: {
          commandFingerprint: "test-packages-cli-task-suite",
          stage: "focused_test",
          testOutputFingerprint: "vitest-task-suite-passing-output-a",
          testStatus: "passed",
        },
        retryBoundary: {
          attempt: 2,
          boundaryId: "implementation-debug-red-green",
          outcome: "passed",
        },
      },
    ),
    implementationTerminalNode(`${familyId}-final-answer`, familyId, {
      implementationDebug: {
        stage: "final_answer",
        summaryFingerprint: "handoff-summary-a",
      },
    }),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    implementationToolNode(
      `${familyId}-tool-context-search`,
      familyId,
      "search:implementation-debug:repo-fingerprint-a",
      {
        implementationDebug: {
          repositoryFingerprint: "repo-fingerprint-a",
          stage: "context_search",
        },
      },
    ),
    implementationToolNode(
      `${familyId}-tool-context-read`,
      familyId,
      "read:packages/cli/src/index.ts:task-suite:repo-fingerprint-a",
      {
        implementationDebug: {
          pathFingerprint: "packages-cli-index-task-suite",
          range: "task-suite",
          repositoryFingerprint: "repo-fingerprint-a",
          stage: "context_read",
        },
      },
      {
        artifacts: [
          fileArtifact(
            `${familyId}-context-file`,
            "context-file-a",
            "verified",
            {
              codex: {
                fileContentFingerprint: "cli-task-suite-fixture-a",
                sourceEquivalenceKey:
                  "read:packages/cli/src/index.ts:task-suite",
                sourceLabel:
                  "Read packages/cli/src/index.ts task-suite section",
              },
            },
          ),
        ],
      },
    ),
    implementationModelNode(
      `${familyId}-model-patch-plan`,
      familyId,
      "patch-plan:two-step-debug:v1",
      {
        implementationDebug: {
          stage: "patch_planning",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-apply-patch-initial`,
      familyId,
      "apply-patch:add-failing-test:v1",
      "non_idempotent_mutation",
      {
        implementationDebug: {
          patchFingerprint: "patch-add-failing-test",
          stage: "apply_patch_initial",
        },
        retryBoundary: {
          attempt: 1,
          boundaryId: "implementation-debug-red-green",
          outcome: "patch_applied",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-focused-test-fail`,
      familyId,
      "focused-test:task-suite:red:v1",
      "approval_required",
      {
        implementationDebug: {
          commandFingerprint: "test-packages-cli-task-suite",
          stage: "focused_test",
          testOutputFingerprint: "vitest-task-suite-failing-output-a",
          testStatus: "failed",
        },
        retryBoundary: {
          attempt: 1,
          boundaryId: "implementation-debug-red-green",
          outcome: "failed",
        },
      },
    ),
    implementationModelNode(
      `${familyId}-model-debug-diagnosis`,
      familyId,
      "debug-diagnosis:test-output-b:patch-b:fixture-b",
      {
        implementationDebug: {
          fixtureFingerprint: "fixture-shape-b",
          patchFingerprint: "patch-fix-fixture-b",
          stage: "failure_diagnosis",
          testOutputFingerprint: "vitest-task-suite-failing-output-b",
        },
        retryBoundary: {
          attempt: 2,
          boundaryId: "implementation-debug-red-green",
          outcome: "diagnosed",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-apply-patch-retry`,
      familyId,
      "apply-patch:fix-fixture:v2",
      "non_idempotent_mutation",
      {
        implementationDebug: {
          patchFingerprint: "patch-fix-fixture-b",
          stage: "apply_patch_retry",
        },
        retryBoundary: {
          attempt: 2,
          boundaryId: "implementation-debug-red-green",
          outcome: "patch_applied",
        },
      },
    ),
    implementationMutationNode(
      `${familyId}-tool-focused-test-pass`,
      familyId,
      "focused-test:task-suite:green:v2",
      "approval_required",
      {
        implementationDebug: {
          commandFingerprint: "test-packages-cli-task-suite",
          stage: "focused_test",
          testOutputFingerprint: "vitest-task-suite-passing-output-b",
          testStatus: "passed",
        },
        retryBoundary: {
          attempt: 2,
          boundaryId: "implementation-debug-red-green",
          outcome: "passed",
        },
      },
    ),
    implementationTerminalNode(`${familyId}-final-answer`, familyId, {
      implementationDebug: {
        stage: "final_answer",
        summaryFingerprint: "handoff-summary-b",
      },
    }),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function createCiAndToolchainTriageFixture(
  familyId: RepoAgentFixtureFamilyId,
): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;
  const checkContract =
    "github-check:code-quality:. scripts/env && mise run check";
  const stableLogMetadata = {
    ciToolchainTriage: {
      checkContract,
      evidenceKind: "check_log_excerpt",
      rawLogStorage: "omitted",
      stage: "ci_log_read",
    },
  };
  const logClassificationMetadata = {
    ciToolchainTriage: {
      checkContract,
      evidenceKind: "log_classification",
      rawLogStorage: "omitted",
      stage: "log_classification",
    },
  };
  const checkStatusMetadata = {
    ciToolchainTriage: {
      checkContract,
      evidenceKind: "check_status_summary",
      rawStatusStorage: "omitted",
      stage: "check_status_read",
    },
  };
  const installMetadata = {
    ciToolchainTriage: {
      commandFingerprint: "pnpm-install-frozen-lockfile-v1",
      evidenceKind: "setup_repair_command",
      stage: "install_repair",
    },
  };
  const previousLocalCheckMetadata = {
    ciToolchainTriage: {
      checkContract,
      commandFingerprint: "mise-run-check-v1",
      evidenceKind: "fresh_local_execution",
      localExecutionRequired: true,
      lockfileFingerprint: "pnpm-lock-v1",
      stage: "local_reproduction",
    },
  };
  const currentLocalCheckMetadata = {
    ciToolchainTriage: {
      checkContract,
      commandFingerprint: "mise-run-check-v2",
      evidenceKind: "fresh_local_execution",
      localExecutionRequired: true,
      lockfileFingerprint: "pnpm-lock-v2",
      stage: "local_reproduction",
    },
  };
  const localRerunRequiredMetadata = {
    ciToolchainTriage: {
      checkContract,
      commandFingerprint: "mise-run-check-rerun-required-v1",
      evidenceKind: "fresh_local_execution",
      localExecutionRequired: true,
      stage: "local_verification",
    },
  };
  const previousEnvironmentMetadata = {
    ciToolchainTriage: {
      environmentFingerprint: "env:node-24.2.0:pnpm-10.12.1",
      evidenceKind: "toolchain_fingerprint",
      hostSpecificPaths: "omitted",
      toolVersionFingerprint: "mise-node-24.2.0-pnpm-10.12.1",
    },
  };
  const currentEnvironmentMetadata = {
    ciToolchainTriage: {
      environmentFingerprint: "env:node-24.3.0:pnpm-10.12.1",
      evidenceKind: "toolchain_fingerprint",
      hostSpecificPaths: "omitted",
      toolVersionFingerprint: "mise-node-24.3.0-pnpm-10.12.1",
    },
  };
  const previousLockfileMetadata = {
    ciToolchainTriage: {
      evidenceKind: "lockfile_fingerprint",
      lockfileFingerprint: "pnpm-lock-v1",
      rawLockfileStorage: "omitted",
    },
  };
  const currentLockfileMetadata = {
    ciToolchainTriage: {
      evidenceKind: "lockfile_fingerprint",
      lockfileFingerprint: "pnpm-lock-v2",
      rawLockfileStorage: "omitted",
    },
  };
  const previousNextActionMetadata = {
    ciToolchainTriage: {
      checkContract,
      ciEvidenceStatus: "insufficient",
      evidenceKind: "triage_next_action",
      nextAction:
        "rerun . scripts/env && mise run check locally before reporting success",
    },
  };
  const currentNextActionMetadata = {
    ciToolchainTriage: {
      checkContract,
      ciEvidenceStatus: "insufficient",
      evidenceKind: "triage_next_action",
      nextAction:
        "rerun . scripts/env && mise run check locally because CI evidence is incomplete",
    },
  };

  const previousGraph = graph(previousRunId, familyId, [
    ciReadOnlyToolNode(
      `${familyId}-tool-check-log-read`,
      familyId,
      "ci-log:code-quality:excerpt-a",
      stableLogMetadata,
      {
        artifacts: [
          fileArtifact(`${familyId}-ci-log`, "ci-log-excerpt-v1", "verified", {
            codex: {
              checkContract,
              redaction: "raw log omitted",
            },
          }),
        ],
      },
    ),
    ciModelNode(
      `${familyId}-model-log-classification`,
      familyId,
      "classify-ci-log:missing-install:v1",
      logClassificationMetadata,
    ),
    ciReadOnlyToolNode(
      `${familyId}-tool-check-status-read`,
      familyId,
      "ci-status:code-quality:failed",
      checkStatusMetadata,
    ),
    ciMutationNode(
      `${familyId}-tool-local-check`,
      familyId,
      "local-check:mise-run-check:v1:pnpm-lock-v1",
      "approval_required",
      previousLocalCheckMetadata,
    ),
    ciMutationNode(
      `${familyId}-tool-local-rerun-required`,
      familyId,
      "local-check:rerun-required:v1",
      "approval_required",
      localRerunRequiredMetadata,
    ),
    ciMutationNode(
      `${familyId}-tool-install`,
      familyId,
      "install:pnpm-frozen-lockfile:v1",
      "non_idempotent_mutation",
      installMetadata,
    ),
    ciReadOnlyToolNode(
      `${familyId}-tool-environment-read`,
      familyId,
      "env:node-24.2.0:pnpm-10.12.1",
      previousEnvironmentMetadata,
    ),
    ciReadOnlyToolNode(
      `${familyId}-tool-lockfile-read`,
      familyId,
      "lockfile:pnpm-lock-v1",
      previousLockfileMetadata,
    ),
    ciModelNode(
      `${familyId}-model-next-action`,
      familyId,
      "next-action:ci-insufficient:local-check-v1",
      previousNextActionMetadata,
    ),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    ciReadOnlyToolNode(
      `${familyId}-tool-check-log-read`,
      familyId,
      "ci-log:code-quality:excerpt-a",
      stableLogMetadata,
      {
        artifacts: [
          fileArtifact(`${familyId}-ci-log`, "ci-log-excerpt-v1", "verified", {
            codex: {
              checkContract,
              redaction: "raw log omitted",
            },
          }),
        ],
      },
    ),
    ciModelNode(
      `${familyId}-model-log-classification`,
      familyId,
      "classify-ci-log:missing-install:v1",
      logClassificationMetadata,
    ),
    ciReadOnlyToolNode(
      `${familyId}-tool-check-status-read`,
      familyId,
      "ci-status:code-quality:failed",
      checkStatusMetadata,
    ),
    ciMutationNode(
      `${familyId}-tool-local-check`,
      familyId,
      "local-check:mise-run-check:v2:pnpm-lock-v2",
      "approval_required",
      currentLocalCheckMetadata,
    ),
    ciMutationNode(
      `${familyId}-tool-local-rerun-required`,
      familyId,
      "local-check:rerun-required:v1",
      "approval_required",
      localRerunRequiredMetadata,
    ),
    ciMutationNode(
      `${familyId}-tool-install`,
      familyId,
      "install:pnpm-frozen-lockfile:v1",
      "non_idempotent_mutation",
      installMetadata,
    ),
    ciReadOnlyToolNode(
      `${familyId}-tool-environment-read`,
      familyId,
      "env:node-24.3.0:pnpm-10.12.1",
      currentEnvironmentMetadata,
    ),
    ciReadOnlyToolNode(
      `${familyId}-tool-lockfile-read`,
      familyId,
      "lockfile:pnpm-lock-v2",
      currentLockfileMetadata,
    ),
    ciModelNode(
      `${familyId}-model-next-action`,
      familyId,
      "next-action:ci-insufficient:local-check-v2",
      currentNextActionMetadata,
    ),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function createPrReviewAndMergeReadinessFixture(
  familyId: RepoAgentFixtureFamilyId,
): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;
  const repositoryPolicyMetadata = {
    prReview: {
      freshnessRequirement: "verified",
      scenario: "stable_review_context",
      sourceKind: "repository_policy",
      stage: "repository_policy_context",
    },
  };
  const styleGuideMetadata = {
    prReview: {
      freshnessRequirement: "verified",
      scenario: "stable_review_context",
      sourceKind: "style_guide",
      stage: "style_guidance_context",
    },
  };
  const reviewRubricMetadata = {
    prReview: {
      freshnessRequirement: "verified",
      scenario: "stable_review_context",
      sourceKind: "review_rubric",
      stage: "review_rubric_context",
    },
  };
  const reviewContextSummaryMetadata = {
    prReview: {
      requiredSources: ["repository_policy", "style_guide", "review_rubric"],
      scenario: "stable_review_context",
      stage: "review_context_summary",
    },
  };
  const previousChangedFilesMetadata = {
    prReview: {
      droppable: false,
      fileContentFingerprint: "changed-files-content-v1",
      scenario: "clean_mergeable_pr",
      stage: "changed_file_content",
    },
  };
  const currentChangedFilesMetadata = {
    prReview: {
      droppable: false,
      fileContentFingerprint: "changed-files-content-v2",
      scenario: "blocked_missing_tests",
      stage: "changed_file_content",
    },
  };
  const previousReviewFindingsMetadata = {
    prReview: {
      findings: ["clean_mergeable_pr"],
      scenario: "clean_mergeable_pr",
      stage: "review_finding_generation",
    },
  };
  const currentReviewFindingsMetadata = {
    prReview: {
      findings: ["missing_tests", "stale_base", "unresolved_review_threads"],
      scenario: "blocked_missing_tests",
      stage: "review_finding_generation",
    },
  };
  const previousCheckMetadata = {
    prReview: {
      checkState: "passing",
      requiredChecks: ["code-quality", "test"],
      scenario: "clean_mergeable_pr",
      stage: "check_summary",
    },
  };
  const currentCheckMetadata = {
    prReview: {
      blockedBy: "missing_tests",
      checkState: "failing",
      requiredChecks: ["code-quality", "test"],
      scenario: "blocked_missing_tests",
      stage: "check_summary",
    },
  };
  const previousMergeBaseMetadata = {
    prReview: {
      baseState: "fresh",
      mergeableState: "clean",
      scenario: "clean_mergeable_pr",
      stage: "merge_base_state",
    },
  };
  const currentMergeBaseMetadata = {
    prReview: {
      baseState: "stale_base",
      blockedBy: "stale_base",
      mergeableState: "behind",
      scenario: "blocked_stale_base",
      stage: "merge_base_state",
    },
  };
  const previousReviewThreadMetadata = {
    prReview: {
      scenario: "clean_mergeable_pr",
      stage: "review_thread_state",
      threadState: "resolved",
    },
  };
  const currentReviewThreadMetadata = {
    prReview: {
      blockedBy: "unresolved_review_threads",
      scenario: "blocked_unresolved_threads",
      stage: "review_thread_state",
      threadState: "unresolved",
    },
  };
  const requestedChangeDecisionMetadata = {
    prReview: {
      decision: "request_changes",
      mergeAction: "none",
      scenario: "blocked_pr_requires_changes",
      stage: "requested_change_decision",
    },
  };
  const finalReviewCommentMetadata = {
    prReview: {
      commentMode: "inline_grounded",
      mergeAction: "none",
      scenario: "blocked_validator_missing",
      stage: "final_review_comments",
    },
  };
  const terminalMetadata = {
    prReview: {
      mergeAction: "none",
      mutationPolicy: "observation_only",
      reviewAdvice: "request_changes",
      stage: "report_and_handoff",
    },
  };

  const previousGraph = graph(previousRunId, familyId, [
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-repository-policy`,
      familyId,
      "review-context:repository-policy:v1",
      repositoryPolicyMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-repository-policy`,
            "repo-policy-v1",
            "verified",
            {
              codex: {
                sourceIdentity: "repo:CONTRIBUTING.md",
                sourceLabel: "Repository contribution policy excerpt",
              },
            },
          ),
        ],
      },
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-style-guide`,
      familyId,
      "review-context:style-guide:v1",
      styleGuideMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-style-guide`,
            "style-guide-v1",
            "verified",
            {
              codex: {
                sourceIdentity: "repo:.agents/AGENTS.md",
                sourceLabel: "Agent style guidance excerpt",
              },
            },
          ),
        ],
      },
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-review-rubric`,
      familyId,
      "review-context:rubric:v1",
      reviewRubricMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-review-rubric`,
            "review-rubric-v1",
            "verified",
            {
              codex: {
                sourceIdentity: "repo:docs/repo-agent-task-ladder-v0.md",
                sourceLabel: "Repo-agent PR review rubric excerpt",
              },
            },
          ),
        ],
      },
    ),
    prReviewModelNode(
      `${familyId}-model-review-context-summary`,
      familyId,
      "review-context-summary:v1",
      reviewContextSummaryMetadata,
      ["review-context-freshness"],
      ["review-context-freshness"],
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-changed-files`,
      familyId,
      "changed-files:content-v1",
      previousChangedFilesMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-changed-files`,
            "changed-files-content-v1",
            "verified",
            {
              codex: {
                droppable: false,
                fileContentFingerprint: "changed-files-content-v1",
                sourceLabel: "Changed-file diff content",
              },
            },
          ),
        ],
      },
    ),
    prReviewModelNode(
      `${familyId}-model-review-findings`,
      familyId,
      "review-findings:clean:v1",
      previousReviewFindingsMetadata,
      ["changed-file-grounding", "check-evidence-grounding"],
      ["changed-file-grounding", "check-evidence-grounding"],
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-check-summary`,
      familyId,
      "checks:passing:v1",
      previousCheckMetadata,
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-merge-base-state`,
      familyId,
      "merge-base:fresh:v1",
      previousMergeBaseMetadata,
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-review-thread-state`,
      familyId,
      "review-threads:resolved:v1",
      previousReviewThreadMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-review-threads`,
            "review-threads-v1",
            "verified",
          ),
        ],
      },
    ),
    prReviewModelNode(
      `${familyId}-model-requested-change-decision`,
      familyId,
      "requested-change-decision:v1",
      requestedChangeDecisionMetadata,
      ["merge-readiness-evidence", "review-thread-grounding"],
      ["merge-readiness-evidence", "review-thread-grounding"],
    ),
    prReviewModelNode(
      `${familyId}-model-final-review-comments`,
      familyId,
      "final-review-comments:v1",
      finalReviewCommentMetadata,
      [
        "inline-comment-grounding",
        "changed-file-grounding",
        "check-evidence-grounding",
      ],
      [
        "inline-comment-grounding",
        "changed-file-grounding",
        "check-evidence-grounding",
      ],
    ),
    implementationTerminalNode(`${familyId}-final-answer`, familyId, {
      ...terminalMetadata,
      prReview: {
        ...terminalMetadata.prReview,
        reviewAdvice: "approve",
      },
    }),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-repository-policy`,
      familyId,
      "review-context:repository-policy:v1",
      repositoryPolicyMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-repository-policy`,
            "repo-policy-v1",
            "verified",
            {
              codex: {
                sourceIdentity: "repo:CONTRIBUTING.md",
                sourceLabel: "Repository contribution policy excerpt",
              },
            },
          ),
        ],
      },
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-style-guide`,
      familyId,
      "review-context:style-guide:v1",
      styleGuideMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-style-guide`,
            "style-guide-v1",
            "verified",
            {
              codex: {
                sourceIdentity: "repo:.agents/AGENTS.md",
                sourceLabel: "Agent style guidance excerpt",
              },
            },
          ),
        ],
      },
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-review-rubric`,
      familyId,
      "review-context:rubric:v1",
      reviewRubricMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-review-rubric`,
            "review-rubric-v1",
            "verified",
            {
              codex: {
                sourceIdentity: "repo:docs/repo-agent-task-ladder-v0.md",
                sourceLabel: "Repo-agent PR review rubric excerpt",
              },
            },
          ),
        ],
      },
    ),
    prReviewModelNode(
      `${familyId}-model-review-context-summary`,
      familyId,
      "review-context-summary:v1",
      reviewContextSummaryMetadata,
      ["review-context-freshness"],
      ["review-context-freshness"],
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-read-changed-files`,
      familyId,
      "changed-files:content-v2",
      currentChangedFilesMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-changed-files`,
            "changed-files-content-v2",
            "verified",
            {
              codex: {
                droppable: false,
                fileContentFingerprint: "changed-files-content-v2",
                sourceLabel: "Changed-file diff content",
              },
            },
          ),
        ],
      },
    ),
    prReviewModelNode(
      `${familyId}-model-review-findings`,
      familyId,
      "review-findings:blocked:v1",
      currentReviewFindingsMetadata,
      ["changed-file-grounding", "check-evidence-grounding"],
      ["changed-file-grounding", "check-evidence-grounding"],
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-check-summary`,
      familyId,
      "checks:missing-tests:v1",
      currentCheckMetadata,
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-merge-base-state`,
      familyId,
      "merge-base:stale:v1",
      currentMergeBaseMetadata,
    ),
    prReviewReadOnlyToolNode(
      `${familyId}-tool-review-thread-state`,
      familyId,
      "review-threads:resolved:v1",
      currentReviewThreadMetadata,
      {
        artifacts: [
          fileArtifact(
            `${familyId}-review-threads`,
            "review-threads-v1",
            "unknown",
          ),
        ],
      },
    ),
    prReviewModelNode(
      `${familyId}-model-requested-change-decision`,
      familyId,
      "requested-change-decision:v1",
      requestedChangeDecisionMetadata,
      ["merge-readiness-evidence", "review-thread-grounding"],
      ["merge-readiness-evidence", "review-thread-grounding"],
    ),
    prReviewModelNode(
      `${familyId}-model-final-review-comments`,
      familyId,
      "final-review-comments:v1",
      finalReviewCommentMetadata,
      ["inline-comment-grounding"],
      [
        "inline-comment-grounding",
        "changed-file-grounding",
        "check-evidence-grounding",
      ],
    ),
    implementationTerminalNode(
      `${familyId}-final-answer`,
      familyId,
      terminalMetadata,
    ),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function createReadOnlyReconnaissanceFixture(
  familyId: RepoAgentFixtureFamilyId,
): {
  readonly currentGraph: ExecutionGraph;
  readonly eventsJsonl: string;
  readonly previousGraph: ExecutionGraph;
} {
  const previousRunId = `${familyId}-previous`;
  const currentRunId = `${familyId}-current`;
  const stableSearchMetadata = {
    reconnaissance: {
      commit: "repo-fingerprint-a",
      query: "repo-agent task-suite fixture",
      resultSetFingerprint: "search-results-a",
      stage: "symbol_search",
    },
  };
  const changedSearchPreviousMetadata = {
    reconnaissance: {
      commit: "repo-fingerprint-a",
      query: "repo-agent task-suite fixture",
      resultSetFingerprint: "search-results-a",
      stage: "symbol_search",
    },
  };
  const changedSearchCurrentMetadata = {
    reconnaissance: {
      commit: "repo-fingerprint-b",
      query: "repo-agent task-suite fixture",
      resultSetFingerprint: "search-results-b",
      stage: "symbol_search",
    },
  };
  const stableReadMetadata = {
    reconnaissance: {
      commit: "repo-fingerprint-a",
      pathFingerprint: "docs-repo-agent-task-ladder",
      range: "1-40",
      stage: "targeted_file_read",
    },
  };
  const staleReadMetadata = {
    reconnaissance: {
      commit: "repo-fingerprint-b",
      pathFingerprint: "docs-repo-agent-task-ladder",
      range: "41-80",
      stage: "targeted_file_read",
    },
  };

  const previousGraph = graph(previousRunId, familyId, [
    reconToolNode(
      `${familyId}-tool-search-stable`,
      familyId,
      "search:repo-agent task-suite fixture:repo-fingerprint-a:search-results-a",
      stableSearchMetadata,
    ),
    reconToolNode(
      `${familyId}-tool-read-unchanged-range`,
      familyId,
      "read:docs/repo-agent-task-ladder-v0.md:1-40:repo-fingerprint-a",
      stableReadMetadata,
      {
        artifacts: [
          fileArtifact(`${familyId}-file-unchanged`, "file-v1", "verified", {
            codex: {
              fileContentFingerprint: "docs-task-ladder-content-a",
              sourceEquivalenceKey:
                "read:docs/repo-agent-task-ladder-v0.md:1-40",
              sourceLabel: "Read docs/repo-agent-task-ladder-v0.md:1-40",
            },
          }),
        ],
      },
    ),
    reconModelNode(
      `${familyId}-model-source-summary`,
      familyId,
      "summary:cited-sources:v1",
      {
        reconnaissance: {
          citedSourceCount: 2,
          stage: "summary_and_patch_orientation",
        },
      },
    ),
    reconToolNode(
      `${familyId}-tool-read-stale-range`,
      familyId,
      "read:docs/repo-agent-task-ladder-v0.md:41-80:repo-fingerprint-b",
      staleReadMetadata,
      {
        artifacts: [
          fileArtifact(`${familyId}-file-stale`, "file-v2", "verified", {
            codex: {
              fileContentFingerprint: "docs-task-ladder-content-b",
              sourceEquivalenceKey:
                "read:docs/repo-agent-task-ladder-v0.md:41-80",
              sourceLabel: "Read docs/repo-agent-task-ladder-v0.md:41-80",
            },
          }),
        ],
      },
    ),
    reconToolNode(
      `${familyId}-tool-search-changed-fingerprint`,
      familyId,
      "search:repo-agent task-suite fixture:repo-fingerprint-a:search-results-a",
      changedSearchPreviousMetadata,
    ),
  ]);
  const currentGraph = graph(currentRunId, familyId, [
    reconToolNode(
      `${familyId}-tool-search-stable`,
      familyId,
      "search:repo-agent task-suite fixture:repo-fingerprint-a:search-results-a",
      stableSearchMetadata,
    ),
    reconToolNode(
      `${familyId}-tool-read-unchanged-range`,
      familyId,
      "read:docs/repo-agent-task-ladder-v0.md:1-40:repo-fingerprint-a",
      stableReadMetadata,
      {
        artifacts: [
          fileArtifact(`${familyId}-file-unchanged`, "file-v1", "verified", {
            codex: {
              fileContentFingerprint: "docs-task-ladder-content-a",
              sourceEquivalenceKey:
                "read:docs/repo-agent-task-ladder-v0.md:1-40",
              sourceLabel: "Read docs/repo-agent-task-ladder-v0.md:1-40",
            },
          }),
        ],
      },
    ),
    reconModelNode(
      `${familyId}-model-source-summary`,
      familyId,
      "summary:cited-sources:v1",
      {
        reconnaissance: {
          citedSourceCount: 2,
          stage: "summary_and_patch_orientation",
        },
      },
    ),
    reconToolNode(
      `${familyId}-tool-read-stale-range`,
      familyId,
      "read:docs/repo-agent-task-ladder-v0.md:41-80:repo-fingerprint-b",
      staleReadMetadata,
      {
        artifacts: [
          fileArtifact(`${familyId}-file-stale`, "file-v2", "unknown", {
            codex: {
              fileContentFingerprint: "docs-task-ladder-content-b",
              sourceEquivalenceKey:
                "read:docs/repo-agent-task-ladder-v0.md:41-80",
              sourceLabel: "Read docs/repo-agent-task-ladder-v0.md:41-80",
            },
          }),
        ],
      },
    ),
    reconToolNode(
      `${familyId}-tool-search-changed-fingerprint`,
      familyId,
      "search:repo-agent task-suite fixture:repo-fingerprint-b:search-results-b",
      changedSearchCurrentMetadata,
    ),
  ]);

  return {
    currentGraph,
    eventsJsonl: renderFixtureEventsJsonl(familyId, currentGraph),
    previousGraph,
  };
}

function graph(
  runId: string,
  familyId: RepoAgentFixtureFamilyId,
  nodes: readonly ExecutionNode[],
): ExecutionGraph {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    edges: [],
    endedAt: "2026-01-01T00:00:02.000Z",
    metadata: {
      fixtureFamily: familyId,
      reuse: {
        runtimeCompatibilityKey: "repo-agent-task-suite:v0",
      },
    },
    nodes,
    runId,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "ok",
    version: EXECUTION_GRAPH_VERSION,
  };
}

function reconModelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        validatorsPassed: ["cited-source-coverage"],
        validatorsRequired: ["cited-source-coverage"],
      },
    },
    totalTokens: 120,
  });
}

function modelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
): ExecutionNode {
  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      reuse: {
        policyAllowed: true,
        validatorsPassed: ["fixture-acceptance"],
        validatorsRequired: ["fixture-acceptance"],
      },
    },
    totalTokens: 120,
  });
}

function reconToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
  } = {},
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "read_only",
      },
    },
    totalTokens: 12,
  });
}

function implementationModelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        validatorsPassed: ["patch-applies", "focused-tests-pass"],
        validatorsRequired: ["patch-applies", "focused-tests-pass"],
      },
    },
    totalTokens: 108,
  });
}

function implementationToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
  } = {},
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "read_only",
      },
    },
    totalTokens: 12,
  });
}

function implementationMutationNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  sideEffectClass: "approval_required" | "non_idempotent_mutation",
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass,
      },
    },
    totalTokens: 12,
  });
}

function implementationTerminalNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "agent_response", familyId, `${id}:terminal`, {
    metadata,
    totalTokens: 0,
  });
}

function ciModelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        validatorsPassed: ["ci-log-classification", "next-action-grounding"],
        validatorsRequired: ["ci-log-classification", "next-action-grounding"],
      },
    },
    totalTokens: 108,
  });
}

function ciReadOnlyToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
  } = {},
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "read_only",
      },
    },
    totalTokens: 12,
  });
}

function ciMutationNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  sideEffectClass: "approval_required" | "non_idempotent_mutation",
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass,
      },
    },
    totalTokens: 12,
  });
}

function docsWikiModelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        validatorsPassed: [
          "claim-source-provenance",
          "no-whitepaper-prose-copy",
          "docs-change-plan-grounding",
        ],
        validatorsRequired: [
          "claim-source-provenance",
          "no-whitepaper-prose-copy",
          "docs-change-plan-grounding",
        ],
      },
    },
    totalTokens: 156,
  });
}

function docsWikiReadOnlyToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
  } = {},
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "read_only",
      },
    },
    totalTokens: 12,
  });
}

function issuePlanningModelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        validatorsPassed: [
          "blocker-graph-consistency",
          "issue-body-contract",
          "adoption-before-new-work",
        ],
        validatorsRequired: [
          "blocker-graph-consistency",
          "issue-body-contract",
          "adoption-before-new-work",
        ],
      },
    },
    totalTokens: 156,
  });
}

function issuePlanningReadOnlyToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "read_only",
      },
    },
    totalTokens: 12,
  });
}

function issuePlanningDecisionNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "approval_required",
      },
    },
    totalTokens: 12,
  });
}

function prReviewModelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
  validatorsPassed: readonly string[],
  validatorsRequired: readonly string[],
): ExecutionNode {
  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        validatorsPassed,
        validatorsRequired,
      },
    },
    totalTokens: 156,
  });
}

function prReviewReadOnlyToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
  } = {},
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "read_only",
      },
    },
    totalTokens: 12,
  });
}

function evidencePromotionModelNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  const validators = [
    "redaction-policy-check",
    "source-fingerprint-check",
    "handoff-completeness-check",
  ];

  return node(id, "model_call", familyId, fingerprintSeed, {
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        validatorsPassed: validators,
        validatorsRequired: validators,
      },
    },
    totalTokens: 144,
  });
}

function evidencePromotionReadOnlyToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
  } = {},
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    metadata: {
      ...metadata,
      reuse: {
        policyAllowed: true,
        sideEffectClass: "read_only",
      },
    },
    totalTokens: 12,
  });
}

function evidencePromotionToolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  metadata: ExecutionNode["metadata"],
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    metadata,
    totalTokens: 12,
  });
}

function toolNode(
  id: string,
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
    readonly sideEffectClass: "read_only" | "unknown";
  },
): ExecutionNode {
  return node(id, "tool_call", familyId, fingerprintSeed, {
    ...(options.artifacts === undefined
      ? {}
      : { artifacts: options.artifacts }),
    metadata: {
      reuse: {
        policyAllowed: true,
        sideEffectClass: options.sideEffectClass,
      },
    },
    totalTokens: 12,
  });
}

function node(
  id: string,
  operationKind: "agent_response" | "model_call" | "tool_call",
  familyId: RepoAgentFixtureFamilyId,
  fingerprintSeed: string,
  options: {
    readonly artifacts?: ExecutionNode["artifacts"];
    readonly metadata: ExecutionNode["metadata"];
    readonly totalTokens: number;
  },
): ExecutionNode {
  return {
    artifacts: options.artifacts ?? [],
    dependencies: [],
    durationMs: 10,
    endedAt: "2026-01-01T00:00:01.000Z",
    id,
    metadata: options.metadata,
    metrics: {
      costUsd: operationKind === "model_call" ? 0.002 : 0,
      latencyMs: 10,
      totalTokens: options.totalTokens,
    },
    operation: {
      fingerprint: stableExecutionHash({ familyId, fingerprintSeed }),
      id,
      kind: operationKind,
      name: id,
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "ok",
  };
}

function fileArtifact(
  id: string,
  fingerprintSeed: string,
  freshnessStatus: "unknown" | "verified",
  metadata: {
    readonly codex?: Readonly<Record<string, unknown>>;
  } = {},
): ExecutionNode["artifacts"][number] {
  return {
    fingerprint: stableExecutionHash({ fingerprintSeed }),
    id,
    kind: "file",
    metadata: {
      redaction: "raw file path omitted",
      reuse: {
        freshnessStatus,
      },
      ...metadata,
    },
  };
}

function renderFixtureEventsJsonl(
  familyId: RepoAgentFixtureFamilyId,
  graph: ExecutionGraph,
): string {
  const events = graph.nodes.map((node) => ({
    id: `${node.id}-event`,
    lifecycle: "finish",
    metadata: {
      fixtureFamily: familyId,
      ...(node.metadata.retryBoundary === undefined
        ? {}
        : { retryBoundary: node.metadata.retryBoundary }),
      ...(node.metadata.ciToolchainTriage === undefined
        ? {}
        : { ciToolchainTriage: node.metadata.ciToolchainTriage }),
      ...(node.metadata.docsWikiAlignment === undefined
        ? {}
        : { docsWikiAlignment: node.metadata.docsWikiAlignment }),
      ...(node.metadata.issuePlanning === undefined
        ? {}
        : { issuePlanning: node.metadata.issuePlanning }),
      ...(node.metadata.prReview === undefined
        ? {}
        : { prReview: node.metadata.prReview }),
      ...(node.metadata.evidencePromotion === undefined
        ? {}
        : { evidencePromotion: node.metadata.evidencePromotion }),
      ...(node.metadata.handoff === undefined
        ? {}
        : { handoff: node.metadata.handoff }),
      privacyMode: "metadata_only",
      source: "repo-agent-task-suite",
    },
    occurredAt: node.endedAt,
    operation: node.operation,
    runId: graph.runId,
    status: node.status === "ok" ? "ok" : "error",
    version: EXECUTION_EVENT_VERSION,
  }));

  return `${events.map((event) => stableStringify(event)).join("\n")}\n`;
}

function fixtureArtifactPaths(
  outputDir: string,
  suiteId: string,
  familyId: RepoAgentFixtureFamilyId,
): TaskSuiteFixtureArtifacts {
  const fixtureDir = join(outputDir, suiteId, familyId);

  return {
    comparisonJson: join(fixtureDir, "comparison.json"),
    eventsJsonl: join(fixtureDir, "events.jsonl"),
    graphJson: join(fixtureDir, "graph.json"),
    reportMd: join(fixtureDir, "report.md"),
    reuseDecisionJson: join(fixtureDir, "reuse-decision.json"),
  };
}

function renderTaskSuiteFixtureReport(input: {
  readonly artifacts: TaskSuiteFixtureArtifacts;
  readonly comparison: ObservedTrajectoryComparison;
  readonly familyId: RepoAgentFixtureFamilyId;
  readonly graph: ExecutionGraph;
  readonly reuseDecision: ReuseDecisionArtifact;
}): string {
  return [
    "# Migaki Repo-Agent Fixture Report",
    "",
    `Family: ${input.familyId}`,
    "",
    "## Artifacts",
    "",
    `- events.jsonl: ${input.artifacts.eventsJsonl}`,
    `- graph.json: ${input.artifacts.graphJson}`,
    `- report.md: ${input.artifacts.reportMd}`,
    `- comparison.json: ${input.artifacts.comparisonJson}`,
    `- reuse-decision.json: ${input.artifacts.reuseDecisionJson}`,
    "",
    "## Metrics",
    "",
    `- Allowed reuse decisions: ${input.reuseDecision.summary.allowed}`,
    `- Needs-review reuse decisions: ${input.reuseDecision.summary.needsReview}`,
    `- Blocked reuse decisions: ${input.reuseDecision.summary.blocked}`,
    `- Changed nodes: ${input.comparison.summary.changedNodes}`,
    ...(input.comparison.summary.totalEstimatedAvoidableLatencyMs === undefined
      ? []
      : [
          `- Estimated avoidable latency: ${input.comparison.summary.totalEstimatedAvoidableLatencyMs} ms`,
        ]),
    ...(input.comparison.summary.totalEstimatedAvoidableTokens === undefined
      ? []
      : [
          `- Estimated avoidable tokens: ${input.comparison.summary.totalEstimatedAvoidableTokens}`,
        ]),
    ...(input.comparison.summary.totalEstimatedAvoidableCostUsd === undefined
      ? []
      : [
          `- Estimated avoidable cost: ${input.comparison.summary.totalEstimatedAvoidableCostUsd} USD`,
        ]),
    "- Actual skipped actions: 0",
    "",
    "## Comparison Details",
    "",
    "Changed nodes:",
    ...formatList(
      input.comparison.changedNodes,
      (node) => `- ${node.nodeId}: ${node.reason}`,
    ),
    "Blocked candidates:",
    ...formatList(
      input.comparison.blockedCandidates,
      (candidate) =>
        `- ${candidate.nodeId}: ${candidate.reasons
          .map((reason) => reason.code)
          .join(
            ", ",
          )}; validators ${candidate.requiredValidators.join(", ") || "none"}`,
    ),
    "Validator requirements:",
    ...formatList(
      input.reuseDecision.decisions,
      (decision) =>
        `- ${decision.nodeId}: validator_requirements ${decision.requiredValidators.join(", ") || "none"}`,
    ),
    ...taskSuiteFixtureFamilyReportLines(input.familyId),
    "",
    renderReuseDecisionArtifact(input.reuseDecision, "human").trimEnd(),
    "",
    renderExecutionReport(input.graph).trimEnd(),
    "",
  ].join("\n");
}

function taskSuiteFixtureFamilyReportLines(
  familyId: RepoAgentFixtureFamilyId,
): readonly string[] {
  if (familyId === "docs-and-wiki-alignment") {
    return [
      "",
      "Docs/wiki alignment:",
      "- Change docs/README.md: refresh stale README claim against repository contract docs.",
      "- Do not change docs/evidence-bundles-v0.md: keep long-term whitepaper-only claims in wiki/whitepaper sources.",
      "- Reuse source excerpts only when freshness is verified and source identity matches.",
      "- Transformed alignment summaries remain needs_review until validators pass and a future replay policy exists.",
      "- Evidence mode: metadata_only; raw prose excerpts, local paths, and full whitepaper text omitted.",
    ];
  }

  if (familyId === "issue-planning-and-blocker-maintenance") {
    return [
      "",
      "Issue planning and blocker maintenance:",
      "- Before #155 closes: exactly one next eligible issue is #154.",
      "- After #155 closes: exactly one next eligible issue is #156.",
      "- Skip issues labeled status:blocked, status:claimed, or status:in-review.",
      "- Adopt existing PR #159 or active claim #158 before creating new work.",
      "- Draft issue body fields: project purpose, acceptance criteria, labels, validation, and Blocked by: #156.",
      "- Evidence mode: metadata_only; live GitHub payloads and local paths omitted.",
    ];
  }

  if (familyId === "pr-review-and-merge-readiness") {
    return [
      "",
      "PR review and merge readiness:",
      "- Changed-file content: non-droppable; fingerprint drift blocks reuse.",
      "- Stable review context: repository policy, style guide, and review rubric are reusable only with verified freshness.",
      "- Review finding generation, inline-comment grounding, merge-readiness checks, and requested-change decisions are validator-bound model nodes.",
      "- Blocked examples: missing tests, stale base, and unresolved review threads require fresh review evidence.",
      "- Final review comments remain blocked or needs_review when grounding validators are missing.",
      "- Review advice is separated from merge action; fixture records no auto-merge or live SCM mutation.",
      "- Evidence mode: metadata_only; changed-file content, live GitHub payloads, and local paths omitted.",
    ];
  }

  if (familyId === "evidence-promotion-and-handoff") {
    return [
      "",
      "Evidence promotion and handoff:",
      "- Promoted artifacts are preserved project knowledge; raw `.migaki/runs` evidence remains short-lived local session state.",
      "- Manifest, graph summary, reuse advice, and handoff artifacts carry redacted metadata only.",
      "- Reuse advice inherits metadata_only privacy and records explicit omissions for prompts, tool payloads, provider responses, credentials, and local paths.",
      "- Handoff output names completed work, checks run, checks blocked, remaining blockers, and next eligible issue.",
      "- Next eligible issue: #159 after #158 merges.",
      "- Evidence mode: metadata_only; raw prompts, tool input, tool output, provider responses, secrets, and local paths omitted.",
    ];
  }

  if (familyId !== "ci-and-toolchain-triage") {
    return [];
  }

  return [
    "",
    "CI/toolchain triage:",
    "- check/gate contract: github-check:code-quality:. scripts/env && mise run check",
    "- Evidence mode: metadata_only; raw logs, credentials, and host-specific paths omitted.",
    "- Next action: rerun `. scripts/env && mise run check` locally because CI evidence is incomplete.",
  ];
}

async function writeTaskSuiteArtifact(
  io: CliIo,
  path: string,
  contents: string,
): Promise<void> {
  if (io.writeFile === undefined) {
    throw new Error("Task-suite run requires a writeFile-capable CLI IO.");
  }

  const directory = path.slice(0, path.lastIndexOf("/"));

  if (directory !== "" && io.mkdir !== undefined) {
    await io.mkdir(directory);
  }

  await io.writeFile(path, contents);
}

function missingRequiredFamilies(
  fixtureFamilies: readonly RepoAgentFixtureFamilyId[],
): readonly RepoAgentFixtureFamilyId[] {
  const present = new Set(fixtureFamilies);

  return repoAgentFixtureFamilyIds.filter((familyId) => !present.has(familyId));
}

function renderTaskSuiteListReport(
  report: TaskSuiteListReport,
  format: CliReportFormat,
): string {
  if (format === "json") {
    return `${stableStringify(report)}\n`;
  }

  return [
    "Migaki Task Suites",
    ...report.suites.map(
      (suite) =>
        `- ${suite.id}: ${suite.fixtureCount} ${plural(
          suite.fixtureCount,
          "fixture",
        )}; missing ${suite.missingRequiredFamilies.join(", ") || "none"}`,
    ),
    "",
  ].join("\n");
}

function renderTaskSuiteRunReport(
  report: TaskSuiteRunReport,
  format: CliReportFormat,
): string {
  if (format === "json") {
    return `${stableStringify(report)}\n`;
  }

  return [
    "Migaki Task Suite",
    `Suite: ${report.suiteId}`,
    `Status: ${report.success ? "complete" : "missing coverage"}`,
    `Fixtures: ${report.coverage.fixtureCount}`,
    `Missing: ${report.coverage.missingRequiredFamilies.join(", ") || "none"}`,
    "Warnings:",
    ...formatList(report.warnings, (warning) => `- ${warning}`),
    "Artifacts:",
    ...formatList(
      report.fixtures,
      (fixture) =>
        `- ${fixture.familyId}: ${fixture.artifacts.eventsJsonl}, ${fixture.artifacts.graphJson}, ${fixture.artifacts.reportMd}, ${fixture.artifacts.comparisonJson}, ${fixture.artifacts.reuseDecisionJson}`,
    ),
    "",
  ].join("\n");
}

function createMvpRepoAgentGateReport(
  suite: TaskSuiteRunReport,
  leakedArtifacts: readonly MvpPrivacyLeak[],
  strictDogfoodStatus: StrictDogfoodStatus,
): MvpRepoAgentGateReport {
  const reuseDecisions = suite.fixtures.reduce(
    (summary, fixture) => ({
      allowed: summary.allowed + fixture.reuseDecision.summary.allowed,
      blocked: summary.blocked + fixture.reuseDecision.summary.blocked,
      needsReview:
        summary.needsReview + fixture.reuseDecision.summary.needsReview,
      totalCandidates:
        summary.totalCandidates + fixture.reuseDecision.summary.totalCandidates,
    }),
    {
      allowed: 0,
      blocked: 0,
      needsReview: 0,
      totalCandidates: 0,
    },
  );
  const blockedReasons = summarizeBlockedReasons(suite.fixtures);
  const requiredValidators = summarizeRequiredValidators(suite.fixtures);
  const actualSkippedActions = suite.fixtures.reduce(
    (count, fixture) => count + fixture.metrics.actualSkippedActions,
    0,
  );
  const metadataOnlyArtifactCount = suite.fixtures.filter(
    (fixture) =>
      fixture.comparison.privacyPolicy.exportMode === "metadata_only" &&
      fixture.reuseDecision.privacyPolicy.exportMode === "metadata_only" &&
      fixture.reuseDecision.redaction.mode === "metadata_only",
  ).length;
  const privacy: MvpPrivacySummary = {
    checkedArtifactCount: suite.fixtures.length * 5,
    leakedArtifacts,
    metadataOnlyArtifactCount,
    prohibitedMarkers: prohibitedDefaultArtifactMarkers.map(({ id }) => id),
    status:
      leakedArtifacts.length === 0 &&
      metadataOnlyArtifactCount === suite.fixtures.length
        ? "passed"
        : "failed",
  };
  const realizedSavings = {
    actualSkippedActions,
    status: actualSkippedActions === 0 ? "passed" : "failed",
  } as const;
  const warnings = [
    ...suite.warnings,
    ...(realizedSavings.status === "passed"
      ? []
      : [
          `MVP gate forbids realized skips before controlled replay; saw ${actualSkippedActions}.`,
        ]),
    ...(privacy.status === "passed"
      ? []
      : ["MVP gate detected prohibited raw data in default artifacts."]),
  ];

  return {
    artifactKind: "mvp_repo_agent_gate",
    deterministicTaskSuiteSuccess: suite.success,
    fixtureArtifacts: suite.fixtures.map((fixture) => ({
      artifacts: fixture.artifacts,
      familyId: fixture.familyId,
    })),
    strictDogfood: {
      command: "mise run migaki:dogfood",
      gatesDeterministicTaskSuite: false,
      status: strictDogfoodStatus,
    },
    success:
      suite.success &&
      realizedSavings.status === "passed" &&
      privacy.status === "passed",
    suiteId: suite.suiteId,
    summary: {
      blockedReasons,
      coverage: suite.coverage,
      privacy,
      realizedSavings,
      reuseDecisions,
      validators: {
        required: requiredValidators,
      },
    },
    version: CLI_TASK_SUITE_VERSION,
    warnings,
  };
}

function summarizeBlockedReasons(
  fixtures: readonly TaskSuiteFixtureReport[],
): readonly MvpBlockedReasonSummary[] {
  const counts = new Map<string, number>();

  for (const fixture of fixtures) {
    for (const candidate of fixture.comparison.blockedCandidates) {
      for (const reason of candidate.reasons) {
        counts.set(reason.code, (counts.get(reason.code) ?? 0) + 1);
      }
    }
  }

  return [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function summarizeRequiredValidators(
  fixtures: readonly TaskSuiteFixtureReport[],
): readonly string[] {
  const validators = new Set<string>();

  for (const fixture of fixtures) {
    for (const candidate of fixture.comparison.blockedCandidates) {
      for (const validator of candidate.requiredValidators) {
        validators.add(validator);
      }
    }

    for (const candidate of fixture.comparison.reusableModelCalls) {
      for (const validator of candidate.requiredValidators) {
        validators.add(validator);
      }
    }

    for (const candidate of fixture.comparison.reusableToolCalls) {
      for (const validator of candidate.requiredValidators) {
        validators.add(validator);
      }
    }
  }

  return [...validators].sort();
}

function renderMvpRepoAgentGateReport(
  report: MvpRepoAgentGateReport,
  format: CliReportFormat,
): string {
  if (format === "json") {
    return `${stableStringify(report)}\n`;
  }

  return [
    "Migaki MVP Repo-Agent Gate",
    `Status: ${report.success ? "passed" : "failed"}`,
    `Deterministic task suite: ${report.deterministicTaskSuiteSuccess ? "passed" : "failed"}`,
    `Strict dogfood: ${report.strictDogfood.status} (${report.strictDogfood.command})`,
    "Coverage:",
    `- Fixture families: ${report.summary.coverage.fixtureCount}`,
    `- Missing: ${report.summary.coverage.missingRequiredFamilies.join(", ") || "none"}`,
    "Reuse decisions:",
    `- Allowed: ${report.summary.reuseDecisions.allowed}`,
    `- Needs review: ${report.summary.reuseDecisions.needsReview}`,
    `- Blocked: ${report.summary.reuseDecisions.blocked}`,
    "Blocked reasons:",
    ...formatList(
      report.summary.blockedReasons,
      (reason) => `- ${reason.code}: ${reason.count}`,
    ),
    "Validators:",
    ...formatList(
      report.summary.validators.required,
      (validator) => `- ${validator}`,
    ),
    "Privacy:",
    `- Status: ${report.summary.privacy.status}`,
    `- Checked artifacts: ${report.summary.privacy.checkedArtifactCount}`,
    `- Leaked artifacts: ${report.summary.privacy.leakedArtifacts.length}`,
    "Realized savings:",
    `- Status: ${report.summary.realizedSavings.status}`,
    `- Actual skipped actions: ${report.summary.realizedSavings.actualSkippedActions}`,
    "Warnings:",
    ...formatList(report.warnings, (warning) => `- ${warning}`),
    "",
  ].join("\n");
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

function createReuseDecisionReport(
  artifact: ReuseDecisionArtifact,
): ReuseDecisionReport {
  return {
    allowed: artifact.summary.allowed,
    artifactKind: "reuse_decision",
    blocked: artifact.summary.blocked,
    comparison: {
      currentRunId: artifact.comparisonRef.currentRunId,
      previousRunId: artifact.comparisonRef.previousRunId,
    },
    decisions: artifact.decisions.map((decision) => ({
      nodeId: decision.nodeId,
      operationKind: decision.operationKind,
      reasons: decision.reasons.map((reason) => reason.code),
      status: decision.status,
    })),
    needsReview: artifact.summary.needsReview,
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

function parseReuseDecisionArtifact(serialized: string): ReuseDecisionArtifact {
  const parsed = JSON.parse(serialized) as unknown;

  if (!isReuseDecisionArtifact(parsed)) {
    throw new Error("Expected migaki.reuse-decision.v0 artifact.");
  }

  return parsed;
}

function isReuseDecisionArtifact(
  value: unknown,
): value is ReuseDecisionArtifact {
  if (!isRecord(value)) {
    return false;
  }

  const comparisonRef = value["comparisonRef"];
  const privacyPolicy = value["privacyPolicy"];
  const redaction = value["redaction"];
  const summary = value["summary"];

  return (
    value["version"] === REUSE_DECISION_ARTIFACT_VERSION &&
    typeof value["createdAt"] === "string" &&
    typeof value["invariant"] === "string" &&
    Array.isArray(value["decisions"]) &&
    value["decisions"].every(isReuseDecision) &&
    isRecord(comparisonRef) &&
    comparisonRef["version"] === "migaki.observed-trajectory-comparison.v0" &&
    typeof comparisonRef["previousRunId"] === "string" &&
    typeof comparisonRef["currentRunId"] === "string" &&
    isRecord(privacyPolicy) &&
    privacyPolicy["exportMode"] === "metadata_only" &&
    isRecord(redaction) &&
    redaction["mode"] === "metadata_only" &&
    Array.isArray(redaction["omittedFields"]) &&
    isRecord(summary) &&
    typeof summary["allowed"] === "number" &&
    typeof summary["blocked"] === "number" &&
    typeof summary["needsReview"] === "number" &&
    typeof summary["totalCandidates"] === "number"
  );
}

function isReuseDecision(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["nodeId"] === "string" &&
    typeof value["previousNodeId"] === "string" &&
    (value["operationKind"] === "model_call" ||
      value["operationKind"] === "tool_call") &&
    (value["status"] === "allowed" ||
      value["status"] === "blocked" ||
      value["status"] === "needs_review") &&
    Array.isArray(value["reasons"]) &&
    value["reasons"].every(isReuseDecisionReason) &&
    Array.isArray(value["requiredValidators"])
  );
}

function isReuseDecisionReason(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    typeof value["message"] === "string"
  );
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
