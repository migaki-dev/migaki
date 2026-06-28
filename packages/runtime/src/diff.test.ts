import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIREdge,
  type MIRModelCallNode,
  type MIRPlan,
} from "@migaki/mir";

import { diffMIRPlans } from "./index.js";

const beforePlan = {
  id: "diff-plan",
  version: MIR_V0_VERSION,
  metadata: {
    createdAt: "2026-01-01T00:00:00.000Z",
    description: "Before plan.",
  },
  constraints: {
    maxCostUsd: 1,
  },
  context: [
    createContextBlock("ctx-stable", {
      contentRef: "secret://before-value",
      tokenEstimate: 10,
    }),
    createContextBlock("ctx-removed"),
  ],
  nodes: [
    createModelNode("node-stable", { label: "Before label" }),
    createModelNode("node-removed"),
  ],
  edges: [
    createEdge("edge-stable", { kind: "control" }),
    createEdge("edge-removed"),
  ],
} satisfies MIRPlan;

const afterPlan = {
  ...beforePlan,
  metadata: {
    ...beforePlan.metadata,
    description: "After plan.",
  },
  constraints: {
    maxCostUsd: 2,
  },
  context: [
    createContextBlock("ctx-added"),
    createContextBlock("ctx-stable", {
      contentRef: "secret://after-value",
      tokenEstimate: 20,
    }),
  ],
  nodes: [
    createModelNode("node-added"),
    createModelNode("node-stable", { label: "After label" }),
  ],
  edges: [
    createEdge("edge-added"),
    createEdge("edge-stable", { kind: "data" }),
  ],
} satisfies MIRPlan;

describe("diffMIRPlans", () => {
  it("reports deterministic metadata, constraint, context, node, and edge changes", () => {
    const diff = diffMIRPlans(beforePlan, afterPlan);

    expect(
      diff.changes.map((change) => ({
        artifactId: change.artifactId,
        artifactKind: change.artifactKind,
        field: change.field,
        kind: change.kind,
        path: change.path,
      })),
    ).toEqual([
      {
        artifactId: undefined,
        artifactKind: "metadata",
        field: "description",
        kind: "metadata_changed",
        path: "$.metadata.description",
      },
      {
        artifactId: undefined,
        artifactKind: "constraint",
        field: "maxCostUsd",
        kind: "constraint_changed",
        path: "$.constraints.maxCostUsd",
      },
      {
        artifactId: "ctx-removed",
        artifactKind: "context",
        field: undefined,
        kind: "context_removed",
        path: '$.context[?(@.id=="ctx-removed")]',
      },
      {
        artifactId: "ctx-added",
        artifactKind: "context",
        field: undefined,
        kind: "context_added",
        path: '$.context[?(@.id=="ctx-added")]',
      },
      {
        artifactId: "ctx-stable",
        artifactKind: "context",
        field: "contentRef",
        kind: "context_changed",
        path: '$.context[?(@.id=="ctx-stable")].contentRef',
      },
      {
        artifactId: "ctx-stable",
        artifactKind: "context",
        field: "tokenEstimate",
        kind: "context_changed",
        path: '$.context[?(@.id=="ctx-stable")].tokenEstimate',
      },
      {
        artifactId: "node-removed",
        artifactKind: "node",
        field: undefined,
        kind: "node_removed",
        path: '$.nodes[?(@.id=="node-removed")]',
      },
      {
        artifactId: "node-added",
        artifactKind: "node",
        field: undefined,
        kind: "node_added",
        path: '$.nodes[?(@.id=="node-added")]',
      },
      {
        artifactId: "node-stable",
        artifactKind: "node",
        field: "label",
        kind: "node_changed",
        path: '$.nodes[?(@.id=="node-stable")].label',
      },
      {
        artifactId: "edge-removed",
        artifactKind: "edge",
        field: undefined,
        kind: "edge_removed",
        path: '$.edges[?(@.id=="edge-removed")]',
      },
      {
        artifactId: "edge-added",
        artifactKind: "edge",
        field: undefined,
        kind: "edge_added",
        path: '$.edges[?(@.id=="edge-added")]',
      },
      {
        artifactId: "edge-stable",
        artifactKind: "edge",
        field: "kind",
        kind: "edge_changed",
        path: '$.edges[?(@.id=="edge-stable")].kind',
      },
    ]);
  });

  it("omits before and after values from generated changes", () => {
    const diff = diffMIRPlans(beforePlan, afterPlan);
    const serialized = JSON.stringify(diff);

    expect(serialized).not.toContain("secret://before-value");
    expect(serialized).not.toContain("secret://after-value");
    expect(diff.changes.every((change) => change.valueMode === "omitted")).toBe(
      true,
    );
  });

  it("represents warning list changes without embedding warning messages", () => {
    const diff = diffMIRPlans(beforePlan, beforePlan, {
      afterWarnings: [
        {
          code: "unsupported_capability",
          message: "Sensitive provider details are not copied into the diff.",
          path: "$.nodes[0]",
          severity: "warning",
        },
      ],
      beforeWarnings: [],
    });

    expect(diff.changes).toEqual([
      {
        artifactId: "unsupported_capability|warning|$.nodes[0]",
        artifactKind: "warning",
        description: "Added warning unsupported_capability.",
        field: undefined,
        kind: "warning_added",
        path: '$.warnings[?(@.code=="unsupported_capability"&&@.severity=="warning"&&@.path=="$.nodes[0]")]',
        valueMode: "omitted",
      },
    ]);
    expect(JSON.stringify(diff)).not.toContain("Sensitive provider details");
  });
});

function createContextBlock(
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

function createModelNode(
  id: string,
  overrides: Partial<Omit<MIRModelCallNode, "id" | "kind">> = {},
): MIRModelCallNode {
  return {
    id,
    kind: "model_call",
    model: {
      task: "synthesis",
    },
    ...overrides,
  };
}

function createEdge(
  id: string,
  overrides: Partial<Omit<MIREdge, "id">> = {},
): MIREdge {
  return {
    id,
    fromNodeId: "node-stable",
    kind: "control",
    toNodeId: "node-stable",
    ...overrides,
  };
}
