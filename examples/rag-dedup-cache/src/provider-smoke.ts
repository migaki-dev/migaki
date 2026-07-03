#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertMIRPlan, type MIRPlan } from "@migaki/mir";
import {
  lowerAnthropicStyleModelRequest,
  lowerLiteLLMCompatibleModelRequest,
  lowerOpenAIStyleModelRequest,
  type AnthropicStyleLoweringResult,
  type LiteLLMCompatibleLoweringResult,
  type ProviderCapabilityName,
  type ProviderWarning,
} from "@migaki/providers";

import { runRagOptimized } from "./optimized.js";

export const RAG_PROVIDER_SMOKE_REPORT_VERSION =
  "migaki.example.rag-provider-smoke.v0";

export type RagProviderSmokeStatus = "failed" | "passed";

export type RagProviderSmokeProviderId =
  | "anthropic-style"
  | "litellm-compatible"
  | "openai-style";

export type RagProviderSmokeCacheSignal =
  | "automatic_caching_assumption"
  | "explicit_cache_control"
  | "gateway_delegated"
  | "none";

export interface RagProviderSmokeCheck {
  readonly actual: string;
  readonly id: string;
  readonly passed: boolean;
  readonly required: string;
}

export interface RagProviderSmokeProvider {
  readonly adapterVersion: string;
  readonly assumptionCapabilities: readonly ProviderCapabilityName[];
  readonly cacheSignal: RagProviderSmokeCacheSignal;
  readonly cacheSignalRefs: readonly string[];
  readonly contextRefs: readonly string[];
  readonly gatewayResponsibilities?: readonly string[];
  readonly id: RagProviderSmokeProviderId;
  readonly model: string;
  readonly supported: boolean;
  readonly warningCodes: readonly string[];
}

export interface RagProviderSmokeReport {
  readonly checks: readonly RagProviderSmokeCheck[];
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly nodeId: string;
  readonly optimizedPlanId: string;
  readonly providers: readonly RagProviderSmokeProvider[];
  readonly status: RagProviderSmokeStatus;
  readonly version: typeof RAG_PROVIDER_SMOKE_REPORT_VERSION;
}

const generatedAt = "2026-01-01T00:00:05.000Z";
const synthesisNodeId = "node-synthesize";
const expectedContextRefs = [
  "fixture://rag/system",
  "fixture://rag/question",
  "fixture://rag/ranked-chunks",
] as const;
const expectedGatewayResponsibilities = [
  "provider_routing",
  "connectivity",
  "budget_enforcement",
  "fallback_policy",
  "observability",
] as const;

export async function createRagProviderSmokeReport(
  baselinePlan: MIRPlan,
): Promise<RagProviderSmokeReport> {
  const optimized = await runRagOptimized(baselinePlan);
  const providers = createProviderSummaries(optimized.optimizedPlan);
  const checks = createProviderChecks(providers);
  const status = checks.every((check) => check.passed) ? "passed" : "failed";

  return {
    checks,
    generatedAt,
    limitations: [
      "deterministic lowering only",
      "no live provider calls",
      "no auth secrets",
      "no provider-side cache hit claim",
    ],
    nodeId: synthesisNodeId,
    optimizedPlanId: optimized.optimizedPlan.id,
    providers,
    status,
    version: RAG_PROVIDER_SMOKE_REPORT_VERSION,
  };
}

export function renderRagProviderSmokeReport(
  report: RagProviderSmokeReport,
): string {
  return [
    "Migaki RAG Provider Lowering Smoke",
    `Status: ${report.status}`,
    `Providers: passed ${report.providers.filter((provider) => provider.supported).length}/${report.providers.length}`,
    ...report.checks.map(
      (check) =>
        `- [${check.passed ? "pass" : "fail"}] ${check.id}: ${check.required} (${check.actual})`,
    ),
    `Node: ${report.nodeId}`,
    `Optimized plan: ${report.optimizedPlanId}`,
    `Warnings: ${report.providers.map(formatProviderWarnings).join(" | ")}`,
    `Limitations: ${report.limitations.join("; ")}`,
    "",
  ].join("\n");
}

