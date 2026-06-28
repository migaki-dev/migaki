import type {
  MIRContextBlock,
  MIRModelCallNode,
  MIRModelCapability,
  MIRPlan,
} from "@migaki/mir";

import {
  checkProviderCapabilityRequirements,
  type ProviderCapabilities,
  type ProviderCapabilityAssumption,
  type ProviderCapabilityName,
  type ProviderCapabilityRequirement,
  type ProviderWarning,
} from "./contracts.js";
import {
  createFetchCompatibleProviderWrapper,
  type FetchCompatibleTransport,
  type FetchProviderWrapperResult,
} from "./fetch-wrapper.js";
import { lookupProviderCapabilities } from "./fixtures.js";

export const ANTHROPIC_STYLE_ADAPTER_VERSION =
  "migaki.anthropic-style-adapter.v0";

export type AnthropicStyleAdapterVersion =
  typeof ANTHROPIC_STYLE_ADAPTER_VERSION;

export interface AnthropicStyleContentBlock {
  readonly cache_control?: {
    readonly ttl?: string;
    readonly type: "ephemeral";
  };
  readonly text_ref: string;
  readonly type: "text_ref";
}

export interface AnthropicStyleMessage {
  readonly content: readonly AnthropicStyleContentBlock[];
  readonly role: "assistant" | "user";
}

export interface AnthropicStyleTool {
  readonly input_schema_ref: string;
  readonly name: string;
}

export interface AnthropicStyleRequestShape {
  readonly max_tokens?: number;
  readonly messages: readonly AnthropicStyleMessage[];
  readonly metadata: {
    readonly adapterVersion: AnthropicStyleAdapterVersion;
    readonly nodeId: string;
    readonly sourcePlanId: string;
  };
  readonly model: string;
  readonly system?: readonly AnthropicStyleContentBlock[];
  readonly temperature?: number;
  readonly tools?: readonly AnthropicStyleTool[];
  readonly top_p?: number;
}

export interface AnthropicStyleLoweringResult {
  readonly assumptions: readonly ProviderCapabilityAssumption[];
  readonly capabilities: ProviderCapabilities;
  readonly requestShape: AnthropicStyleRequestShape;
  readonly supported: boolean;
  readonly warnings: readonly ProviderWarning[];
}

export interface LowerAnthropicStyleModelRequestInput {
  readonly capabilities?: ProviderCapabilities;
  readonly model?: string;
  readonly nodeId: string;
  readonly plan: MIRPlan;
}

export interface AnthropicStyleAdapterOptions {
  readonly apiKey?: string;
  readonly capabilities?: ProviderCapabilities;
  readonly endpoint?: string;
  readonly model?: string;
  readonly transport: FetchCompatibleTransport;
}

export interface AnthropicStyleAdapterExecuteInput {
  readonly nodeId: string;
  readonly plan: MIRPlan;
}

export interface AnthropicStyleAdapterExecuteResult {
  readonly lowering: AnthropicStyleLoweringResult;
  readonly transport: FetchProviderWrapperResult;
}

export interface AnthropicStyleAdapter {
  executeModelRequest(
    input: AnthropicStyleAdapterExecuteInput,
  ): Promise<AnthropicStyleAdapterExecuteResult>;
  lowerModelRequest(
    input: AnthropicStyleAdapterExecuteInput,
  ): AnthropicStyleLoweringResult;
}

const defaultEndpoint = "https://api.anthropic.example/v1/messages";
const defaultModel = "anthropic-style-synthesis";
const defaultAnthropicVersion = "2023-06-01";

export function lowerAnthropicStyleModelRequest(
  input: LowerAnthropicStyleModelRequestInput,
): AnthropicStyleLoweringResult {
  const capabilities = input.capabilities ?? getAnthropicStyleCapabilities();
  const node = getModelNode(input.plan, input.nodeId);
  const metadata = readAnthropicStyleMetadata(node);
  const capabilityCheck = checkProviderCapabilityRequirements(
    capabilities,
    collectCapabilityRequirements(node),
  );
  const warnings: ProviderWarning[] = [...capabilityCheck.warnings];
  const requestShape = createRequestShape({
    capabilities,
    metadata,
    model: input.model ?? metadata.model ?? defaultModel,
    node,
    plan: input.plan,
  });
  const assumptions = createAssumptions({
    capabilities,
    hasExplicitCacheBreakpoint: hasExplicitCacheBreakpoint(input.plan, node),
    hasTools: (requestShape.tools ?? []).length > 0,
  });

  warnings.push(...createCacheWarnings(input.plan, node, capabilities));

  return {
    assumptions,
    capabilities,
    requestShape,
    supported: warnings.every((warning) => warning.severity !== "error"),
    warnings,
  };
}

