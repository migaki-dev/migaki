import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertSafeRunId,
  createExecutionReportSummary,
  EXECUTION_GRAPH_VERSION,
  parseExecutionEvent,
  serializeExecutionJson,
  type Artifact,
  type ExecutionClock,
  type ExecutionGraph,
  type ExecutionNode,
  type ExecutionReportSummary,
} from "./execution.js";
import {
  EVIDENCE_PRIVACY_POLICY_VERSION,
  type EvidencePrivacyPolicyReference,
} from "./evidence-bundle.js";

export const PROMOTED_ARTIFACT_VERSION = "migaki.promoted-artifact.v0";
export const PROMOTED_GRAPH_SUMMARY_VERSION =
  "migaki.promoted-graph-summary.v0";

export type PromotedArtifactValidationErrorCode =
  | "invalid_artifact_name"
  | "malformed_source_artifact"
  | "missing_required_artifact";

export interface PromoteExecutionRunOptions {
  readonly artifactRoot?: string;
  readonly clock?: ExecutionClock;
  readonly name: string;
  readonly runId: string;
  readonly sourceRoot?: string;
}

export interface FindLatestExecutionRunOptions {
  readonly sourceRoot?: string;
}

export interface PromoteExecutionRunResult {
  readonly bundleDirectory: string;
  readonly graphSummaryPath: string;
  readonly manifest: PromotedArtifactManifest;
  readonly manifestPath: string;
  readonly reportPath: string;
}

export interface PromotedSourceArtifact {
  readonly bytes: number;
  readonly fingerprint: string;
  readonly path: string;
  readonly promoted: boolean;
  readonly reason?: string;
}

export interface PromotedArtifactFile {
  readonly mediaType: string;
  readonly path: string;
  readonly role: "graph_summary" | "manifest" | "report";
}

export interface PromotedArtifactRedactionRecord {
  readonly artifactId?: string;
  readonly kind?: string;
  readonly mode: "omitted" | "redacted";
  readonly nodeId?: string;
  readonly path: string;
  readonly reason: string;
  readonly sourceArtifact: string;
}

export interface PromotedArtifactManifest {
  readonly artifacts: readonly PromotedArtifactFile[];
  readonly createdAt: string;
  readonly name: string;
  readonly privacyPolicy: EvidencePrivacyPolicyReference;
  readonly redactions: readonly PromotedArtifactRedactionRecord[];
  readonly source: {
    readonly localRunPath: string;
    readonly runId: string;
  };
  readonly sourceArtifacts: readonly PromotedSourceArtifact[];
  readonly version: typeof PROMOTED_ARTIFACT_VERSION;
}

export interface PromotedGraphSummary {
  readonly edgeCount: number;
  readonly endedAt?: string;
  readonly nodes: readonly PromotedGraphSummaryNode[];
  readonly reportSummary: Pick<
    ExecutionReportSummary,
    | "failedNodes"
    | "nodeCount"
    | "opportunitySummary"
    | "runId"
    | "status"
    | "toolCalls"
    | "version"
  >;
  readonly runId: string;
  readonly startedAt: string;
  readonly status: ExecutionGraph["status"];
  readonly version: typeof PROMOTED_GRAPH_SUMMARY_VERSION;
}

export interface PromotedGraphSummaryNode {
  readonly artifacts: readonly PromotedGraphSummaryArtifact[];
  readonly durationMs?: number;
  readonly endedAt?: string;
  readonly id: string;
  readonly operation: {
    readonly id: string;
    readonly kind: string;
    readonly name?: string;
  };
  readonly startedAt: string;
  readonly status: ExecutionNode["status"];
}

export interface PromotedGraphSummaryArtifact {
  readonly fingerprint?: string;
  readonly id: string;
  readonly kind: string;
  readonly redaction?: {
    readonly mode: "omitted" | "redacted";
    readonly reason: string;
  };
}

export class PromotedArtifactValidationFailure extends Error {
  readonly code: PromotedArtifactValidationErrorCode;
  readonly path: string;

  constructor(input: {
    readonly code: PromotedArtifactValidationErrorCode;
    readonly message: string;
    readonly path: string;
  }) {
    super(input.message);
    this.name = "PromotedArtifactValidationFailure";
    this.code = input.code;
    this.path = input.path;
  }
}

const requiredSourceArtifacts = [
  {
    fileName: "events.jsonl",
    promoted: false,
    reason: "Raw local event streams are not promoted by default.",
  },
  {
    fileName: "graph.json",
    promoted: true,
  },
  {
    fileName: "report.md",
    promoted: true,
  },
] as const;

