import type { MIRPlan } from "@migaki/mir";

export const PROVIDER_CONTRACT_VERSION = "migaki.providers.v0";

export type ProviderContractVersion = typeof PROVIDER_CONTRACT_VERSION;

export type ProviderBackendKind =
  | "anthropic_style"
  | "custom"
  | "litellm_compatible"
  | "mock"
  | "openai_style";

export interface ProviderCapabilities {
  readonly backendKind: ProviderBackendKind;
  readonly cacheTtlOptions?: readonly string[];
  readonly maxContextTokens?: number;
  readonly observedAt: string;
  readonly provider: string;
  readonly source: ProviderCapabilitySource;
  readonly supportsAutomaticCaching: boolean;
  readonly supportsBatching: boolean;
  readonly supportsExplicitCacheBreakpoints: boolean;
  readonly supportsPromptCaching: boolean;
  readonly supportsReasoningControls: boolean;
  readonly supportsRemoteMCP: boolean;
  readonly supportsStructuredOutputs: boolean;
  readonly supportsToolCalling: boolean;
  readonly supportsZeroDataRetention?: boolean;
  readonly version: ProviderContractVersion;
}

export interface ProviderCapabilitySource {
  readonly kind: "docs" | "fixture" | "manual" | "observed";
  readonly note?: string;
  readonly url?: string;
}

export type ProviderCapabilityName =
  | "automatic_caching"
  | "batching"
  | "context_limits"
  | "explicit_cache_breakpoints"
  | "prompt_caching"
  | "reasoning_controls"
  | "remote_mcp"
  | "structured_outputs"
  | "tool_calling"
  | "zero_data_retention";

export interface ProviderCapabilityRequirement {
  readonly capability: ProviderCapabilityName;
  readonly minContextTokens?: number;
  readonly reason?: string;
  readonly required: boolean;
}

export interface ProviderCapabilityCheck {
  readonly supported: boolean;
  readonly warnings: readonly ProviderWarning[];
}

export interface ProviderWarning {
  readonly assumption?: string;
  readonly capability?: ProviderCapabilityName;
  readonly code: ProviderWarningCode;
  readonly message: string;
  readonly severity: "error" | "info" | "warning";
}

export type ProviderWarningCode =
  | "capability_unknown"
  | "context_limit_exceeded"
  | "downgraded_capability"
  | "retention_unavailable"
  | "unsupported_capability";

export interface ProviderCapabilityAssumption {
  readonly capability: ProviderCapabilityName;
  readonly description: string;
  readonly evidenceRef?: string;
}

export interface ExecutionBackend<
  TLoweredPlan extends LoweredExecutionPlan = LoweredExecutionPlan,
  TResult extends ExecutionResult = ExecutionResult,
> {
  readonly backendKind: ProviderBackendKind;
  readonly capabilities: ProviderCapabilities;
  readonly id: string;
  readonly provider: string;
  lower(plan: MIRPlan): Promise<TLoweredPlan>;
  execute(plan: TLoweredPlan): Promise<TResult>;
}

export interface LoweredExecutionPlan {
  readonly assumptions: readonly ProviderCapabilityAssumption[];
  readonly backendId: string;
  readonly id: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly provider: string;
  readonly sourcePlanId: string;
  readonly steps: readonly LoweredExecutionStep[];
  readonly version: ProviderContractVersion;
  readonly warnings: readonly ProviderWarning[];
}

export interface LoweredExecutionStep {
  readonly assumptionRefs?: readonly string[];
  readonly id: string;
  readonly inputContext?: readonly string[];
  readonly kind:
    | "approval"
    | "cache"
    | "model"
    | "retrieval"
    | "tool"
    | "validator";
  readonly outputContext?: string;
  readonly requestRef?: string;
  readonly sourceNodeId: string;
}

export interface ExecutionResult {
  readonly error?: ProviderExecutionError;
  readonly loweredPlanId: string;
  readonly outputs: readonly ExecutionOutput[];
  readonly status: "failed" | "partial" | "succeeded";
  readonly usage?: ExecutionUsage;
  readonly version: ProviderContractVersion;
  readonly warnings: readonly ProviderWarning[];
}

export interface ExecutionOutput {
  readonly contextId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly nodeId: string;
  readonly outputRef: string;
}

export interface ExecutionUsage {
  readonly costUsd?: number;
  readonly inputTokens?: number;
  readonly latencyMs?: number;
  readonly outputTokens?: number;
}

export interface ProviderExecutionError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export function checkProviderCapabilityRequirements(
  capabilities: ProviderCapabilities,
  requirements: readonly ProviderCapabilityRequirement[],
): ProviderCapabilityCheck {
  const warnings: ProviderWarning[] = [];

  for (const requirement of requirements) {
    const available = isCapabilityAvailable(capabilities, requirement);

    if (available === true) {
      continue;
    }

    if (!requirement.required) {
      const warning: ProviderWarning = {
        capability: requirement.capability,
        code: "downgraded_capability",
        message: "Optional provider capability is unavailable.",
        severity: "warning",
      };

      if (requirement.reason !== undefined) {
        warnings.push({ ...warning, assumption: requirement.reason });
      } else {
        warnings.push(warning);
      }
      continue;
    }

    const warning: ProviderWarning = {
      capability: requirement.capability,
      code:
        available === undefined
          ? "capability_unknown"
          : "unsupported_capability",
      message:
        available === undefined
          ? "Required provider capability is unknown."
          : "Required provider capability is unavailable.",
      severity: "error",
    };

    if (requirement.reason !== undefined) {
      warnings.push({ ...warning, assumption: requirement.reason });
    } else {
      warnings.push(warning);
    }
  }

  return {
    supported: warnings.every((warning) => warning.severity !== "error"),
    warnings,
  };
}

function isCapabilityAvailable(
  capabilities: ProviderCapabilities,
  requirement: ProviderCapabilityRequirement,
): boolean | undefined {
  switch (requirement.capability) {
    case "automatic_caching":
      return capabilities.supportsAutomaticCaching;
    case "batching":
      return capabilities.supportsBatching;
    case "context_limits":
      if (requirement.minContextTokens === undefined) {
        return capabilities.maxContextTokens !== undefined;
      }

      if (capabilities.maxContextTokens === undefined) {
        return undefined;
      }

      return capabilities.maxContextTokens >= requirement.minContextTokens;
    case "explicit_cache_breakpoints":
      return capabilities.supportsExplicitCacheBreakpoints;
    case "prompt_caching":
      return capabilities.supportsPromptCaching;
    case "reasoning_controls":
      return capabilities.supportsReasoningControls;
    case "remote_mcp":
      return capabilities.supportsRemoteMCP;
    case "structured_outputs":
      return capabilities.supportsStructuredOutputs;
    case "tool_calling":
      return capabilities.supportsToolCalling;
    case "zero_data_retention":
      return capabilities.supportsZeroDataRetention;
  }
}