export function createAnthropicStyleAdapter(
  options: AnthropicStyleAdapterOptions,
): AnthropicStyleAdapter {
  const capabilities = options.capabilities ?? getAnthropicStyleCapabilities();
  const wrapper = createFetchCompatibleProviderWrapper({
    provider: capabilities.provider,
    transport: options.transport,
  });

  return {
    lowerModelRequest(
      input: AnthropicStyleAdapterExecuteInput,
    ): AnthropicStyleLoweringResult {
      return lowerAnthropicStyleModelRequest({
        capabilities,
        nodeId: input.nodeId,
        plan: input.plan,
        ...(options.model !== undefined ? { model: options.model } : {}),
      });
    },
    async executeModelRequest(
      input: AnthropicStyleAdapterExecuteInput,
    ): Promise<AnthropicStyleAdapterExecuteResult> {
      const lowering = lowerAnthropicStyleModelRequest({
        capabilities,
        nodeId: input.nodeId,
        plan: input.plan,
        ...(options.model !== undefined ? { model: options.model } : {}),
      });
      const transport = await wrapper.request({
        body: JSON.stringify(lowering.requestShape),
        capture: {
          requestBody: "metadata_only",
          responseBody: "metadata_only",
        },
        headers: createHeaders(options.apiKey),
        id: `anthropic-style-${input.plan.id}-${input.nodeId}`,
        url: options.endpoint ?? defaultEndpoint,
      });

      return {
        lowering,
        transport,
      };
    },
  };
}

function createRequestShape(input: {
  readonly capabilities: ProviderCapabilities;
  readonly metadata: AnthropicStyleMetadata;
  readonly model: string;
  readonly node: MIRModelCallNode;
  readonly plan: MIRPlan;
}): AnthropicStyleRequestShape {
  const inputBlocks = collectInputBlocks(input.plan, input.node);
  const system = inputBlocks
    .filter((block) => block.role === "system_instruction")
    .map((block) =>
      createContentBlock({
        block,
        capabilities: input.capabilities,
        cacheTtl: input.metadata.cacheTtl,
      }),
    );
  const userContent = inputBlocks
    .filter((block) => block.role !== "system_instruction")
    .map((block) =>
      createContentBlock({
        block,
        capabilities: input.capabilities,
        cacheTtl: input.metadata.cacheTtl,
      }),
    );

  return {
    messages: [
      {
        content: userContent,
        role: "user",
      },
    ],
    metadata: {
      adapterVersion: ANTHROPIC_STYLE_ADAPTER_VERSION,
      nodeId: input.node.id,
      sourcePlanId: input.plan.id,
    },
    model: input.model,
    ...(input.node.parameters?.maxOutputTokens !== undefined
      ? { max_tokens: input.node.parameters.maxOutputTokens }
      : {}),
    ...(input.node.parameters?.temperature !== undefined
      ? { temperature: input.node.parameters.temperature }
      : {}),
    ...(input.node.parameters?.topP !== undefined
      ? { top_p: input.node.parameters.topP }
      : {}),
    ...(system.length > 0 ? { system } : {}),
    ...(input.metadata.tools.length > 0 &&
    input.capabilities.supportsToolCalling
      ? {
          tools: input.metadata.tools.map((tool) => ({
            input_schema_ref: tool.schemaRef,
            name: tool.name,
          })),
        }
      : {}),
  };
}

function createContentBlock(input: {
  readonly block: MIRContextBlock;
  readonly cacheTtl: string | undefined;
  readonly capabilities: ProviderCapabilities;
}): AnthropicStyleContentBlock {
  const useCacheControl =
    input.block.cachePolicy?.keyRef !== undefined &&
    input.capabilities.supportsExplicitCacheBreakpoints;
  const ttl = input.cacheTtl ?? input.capabilities.cacheTtlOptions?.[0];

  return {
    text_ref: input.block.contentRef,
    type: "text_ref",
    ...(useCacheControl
      ? {
          cache_control: {
            type: "ephemeral",
            ...(ttl !== undefined ? { ttl } : {}),
          },
        }
      : {}),
  };
}

function collectInputBlocks(
  plan: MIRPlan,
  node: MIRModelCallNode,
): readonly MIRContextBlock[] {
  const contextById = new Map(plan.context.map((block) => [block.id, block]));

  return (node.inputContext ?? []).flatMap((contextId) => {
    const block = contextById.get(contextId);

    return block === undefined ? [] : [block];
  });
}