export async function findLatestExecutionRun(
  options: FindLatestExecutionRunOptions = {},
): Promise<string> {
  const sourceRoot = options.sourceRoot ?? ".migaki";
  const runsDirectory = join(sourceRoot, "runs");
  let entries: Dirent[];

  try {
    entries = await readdir(runsDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new PromotedArtifactValidationFailure({
        code: "missing_required_artifact",
        message: `No Migaki runs directory found at ${displayRunsPath(sourceRoot)}.`,
        path: displayRunsPath(sourceRoot),
      });
    }

    throw error;
  }

  const candidates = (
    await Promise.all(
      entries.flatMap((entry) => {
        if (!entry.isDirectory() || !isSafeRunId(entry.name)) {
          return [];
        }

        return [latestRunCandidate(runsDirectory, entry.name)];
      }),
    )
  )
    .filter((candidate) => candidate !== undefined)
    .sort(
      (left, right) =>
        right.reportMtimeMs - left.reportMtimeMs ||
        right.runId.localeCompare(left.runId),
    );

  const latest = candidates[0];

  if (latest === undefined) {
    throw new PromotedArtifactValidationFailure({
      code: "missing_required_artifact",
      message: `No Migaki report.md files found under ${displayRunsPath(sourceRoot)}.`,
      path: displayRunsPath(sourceRoot),
    });
  }

  return latest.runId;
}

export async function promoteExecutionRun(
  options: PromoteExecutionRunOptions,
): Promise<PromoteExecutionRunResult> {
  assertSafeRunId(options.runId);
  assertSafeArtifactName(options.name);

  const sourceRoot = options.sourceRoot ?? ".migaki";
  const artifactRoot = options.artifactRoot ?? join("docs", "migaki-artifacts");
  const localRunPath = `.migaki/runs/${options.runId}`;
  const runDirectory = join(sourceRoot, "runs", options.runId);
  const bundleDirectory = join(artifactRoot, options.name);
  const sourceFiles = await readRequiredSourceArtifacts({
    localRunPath,
    runDirectory,
  });
  const events = parseEventsJsonl({
    contents: sourceFiles.eventsJsonl.contents,
    path: sourceFiles.eventsJsonl.displayPath,
    runId: options.runId,
  });
  const graph = parseExecutionGraph({
    contents: sourceFiles.graphJson.contents,
    path: sourceFiles.graphJson.displayPath,
    runId: options.runId,
  });
  const report = validateReport({
    contents: sourceFiles.reportMarkdown.contents,
    path: sourceFiles.reportMarkdown.displayPath,
  });

  if (events.length === 0) {
    throw new PromotedArtifactValidationFailure({
      code: "malformed_source_artifact",
      message: "Migaki events.jsonl must contain at least one event.",
      path: sourceFiles.eventsJsonl.displayPath,
    });
  }

  const createdAt =
    options.clock?.now().toISOString() ?? new Date().toISOString();
  const graphSummary = createPromotedGraphSummary(graph);
  const manifest: PromotedArtifactManifest = {
    artifacts: [
      {
        mediaType: "application/json",
        path: "manifest.json",
        role: "manifest",
      },
      {
        mediaType: "text/markdown",
        path: "report.md",
        role: "report",
      },
      {
        mediaType: "application/json",
        path: "graph-summary.json",
        role: "graph_summary",
      },
    ],
    createdAt,
    name: options.name,
    privacyPolicy: {
      exportMatrixVersion: EVIDENCE_PRIVACY_POLICY_VERSION,
      exportMode: "redacted",
      fullTraceOptIn: false,
    },
    redactions: [
      {
        mode: "omitted",
        path: sourceFiles.eventsJsonl.displayPath,
        reason: "Raw local event streams are not promoted by default.",
        sourceArtifact: sourceFiles.eventsJsonl.displayPath,
      },
      ...collectGraphRedactions(graph, sourceFiles.graphJson.displayPath),
    ],
    source: {
      localRunPath,
      runId: options.runId,
    },
    sourceArtifacts: requiredSourceArtifacts.map((artifact) => {
      const sourceFile = sourceFileByName(sourceFiles, artifact.fileName);

      return {
        bytes: sourceFile.byteLength,
        fingerprint: sourceFile.fingerprint,
        path: sourceFile.displayPath,
        promoted: artifact.promoted,
        ...("reason" in artifact ? { reason: artifact.reason } : {}),
      };
    }),
    version: PROMOTED_ARTIFACT_VERSION,
  };

  await mkdir(bundleDirectory, { recursive: true });

  const manifestPath = join(bundleDirectory, "manifest.json");
  const reportPath = join(bundleDirectory, "report.md");
  const graphSummaryPath = join(bundleDirectory, "graph-summary.json");

  await writeFile(
    manifestPath,
    `${serializeExecutionJson(manifest, 2)}\n`,
    "utf8",
  );
  await writeFile(reportPath, ensureTrailingNewline(report), "utf8");
  await writeFile(
    graphSummaryPath,
    `${serializeExecutionJson(graphSummary, 2)}\n`,
    "utf8",
  );

  return {
    bundleDirectory,
    graphSummaryPath,
    manifest,
    manifestPath,
    reportPath,
  };
}

