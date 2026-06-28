import type { MIREdge, MIRContextBlock, MIRNode, MIRPlan } from "@migaki/mir";

import {
  CONTEXT_LEDGER_VERSION,
  createContextLedger,
} from "./context-ledger.js";
import { diffMIRPlans } from "./diff.js";
import {
  EVIDENCE_EVENT_VERSION,
  type ContextChangeEvidenceEvent,
  type EstimateEvidenceEvent,
} from "./evidence.js";
import {
  PASS_CONTRACT_VERSION,
  type OptimizationPass,
  type PassContext,
  type PassEvidenceFragment,
  type PassResult,
  type PassWarning,
} from "./pass.js";

const passIdentity = {
  name: "migaki.context.exact_duplicate_elimination",
  version: "0.0.0",
};

export const exactDuplicateContextEliminationPass = {
  ...passIdentity,
  contractVersion: PASS_CONTRACT_VERSION,
  inputCapabilities: [
    {
      name: "mir.context.ledger",
      required: true,
      source: "runtime",
      description: `Uses ${CONTEXT_LEDGER_VERSION} context lookups.`,
    },
  ],
  outputCapabilities: [
    {
      name: "mir.context.exact_duplicates_eliminated",
      source: "runtime",
    },
  ],
  safety: {
    level: "deterministic",
    notes:
      "Only removes exact duplicate context references marked deduplicable.",
  },
  async apply(plan: MIRPlan, context: PassContext): Promise<PassResult> {
    const groups = groupDuplicateCandidates(plan.context);
    const protectedOutputContextIds = collectProtectedOutputContextIds(plan);
    const replacements = new Map<string, string>();
    const warnings: PassWarning[] = [];
    const evidence: PassEvidenceFragment[] = [];
    let evidenceIndex = 1;
    let removedTokenEstimate = 0;

    for (const group of groups) {
      const canonical = group[0];

      if (canonical === undefined) {
        continue;
      }

      for (const candidate of group.slice(1)) {
        const reason = preservationReason(
          canonical,
          candidate,
          protectedOutputContextIds,
        );

        if (reason !== undefined) {
          warnings.push({
            assumption: reason,
            code: "duplicate_context_preserved",
            message: "Exact duplicate context was preserved.",
            path: contextPath(candidate.id),
            severity: "warning",
          });
          evidence.push(
            createContextEvidence({
              canonicalId: canonical.id,
              candidateId: candidate.id,
              context,
              evidenceIndex,
              summary: `Preserved duplicate context ${candidate.id}.`,
            }),
          );
          evidenceIndex += 1;
          continue;
        }

        replacements.set(candidate.id, canonical.id);
        removedTokenEstimate += candidate.tokenEstimate ?? 0;
        evidence.push(
          createContextEvidence({
            canonicalId: canonical.id,
            candidateId: candidate.id,
            context,
            evidenceIndex,
            summary: `Deduplicated context ${candidate.id} into ${canonical.id}.`,
          }),
        );
        evidenceIndex += 1;
      }
    }

    if (removedTokenEstimate > 0) {
      evidence.push(
        createTokenEstimateEvidence({
          context,
          evidenceIndex,
          removedTokenEstimate,
        }),
      );
    }

    const nextPlan =
      replacements.size === 0
        ? plan
        : rewritePlanContextReferences(plan, replacements);

    return {
      diff: diffMIRPlans(plan, nextPlan, {
        afterWarnings: warnings,
        beforeWarnings: [],
      }),
      evidence,
      pass: passIdentity,
      plan: nextPlan,
      version: PASS_CONTRACT_VERSION,
      warnings,
    };
  },
} satisfies OptimizationPass;

function groupDuplicateCandidates(
  blocks: readonly MIRContextBlock[],
): readonly (readonly MIRContextBlock[])[] {
  const ledger = createContextLedger(blocks);
  const groups = new Map<string, MIRContextBlock[]>();

  for (const block of ledger.all()) {
    const key = duplicateKey(block);

    if (key === undefined) {
      continue;
    }

    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [block]);
      continue;
    }

    group.push(block);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

function duplicateKey(block: MIRContextBlock): string | undefined {
  if (block.contentHash !== undefined && block.contentHash.trim() !== "") {
    return `hash:${block.contentHash}`;
  }

  if (block.contentRef.trim() === "") {
    return undefined;
  }

  return `ref:${block.contentRef}`;
}

function preservationReason(
  canonical: MIRContextBlock,
  candidate: MIRContextBlock,
  protectedOutputContextIds: ReadonlySet<string>,
): string | undefined {
  if (
    canonical.mutability !== "deduplicable" ||
    candidate.mutability !== "deduplicable"
  ) {
    return "Both duplicate context blocks must be marked deduplicable.";
  }

  if (
    isSensitive(canonical.privacyClass) ||
    isSensitive(candidate.privacyClass)
  ) {
    return "Sensitive context is preserved until explicit redaction rules exist.";
  }

  if (canonical.role !== candidate.role) {
    return "Duplicate context roles differ.";
  }

  if (canonical.provenance.source !== candidate.provenance.source) {
    return "Duplicate context provenance sources differ.";
  }

  if (protectedOutputContextIds.has(candidate.id)) {
    return "Context produced as a node output is preserved.";
  }

  return undefined;
}

