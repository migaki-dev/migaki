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

type TaskSuiteArgs = TaskSuiteListArgs | TaskSuiteRunArgs;

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
    description: "All MVP repo-agent task ladder fixture families.",
    fixtureFamilies: repoAgentFixtureFamilyIds,
    id: "repo-agent-mvp",
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

  if (subcommand !== "list" && subcommand !== "run") {
    return "Usage: migaki task-suite <list|run> [--suite suite-id] [--output-dir dir] [--format human|json]";
  }

  let format: CliReportFormat = "human";
  let outputDir = ".migaki/task-suites";
  let suite: string | undefined;

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

    return `Unknown task-suite argument: ${String(arg)}.`;
  }

  if (subcommand === "list") {
    return { command: "list", format };
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