function createPromotedGraphSummary(
  graph: ExecutionGraph,
): PromotedGraphSummary {
  const reportSummary = createExecutionReportSummary(graph);
  const summary: PromotedGraphSummary = {
    edgeCount: graph.edges.length,
    nodes: graph.nodes.map(promoteGraphNode),
    reportSummary: {
      failedNodes: reportSummary.failedNodes,
      nodeCount: reportSummary.nodeCount,
      runId: reportSummary.runId,
      status: reportSummary.status,
      toolCalls: reportSummary.toolCalls,
      version: reportSummary.version,
      ...(reportSummary.opportunitySummary !== undefined
        ? { opportunitySummary: reportSummary.opportunitySummary }
        : {}),
    },
    runId: graph.runId,
    startedAt: graph.startedAt,
    status: graph.status,
    version: PROMOTED_GRAPH_SUMMARY_VERSION,
    ...(graph.endedAt !== undefined ? { endedAt: graph.endedAt } : {}),
  };

  return summary;
}

function promoteGraphNode(node: ExecutionNode): PromotedGraphSummaryNode {
  return {
    artifacts: node.artifacts.map(promoteGraphArtifact),
    id: node.id,
    operation: {
      id: node.operation.id,
      kind: node.operation.kind,
      ...(node.operation.name !== undefined
        ? { name: node.operation.name }
        : {}),
    },
    startedAt: node.startedAt,
    status: node.status,
    ...(node.durationMs !== undefined ? { durationMs: node.durationMs } : {}),
    ...(node.endedAt !== undefined ? { endedAt: node.endedAt } : {}),
  };
}

function promoteGraphArtifact(
  artifact: Artifact,
): PromotedGraphSummaryArtifact {
  const redaction = readArtifactRedaction(artifact);

  return {
    id: artifact.id,
    kind: artifact.kind,
    ...(artifact.fingerprint !== undefined
      ? { fingerprint: artifact.fingerprint }
      : {}),
    ...(redaction !== undefined ? { redaction } : {}),
  };
}

function collectGraphRedactions(
  graph: ExecutionGraph,
  sourceArtifact: string,
): readonly PromotedArtifactRedactionRecord[] {
  return graph.nodes.flatMap((node) =>
    node.artifacts.flatMap((artifact) => {
      const redaction = readArtifactRedaction(artifact);

      if (redaction === undefined) {
        return [];
      }

      return [
        {
          artifactId: artifact.id,
          kind: artifact.kind,
          mode: redaction.mode,
          nodeId: node.id,
          path: `graph.nodes.${node.id}.artifacts.${artifact.id}`,
          reason: redaction.reason,
          sourceArtifact,
        },
      ];
    }),
  );
}

function readArtifactRedaction(
  artifact: Artifact,
): PromotedGraphSummaryArtifact["redaction"] | undefined {
  const metadata = readRecord(artifact.metadata);
  const redaction = readRecord(metadata?.redaction);

  if (redaction !== undefined) {
    const mode = redactionMode(readString(redaction.mode));
    const reason = readString(redaction.reason);

    if (mode !== undefined && reason !== undefined) {
      return {
        mode,
        reason,
      };
    }
  }

  if (typeof metadata?.redaction === "string") {
    return {
      mode: "omitted",
      reason: metadata.redaction,
    };
  }

  return undefined;
}

async function readRequiredSourceArtifacts(input: {
  readonly localRunPath: string;
  readonly runDirectory: string;
}): Promise<{
  readonly eventsJsonl: SourceFile;
  readonly graphJson: SourceFile;
  readonly reportMarkdown: SourceFile;
}> {
  const eventsJsonl = await readSourceFile({
    displayPath: `${input.localRunPath}/events.jsonl`,
    path: join(input.runDirectory, "events.jsonl"),
  });
  const graphJson = await readSourceFile({
    displayPath: `${input.localRunPath}/graph.json`,
    path: join(input.runDirectory, "graph.json"),
  });
  const reportMarkdown = await readSourceFile({
    displayPath: `${input.localRunPath}/report.md`,
    path: join(input.runDirectory, "report.md"),
  });

  return {
    eventsJsonl,
    graphJson,
    reportMarkdown,
  };
}

