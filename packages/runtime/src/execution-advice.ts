import { stableExecutionHash } from "./execution.js";

export interface ExecutionAdviceGraphCandidate {
  readonly graphPath: string;
  readonly modifiedAtMs: number;
  readonly nodeCount?: number;
  readonly opportunityCount?: number;
  readonly runId: string;
  readonly smokeHarness?: boolean;
  readonly status?: string;
  readonly toolCalls?: number;
}

export interface SelectExecutionAdviceGraphOptions {
  readonly includeSmoke?: boolean;
}

export type ExecutionAdviceGraphCandidateSkipReason =
  | "running_run"
  | "session_run"
  | "smoke_harness_run"
  | "smoke_run";

export interface ExecutionAdviceGraphCandidateRejection {
  readonly candidate: ExecutionAdviceGraphCandidate;
  readonly reasons: readonly ExecutionAdviceGraphCandidateSkipReason[];
}

export interface ExecutionAdviceGraphCandidateSelection {
  readonly eligibleCandidates: readonly ExecutionAdviceGraphCandidate[];
  readonly rejectedCandidates: readonly ExecutionAdviceGraphCandidateRejection[];
  readonly selected?: ExecutionAdviceGraphCandidate;
}

export interface ExecutionAdviceSourceSummary {
  readonly sourceAdapters: readonly NamedCount[];
  readonly warning?: string;
}

interface NamedCount {
  readonly count: number;
  readonly name: string;
}

const smokeRunIdPattern = /^codex-(?:session|turn)-migaki-smoke-/u;
const sessionRunIdPattern = /^codex-session-/u;
const turnRunIdPattern = /^codex-turn-/u;
export const MIGAKI_SMOKE_REAL_TURN_MARKER = ".migaki-smoke-real-turn";
const knownSmokeHarnessPromptFingerprints = new Set([
  stableExecutionHash({
    hookEventName: "UserPromptSubmit",
    prompt:
      "Run pwd with the shell tool, then reply exactly: MIGAKI_HOOK_SMOKE",
  }),
]);

export function isSmokeExecutionRunId(runId: string): boolean {
  return smokeRunIdPattern.test(runId);
}

export function isSessionExecutionRunId(runId: string): boolean {
  return sessionRunIdPattern.test(runId);
}

export function isTurnExecutionRunId(runId: string): boolean {
  return turnRunIdPattern.test(runId);
}

export function isSmokeHarnessExecutionRun(
  candidate: ExecutionAdviceGraphCandidate,
): boolean {
  return candidate.smokeHarness === true;
}

