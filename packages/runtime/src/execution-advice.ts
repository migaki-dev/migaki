export interface ExecutionAdviceGraphCandidate {
  readonly graphPath: string;
  readonly modifiedAtMs: number;
  readonly runId: string;
}

export interface SelectExecutionAdviceGraphOptions {
  readonly includeSmoke?: boolean;
}

const smokeRunIdPattern = /^codex-(?:session|turn)-migaki-smoke-/u;

export function isSmokeExecutionRunId(runId: string): boolean {
  return smokeRunIdPattern.test(runId);
}

export function selectExecutionAdviceGraphCandidate(
  candidates: readonly ExecutionAdviceGraphCandidate[],
  options: SelectExecutionAdviceGraphOptions = {},
): ExecutionAdviceGraphCandidate | undefined {
  const eligibleCandidates =
    options.includeSmoke === true
      ? candidates
      : candidates.filter(
          (candidate) => !isSmokeExecutionRunId(candidate.runId),
        );

  return [...eligibleCandidates].sort(compareAdviceGraphCandidates)[0];
}

function compareAdviceGraphCandidates(
  left: ExecutionAdviceGraphCandidate,
  right: ExecutionAdviceGraphCandidate,
): number {
  return (
    right.modifiedAtMs - left.modifiedAtMs ||
    right.runId.localeCompare(left.runId) ||
    right.graphPath.localeCompare(left.graphPath)
  );
}