function collectCapabilityRequirements(
  node: MIRModelCallNode,
): readonly ProviderCapabilityRequirement[] {
  const capabilities = new Set<ProviderCapabilityName>();

  for (const capability of node.model.requiredCapabilities ?? []) {
    capabilities.add(mapModelCapability(capability));
  }

  return [...capabilities].map((capability) => ({
    capability,
    reason: `Model node ${node.id} requires ${capability}.`,
    required: true,
  }));
}

function mapModelCapability(
  capability: MIRModelCapability,
): ProviderCapabilityName {
  switch (capability) {
    case "json_mode":
    case "structured_output":
      return "structured_outputs";
    case "prompt_caching":
      return "prompt_caching";
    case "reasoning_controls":
      return "reasoning_controls";
    case "tool_calling":
      return "tool_calling";
  }
}

function createAssumptions(input: {
  readonly capabilities: ProviderCapabilities;
  readonly hasExplicitCacheBreakpoint: boolean;
  readonly hasTools: boolean;
}): readonly ProviderCapabilityAssumption[] {
  const evidenceRef = providerEvidenceRef(input.capabilities);
  const assumptions: ProviderCapabilityAssumption[] = [];

  if (
    input.hasExplicitCacheBreakpoint &&
    input.capabilities.supportsExplicitCacheBreakpoints
  ) {
    assumptions.push({
      capability: "explicit_cache_breakpoints",
      description:
        "Anthropic-style capability fixture supports explicit cache breakpoint lowering.",
      evidenceRef,
    });
  }

  if (input.hasTools) {
    assumptions.push({
      capability: "tool_calling",
      description: "Anthropic-style capability fixture supports tool calling.",
      evidenceRef,
    });
  }

  return assumptions;
}

function createCacheWarnings(
  plan: MIRPlan,
  node: MIRModelCallNode,
  capabilities: ProviderCapabilities,
): readonly ProviderWarning[] {
  if (
    capabilities.supportsExplicitCacheBreakpoints ||
    !hasExplicitCacheBreakpoint(plan, node)
  ) {
    return [];
  }

  return [
    {
      assumption:
        "Anthropic-style cache breakpoint metadata was requested but the fixture does not support it.",
      capability: "explicit_cache_breakpoints",
      code: "downgraded_capability",
      message: "Explicit cache breakpoint metadata was not lowered.",
      severity: "warning",
    },
  ];
}

function hasExplicitCacheBreakpoint(
  plan: MIRPlan,
  node: MIRModelCallNode,
): boolean {
  return collectInputBlocks(plan, node).some(
    (block) => block.cachePolicy?.keyRef !== undefined,
  );
}

interface AnthropicStyleMetadata {
  readonly cacheTtl?: string;
  readonly model?: string;
  readonly tools: readonly {
    readonly name: string;
    readonly schemaRef: string;
  }[];
}

function readAnthropicStyleMetadata(
  node: MIRModelCallNode,
): AnthropicStyleMetadata {
  const raw = node.metadata?.["anthropicStyle"];

  if (!isRecord(raw)) {
    return {
      tools: [],
    };
  }

  return {
    ...(typeof raw["cacheTtl"] === "string"
      ? { cacheTtl: raw["cacheTtl"] }
      : {}),
    ...(typeof raw["model"] === "string" ? { model: raw["model"] } : {}),
    tools: readTools(raw["tools"]),
  };
}

function readTools(
  value: unknown,
): readonly { readonly name: string; readonly schemaRef: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tools: { name: string; schemaRef: string }[] = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item["name"] !== "string" ||
      typeof item["schemaRef"] !== "string"
    ) {
      return [];
    }

    tools.push({
      name: item["name"],
      schemaRef: item["schemaRef"],
    });
  }

  return tools;
}

function getModelNode(plan: MIRPlan, nodeId: string): MIRModelCallNode {
  const node = plan.nodes.find((candidate) => candidate.id === nodeId);

  if (node === undefined) {
    throw new Error(`Unknown mIR node ${nodeId}.`);
  }

  if (node.kind !== "model_call") {
    throw new Error(`mIR node ${nodeId} is not a model_call node.`);
  }

  return node;
}

function createHeaders(
  apiKey: string | undefined,
): Readonly<Record<string, string>> {
  return {
    "anthropic-version": defaultAnthropicVersion,
    "content-type": "application/json",
    ...(apiKey !== undefined ? { "x-api-key": apiKey } : {}),
  };
}

function getAnthropicStyleCapabilities(): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities("anthropic-style");

  if (capabilities === undefined) {
    throw new Error("Anthropic-style provider capability fixture is missing.");
  }

  return capabilities;
}

function providerEvidenceRef(capabilities: ProviderCapabilities): string {
  return `provider-capabilities://${capabilities.provider}/${capabilities.version}/${capabilities.observedAt}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
