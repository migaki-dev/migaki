#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  runCodeReviewWorkflowBenchmark,
  runParallelMigakiBenchmark,
  runRepoAgentReuseBenchmark,
  type CodeReviewWorkflowBenchmarkResult,
  type ParallelMigakiBenchmarkOptions,
  type ParallelMigakiBenchmarkResult,
  type RepoAgentReuseBenchmarkResult,
} from "./benchmark.js";
import { serializeStableJson } from "./hash.js";
import { LocalMigakiStore } from "./store.js";

export const MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION =
  "migaki.openai-agents-js.cli.v0";

export type MigakiOpenAIAgentsCliFormat = "human" | "json";

export interface MigakiOpenAIAgentsCliIo {
  readonly cwd: () => string;
  readonly importModule: (specifier: string) => Promise<unknown> | unknown;
}

export interface MigakiOpenAIAgentsCliResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface BenchmarkArgs {
  readonly format: MigakiOpenAIAgentsCliFormat;
  readonly migakiRunId?: string;
  readonly modulePath: string;
  readonly runId: string;
  readonly storeDirectory: string;
  readonly writeReport: boolean;
}

interface RepoAgentBenchmarkArgs {
  readonly format: MigakiOpenAIAgentsCliFormat;
  readonly runId: string;
  readonly storeDirectory: string;
}

type CodeReviewBenchmarkArgs = RepoAgentBenchmarkArgs;

const defaultStoreDirectory = ".migaki";

const defaultIo: MigakiOpenAIAgentsCliIo = {
  cwd() {
    return process.cwd();
  },
  importModule(specifier) {
    return import(specifier);
  },
};

export async function runCli(
  argv: readonly string[],
  io: MigakiOpenAIAgentsCliIo = defaultIo,
): Promise<MigakiOpenAIAgentsCliResult> {
  const command = argv[0];

  if (command === "benchmark") {
    return runBenchmarkCommand(argv.slice(1), io);
  }

  if (command === "repo-agent-benchmark") {
    return runRepoAgentBenchmarkCommand(argv.slice(1));
  }

  if (command === "code-review-benchmark") {
    return runCodeReviewBenchmarkCommand(argv.slice(1));
  }

  if (command === "--help" || command === "-h") {
    return succeed(renderUsage());
  }

  return fail(renderUsage());
}

async function runBenchmarkCommand(
  argv: readonly string[],
  io: MigakiOpenAIAgentsCliIo,
): Promise<MigakiOpenAIAgentsCliResult> {
  if (includesHelp(argv)) {
    return succeed(renderBenchmarkUsage());
  }

  const args = parseBenchmarkArgs(argv);

  if (typeof args === "string") {
    return fail(`${args}\n\n${renderBenchmarkUsage()}`);
  }

  let moduleExports: unknown;

  try {
    moduleExports = await io.importModule(
      resolveModuleSpecifier(args.modulePath, io.cwd()),
    );
  } catch (error) {
    return fail(`Could not load benchmark module: ${errorMessage(error)}`);
  }

  const createRun = readCreateRunExport(moduleExports);

  if (typeof createRun === "string") {
    return fail(createRun);
  }

  let result: ParallelMigakiBenchmarkResult;

  try {
    result = await runParallelMigakiBenchmark({
      createRun,
      runId: args.runId,
      store: new LocalMigakiStore(args.storeDirectory),
      writeReport: args.writeReport,
      ...(args.migakiRunId !== undefined
        ? { migakiRunId: args.migakiRunId }
        : {}),
    });
  } catch (error) {
    return fail(`Benchmark failed: ${errorMessage(error)}`);
  }

  const stdout =
    args.format === "json"
      ? renderBenchmarkJson(args, result)
      : renderBenchmarkHuman(args, result);

  return {
    exitCode: result.comparison.bothSucceeded ? 0 : 1,
    stderr: "",
    stdout,
  };
}

async function runRepoAgentBenchmarkCommand(
  argv: readonly string[],
): Promise<MigakiOpenAIAgentsCliResult> {
  if (includesHelp(argv)) {
    return succeed(renderRepoAgentBenchmarkUsage());
  }

  const args = parseRepoAgentBenchmarkArgs(argv);

  if (typeof args === "string") {
    return fail(`${args}\n\n${renderRepoAgentBenchmarkUsage()}`);
  }

  let result: RepoAgentReuseBenchmarkResult;

  try {
    result = await runRepoAgentReuseBenchmark({
      runId: args.runId,
      store: new LocalMigakiStore(args.storeDirectory),
    });
  } catch (error) {
    return fail(`Repo-agent benchmark failed: ${errorMessage(error)}`);
  }

  return succeed(
    args.format === "json"
      ? renderRepoAgentBenchmarkJson(args, result)
      : renderRepoAgentBenchmarkHuman(args, result),
  );
}