export function serializeRagProviderSmokeReport(
  report: RagProviderSmokeReport,
): string {
  return `${JSON.stringify(toStableJsonValue(report), null, 2)}\n`;
}

async function loadBaselinePlan(): Promise<MIRPlan> {
  return assertMIRPlan(
    JSON.parse(
      await readFile(
        new URL(
          "../../../packages/mir/src/examples/rag-baseline.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  );
}

function createProviderSummaries(
  plan: MIRPlan,
): readonly RagProviderSmokeProvider[] {
  const anthropic = lowerAnthropicStyleModelRequest({
    nodeId: synthesisNodeId,
    plan,
  });
  const openai = lowerOpenAIStyleModelRequest({
    nodeId: synthesisNodeId,
    plan,
  });
  const litellm = lowerLiteLLMCompatibleModelRequest({
    nodeId: synthesisNodeId,
    plan,
  });

  return [
    summarizeAnthropicLowering(anthropic),
    summarizeOpenAILowering(openai),
    summarizeLiteLLMLowering(litellm),
  ];
}

function summarizeAnthropicLowering(
  result: AnthropicStyleLoweringResult,
): RagProviderSmokeProvider {
  const blocks = [
    ...(result.requestShape.system ?? []),
    ...result.requestShape.messages.flatMap((message) => message.content),
  ];
  const cacheSignalRefs = blocks.flatMap((block) =>
    block.cache_control === undefined ? [] : [block.text_ref],
  );

  return {
    adapterVersion: result.requestShape.metadata.adapterVersion,
    assumptionCapabilities: assumptionCapabilities(result.assumptions),
    cacheSignal: cacheSignalRefs.length > 0 ? "explicit_cache_control" : "none",
    cacheSignalRefs,
    contextRefs: blocks.map((block) => block.text_ref),
    id: "anthropic-style",
    model: result.requestShape.model,
    supported: result.supported,
    warningCodes: warningCodes(result.warnings),
  };
}

function summarizeOpenAILowering(
  result: ReturnType<typeof lowerOpenAIStyleModelRequest>,
): RagProviderSmokeProvider {
  const capabilities = assumptionCapabilities(result.assumptions);

  return {
    adapterVersion: result.requestShape.metadata.adapterVersion,
    assumptionCapabilities: capabilities,
    cacheSignal: capabilities.includes("automatic_caching")
      ? "automatic_caching_assumption"
      : "none",
    cacheSignalRefs: [],
    contextRefs: result.requestShape.input.map((item) => item.contentRef),
    id: "openai-style",
    model: result.requestShape.model,
    supported: result.supported,
    warningCodes: warningCodes(result.warnings),
  };
}

function summarizeLiteLLMLowering(
  result: LiteLLMCompatibleLoweringResult,
): RagProviderSmokeProvider {
  return {
    adapterVersion: result.requestShape.metadata.adapterVersion,
    assumptionCapabilities: assumptionCapabilities(result.assumptions),
    cacheSignal:
      result.gatewayAssumptions.length > 0 ? "gateway_delegated" : "none",
    cacheSignalRefs: [],
    contextRefs: result.requestShape.messages.map(
      (message) => message.content_ref,
    ),
    gatewayResponsibilities:
      result.requestShape.metadata.gatewayResponsibilities,
    id: "litellm-compatible",
    model: result.requestShape.model,
    supported: result.supported,
    warningCodes: warningCodes(result.warnings),
  };
}

function createProviderChecks(
  providers: readonly RagProviderSmokeProvider[],
): readonly RagProviderSmokeCheck[] {
  const anthropic = requireProvider(providers, "anthropic-style");
  const openai = requireProvider(providers, "openai-style");
  const litellm = requireProvider(providers, "litellm-compatible");
  const supportedProviders = providers
    .filter((provider) => provider.supported)
    .map((provider) => provider.id);
  const contextActual = providers
    .map((provider) => `${provider.id}:${provider.contextRefs.join(",")}`)
    .join(" | ");
  const openaiWarning =
    openai.warningCodes.find(
      (warning) =>
        warning === "downgraded_capability:explicit_cache_breakpoints",
    ) ?? "missing";
  const litellmWarning =
    litellm.warningCodes.find(
      (warning) => warning === "downgraded_capability:prompt_caching",
    ) ?? "missing";
  const litellmResponsibilities =
    litellm.gatewayResponsibilities?.join(",") ?? "missing";

  return [
    {
      actual: supportedProviders.join(","),
      id: "provider_support",
      passed: supportedProviders.length === providers.length,
      required: "all provider lowerers support the optimized synthesis node",
    },
    {
      actual: contextActual,
      id: "optimized_synthesis_context_refs",
      passed: providers.every((provider) =>
        arraysEqual(provider.contextRefs, expectedContextRefs),
      ),
      required: "preserve optimized synthesis context refs for every provider",
    },
    {
      actual: anthropic.cacheSignalRefs.join(",") || "missing",
      id: "anthropic_explicit_cache_control",
      passed:
        anthropic.cacheSignal === "explicit_cache_control" &&
        arraysEqual(anthropic.cacheSignalRefs, [
          "fixture://rag/system",
          "fixture://rag/ranked-chunks",
        ]),
      required:
        "lower cache-eligible context into Anthropic-style cache_control blocks",
    },
    {
      actual: `assumption ${openai.assumptionCapabilities.includes("automatic_caching") ? "automatic_caching" : "missing"}; warning ${openaiWarning}`,
      id: "openai_automatic_cache_downgrade",
      passed:
        openai.cacheSignal === "automatic_caching_assumption" &&
        openaiWarning === "downgraded_capability:explicit_cache_breakpoints",
      required:
        "keep OpenAI-style prompt caching provider-managed with an explicit downgrade warning",
    },
    {
      actual: `responsibilities ${litellmResponsibilities}; warning ${litellmWarning}`,
      id: "litellm_gateway_cache_delegation",
      passed:
        litellm.cacheSignal === "gateway_delegated" &&
        arraysEqual(
          litellm.gatewayResponsibilities ?? [],
          expectedGatewayResponsibilities,
        ) &&
        litellmWarning === "downgraded_capability:prompt_caching",
      required: "keep LiteLLM-compatible cache policy delegated to the gateway",
    },
  ];
}

function requireProvider(
  providers: readonly RagProviderSmokeProvider[],
  id: RagProviderSmokeProviderId,
): RagProviderSmokeProvider {
  const provider = providers.find((candidate) => candidate.id === id);

  if (provider === undefined) {
    throw new Error(`Provider smoke report is missing ${id}.`);
  }

  return provider;
}

function assumptionCapabilities(
  assumptions: readonly { readonly capability: ProviderCapabilityName }[],
): readonly ProviderCapabilityName[] {
  return assumptions.map((assumption) => assumption.capability);
}

function warningCodes(warnings: readonly ProviderWarning[]): readonly string[] {
  return warnings.map((warning) =>
    warning.capability === undefined
      ? warning.code
      : `${warning.code}:${warning.capability}`,
  );
}

function formatProviderWarnings(provider: RagProviderSmokeProvider): string {
  return `${provider.id}: ${
    provider.warningCodes.length > 0 ? provider.warningCodes.join(",") : "none"
  }`;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .flatMap((key) => {
          const nested = value[key];

          return nested === undefined ? [] : [[key, toStableJsonValue(nested)]];
        }),
    );
  }

  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(
      [
        "Usage: scripts/migaki-provider-smoke [--json]",
        "",
        "Run deterministic RAG provider lowering smoke checks without live provider calls.",
        "",
        "Options:",
        "  --json      Print the stable JSON report instead of text.",
        "  -h, --help  Show this help.",
        "",
      ].join("\n"),
    );
    return;
  }

  const unknown = args.find((arg) => arg !== "--json");

  if (unknown !== undefined) {
    process.stderr.write(`Unknown argument: ${unknown}\n`);
    process.exitCode = 2;
    return;
  }

  const report = await createRagProviderSmokeReport(await loadBaselinePlan());
  const output = args.includes("--json")
    ? serializeRagProviderSmokeReport(report)
    : renderRagProviderSmokeReport(report);

  process.stdout.write(output);

  if (report.status !== "passed") {
    process.exitCode = 1;
  }
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
      error instanceof Error
        ? `${error.message}\n`
        : "Provider smoke failed.\n",
    );
    process.exitCode = 1;
  });
}