function collectProtectedOutputContextIds(plan: MIRPlan): ReadonlySet<string> {
  const protectedIds = new Set<string>();

  for (const node of plan.nodes) {
    if (node.outputContext !== undefined) {
      protectedIds.add(node.outputContext);
    }

    if (node.kind === "retrieval_call") {
      protectedIds.add(node.resultContext);
    }
  }

  return protectedIds;
}

function rewritePlanContextReferences(
  plan: MIRPlan,
  replacements: ReadonlyMap<string, string>,
): MIRPlan {
  return {
    ...plan,
    context: plan.context.filter((block) => !replacements.has(block.id)),
    nodes: plan.nodes.map((node) =>
      rewriteNodeContextReferences(node, replacements),
    ),
    edges: plan.edges.map((edge) =>
      rewriteEdgeContextReferences(edge, replacements),
    ),
  };
}

function rewriteNodeContextReferences(
  node: MIRNode,
  replacements: ReadonlyMap<string, string>,
): MIRNode {
  let nextNode = node;

  if (node.inputContext !== undefined) {
    const nextInputContext = rewriteContextIds(node.inputContext, replacements);

    if (nextInputContext !== node.inputContext) {
      nextNode = {
        ...nextNode,
        inputContext: nextInputContext,
      } as MIRNode;
    }
  }

  if (node.kind === "retrieval_call") {
    const nextQueryContext =
      replacements.get(node.queryContext) ?? node.queryContext;

    if (nextQueryContext !== node.queryContext) {
      nextNode = {
        ...nextNode,
        queryContext: nextQueryContext,
      } as MIRNode;
    }
  }

  return nextNode;
}

function rewriteEdgeContextReferences(
  edge: MIREdge,
  replacements: ReadonlyMap<string, string>,
): MIREdge {
  if (edge.contextIds === undefined) {
    return edge;
  }

  const nextContextIds = rewriteContextIds(edge.contextIds, replacements);

  if (nextContextIds === edge.contextIds) {
    return edge;
  }

  return {
    ...edge,
    contextIds: nextContextIds,
  };
}

function rewriteContextIds(
  contextIds: readonly string[],
  replacements: ReadonlyMap<string, string>,
): readonly string[] {
  const seen = new Set<string>();
  const nextContextIds: string[] = [];
  let changed = false;

  for (const contextId of contextIds) {
    const nextContextId = replacements.get(contextId) ?? contextId;

    if (nextContextId !== contextId) {
      changed = true;
    }

    if (seen.has(nextContextId)) {
      changed = true;
      continue;
    }

    seen.add(nextContextId);
    nextContextIds.push(nextContextId);
  }

  return changed ? nextContextIds : contextIds;
}

function createContextEvidence(input: {
  readonly canonicalId: string;
  readonly candidateId: string;
  readonly context: PassContext;
  readonly evidenceIndex: number;
  readonly summary: string;
}): ContextChangeEvidenceEvent {
  return {
    contextChange: {
      changeKind: "deduplicated",
      contextIds: [input.candidateId, input.canonicalId],
    },
    id: evidenceId(input.evidenceIndex),
    kind: "context_change",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "pass",
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: input.summary,
    version: EVIDENCE_EVENT_VERSION,
  };
}

function createTokenEstimateEvidence(input: {
  readonly context: PassContext;
  readonly evidenceIndex: number;
  readonly removedTokenEstimate: number;
}): EstimateEvidenceEvent {
  return {
    estimate: {
      confidence: "estimated",
      estimateKind: "token",
      subjectRef: "$.context",
      unit: "tokens",
      value: input.removedTokenEstimate,
    },
    id: evidenceId(input.evidenceIndex),
    kind: "estimate",
    privacy: {
      privacyClass: "internal",
      replayMode: "metadata",
    },
    redaction: {
      mode: "none",
    },
    source: {
      kind: "pass",
      pass: passIdentity,
      runId: input.context.runId,
    },
    summary: "Estimated tokens removed by exact duplicate context elimination.",
    version: EVIDENCE_EVENT_VERSION,
  };
}

function evidenceId(index: number): string {
  return `exact-duplicate-context-${String(index).padStart(3, "0")}`;
}

function contextPath(contextId: string): string {
  return `$.context[?(@.id==${JSON.stringify(contextId)})]`;
}

function isSensitive(privacyClass: MIRContextBlock["privacyClass"]): boolean {
  return (
    privacyClass === "confidential" ||
    privacyClass === "restricted" ||
    privacyClass === "secret"
  );
}
