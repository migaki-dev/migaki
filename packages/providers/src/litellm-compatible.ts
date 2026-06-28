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

export const LITELLM_COMPATIBLE_ADAPTER_VERSION =
  "migaki.litellm-compatible-adapter.v0";

export type LiteLLMCompatibleAdapterVersion =
  typeof LITELLM_COMPATIBLE_ADAPTER_VERSION;

export type LiteLLMGatewayResponsibility =
  | "budget_enforcement"
  | "connectivity"
  | "fallback_policy"
  | "observability"
  | "provider_routing";

export interface LiteLLMGatewayAssumption {
  readonly description: string;
  readonly owner: "gateway";
  readonly responsibility: LiteLLMGatewayResponsibility;
}

export interface LiteLLMCompatibleMessage {
  readonly content_ref: string;
  readonly context_id: string;
  readonly role: "assistant" | "system" | "tool" | "user";
}

export interface LiteLLMCompatibleResponseFormat {
  readonly json_schema: {
    readonly name: string;
    readonly schema_ref: string;
  };
  readonly type: "json_schema";
}

export interface LiteLLMCompatibleTool {
  readonly function: {
    readonly name: string;
    readonly parameters_ref: string;
  };
  readonly type: "function";
}

export interface LiteLLMCompatibleRequestShape {
  readonly max_tokens?: number;
  readonly messages: readonly LiteLLMCompatibleMessage[];
  readonly metadata: {
    readonly adapterVersion: LiteLLMCompatibleAdapterVersion;
    readonly gatewayResponsibilities: readonly LiteLLMGatewayResponsibility[];
    readonly nodeId: string;
    readonly sourcePlanId: string;
  };
  readonly model: string;
  readonly response_format?: LiteLLMCompatibleResponseFormat;
  readonly temperature?: number;
  readonly tools?: readonly LiteLLMCompatibleTool[];
  readonly top_p?: number;
}

export interface LiteLLMCompatibleLoweringResult {
  readonly assumptions: readonly ProviderCapabilityAssumption[];
  readonly capabilities: ProviderCapabilities;
  readonly gatewayAssumptions: readonly LiteLLMGatewayAssumption[];
  readonly requestShape: LiteLLMCompatibleRequestShape;
  readonly supported: boolean;
  readonly warnings: readonly ProviderWarning[];
}

export interface LowerLiteLLMCompatibleModelRequestInput {
  readonly capabilities?: ProviderCapabilities;
  readonly model?: string;
  readonly nodeId: string;
  readonly plan: MIRPlan;
}

export interface LiteLLMCompatibleAdapterOptions {
  readonly apiKey?: string;
  readonly capabilities?: ProviderCapabilities;
  readonly endpoint?: string;
  readonly model?: string;
  readonly transport: FetchCompatibleTransport;
}

export interface LiteLLMCompatibleAdapterExecuteInput {
  readonly nodeId: string;
  readonly plan: MIRPlan;
}

export interface LiteLLMCompatibleAdapterExecuteResult {
  readonly lowering: LiteLLMCompatibleLoweringResult;
  readonly transport: FetchProviderWrapperResult;
}

export interface LiteLLMCompatibleAdapter {
  executeModelRequest(
    input: LiteLLMCompatibleAdapterExecuteInput,
  ): Promise<LiteLLMCompatibleAdapterExecuteResult>;
  lowerModelRequest(
    input: LiteLLMCompatibleAdapterExecuteInput,
  ): LiteLLMCompatibleLoweringResult;
}

const defaultEndpoint = "https://litellm.example/v1/chat/completions";
const defaultModel = "litellm-compatible-synthesis";
const gatewayResponsibilities = [
  "provider_routing",
  "connectivity",
  "budget_enforcement",
  "fallback_policy",
  "observability",
] as const satisfies readonly LiteLLMGatewayResponsibility[];

export function lowerLiteLLMCompatibleModelRequest(
  input: LowerLiteLLMCompatibleModelRequestInput,
): LiteLLMCompatibleLoweringResult {
  const capabilities = input.capabilities ?? getLiteLLMCompatibleCapabilities();
  const node = getModelNode(input.plan, input.nodeId);
  const metadata = readLiteLLMCompatibleMetadata(node);
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

  warnings.push(...createGatewayWarnings(input.plan, node, capabilities));

  return {
    assumptions: createAssumptions({
      capabilities,
      hasResponseFormat: requestShape.response_format !== undefined,
      hasTools: (requestShape.tools ?? []).length > 0,
    }),
    capabilities,
    gatewayAssumptions: createGatewayAssumptions(),
    requestShape,
    supported: warnings.every((warning) => warning.severity !== "error"),
    warnings,
  };
}

