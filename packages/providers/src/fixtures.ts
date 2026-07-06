import {
  PROVIDER_CONTRACT_VERSION,
  PROVIDER_COST_RATE_FIXTURE_VERSION,
  checkProviderCapabilityRequirements,
  type ProviderBackendKind,
  type ProviderCapabilities,
  type ProviderCapabilityCheck,
  type ProviderCapabilityCheckOptions,
  type ProviderCapabilityRequirement,
  type ProviderCapabilitySource,
  type ProviderCostRateEvidenceCitation,
  type ProviderCostRateFixture,
} from "./contracts.js";

export const PROVIDER_CAPABILITY_FIXTURE_VERSION = PROVIDER_CONTRACT_VERSION;

export type ProviderCapabilityFixtureId =
  | "anthropic-style"
  | "litellm-compatible"
  | "mock"
  | "openai-style";

export interface ProviderCapabilityEvidenceCitation {
  readonly backendKind: ProviderBackendKind;
  readonly fixtureVersion: typeof PROVIDER_CAPABILITY_FIXTURE_VERSION;
  readonly observedAt: string;
  readonly provider: string;
  readonly source: ProviderCapabilitySource;
  readonly staleAfter?: string;
  readonly version: typeof PROVIDER_CAPABILITY_FIXTURE_VERSION;
  readonly verifiedAt: string;
}

