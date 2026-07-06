import { describe, expect, it } from "vitest";

import { assertMIRPlan } from "@migaki/mir";

import { readJsonFixture } from "../../../src/testing/index.js";
import {
  createRagProviderSmokeReport,
  renderRagProviderSmokeReport,
  serializeRagProviderSmokeReport,
} from "./index.js";

describe("RAG provider lowering smoke", () => {
  it("proves the optimized RAG synthesis node lowers into deterministic provider request shapes", async () => {
    const report = await createRagProviderSmokeReport(await loadBaselinePlan());
    const serialized = serializeRagProviderSmokeReport(report);

    expect(JSON.parse(serialized)).toEqual(report);
    expect(report.status).toBe("passed");
    expect(report.nodeId).toBe("node-synthesize");
    expect(report.optimizedPlanId).toBe("rag-optimized");
    expect(report.providers).toEqual([
      {
        adapterVersion: "migaki.anthropic-style-adapter.v0",
        assumptionCapabilities: ["explicit_cache_breakpoints"],
        cacheSignal: "explicit_cache_control",
        cacheSignalRefs: [
          "fixture://rag/system",
          "fixture://rag/ranked-chunks",
        ],
        contextRefs: [
          "fixture://rag/system",
          "fixture://rag/question",
          "fixture://rag/ranked-chunks",
        ],
        id: "anthropic-style",
        model: "anthropic-style-synthesis",
        supported: true,
        warningCodes: [],
      },
      {
        adapterVersion: "migaki.openai-style-adapter.v0",
        assumptionCapabilities: ["automatic_caching"],
        cacheSignal: "automatic_caching_assumption",
        cacheSignalRefs: [],
        contextRefs: [
          "fixture://rag/system",
          "fixture://rag/question",
          "fixture://rag/ranked-chunks",
        ],
        id: "openai-style",
        model: "openai-style-synthesis",
        supported: true,
        warningCodes: ["downgraded_capability:explicit_cache_breakpoints"],
      },
      {
        adapterVersion: "migaki.litellm-compatible-adapter.v0",
        assumptionCapabilities: [],
        cacheSignal: "gateway_delegated",
        cacheSignalRefs: [],
        contextRefs: [
          "fixture://rag/system",
          "fixture://rag/question",
          "fixture://rag/ranked-chunks",
        ],
        gatewayResponsibilities: [
          "provider_routing",
          "connectivity",
          "budget_enforcement",
          "fallback_policy",
          "retry_policy",
          "cache_backend",
          "observability",
        ],
        id: "litellm-compatible",
        model: "litellm-compatible-synthesis",
        supported: true,
        warningCodes: ["downgraded_capability:prompt_caching"],
      },
    ]);
    expect(report.checks).toEqual([
      {
        actual: "anthropic-style,openai-style,litellm-compatible",
        id: "provider_support",
        passed: true,
        required: "all provider lowerers support the optimized synthesis node",
      },
      {
        actual:
          "anthropic-style:fixture://rag/system,fixture://rag/question,fixture://rag/ranked-chunks | openai-style:fixture://rag/system,fixture://rag/question,fixture://rag/ranked-chunks | litellm-compatible:fixture://rag/system,fixture://rag/question,fixture://rag/ranked-chunks",
        id: "optimized_synthesis_context_refs",
        passed: true,
        required:
          "preserve optimized synthesis context refs for every provider",
      },
      {
        actual: "fixture://rag/system,fixture://rag/ranked-chunks",
        id: "anthropic_explicit_cache_control",
        passed: true,
        required:
          "lower cache-eligible context into Anthropic-style cache_control blocks",
      },
      {
        actual:
          "assumption automatic_caching; warning downgraded_capability:explicit_cache_breakpoints",
        id: "openai_automatic_cache_downgrade",
        passed: true,
        required:
          "keep OpenAI-style prompt caching provider-managed with an explicit downgrade warning",
      },
      {
        actual:
          "responsibilities provider_routing,connectivity,budget_enforcement,fallback_policy,retry_policy,cache_backend,observability; warning downgraded_capability:prompt_caching",
        id: "litellm_gateway_cache_delegation",
        passed: true,
        required:
          "keep LiteLLM-compatible cache policy delegated to the gateway",
      },
    ]);
    expect(renderRagProviderSmokeReport(report)).toEqual(
      [
        "Migaki RAG Provider Lowering Smoke",
        "Status: passed",
        "Providers: passed 3/3",
        "- [pass] provider_support: all provider lowerers support the optimized synthesis node (anthropic-style,openai-style,litellm-compatible)",
        "- [pass] optimized_synthesis_context_refs: preserve optimized synthesis context refs for every provider (anthropic-style:fixture://rag/system,fixture://rag/question,fixture://rag/ranked-chunks | openai-style:fixture://rag/system,fixture://rag/question,fixture://rag/ranked-chunks | litellm-compatible:fixture://rag/system,fixture://rag/question,fixture://rag/ranked-chunks)",
        "- [pass] anthropic_explicit_cache_control: lower cache-eligible context into Anthropic-style cache_control blocks (fixture://rag/system,fixture://rag/ranked-chunks)",
        "- [pass] openai_automatic_cache_downgrade: keep OpenAI-style prompt caching provider-managed with an explicit downgrade warning (assumption automatic_caching; warning downgraded_capability:explicit_cache_breakpoints)",
        "- [pass] litellm_gateway_cache_delegation: keep LiteLLM-compatible cache policy delegated to the gateway (responsibilities provider_routing,connectivity,budget_enforcement,fallback_policy,retry_policy,cache_backend,observability; warning downgraded_capability:prompt_caching)",
        "Node: node-synthesize",
        "Optimized plan: rag-optimized",
        "Warnings: anthropic-style: none | openai-style: downgraded_capability:explicit_cache_breakpoints | litellm-compatible: downgraded_capability:prompt_caching",
        "Limitations: deterministic lowering only; no live provider calls; no auth secrets; no provider-side cache hit claim",
        "",
      ].join("\n"),
    );
  });
});

async function loadBaselinePlan() {
  return assertMIRPlan(
    await readJsonFixture(
      new URL(
        "../../../packages/mir/src/examples/rag-baseline.json",
        import.meta.url,
      ),
    ),
  );
}
