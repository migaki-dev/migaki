import { describe, expect, it } from "vitest";

import {
  MIR_V0_VERSION,
  type MIRContextBlock,
  type MIREdge,
  type MIRModelCallNode,
  type MIRPlan,
  type MIRToolCallNode,
} from "@migaki/mir";

import {
  GRAPH_COMPARISON_VERSION,
  compareMigakiGraphs,
  serializeMigakiGraphComparison,
} from "./index.js";

describe("compareMigakiGraphs", () => {
  it("identifies exact reusable model and tool nodes with avoidable-work metrics", () => {
    const graph = createGraph({
      context: [
        createContext("ctx-system", 10),
        createContext("ctx-question", 5),
        createContext("ctx-answer", 8),
        createContext("ctx-tool-result", 7),
      ],
      edges: [
        createEdge("edge-model-tool", "node-model-a", "node-tool-a", [
          "ctx-answer",
        ]),
        createEdge("edge-tool-model", "node-tool-a", "node-model-b", [
          "ctx-tool-result",
        ]),
      ],
      nodes: [
        createModelNode("node-model-a", {
          inputContext: ["ctx-system", "ctx-question"],
          outputContext: "ctx-answer",
        }),
        createToolNode("node-tool-a", {
          inputContext: ["ctx-answer"],
          outputContext: "ctx-tool-result",
        }),
        createModelNode("node-model-b", {
          inputContext: ["ctx-tool-result"],
          outputContext: "ctx-final",
        }),
      ],
    });

    const comparison = compareMigakiGraphs(graph, graph);

    expect(comparison.version).toBe(GRAPH_COMPARISON_VERSION);
    expect(
      comparison.reusableNodes.map((node) => ({
        kind: node.kind,
        nodeId: node.nodeId,
        tokenEstimate: node.tokenEstimate,
      })),
    ).toEqual([
      {
        kind: "model_call",
        nodeId: "node-model-a",
        tokenEstimate: 15,
      },
      {
        kind: "model_call",
        nodeId: "node-model-b",
        tokenEstimate: 7,
      },
      {
        kind: "tool_call",
        nodeId: "node-tool-a",
        tokenEstimate: 8,
      },
    ]);
    expect(comparison.metrics).toEqual({
      changedNodes: 0,
      estimatedAvoidableModelCalls: 2,
      estimatedAvoidableTokens: 22,
      estimatedAvoidableToolCalls: 1,
      longestReusablePath: {
        length: 3,
        nodeIds: ["node-model-a", "node-tool-a", "node-model-b"],
      },
      nonReusableNodesWithReasons: 0,
      reusableModelCalls: 2,
      reusableTokenCount: 30,
      reusableToolCalls: 1,
    });
    expect(
      comparison.reusableNodes.every(
        (node) =>
          node.inputHash.startsWith("sha256:") &&
          node.dependencyHash.startsWith("sha256:") &&
          node.runtimeHash.startsWith("sha256:"),
      ),
    ).toBe(true);
    expect(comparison.nonReusableNodesWithReasons).toEqual([]);
  });

  it("blocks exact reuse when cache, input, dependency, or runtime hashes change", () => {
    const previous = createGraph({
      context: [
        createContext("ctx-input", 3, { contentHash: "sha256:before" }),
        createContext("ctx-upstream", 2),
      ],
      edges: [
        createEdge("edge-upstream", "node-upstream", "node-model", [
          "ctx-input",
        ]),
      ],
      nodes: [
        createModelNode("node-upstream", {
          outputContext: "ctx-upstream",
        }),
        createModelNode("node-model", {
          inputContext: ["ctx-input"],
          metadata: {
            cacheKeyRef: "cache://before",
          },
          model: {
            task: "synthesis",
          },
        }),
      ],
    });
    const current = createGraph({
      context: [
        createContext("ctx-input", 3, { contentHash: "sha256:after" }),
        createContext("ctx-upstream", 2),
      ],
      edges: [
        createEdge("edge-upstream", "node-other-upstream", "node-model", [
          "ctx-input",
        ]),
      ],
      nodes: [
        createModelNode("node-other-upstream", {
          outputContext: "ctx-upstream",
        }),
        createModelNode("node-model", {
          inputContext: ["ctx-input"],
          metadata: {
            cacheKeyRef: "cache://after",
          },
          model: {
            task: "reasoning",
          },
        }),
      ],
    });

    const comparison = compareMigakiGraphs(previous, current);

    expect(comparison.reusableNodes.map((node) => node.nodeId)).toEqual([]);
    expect(comparison.changedNodes).toEqual(["node-model"]);
    expect(comparison.nonReusableNodesWithReasons).toEqual([
      {
        current: expect.objectContaining({
          cacheKey: "cache://after",
        }),
        kind: "model_call",
        nodeId: "node-model",
        previous: expect.objectContaining({
          cacheKey: "cache://before",
        }),
        reasons: [
          {
            code: "cache_key_changed",
            message: "The exact cache key changed between graph runs.",
          },
          {
            code: "input_hash_changed",
            message: "The exact input context hash changed between graph runs.",
          },
          {
            code: "dependency_hash_changed",
            message:
              "The exact upstream dependency hash changed between graph runs.",
          },
          {
            code: "runtime_hash_changed",
            message:
              "The exact runtime request hash changed between graph runs.",
          },
        ],
      },
      {
        current: expect.any(Object),
        kind: "model_call",
        nodeId: "node-other-upstream",
        previous: undefined,
        reasons: [
          {
            code: "node_missing_in_previous_graph",
            message: "No node with the same id exists in the previous graph.",
          },
        ],
      },
    ]);
    expect(comparison.metrics).toMatchObject({
      changedNodes: 1,
      nonReusableNodesWithReasons: 2,
      reusableModelCalls: 0,
      reusableToolCalls: 0,
    });
  });

  it("does not perform semantic matching when an exact node id is absent", () => {
    const previous = createGraph({
      nodes: [createToolNode("node-search")],
    });
    const current = createGraph({
      nodes: [createToolNode("node-search-renamed")],
    });

    const comparison = compareMigakiGraphs(previous, current);

    expect(comparison.reusableNodes).toEqual([]);
    expect(comparison.nonReusableNodesWithReasons).toEqual([
      {
        current: expect.any(Object),
        kind: "tool_call",
        nodeId: "node-search-renamed",
        previous: undefined,
        reasons: [
          {
            code: "node_missing_in_previous_graph",
            message: "No node with the same id exists in the previous graph.",
          },
        ],
      },
    ]);
  });

  it("serializes comparison artifacts deterministically", () => {
    const graph = createGraph({
      nodes: [createToolNode("node-tool")],
    });
    const comparison = compareMigakiGraphs(graph, graph);

    expect(JSON.parse(serializeMigakiGraphComparison(comparison))).toEqual(
      comparison,
    );
    expect(serializeMigakiGraphComparison(comparison)).toBe(
      serializeMigakiGraphComparison(comparison),
    );
  });
});