export function createExecutionAdviceGraphCandidate(input: {
  readonly graph: unknown;
  readonly graphPath: string;
  readonly modifiedAtMs: number;
  readonly runId: string;
  readonly smokeHarness?: boolean;
}): ExecutionAdviceGraphCandidate {
  const graph = isRecord(input.graph) ? input.graph : {};
  const status = readString(graph, "status");
  const toolCalls = countToolCalls(graph);
  const nodeCount = countNodes(graph);
  const opportunityCount = countRepeatedFileOpportunities(graph);
  const smokeHarness =
    input.smokeHarness === true || graphHasKnownSmokeHarnessPrompt(graph);

  return {
    graphPath: input.graphPath,
    modifiedAtMs: input.modifiedAtMs,
    ...(nodeCount !== undefined ? { nodeCount } : {}),
    ...(opportunityCount !== undefined ? { opportunityCount } : {}),
    runId: input.runId,
    ...(smokeHarness ? { smokeHarness: true } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
  };
}

export function selectExecutionAdviceGraphCandidate(
  candidates: readonly ExecutionAdviceGraphCandidate[],
  options: SelectExecutionAdviceGraphOptions = {},
): ExecutionAdviceGraphCandidate | undefined {
  return createExecutionAdviceGraphCandidateSelection(candidates, options)
    .selected;
}

export function createExecutionAdviceGraphCandidateSelection(
  candidates: readonly ExecutionAdviceGraphCandidate[],
  options: SelectExecutionAdviceGraphOptions = {},
): ExecutionAdviceGraphCandidateSelection {
  const eligibleCandidates: ExecutionAdviceGraphCandidate[] = [];
  const rejectedCandidates: ExecutionAdviceGraphCandidateRejection[] = [];

  for (const candidate of candidates) {
    const reasons = executionAdviceGraphCandidateSkipReasons(
      candidate,
      options,
    );

    if (reasons.length === 0) {
      eligibleCandidates.push(candidate);
    } else {
      rejectedCandidates.push({
        candidate,
        reasons,
      });
    }
  }

  const sortedEligibleCandidates =
    sortExecutionAdviceGraphCandidates(eligibleCandidates);

  return {
    eligibleCandidates: sortedEligibleCandidates,
    rejectedCandidates,
    ...(sortedEligibleCandidates[0] !== undefined
      ? { selected: sortedEligibleCandidates[0] }
      : {}),
  };
}

export function executionAdviceGraphCandidateSkipReasons(
  candidate: ExecutionAdviceGraphCandidate,
  options: SelectExecutionAdviceGraphOptions = {},
): readonly ExecutionAdviceGraphCandidateSkipReason[] {
  const reasons: ExecutionAdviceGraphCandidateSkipReason[] = [];

  if (options.includeSmoke !== true && isSmokeExecutionRunId(candidate.runId)) {
    reasons.push("smoke_run");
  }

  if (options.includeSmoke !== true && isSmokeHarnessExecutionRun(candidate)) {
    reasons.push("smoke_harness_run");
  }

  if (isSessionExecutionRunId(candidate.runId)) {
    reasons.push("session_run");
  }

  if (candidate.status === "running") {
    reasons.push("running_run");
  }

  return reasons;
}

export function sortExecutionAdviceGraphCandidates(
  candidates: readonly ExecutionAdviceGraphCandidate[],
): readonly ExecutionAdviceGraphCandidate[] {
  return [...candidates].sort(compareAdviceGraphCandidates);
}

export function sortExecutionAdviceGraphCandidatesByModifiedTime(
  candidates: readonly ExecutionAdviceGraphCandidate[],
): readonly ExecutionAdviceGraphCandidate[] {
  return [...candidates].sort(compareAdviceGraphCandidatesByModifiedTime);
}

export function formatExecutionAdviceSelectionNote(
  selected: ExecutionAdviceGraphCandidate,
  latestCandidate: ExecutionAdviceGraphCandidate | undefined,
): string | undefined {
  if (
    latestCandidate === undefined ||
    selected.runId === latestCandidate.runId
  ) {
    return undefined;
  }

  const selectedHasSignal = (selected.opportunityCount ?? 0) > 0;
  const latestHasSignal = (latestCandidate.opportunityCount ?? 0) > 0;

  if (selected.modifiedAtMs < latestCandidate.modifiedAtMs) {
    if (selectedHasSignal && !latestHasSignal) {
      return "selected advice is older than the latest eligible turn because it has actionable signal and the latest eligible turn has none.";
    }

    return "selected advice is older than the latest eligible turn; compare this with current dogfood status before treating advice as current-session evidence.";
  }

  if (selected.modifiedAtMs > latestCandidate.modifiedAtMs) {
    return "selected advice is newer than the latest eligible turn, which usually means filtering options changed the candidate pool.";
  }

  return "selected advice differs from the latest eligible turn.";
}

export function summarizeExecutionAdviceSources(
  eventsJsonl: string,
): ExecutionAdviceSourceSummary {
  const sourceAdapterCounts = new Map<string, number>();

  for (const line of eventsJsonl.split(/\r?\n/u)) {
    if (line.trim() === "") {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }

    const source = readRecord(readRecord(readRecord(parsed).metadata).source);
    const adapter = readString(source, "adapter");

    if (adapter !== undefined) {
      sourceAdapterCounts.set(
        adapter,
        (sourceAdapterCounts.get(adapter) ?? 0) + 1,
      );
    }
  }

  const sourceAdapters = sortNamedCounts(sourceAdapterCounts);
  const adapterNames = new Set(sourceAdapters.map((count) => count.name));
  const warning = adapterNames.has("manual-exec")
    ? "selected advice includes manual-exec bridge evidence; use it as coaching, not as native hook proof."
    : undefined;

  return {
    sourceAdapters,
    ...(warning !== undefined ? { warning } : {}),
  };
}

export function formatNamedCounts(counts: readonly NamedCount[]): string {
  return counts.length === 0
    ? "none"
    : counts.map((count) => `${count.name} ${count.count}`).join(", ");
}

function compareAdviceGraphCandidates(
  left: ExecutionAdviceGraphCandidate,
  right: ExecutionAdviceGraphCandidate,
): number {
  return (
    candidateUsefulnessRank(right) - candidateUsefulnessRank(left) ||
    compareAdviceGraphCandidatesByModifiedTime(left, right)
  );
}

function candidateUsefulnessRank(
  candidate: ExecutionAdviceGraphCandidate,
): number {
  return (candidate.opportunityCount ?? 0) > 0 ? 1 : 0;
}

function compareAdviceGraphCandidatesByModifiedTime(
  left: ExecutionAdviceGraphCandidate,
  right: ExecutionAdviceGraphCandidate,
): number {
  return (
    right.modifiedAtMs - left.modifiedAtMs ||
    right.runId.localeCompare(left.runId) ||
    right.graphPath.localeCompare(left.graphPath)
  );
}

function countNodes(
  graph: Readonly<Record<string, unknown>>,
): number | undefined {
  const nodes = graph.nodes;

  return Array.isArray(nodes) ? nodes.length : undefined;
}

function countToolCalls(
  graph: Readonly<Record<string, unknown>>,
): number | undefined {
  const nodes = graph.nodes;

  if (!Array.isArray(nodes)) {
    return undefined;
  }

  return nodes.filter((node) => {
    if (!isRecord(node) || !isRecord(node.operation)) {
      return false;
    }

    return node.operation.kind === "tool_call";
  }).length;
}

function countRepeatedFileOpportunities(
  graph: Readonly<Record<string, unknown>>,
): number | undefined {
  const nodes = graph.nodes;

  if (!Array.isArray(nodes)) {
    return undefined;
  }

  const countsByFingerprint = new Map<string, number>();

  for (const node of nodes) {
    if (!isRecord(node) || !Array.isArray(node.artifacts)) {
      continue;
    }

    for (const artifact of node.artifacts) {
      if (!isRecord(artifact) || artifact.kind !== "file") {
        continue;
      }

      const fingerprint = readString(artifact, "fingerprint");

      if (fingerprint === undefined) {
        continue;
      }

      countsByFingerprint.set(
        fingerprint,
        (countsByFingerprint.get(fingerprint) ?? 0) + 1,
      );
    }
  }

  return [...countsByFingerprint.values()].filter((count) => count > 1).length;
}

function graphHasKnownSmokeHarnessPrompt(
  graph: Readonly<Record<string, unknown>>,
): boolean {
  const nodes = graph.nodes;

  if (!Array.isArray(nodes)) {
    return false;
  }

  return nodes.some((node) => {
    if (!isRecord(node) || !isRecord(node.operation)) {
      return false;
    }

    if (readString(node.operation, "kind") !== "user_prompt") {
      return false;
    }

    const operationFingerprint = readString(node.operation, "fingerprint");

    if (
      operationFingerprint !== undefined &&
      knownSmokeHarnessPromptFingerprints.has(operationFingerprint)
    ) {
      return true;
    }

    if (!Array.isArray(node.artifacts)) {
      return false;
    }

    return node.artifacts.some((artifact) => {
      if (!isRecord(artifact) || artifact.kind !== "prompt") {
        return false;
      }

      const artifactFingerprint = readString(artifact, "fingerprint");

      return (
        artifactFingerprint !== undefined &&
        knownSmokeHarnessPromptFingerprints.has(artifactFingerprint)
      );
    });
  });
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];

  return typeof value === "string" ? value : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function sortNamedCounts(
  counts: ReadonlyMap<string, number>,
): readonly NamedCount[] {
  return [...counts.entries()]
    .map(([name, count]) => ({
      count,
      name,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name),
    );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
