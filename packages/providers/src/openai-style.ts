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

export const OPENAI_STYLE_ADAPTER_VERSION = "migaki.openai-style-adapter.v0";

export type OpenAIStyleAdapterVersion = typeof OPENAI_STYLE_ADAPTER_VERSION;

export interface OpenAIStyleInputItem {
  readonly contentRef: string;
  readonly contextId: string;
  readonly role: "assistant" | "developer" | "system" | "tool" | "user";
}

export interface OpenAIStyleResponseFormat {
  readonly json_schema: {
    readonly name: string;
    readonly schema_ref: string;
  };
  readonly type: "json_schema";
}

export interface OpenAIStyleTool {
  readonly name: string;
  readonly schema_ref: string;
}

export interface OpenAIStyleRequestShape {
  readonly input: readonly OpenAIStyleInputItem[];
  readonly max_output_tokens?: number;
  readonly metadata: {
    readonly adapterVersion: OpenAIStyleAdapterVersion;
    readonly nodeId: string;
    readonly sourcePlanId: string;
  };
  readonly model: string;
  readonly response_format?: OpenAIStyleResponseFormat;
  readonly temperature?: number;
  readonly tools?: readonly OpenAIStyleTool[];
  readonly top_p?: number;
}

export interface OpenAIStyleLoweringResult {
  readonly assumptions: readonly ProviderCapabilityAssumption[];
  readonly capabilities: ProviderCapabilities;
  readonly requestShape: OpenAIStyleRequestShape;
  readonly supported: boolean;
  readonly warnings: readonly ProviderWarning[];
}

export interface LowerOpenAIStyleModelRequestInput {
  readonly capabilities?: ProviderCapabilities;
  readonly model?: string;
  readonly nodeId: string;
  readonly plan: MIRPlan;
}

export interface OpenAIStyleAdapterOptions {
  readonly apiKey?: string;
  readonly capabilities?: ProviderCapabilities;
  readonly endpoint?: string;
  readonly model?: string;
  readonly transport: FetchCompatibleTransport;
}

export interface OpenAIStyleAdapterExecuteInput {
  readonly nodeId: string;
  readonly plan: MIRPlan;
}

export interface OpenAIStyleAdapterExecuteResult {
  readonly lowering: OpenAIStyleLoweringResult;
  readonly transport: FetchProviderWrapperResult;
}

export interface OpenAIStyleAdapter {
  executeModelRequest(
    input: OpenAIStyleAdapterExecuteInput,
  ): Promise<OpenAIStyleAdapterExecuteResult>;
  lowerModelRequest(
    input: OpenAIStyleAdapterExecuteInput,
  ): OpenAIStyleLoweringResult;
}

const defaultEndpoint = "https://api.openai.example/v1/responses";
const defaultModel = "openai-style-synthesis";