async function runCodeReviewBenchmarkCommand(
  argv: readonly string[],
): Promise<MigakiOpenAIAgentsCliResult> {
  if (includesHelp(argv)) {
    return succeed(renderCodeReviewBenchmarkUsage());
  }

  const args = parseCodeReviewBenchmarkArgs(argv);

  if (typeof args === "string") {
    return fail(`${args}\n\n${renderCodeReviewBenchmarkUsage()}`);
  }

  let result: CodeReviewWorkflowBenchmarkResult;

  try {
    result = await runCodeReviewWorkflowBenchmark({
      runId: args.runId,
      store: new LocalMigakiStore(args.storeDirectory),
    });
  } catch (error) {
    return fail(`Code-review benchmark failed: ${errorMessage(error)}`);
  }

  return succeed(
    args.format === "json"
      ? renderCodeReviewBenchmarkJson(args, result)
      : renderCodeReviewBenchmarkHuman(args, result),
  );
}

function parseBenchmarkArgs(argv: readonly string[]): BenchmarkArgs | string {
  let format: MigakiOpenAIAgentsCliFormat = "human";
  let migakiRunId: string | undefined;
  let modulePath: string | undefined;
  let runId: string | undefined;
  let storeDirectory = defaultStoreDirectory;
  let writeReport = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--module") {
      const value = readOptionValue(argv, index, arg);

      if (typeof value !== "string") {
        return value.message;
      }

      modulePath = value;
      index += 1;
      continue;
    }

    if (arg === "--run-id") {
      const value = readOptionValue(argv, index, arg);

      if (typeof value !== "string") {
        return value.message;
      }

      runId = value;
      index += 1;
      continue;
    }

    if (arg === "--migaki-run-id") {
      const value = readOptionValue(argv, index, arg);

      if (typeof value !== "string") {
        return value.message;
      }

      migakiRunId = value;
      index += 1;
      continue;
    }

    if (arg === "--store") {
      const value = readOptionValue(argv, index, arg);

      if (typeof value !== "string") {
        return value.message;
      }

      storeDirectory = value;
      index += 1;
      continue;
    }

    if (arg === "--format") {
      const parsed = readFormatOption(argv, index);

      if (typeof parsed !== "string") {
        return parsed.message;
      }

      format = parsed;
      index += 1;
      continue;
    }

    if (arg === "--no-report") {
      writeReport = false;
      continue;
    }

    return `Unknown benchmark argument: ${String(arg)}.`;
  }

  if (modulePath === undefined) {
    return "Missing required --module argument.";
  }

  if (runId === undefined) {
    return "Missing required --run-id argument.";
  }

  return {
    format,
    ...(migakiRunId !== undefined ? { migakiRunId } : {}),
    modulePath,
    runId,
    storeDirectory,
    writeReport,
  };
}

function parseRepoAgentBenchmarkArgs(
  argv: readonly string[],
): RepoAgentBenchmarkArgs | string {
  return parseFixtureBenchmarkArgs(argv, "repo-agent-benchmark");
}

function parseCodeReviewBenchmarkArgs(
  argv: readonly string[],
): CodeReviewBenchmarkArgs | string {
  return parseFixtureBenchmarkArgs(argv, "code-review-benchmark");
}

function parseFixtureBenchmarkArgs(
  argv: readonly string[],
  commandName: string,
): RepoAgentBenchmarkArgs | string {
  let format: MigakiOpenAIAgentsCliFormat = "human";
  let runId: string | undefined;
  let storeDirectory = defaultStoreDirectory;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--run-id") {
      const value = readOptionValue(argv, index, arg);

      if (typeof value !== "string") {
        return value.message;
      }

      runId = value;
      index += 1;
      continue;
    }

    if (arg === "--store") {
      const value = readOptionValue(argv, index, arg);

      if (typeof value !== "string") {
        return value.message;
      }

      storeDirectory = value;
      index += 1;
      continue;
    }

    if (arg === "--format") {
      const parsed = readFormatOption(argv, index);

      if (typeof parsed !== "string") {
        return parsed.message;
      }

      format = parsed;
      index += 1;
      continue;
    }

    return `Unknown ${commandName} argument: ${String(arg)}.`;
  }

  if (runId === undefined) {
    return "Missing required --run-id argument.";
  }

  return {
    format,
    runId,
    storeDirectory,
  };
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  option: string,
): string | { readonly message: string } {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    return { message: `Missing value for ${option}.` };
  }

  return value;
}

function includesHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function readFormatOption(
  argv: readonly string[],
  index: number,
): MigakiOpenAIAgentsCliFormat | { readonly message: string } {
  const value = readOptionValue(argv, index, "--format");

  if (typeof value !== "string") {
    return value;
  }

  if (value !== "human" && value !== "json") {
    return { message: "Expected --format to be human or json." };
  }

  return value;
}

function readCreateRunExport(
  moduleExports: unknown,
): ParallelMigakiBenchmarkOptions["createRun"] | string {
  if (typeof moduleExports === "function") {
    return moduleExports as ParallelMigakiBenchmarkOptions["createRun"];
  }

  if (!isRecord(moduleExports)) {
    return "Benchmark module must export createRun(lane).";
  }

  if (typeof moduleExports.createRun === "function") {
    return moduleExports.createRun as ParallelMigakiBenchmarkOptions["createRun"];
  }

  if (typeof moduleExports.default === "function") {
    return moduleExports.default as ParallelMigakiBenchmarkOptions["createRun"];
  }

  if (
    isRecord(moduleExports.default) &&
    typeof moduleExports.default.createRun === "function"
  ) {
    return moduleExports.default
      .createRun as ParallelMigakiBenchmarkOptions["createRun"];
  }

  return "Benchmark module must export createRun(lane).";
}

function renderBenchmarkJson(
  args: BenchmarkArgs,
  result: ParallelMigakiBenchmarkResult,
): string {
  return `${serializeStableJson(
    {
      artifacts: parallelArtifacts(args.storeDirectory, result),
      baseline: result.baseline,
      command: "benchmark",
      comparison: result.comparison,
      migaki: result.migaki,
      migakiRunId: result.migakiRunId,
      module: args.modulePath,
      runId: result.runId,
      version: MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION,
    },
    2,
  )}\n`;
}

function renderBenchmarkHuman(
  args: BenchmarkArgs,
  result: ParallelMigakiBenchmarkResult,
): string {
  const artifacts = parallelArtifacts(args.storeDirectory, result);

  return [
    "Migaki OpenAI Agents Benchmark",
    `Version: ${MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION}`,
    `Run: ${result.runId}`,
    `Migaki run: ${result.migakiRunId}`,
    `Module: ${args.modulePath}`,
    `Baseline: ${result.baseline.status} in ${formatMs(
      result.baseline.durationMs,
    )}`,
    `Migaki: ${result.migaki.status} in ${formatMs(result.migaki.durationMs)}`,
    `Overhead: ${formatMs(result.comparison.overheadMs)} (${formatRatio(
      result.comparison.overheadRatio,
    )})`,
    `Outputs equal: ${formatOptionalBoolean(result.comparison.outputEqual)}`,
    `Baseline error: ${result.baseline.error?.message ?? "none"}`,
    `Migaki error: ${result.migaki.error?.message ?? "none"}`,
    "Artifacts:",
    `- comparison report: ${artifacts.comparisonReport}`,
    `- Migaki events: ${artifacts.migakiEvents}`,
    `- Migaki graph: ${artifacts.migakiGraph}`,
    `- Migaki report: ${artifacts.migakiReport}`,
    "",
  ].join("\n");
}

function renderRepoAgentBenchmarkJson(
  args: RepoAgentBenchmarkArgs,
  result: RepoAgentReuseBenchmarkResult,
): string {
  return `${serializeStableJson(
    {
      artifacts: repoAgentReuseArtifacts(args.storeDirectory, result),
      command: "repo-agent-benchmark",
      comparison: result.comparison.summary,
      currentRunId: result.current.runId,
      previousRunId: result.previous.runId,
      reuseDecision: result.reuseDecision.summary,
      runId: result.runId,
      version: MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION,
    },
    2,
  )}\n`;
}