export function createLiteLLMCompatibleAdapter(
  options: LiteLLMCompatibleAdapterOptions,
): LiteLLMCompatibleAdapter {
  const capabilities =
    options.capabilities ?? getLiteLLMCompatibleCapabilities();
  const wrapper = createFetchCompatibleProviderWrapper({
    provider: capabilities.provider,
    transport: options.transport,
  });

  return {
    lowerModelRequest(
      input: LiteLLMCompatibleAdapterExecuteInput,
    ): LiteLLMCompatibleLoweringResult {
      return lowerLiteLLMCompatibleModelRequest({
        capabilities,
        nodeId: input.nodeId,
        plan: input.plan,
        ...(options.model !== undefined ? { model: options.model } : {}),
      });
    },
    async executeModelRequest(
      input: LiteLLMCompatibleAdapterExecuteInput,
    ): Promise<LiteLLMCompatibleAdapterExecuteResult> {
      const lowering = lowerLiteLLMCompatibleModelRequest({
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
        id: `litellm-compatible-${input.plan.id}-${input.nodeId}`,
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
  readonly metadata: LiteLLMCompatibleMetadata;
  readonly model: string;
  readonly node: MIRModelCallNode;
  readonly plan: MIRPlan;
}): LiteLLMCompatibleRequestShape {
  return {
    messages: collectMessages(input.plan, input.node),
    metadata: {
      adapterVersion: LITELLM_COMPATIBLE_ADAPTER_VERSION,
      gatewayResponsibilities,
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
    ...(input.metadata.responseFormat !== undefined &&
    input.capabilities.supportsStructuredOutputs
      ? {
          response_format: {
            json_schema: {
              name: input.metadata.responseFormat.name,
              schema_ref: input.metadata.responseFormat.schemaRef,
            },
            type: "json_schema",
          } satisfies LiteLLMCompatibleResponseFormat,
        }
      : {}),
    ...(input.metadata.tools.length > 0 &&
    input.capabilities.supportsToolCalling
      ? {
          tools: input.metadata.tools.map((tool) => ({
            function: {
              name: tool.name,
              parameters_ref: tool.schemaRef,
            },
            type: "function",
          })),
        }
      : {}),
  };
}

function collectMessages(
  plan: MIRPlan,
  node: MIRModelCallNode,
): readonly LiteLLMCompatibleMessage[] {
  const contextById = new Map(plan.context.map((block) => [block.id, block]));

  return (node.inputContext ?? []).flatMap((contextId) => {
    const block = contextById.get(contextId);

    if (block === undefined) {
      return [];
    }

    return [
      {
        content_ref: block.contentRef,
        context_id: block.id,
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
  readonly hasResponseFormat: boolean;
  readonly hasTools: boolean;
}): readonly ProviderCapabilityAssumption[] {
  const evidenceRef = providerEvidenceRef(input.capabilities);
  const assumptions: ProviderCapabilityAssumption[] = [];

  if (input.hasResponseFormat) {
    assumptions.push({
      capability: "structured_outputs",
      description:
        "LiteLLM-compatible gateway fixture accepts structured output request metadata; the gateway owns provider-specific translation.",
      evidenceRef,
    });
  }

  if (input.hasTools) {
    assumptions.push({
      capability: "tool_calling",
      description:
        "LiteLLM-compatible gateway fixture accepts tool request metadata; the gateway owns provider-specific translation.",
      evidenceRef,
    });
  }

  return assumptions;
}

function createGatewayAssumptions(): readonly LiteLLMGatewayAssumption[] {
  return gatewayResponsibilities.map((responsibility) => ({
    description: describeGatewayResponsibility(responsibility),
    owner: "gateway",
    responsibility,
  }));
}

function describeGatewayResponsibility(
  responsibility: LiteLLMGatewayResponsibility,
): string {
  switch (responsibility) {
    case "provider_routing":
      return "The LiteLLM-compatible gateway chooses the concrete upstream provider or model route.";
    case "connectivity":
      return "The LiteLLM-compatible gateway owns upstream network connectivity.";
    case "budget_enforcement":
      return "The LiteLLM-compatible gateway owns runtime budgets and spend limits.";
    case "fallback_policy":
      return "The LiteLLM-compatible gateway owns provider fallback behavior after lowering.";
    case "observability":
      return "The LiteLLM-compatible gateway owns provider-side monitoring and request telemetry.";
  }
}

function createGatewayWarnings(
  plan: MIRPlan,
  node: MIRModelCallNode,
  capabilities: ProviderCapabilities,
): readonly ProviderWarning[] {
  if (capabilities.supportsPromptCaching || !hasCachePolicy(plan, node)) {
    return [];
  }

  return [
    {
      assumption:
        "LiteLLM-compatible gateway fixture does not lower Migaki cache policy.",
      capability: "prompt_caching",
      code: "downgraded_capability",
      message: "Migaki cache policy metadata was not lowered.",
      severity: "warning",
    },
  ];
}

function hasCachePolicy(plan: MIRPlan, node: MIRModelCallNode): boolean {
  return collectInputBlocks(plan, node).some(
    (block) => block.cachePolicy !== undefined,
  );
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

function mapContextRole(
  block: MIRContextBlock,
): LiteLLMCompatibleMessage["role"] {
  switch (block.role) {
    case "developer_instruction":
    case "system_instruction":
      return "system";
    case "tool_result":
      return "tool";
    case "scratchpad":
    case "validator_output":
      return "assistant";
    case "example":
    case "memory":
    case "retrieved_document":
    case "user_input":
      return "user";
  }
}

interface LiteLLMCompatibleMetadata {
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

function readLiteLLMCompatibleMetadata(
  node: MIRModelCallNode,
): LiteLLMCompatibleMetadata {
  const raw = node.metadata?.["litellmCompatible"];

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

function getLiteLLMCompatibleCapabilities(): ProviderCapabilities {
  const capabilities = lookupProviderCapabilities("litellm-compatible");

  if (capabilities === undefined) {
    throw new Error(
      "LiteLLM-compatible provider capability fixture is missing.",
    );
  }

  return capabilities;
}

function providerEvidenceRef(capabilities: ProviderCapabilities): string {
  return `provider-capabilities://${capabilities.provider}/${capabilities.version}/${capabilities.observedAt}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