export function lowerOpenAIStyleModelRequest(
  input: LowerOpenAIStyleModelRequestInput,
): OpenAIStyleLoweringResult {
  const capabilities = input.capabilities ?? getOpenAIStyleCapabilities();
  const node = getModelNode(input.plan, input.nodeId);
  const metadata = readOpenAIStyleMetadata(node);
  const requirements = collectCapabilityRequirements(node);
  const capabilityCheck = checkProviderCapabilityRequirements(
    capabilities,
    requirements,
    {
      checkedAt: input.plan.metadata.createdAt,
    },
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
    hasCacheableContext: hasCacheableInputContext(input.plan, node),
    hasResponseFormat: requestShape.response_format !== undefined,
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

export function createOpenAIStyleAdapter(
  options: OpenAIStyleAdapterOptions,
): OpenAIStyleAdapter {
  const capabilities = options.capabilities ?? getOpenAIStyleCapabilities();
  const wrapper = createFetchCompatibleProviderWrapper({
    provider: capabilities.provider,
    transport: options.transport,
  });

  return {
    lowerModelRequest(
      input: OpenAIStyleAdapterExecuteInput,
    ): OpenAIStyleLoweringResult {
      return lowerOpenAIStyleModelRequest({
        capabilities,
        nodeId: input.nodeId,
        plan: input.plan,
        ...(options.model !== undefined ? { model: options.model } : {}),
      });
    },
    async executeModelRequest(
      input: OpenAIStyleAdapterExecuteInput,
    ): Promise<OpenAIStyleAdapterExecuteResult> {
      const lowering = lowerOpenAIStyleModelRequest({
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
        id: `openai-style-${input.plan.id}-${input.nodeId}`,
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
  readonly metadata: OpenAIStyleMetadata;
  readonly model: string;
  readonly node: MIRModelCallNode;
  readonly plan: MIRPlan;
}): OpenAIStyleRequestShape {
  return {
    input: collectInputItems(input.plan, input.node),
    metadata: {
      adapterVersion: OPENAI_STYLE_ADAPTER_VERSION,
      nodeId: input.node.id,
      sourcePlanId: input.plan.id,
    },
    model: input.model,
    ...(input.node.parameters?.maxOutputTokens !== undefined
      ? { max_output_tokens: input.node.parameters.maxOutputTokens }
      : {}),
    ...(input.node.parameters?.temperature !== undefined
      ? { temperature: input.node.parameters.temperature }
      : {}),
    ...(input.node.parameters?.topP !== undefined
      ? { top_p: input.node.parameters.topP }
      : {}),
    ...(input.metadata.responseFormat !== undefined &&
    input.capabilities.supportsStructuredOutputs
      ? {
          response_format: {
            json_schema: {
              name: input.metadata.responseFormat.name,
              schema_ref: input.metadata.responseFormat.schemaRef,
            },
            type: "json_schema",
          } satisfies OpenAIStyleResponseFormat,
        }
      : {}),
    ...(input.metadata.tools.length > 0 &&
    input.capabilities.supportsToolCalling
      ? {
          tools: input.metadata.tools.map((tool) => ({
            name: tool.name,
            schema_ref: tool.schemaRef,
          })),
        }
      : {}),
  };
}

function collectInputItems(
  plan: MIRPlan,
  node: MIRModelCallNode,
): readonly OpenAIStyleInputItem[] {
  const contextById = new Map(plan.context.map((block) => [block.id, block]));

  return (node.inputContext ?? []).flatMap((contextId) => {
    const block = contextById.get(contextId);

    if (block === undefined) {
      return [];
    }

    return [
      {
        contentRef: block.contentRef,
        contextId: block.id,
        role: mapContextRole(block),
      },
    ];
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
  readonly hasCacheableContext: boolean;
  readonly hasResponseFormat: boolean;
  readonly hasTools: boolean;
}): readonly ProviderCapabilityAssumption[] {
  const evidenceRef = providerEvidenceRef(input.capabilities);
  const assumptions: ProviderCapabilityAssumption[] = [];

  if (input.hasResponseFormat) {
    assumptions.push({
      capability: "structured_outputs",
      description:
        "OpenAI-style capability fixture supports structured output lowering.",
      evidenceRef,
    });
  }

  if (input.hasTools) {
    assumptions.push({
      capability: "tool_calling",
      description: "OpenAI-style capability fixture supports tool calling.",
      evidenceRef,
    });
  }

  if (
    input.hasCacheableContext &&
    input.capabilities.supportsAutomaticCaching
  ) {
    assumptions.push({
      capability: "automatic_caching",
      description:
        "OpenAI-style fixture represents prompt caching as provider-managed automatic caching.",
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
        "OpenAI-style fixture supports automatic caching but not explicit cache breakpoints.",
      capability: "explicit_cache_breakpoints",
      code: "downgraded_capability",
      message: "Explicit cache breakpoint metadata was not lowered.",
      severity: "warning",
    },
  ];
}

function hasCacheableInputContext(
  plan: MIRPlan,
  node: MIRModelCallNode,
): boolean {
  return collectInputContextBlocks(plan, node).some(
    (block) =>
      block.cachePolicy?.mode === "eligible" ||
      block.cachePolicy?.mode === "required",
  );
}

function hasExplicitCacheBreakpoint(
  plan: MIRPlan,
  node: MIRModelCallNode,
): boolean {
  return collectInputContextBlocks(plan, node).some(
    (block) => block.cachePolicy?.keyRef !== undefined,
  );
}

function collectInputContextBlocks(
  plan: MIRPlan,
  node: MIRModelCallNode,
): readonly MIRContextBlock[] {
  const contextById = new Map(plan.context.map((block) => [block.id, block]));

  return (node.inputContext ?? []).flatMap((contextId) => {
    const block = contextById.get(contextId);

    return block === undefined ? [] : [block];
  });
}

function mapContextRole(block: MIRContextBlock): OpenAIStyleInputItem["role"] {
  switch (block.role) {
    case "developer_instruction":
      return "developer";
    case "system_instruction":
      return "system";
    case "tool_result":
      return "tool";
    case "example":
    case "memory":
    case "retrieved_document":
    case "scratchpad":
    case "user_input":
    case "validator_output":
      return "user";
  }
}

interface OpenAIStyleMetadata {
  readonly model?: string;
  readonly responseFormat?: {
    readonly name: string;
    readonly schemaRef: string;
  };
  readonly tools: readonly {
    readonly name: string;
    readonly schemaRef: string;
  }[];
}

function readOpenAIStyleMetadata(node: MIRModelCallNode): OpenAIStyleMetadata {
  const raw = node.metadata?.["openaiStyle"];

  if (!isRecord(raw)) {
    return {
      tools: [],
    };
  }

  return {
    ...(typeof raw["model"] === "string" ? { model: raw["model"] } : {}),
    ...(isResponseFormat(raw["responseFormat"])
      ? { responseFormat: raw["responseFormat"] }
      : {}),
    tools: readTools(raw["tools"]),
  };
}

function isResponseFormat(value: unknown): value is {
  readonly name: string;
  readonly schemaRef: string;
} {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["schemaRef"] === "string"
  );
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
    "content-type": "application/json",
    ...(apiKey !== undefined ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function getOpenAIStyleCapabilities(): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities("openai-style");

  if (capabilities === undefined) {
    throw new Error("OpenAI-style provider capability fixture is missing.");
  }

  return capabilities;
}

function providerEvidenceRef(capabilities: ProviderCapabilities): string {
  return `provider-capabilities://${capabilities.provider}/${capabilities.version}/${capabilities.observedAt}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
