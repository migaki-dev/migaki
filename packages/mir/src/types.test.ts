import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIREdgeKind,
  type MIRContextMutability,
  type MIRContextRole,
  type MIRNode,
  type MIRPlan,
  type MIRPrivacyClass,
  type MIRProvenanceSource,
} from "./index.js";

const everyNodeKind = [
  "model_call",
  "tool_call",
  "retrieval_call",
  "context_transform",
  "validator",
  "approval",
  "cache_read",
  "cache_write",
  "branch",
  "join",
] as const satisfies readonly MIRNode["kind"][];

const everyContextRole = [
  "developer_instruction",
  "example",
  "memory",
  "retrieved_document",
  "scratchpad",
  "system_instruction",
  "tool_result",
  "user_input",
  "validator_output",
] as const satisfies readonly MIRContextRole[];

const everyContextMutability = [
  "compressible",
  "deduplicable",
  "droppable",
  "fixed",
  "summarizable",
] as const satisfies readonly MIRContextMutability[];

const everyPrivacyClass = [
  "confidential",
  "internal",
  "public",
  "restricted",
  "secret",
] as const satisfies readonly MIRPrivacyClass[];

const everyProvenanceSource = [
  "cache",
  "developer",
  "generated",
  "memory",
  "retrieval",
  "system",
  "tool",
  "user",
  "validator",
] as const satisfies readonly MIRProvenanceSource[];

const everyEdgeKind = [
  "control",
  "data",
  "fallback",
  "validation",
] as const satisfies readonly MIREdgeKind[];

const examplePlan = {
  id: "mir-plan-rag-example",
  version: MIR_V0_VERSION,
  metadata: {
    application: "rag-dedup-cache",
    createdAt: "2026-01-01T00:00:00.000Z",
    traceId: "trace-fixture-001",
  },
  constraints: {
    auditLevel: "evidence_bundle",
    cachePolicy: {
      mode: "eligible",
      scope: "plan",
    },
    maxCostUsd: 1,
    maxLatencyMs: 1_000,
    minValidatorPassRate: 1,
    replayPolicy: "metadata",
    requiredValidators: ["validator-source-grounding"],
    retentionPolicy: {
      mode: "metadata_only",
    },
  },
  context: [
    {
      id: "ctx-system",
      role: "system_instruction",
      contentRef: "fixture://system",
      mutability: "fixed",
      provenance: {
        source: "system",
      },
      cachePolicy: {
        mode: "required",
        scope: "plan",
      },
      privacyClass: "internal",
      retentionPolicy: {
        mode: "metadata_only",
      },
      tokenEstimate: 12,
    },
    {
      id: "ctx-question",
      role: "user_input",
      contentRef: "fixture://question",
      mutability: "fixed",
      provenance: {
        source: "user",
      },
      privacyClass: "confidential",
      retentionPolicy: {
        mode: "redacted",
      },
    },
  ],
  nodes: [
    {
      id: "node-cache-read",
      kind: "cache_read",
      cacheKeyRef: "cache://rag-prefix",
      outputContext: "ctx-cached-prefix",
      cachePolicy: {
        mode: "eligible",
        scope: "plan",
      },
    },
    {
      id: "node-retrieve",
      kind: "retrieval_call",
      queryContext: "ctx-question",
      resultContext: "ctx-retrieved",
      retrieval: {
        source: "docs",
        topK: 4,
      },
    },
    {
      id: "node-deduplicate",
      kind: "context_transform",
      inputContext: ["ctx-retrieved"],
      outputContext: "ctx-deduplicated",
      transform: {
        kind: "deduplicate",
        lossy: false,
      },
    },
    {
      id: "node-rank",
      kind: "model_call",
      inputContext: ["ctx-system", "ctx-question", "ctx-deduplicated"],
      outputContext: "ctx-ranked",
      model: {
        task: "ranking",
        requiredCapabilities: ["structured_output"],
      },
      parameters: {
        maxOutputTokens: 256,
      },
    },
    {
      id: "node-tool",
      kind: "tool_call",
      inputContext: ["ctx-ranked"],
      outputContext: "ctx-tool-result",
      tool: {
        name: "quote-selector",
        inputRef: "fixture://tool-input",
      },
    },
    {
      id: "node-branch",
      kind: "branch",
      branches: [
        {
          id: "has-citations",
          conditionRef: "fixture://conditions/has-citations",
          targetNodeId: "node-synthesize",
        },
      ],
    },
    {
      id: "node-synthesize",
      kind: "model_call",
      inputContext: ["ctx-tool-result"],
      outputContext: "ctx-answer",
      model: {
        task: "synthesis",
      },
    },
    {
      id: "node-validate",
      kind: "validator",
      inputContext: ["ctx-answer", "ctx-deduplicated"],
      outputContext: "ctx-validation",
      validator: {
        kind: "source_grounding",
        name: "validator-source-grounding",
      },
      failurePolicy: "retry_node",
    },
    {
      id: "node-approval",
      kind: "approval",
      approval: {
        approvalId: "approval-public-demo",
        reason: "Publish demo answer",
      },
      inputContext: ["ctx-answer", "ctx-validation"],
    },
    {
      id: "node-cache-write",
      kind: "cache_write",
      cacheKeyRef: "cache://rag-prefix",
      inputContext: ["ctx-system"],
      cachePolicy: {
        mode: "eligible",
        scope: "plan",
      },
    },
    {
      id: "node-join",
      kind: "join",
      inputNodeIds: ["node-approval", "node-cache-write"],
      strategy: "all",
    },
  ],
  edges: [
    {
      id: "edge-retrieve-rank",
      fromNodeId: "node-retrieve",
      toNodeId: "node-rank",
      kind: "data",
      contextIds: ["ctx-retrieved"],
    },
  ],
} as const satisfies MIRPlan;

describe("mIR v0 core types", () => {
  it("exports the version literal used by example plans", () => {
    expect(examplePlan.version).toBe("migaki.mir.v0");
  });

  it("covers every v0 node kind in the compile-time fixture", () => {
    const presentKinds = new Set(examplePlan.nodes.map((node) => node.kind));

    expect([...presentKinds].sort()).toEqual([...everyNodeKind].sort());
  });

  it("exports provider-neutral context and graph vocabularies", () => {
    expect(everyContextRole).toContain("retrieved_document");
    expect(everyContextMutability).toContain("deduplicable");
    expect(everyPrivacyClass).toContain("restricted");
    expect(everyProvenanceSource).toContain("validator");
    expect(everyEdgeKind).toContain("validation");
  });
});