interface SourceFile {
  readonly byteLength: number;
  readonly contents: string;
  readonly displayPath: string;
  readonly fingerprint: string;
}

async function readSourceFile(input: {
  readonly displayPath: string;
  readonly path: string;
}): Promise<SourceFile> {
  let contents: string;

  try {
    contents = await readFile(input.path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new PromotedArtifactValidationFailure({
        code: "missing_required_artifact",
        message: `Missing required Migaki source artifact ${input.displayPath}.`,
        path: input.displayPath,
      });
    }

    throw error;
  }

  return {
    byteLength: Buffer.byteLength(contents, "utf8"),
    contents,
    displayPath: input.displayPath,
    fingerprint: sha256(contents),
  };
}

function parseEventsJsonl(input: {
  readonly contents: string;
  readonly path: string;
  readonly runId: string;
}): readonly unknown[] {
  try {
    return input.contents
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const event = parseExecutionEvent(line);

        if (event.runId !== input.runId) {
          throw new Error(
            `Execution event ${event.id} belongs to ${event.runId}.`,
          );
        }

        return event;
      });
  } catch (error) {
    throw malformedSourceArtifact(input.path, error);
  }
}

function parseExecutionGraph(input: {
  readonly contents: string;
  readonly path: string;
  readonly runId: string;
}): ExecutionGraph {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.contents);
  } catch (error) {
    throw malformedSourceArtifact(input.path, error);
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== EXECUTION_GRAPH_VERSION ||
    parsed.runId !== input.runId ||
    !isExecutionGraphStatus(parsed.status) ||
    typeof parsed.startedAt !== "string" ||
    !Array.isArray(parsed.nodes) ||
    !Array.isArray(parsed.edges)
  ) {
    throw malformedSourceArtifact(input.path);
  }

  return parsed as unknown as ExecutionGraph;
}

function validateReport(input: {
  readonly contents: string;
  readonly path: string;
}): string {
  if (input.contents.trim() === "") {
    throw malformedSourceArtifact(input.path);
  }

  return input.contents;
}

function sourceFileByName(
  files: {
    readonly eventsJsonl: SourceFile;
    readonly graphJson: SourceFile;
    readonly reportMarkdown: SourceFile;
  },
  fileName: (typeof requiredSourceArtifacts)[number]["fileName"],
): SourceFile {
  if (fileName === "events.jsonl") {
    return files.eventsJsonl;
  }

  if (fileName === "graph.json") {
    return files.graphJson;
  }

  return files.reportMarkdown;
}

function malformedSourceArtifact(
  path: string,
  cause?: unknown,
): PromotedArtifactValidationFailure {
  const suffix =
    cause instanceof Error && cause.message !== "" ? ` ${cause.message}` : "";

  return new PromotedArtifactValidationFailure({
    code: "malformed_source_artifact",
    message: `Malformed Migaki source artifact ${path}.${suffix}`,
    path,
  });
}

function assertSafeArtifactName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") {
    throw new PromotedArtifactValidationFailure({
      code: "invalid_artifact_name",
      message:
        "Promoted artifact name may contain only letters, numbers, dots, underscores, and hyphens.",
      path: name,
    });
  }
}

function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(runId);
}

async function latestRunCandidate(
  runsDirectory: string,
  runId: string,
): Promise<
  { readonly reportMtimeMs: number; readonly runId: string } | undefined
> {
  try {
    const reportStat = await stat(join(runsDirectory, runId, "report.md"));

    if (!reportStat.isFile()) {
      return undefined;
    }

    return {
      reportMtimeMs: reportStat.mtimeMs,
      runId,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

function displayRunsPath(sourceRoot: string): string {
  return sourceRoot === ".migaki" ? ".migaki/runs" : join(sourceRoot, "runs");
}

function sha256(contents: string): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isExecutionGraphStatus(
  value: unknown,
): value is ExecutionGraph["status"] {
  return value === "error" || value === "ok" || value === "running";
}

function redactionMode(
  value: string | undefined,
): "omitted" | "redacted" | undefined {
  if (value === "omitted" || value === "redacted") {
    return value;
  }

  return undefined;
}

function readRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return (
    isRecord(error) && typeof error.code === "string" && error.code === "ENOENT"
  );
}