function renderRepoAgentBenchmarkHuman(
  args: RepoAgentBenchmarkArgs,
  result: RepoAgentReuseBenchmarkResult,
): string {
  const artifacts = repoAgentReuseArtifacts(args.storeDirectory, result);

  return [
    "Migaki OpenAI Agents Repo-Agent Reuse Benchmark",
    `Version: ${MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION}`,
    `Run: ${result.runId}`,
    `Previous run: ${result.previous.runId}`,
    `Current run: ${result.current.runId}`,
    `Reusable model nodes: ${result.comparison.summary.reusableModelCalls}`,
    `Reusable tool nodes: ${result.comparison.summary.reusableToolCalls}`,
    `Changed nodes: ${result.comparison.summary.changedNodes}`,
    `Blocked candidates: ${result.comparison.summary.blockedCandidates}`,
    `Estimated avoidable tokens: ${formatOptionalNumber(
      result.comparison.summary.totalEstimatedAvoidableTokens,
    )}`,
    `Estimated avoidable cost USD: ${formatOptionalCost(
      result.comparison.summary.totalEstimatedAvoidableCostUsd,
    )}`,
    `Estimated avoidable latency ms: ${formatOptionalNumber(
      result.comparison.summary.totalEstimatedAvoidableLatencyMs,
    )}`,
    "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
    "Artifacts:",
    `- previous events: ${artifacts.previousEvents}`,
    `- previous graph: ${artifacts.previousGraph}`,
    `- previous report: ${artifacts.previousReport}`,
    `- current events: ${artifacts.currentEvents}`,
    `- current graph: ${artifacts.currentGraph}`,
    `- current report: ${artifacts.currentReport}`,
    `- comparison report: ${artifacts.report}`,
    `- comparison artifact: ${artifacts.comparison}`,
    `- reuse decision artifact: ${artifacts.reuseDecision}`,
    "",
  ].join("\n");
}

function renderCodeReviewBenchmarkJson(
  args: CodeReviewBenchmarkArgs,
  result: CodeReviewWorkflowBenchmarkResult,
): string {
  return `${serializeStableJson(
    {
      artifacts: codeReviewWorkflowArtifacts(args.storeDirectory, result),
      command: "code-review-benchmark",
      comparison: result.comparison.summary,
      contextDiff: result.contextDiff,
      currentRunId: result.current.runId,
      metrics: result.metrics,
      migakiPath: result.migakiPath,
      previousRunId: result.previous.runId,
      reuseDecision: result.reuseDecision.summary,
      runId: result.runId,
      version: MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION,
      warningList: result.warningList,
    },
    2,
  )}\n`;
}

function renderCodeReviewBenchmarkHuman(
  args: CodeReviewBenchmarkArgs,
  result: CodeReviewWorkflowBenchmarkResult,
): string {
  const artifacts = codeReviewWorkflowArtifacts(args.storeDirectory, result);

  return [
    "Migaki OpenAI Agents Code-Review Workflow Benchmark",
    `Version: ${MIGAKI_OPENAI_AGENTS_JS_CLI_VERSION}`,
    `Run: ${result.runId}`,
    `Previous run: ${result.previous.runId}`,
    `Current run: ${result.current.runId}`,
    `Comment acceptance proxy: ${formatOptionalNumber(result.metrics.commentAcceptanceProxy)}`,
    `False-positive proxy: ${formatOptionalNumber(result.metrics.falsePositiveProxy)}`,
    `Validator pass rate: ${formatOptionalNumber(result.metrics.validatorPassRate)}`,
    `Cost delta USD: ${formatOptionalCost(result.metrics.costDeltaUsd)}`,
    `Latency delta ms: ${formatOptionalNumber(result.metrics.latencyDeltaMs)}`,
    "Observation only: no model calls, tool calls, file reads, provider requests, replay, cache lookup, or user-visible action was skipped.",
    "Artifacts:",
    `- previous events: ${artifacts.previousEvents}`,
    `- previous graph: ${artifacts.previousGraph}`,
    `- current events: ${artifacts.currentEvents}`,
    `- current graph: ${artifacts.currentGraph}`,
    `- comparison report: ${artifacts.report}`,
    `- comparison artifact: ${artifacts.comparison}`,
    `- metrics artifact: ${artifacts.metrics}`,
    `- reuse decision artifact: ${artifacts.reuseDecision}`,
    "",
  ].join("\n");
}