function createGraph(
  overrides: Partial<
    Omit<MIRPlan, "constraints" | "id" | "metadata" | "version">
  > = {},
): MIRPlan {
  return {
    constraints: {},
    context: [],
    edges: [],
    id: "test-graph",
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    nodes: [],
    version: MIR_V0_VERSION,
    ...overrides,
  };
}

function createContext(
  id: string,
  tokenEstimate: number,
  overrides: Partial<Omit<MIRContextBlock, "id" | "tokenEstimate">> = {},
): MIRContextBlock {
  return {
    contentRef: `fixture://${id}`,
    id,
    mutability: "fixed",
    provenance: {
      source: "system",
    },
    role: "system_instruction",
    tokenEstimate,
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

function createToolNode(
  id: string,
  overrides: Partial<Omit<MIRToolCallNode, "id" | "kind">> = {},
): MIRToolCallNode {
  return {
    id,
    kind: "tool_call",
    tool: {
      inputRef: `fixture://${id}/input`,
      name: "repo_search",
      schemaRef: "schema://repo_search",
    },
    ...overrides,
  };
}

function createEdge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  contextIds: readonly string[] = [],
): MIREdge {
  return {
    contextIds,
    fromNodeId,
    id,
    kind: "data",
    toNodeId,
  };
}