const providerCapabilityFixtures = {
  mock: {
    version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    provider: "mock",
    backendKind: "mock",
    observedAt: "2026-01-01",
    verifiedAt: "2026-01-01",
    staleAfter: "2026-12-31",
    source: {
      kind: "fixture",
      label: "Deterministic mock backend fixture",
      note: "Deterministic local mock backend for tests.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
    supportsPromptCaching: false,
    supportsExplicitCacheBreakpoints: false,
    supportsAutomaticCaching: false,
    supportsToolCalling: true,
    supportsRemoteMCP: false,
    supportsStructuredOutputs: true,
    supportsBatching: false,
    supportsReasoningControls: false,
    supportsZeroDataRetention: true,
    maxContextTokens: 8192,
  },
  "openai-style": {
    version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    provider: "openai-style",
    backendKind: "openai_style",
    observedAt: "2026-01-01",
    verifiedAt: "2026-01-01",
    staleAfter: "2026-12-31",
    source: {
      kind: "fixture",
      label: "OpenAI-style capability fixture",
      note: "OpenAI-style fixture with automatic prompt caching assumptions.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
    supportsPromptCaching: true,
    supportsExplicitCacheBreakpoints: false,
    supportsAutomaticCaching: true,
    supportsToolCalling: true,
    supportsRemoteMCP: true,
    supportsStructuredOutputs: true,
    supportsBatching: true,
    supportsReasoningControls: true,
    supportsZeroDataRetention: false,
    maxContextTokens: 128000,
  },
  "anthropic-style": {
    version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    provider: "anthropic-style",
    backendKind: "anthropic_style",
    observedAt: "2026-01-01",
    verifiedAt: "2026-01-01",
    staleAfter: "2026-12-31",
    source: {
      kind: "fixture",
      label: "Anthropic-style capability fixture",
      note: "Anthropic-style fixture with explicit cache breakpoint assumptions.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
    cacheTtlOptions: ["5m", "1h"],
    supportsPromptCaching: true,
    supportsExplicitCacheBreakpoints: true,
    supportsAutomaticCaching: false,
    supportsToolCalling: true,
    supportsRemoteMCP: false,
    supportsStructuredOutputs: false,
    supportsBatching: true,
    supportsReasoningControls: true,
    supportsZeroDataRetention: false,
    maxContextTokens: 200000,
  },
  "litellm-compatible": {
    version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
    provider: "litellm-compatible",
    backendKind: "litellm_compatible",
    observedAt: "2026-01-01",
    verifiedAt: "2026-01-01",
    staleAfter: "2026-12-31",
    source: {
      kind: "fixture",
      label: "LiteLLM-compatible gateway fixture",
      note: "LiteLLM-compatible fixture; gateway owns routing and connectivity.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
    supportsPromptCaching: false,
    supportsExplicitCacheBreakpoints: false,
    supportsAutomaticCaching: false,
    supportsToolCalling: true,
    supportsRemoteMCP: false,
    supportsStructuredOutputs: true,
    supportsBatching: false,
    supportsReasoningControls: false,
    supportsZeroDataRetention: false,
    maxContextTokens: 32000,
  },
} as const satisfies Record<ProviderCapabilityFixtureId, ProviderCapabilities>;

const providerCostRateFixtures = [
  {
    version: PROVIDER_COST_RATE_FIXTURE_VERSION,
    provider: "mock",
    model: "mock-default",
    currency: "USD",
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      label: "Mock cost-rate fixture",
      note: "Zero-cost deterministic mock backend fixture.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
  },
  {
    version: PROVIDER_COST_RATE_FIXTURE_VERSION,
    provider: "openai-style",
    model: "openai-style-synthesis",
    currency: "USD",
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 4,
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      label: "OpenAI-style cost-rate fixture",
      note: "Synthetic OpenAI-style cost fixture for deterministic tests.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
  },
  {
    version: PROVIDER_COST_RATE_FIXTURE_VERSION,
    provider: "anthropic-style",
    model: "anthropic-style-synthesis",
    currency: "USD",
    inputUsdPerMillionTokens: 2,
    outputUsdPerMillionTokens: 8,
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      label: "Anthropic-style cost-rate fixture",
      note: "Synthetic Anthropic-style cost fixture for deterministic tests.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
  },
  {
    version: PROVIDER_COST_RATE_FIXTURE_VERSION,
    provider: "litellm-compatible",
    model: "litellm-compatible-synthesis",
    currency: "USD",
    inputUsdPerMillionTokens: 1.5,
    outputUsdPerMillionTokens: 6,
    observedAt: "2026-01-01",
    source: {
      kind: "fixture",
      label: "LiteLLM-compatible cost-rate fixture",
      note: "Synthetic LiteLLM-compatible gateway cost fixture.",
      url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
    },
  },
] as const satisfies readonly ProviderCostRateFixture[];

export function listProviderCapabilityFixtures(): readonly ProviderCapabilities[] {
  return Object.values(providerCapabilityFixtures);
}

export function listProviderCostRateFixtures(): readonly ProviderCostRateFixture[] {
  return providerCostRateFixtures;
}

export function lookupProviderCapabilities(
  fixtureId: string,
): ProviderCapabilities | undefined {
  return isProviderCapabilityFixtureId(fixtureId)
    ? providerCapabilityFixtures[fixtureId]
    : undefined;
}

export function lookupProviderCostRateFixture(
  provider: string,
  model: string,
): ProviderCostRateFixture | undefined {
  return providerCostRateFixtures.find(
    (fixture) => fixture.provider === provider && fixture.model === model,
  );
}

export function checkProviderFixtureRequirements(
  fixtureId: string,
  requirements: readonly ProviderCapabilityRequirement[],
  options: ProviderCapabilityCheckOptions = {},
): ProviderCapabilityCheck {
  const capabilities = lookupProviderCapabilities(fixtureId);

  if (capabilities === undefined) {
    return {
      supported: false,
      warnings: [
        {
          code: "capability_unknown",
          message: "Provider capability fixture is unknown.",
          severity: "error",
        },
      ],
    };
  }

  return checkProviderCapabilityRequirements(
    capabilities,
    requirements,
    options,
  );
}

export function citeProviderCapabilities(
  capabilities: ProviderCapabilities,
): ProviderCapabilityEvidenceCitation {
  return {
    backendKind: capabilities.backendKind,
    fixtureVersion: capabilities.fixtureVersion,
    observedAt: capabilities.observedAt,
    provider: capabilities.provider,
    source: capabilities.source,
    ...(capabilities.staleAfter !== undefined
      ? { staleAfter: capabilities.staleAfter }
      : {}),
    version: capabilities.version,
    verifiedAt: capabilities.verifiedAt,
  };
}

export function citeProviderCostRate(
  fixture: ProviderCostRateFixture,
): ProviderCostRateEvidenceCitation {
  const citation: ProviderCostRateEvidenceCitation = {
    currency: fixture.currency,
    inputUsdPerMillionTokens: fixture.inputUsdPerMillionTokens,
    model: fixture.model,
    observedAt: fixture.observedAt,
    provider: fixture.provider,
    source: fixture.source,
    version: fixture.version,
    ...(fixture.expiresAt !== undefined
      ? { expiresAt: fixture.expiresAt }
      : {}),
    ...(fixture.outputUsdPerMillionTokens !== undefined
      ? { outputUsdPerMillionTokens: fixture.outputUsdPerMillionTokens }
      : {}),
  };

  return citation;
}

function isProviderCapabilityFixtureId(
  fixtureId: string,
): fixtureId is ProviderCapabilityFixtureId {
  return fixtureId in providerCapabilityFixtures;
}