function renderUsage(): string {
  return [
    "Usage: migaki-openai-agents-js <command> [options]",
    "",
    "Commands:",
    "  benchmark                Run baseline and Migaki lanes in parallel.",
    "  repo-agent-benchmark     Run the deterministic repo-agent benchmark fixture.",
    "  code-review-benchmark   Run the deterministic code-review workflow fixture.",
    "",
    "Run a command with --help for command-specific options.",
    "",
  ].join("\n");
}

function renderBenchmarkUsage(): string {
  return [
    "Usage: migaki-openai-agents-js benchmark --module <module> --run-id <id> [options]",
    "",
    "Options:",
    "  --module <module>        Module exporting createRun(lane).",
    "  --run-id <id>            Comparison run id.",
    "  --migaki-run-id <id>     Migaki lane run id. Defaults to <run-id>-migaki.",
    "  --store <dir>            Local Migaki store directory. Defaults to .migaki.",
    "  --format human|json      Output format. Defaults to human.",
    "  --no-report              Do not write the comparison report.",
    "",
  ].join("\n");
}

function renderRepoAgentBenchmarkUsage(): string {
  return [
    "Usage: migaki-openai-agents-js repo-agent-benchmark --run-id <id> [options]",
    "",
    "Options:",
    "  --run-id <id>            Repo-agent fixture run id.",
    "  --store <dir>            Local Migaki store directory. Defaults to .migaki.",
    "  --format human|json      Output format. Defaults to human.",
    "",
  ].join("\n");
}

function renderCodeReviewBenchmarkUsage(): string {
  return [
    "Usage: migaki-openai-agents-js code-review-benchmark --run-id <id> [options]",
    "",
    "Options:",
    "  --run-id <id>            Code-review fixture run id.",
    "  --store <dir>            Local Migaki store directory. Defaults to .migaki.",
    "  --format human|json      Output format. Defaults to human.",
    "",
  ].join("\n");
}

function parallelArtifacts(
  storeDirectory: string,
  result: ParallelMigakiBenchmarkResult,
): Readonly<Record<string, string>> {
  return {
    comparisonReport: join(storeDirectory, "runs", result.runId, "report.md"),
    migakiEvents: join(
      storeDirectory,
      "runs",
      result.migakiRunId,
      "events.jsonl",
    ),
    migakiGraph: join(storeDirectory, "runs", result.migakiRunId, "graph.json"),
    migakiReport: join(storeDirectory, "runs", result.migakiRunId, "report.md"),
  };
}

function repoAgentReuseArtifacts(
  storeDirectory: string,
  result: RepoAgentReuseBenchmarkResult,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(result.artifacts).map(([key, path]) => [
      key,
      join(storeDirectory, path),
    ]),
  );
}

function codeReviewWorkflowArtifacts(
  storeDirectory: string,
  result: CodeReviewWorkflowBenchmarkResult,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(result.artifacts).map(([key, path]) => [
      key,
      join(storeDirectory, path),
    ]),
  );
}

function resolveModuleSpecifier(modulePath: string, cwd: string): string {
  if (hasUrlScheme(modulePath)) {
    return modulePath;
  }

  if (looksLikePath(modulePath)) {
    return pathToFileURL(resolve(cwd, modulePath)).href;
  }

  return modulePath;
}

function looksLikePath(modulePath: string): boolean {
  return (
    modulePath.startsWith(".") ||
    modulePath.startsWith("/") ||
    modulePath.includes("\\") ||
    modulePath.endsWith(".ts") ||
    modulePath.endsWith(".tsx")
  );
}

function hasUrlScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function formatMs(value: number): string {
  return `${formatNumber(value)}ms`;
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "unknown" : `${formatNumber(value)}x`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : formatNumber(value);
}

function formatOptionalCost(value: number | undefined): string {
  return value === undefined ? "unknown" : value.toFixed(6);
}

function formatOptionalBoolean(value: boolean | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function succeed(stdout: string): MigakiOpenAIAgentsCliResult {
  return {
    exitCode: 0,
    stderr: "",
    stdout: stdout.endsWith("\n") ? stdout : `${stdout}\n`,
  };
}

function fail(message: string): MigakiOpenAIAgentsCliResult {
  return {
    exitCode: 1,
    stderr: message.endsWith("\n") ? message : `${message}\n`,
    stdout: "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));

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
  main().catch((error: unknown) => {
    process.stderr.write(
      `migaki-openai-agents-js failed: ${errorMessage(error)}\n`,
    );
    process.exitCode = 1;
  });
}
