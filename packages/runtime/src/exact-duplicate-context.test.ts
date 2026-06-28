import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIRPlan,
} from "@migaki/mir";

import {
  EVIDENCE_EVENT_VERSION,
  exactDuplicateContextEliminationPass,
} from "./index.js";

const passContext = {
  runId: "dedup-test-run",
  startedAt: "2026-01-01T00:00:00.000Z",
};

describe("exactDuplicateContextEliminationPass", () => {
  it("eliminates safe exact duplicates and rewrites input references deterministically", async () => {
    const plan = createPlan([
      createContext("ctx-question", {
        contentRef: "fixture://question",
        mutability: "fixed",
        privacyClass: "confidential",
        provenance: {
          source: "user",
        },
        role: "user_input",
      }),
      createContext("ctx-doc-a", {
        contentHash: "sha256:duplicate-doc",
        contentRef: "fixture://doc-a",
        tokenEstimate: 10,
      }),
      createContext("ctx-doc-b", {
        contentHash: "sha256:duplicate-doc",
        contentRef: "fixture://doc-b",
        tokenEstimate: 10,
      }),
      createContext("ctx-doc-c", {
        contentHash: "sha256:unique-doc",
        contentRef: "fixture://doc-c",
        tokenEstimate: 5,
      }),
    ]);

    const result = await exactDuplicateContextEliminationPass.apply(
      plan,
      passContext,
    );

    expect(result.plan.context.map((block) => block.id)).toEqual([
      "ctx-question",
      "ctx-doc-a",
      "ctx-doc-c",
    ]);
    expect(result.plan.nodes[0]?.inputContext).toEqual([
      "ctx-doc-a",
      "ctx-question",
    ]);
    expect(result.plan.edges[0]?.contextIds).toEqual(["ctx-doc-a"]);
    expect(result.warnings).toEqual([]);
    expect(result.diff.kind).toBe("inline");
    if (result.diff.kind !== "inline") {
      throw new Error("Expected inline pass diff.");
    }
    expect(result.diff.changes.map((change) => change.kind)).toContain(
      "context_removed",
    );
    expect(result.evidence).toMatchObject([
      {
        version: EVIDENCE_EVENT_VERSION,
        kind: "context_change",
        contextChange: {
          changeKind: "deduplicated",
          contextIds: ["ctx-doc-b", "ctx-doc-a"],
        },
      },
      {
        version: EVIDENCE_EVENT_VERSION,
        kind: "estimate",
        estimate: {
          estimateKind: "token",
          unit: "tokens",
          value: 10,
        },
      },
    ]);
  });

  it("preserves unsafe duplicates with warnings and evidence", async () => {
    const plan = createPlan([
      createContext("ctx-fixed-a", {
        contentRef: "fixture://fixed",
        mutability: "fixed",
        role: "developer_instruction",
      }),
      createContext("ctx-fixed-b", {
        contentRef: "fixture://fixed",
        mutability: "fixed",
        role: "developer_instruction",
      }),
      createContext("ctx-secret-a", {
        contentRef: "fixture://secret",
        privacyClass: "secret",
      }),
      createContext("ctx-secret-b", {
        contentRef: "fixture://secret",
        privacyClass: "secret",
      }),
      createContext("ctx-provenance-a", {
        contentRef: "fixture://provenance",
        provenance: {
          source: "retrieval",
        },
      }),
      createContext("ctx-provenance-b", {
        contentRef: "fixture://provenance",
        provenance: {
          source: "memory",
        },
      }),
    ]);

    const result = await exactDuplicateContextEliminationPass.apply(
      plan,
      passContext,
    );

    expect(result.plan).toBe(plan);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "duplicate_context_preserved",
      "duplicate_context_preserved",
      "duplicate_context_preserved",
    ]);
    expect(
      result.evidence
        .filter((event) => event.kind === "context_change")
        .map((event) => event.summary),
    ).toEqual([
      "Preserved duplicate context ctx-fixed-b.",
      "Preserved duplicate context ctx-provenance-b.",
      "Preserved duplicate context ctx-secret-b.",
    ]);
  });
});

function createPlan(context: readonly MIRContextBlock[]): MIRPlan {
  return {
    id: "dedup-plan",
    version: MIR_V0_VERSION,
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    constraints: {},
    context,
    nodes: [
      {
        id: "node-synthesize",
        kind: "model_call",
        inputContext: ["ctx-doc-b", "ctx-doc-a", "ctx-question"],
        model: {
          task: "synthesis",
        },
        outputContext: "ctx-answer",
      },
    ],
    edges: [
      {
        id: "edge-doc",
        fromNodeId: "node-retrieve",
        kind: "data",
        contextIds: ["ctx-doc-b"],
        toNodeId: "node-synthesize",
      },
    ],
  };
}

function createContext(
  id: string,
  overrides: Partial<Omit<MIRContextBlock, "id">> = {},
): MIRContextBlock {
  return {
    id,
    contentRef: `fixture://${id}`,
    mutability: "deduplicable",
    provenance: {
      source: "retrieval",
    },
    role: "retrieved_document",
    ...overrides,
  };
}
