import { describe, expect, it } from "vitest";

import {
  PROVIDER_CAPABILITY_FIXTURE_VERSION,
  PROVIDER_COST_RATE_FIXTURE_VERSION,
  checkProviderFixtureRequirements,
  checkProviderCapabilityRequirements,
  citeProviderCapabilities,
  citeProviderCostRate,
  listProviderCapabilityFixtures,
  listProviderCostRateFixtures,
  lookupProviderCapabilities,
  lookupProviderCostRateFixture,
} from "./index.js";

describe("provider capability fixtures", () => {
  it("lists versioned fixtures with source metadata", () => {
    const fixtures = listProviderCapabilityFixtures();

    expect(fixtures.map((fixture) => fixture.backendKind)).toEqual([
      "mock",
      "openai_style",
      "anthropic_style",
      "litellm_compatible",
    ]);
    expect(
      fixtures.map((fixture) => ({
        observedAt: fixture.observedAt,
        fixtureVersion: fixture.fixtureVersion,
        sourceLabel: fixture.source.label,
        sourceKind: fixture.source.kind,
        sourceUrl: fixture.source.url,
        staleAfter: fixture.staleAfter,
        version: fixture.version,
        verifiedAt: fixture.verifiedAt,
      })),
    ).toEqual([
      {
        fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        observedAt: "2026-01-01",
        sourceLabel: "Deterministic mock backend fixture",
        sourceKind: "fixture",
        sourceUrl:
          "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
        staleAfter: "2026-12-31",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        verifiedAt: "2026-01-01",
      },
      {
        fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        observedAt: "2026-01-01",
        sourceLabel: "OpenAI-style capability fixture",
        sourceKind: "fixture",
        sourceUrl:
          "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
        staleAfter: "2026-12-31",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        verifiedAt: "2026-01-01",
      },
      {
        fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        observedAt: "2026-01-01",
        sourceLabel: "Anthropic-style capability fixture",
        sourceKind: "fixture",
        sourceUrl:
          "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
        staleAfter: "2026-12-31",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        verifiedAt: "2026-01-01",
      },
      {
        fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        observedAt: "2026-01-01",
        sourceLabel: "LiteLLM-compatible gateway fixture",
        sourceKind: "fixture",
        sourceUrl:
          "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
        staleAfter: "2026-12-31",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
        verifiedAt: "2026-01-01",
      },
    ]);
  });

  it("looks up a fixture and returns evidence citation metadata", () => {
    const fixture = lookupProviderCapabilities("anthropic-style");

    expect(fixture?.supportsExplicitCacheBreakpoints).toBe(true);
    expect(
      fixture === undefined ? undefined : citeProviderCapabilities(fixture),
    ).toEqual({
      backendKind: "anthropic_style",
      fixtureVersion: PROVIDER_CAPABILITY_FIXTURE_VERSION,
      observedAt: "2026-01-01",
      provider: "anthropic-style",
      source: {
        kind: "fixture",
        label: "Anthropic-style capability fixture",
        note: "Anthropic-style fixture with explicit cache breakpoint assumptions.",
        url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
      },
      staleAfter: "2026-12-31",
      version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
      verifiedAt: "2026-01-01",
    });
  });

  it("keeps fresh capability fixture metadata out of warnings", () => {
    const fixture = lookupProviderCapabilities("openai-style");

    if (fixture === undefined) {
      throw new Error("OpenAI-style fixture is missing.");
    }

    expect(
      checkProviderCapabilityRequirements(fixture, [], {
        checkedAt: "2026-06-01",
      }),
    ).toEqual({
      supported: true,
      warnings: [],
    });
  });

  it("fails closed when required capability fixture source metadata is missing", () => {
    const fixture = lookupProviderCapabilities("mock");

    if (fixture === undefined) {
      throw new Error("Mock fixture is missing.");
    }

    const withoutSource = Object.fromEntries(
      Object.entries(fixture).filter(([key]) => key !== "source"),
    );

    expect(
      checkProviderCapabilityRequirements(
        withoutSource as unknown as typeof fixture,
        [],
        {
          checkedAt: "2026-06-01",
        },
      ),
    ).toEqual({
      supported: false,
      warnings: [
        {
          code: "capability_metadata_missing",
          message: "Provider capability fixture metadata is missing.",
          severity: "error",
          assumption: "Provider mock is missing source metadata.",
        },
      ],
    });
  });

  it("fails closed when capability fixture metadata is stale", () => {
    const fixture = lookupProviderCapabilities("mock");

    if (fixture === undefined) {
      throw new Error("Mock fixture is missing.");
    }

    expect(
      checkProviderCapabilityRequirements(
        {
          ...fixture,
          staleAfter: "2026-01-31",
        },
        [],
        {
          checkedAt: "2026-02-01",
        },
      ),
    ).toEqual({
      supported: false,
      warnings: [
        {
          code: "capability_fixture_stale",
          message: "Provider capability fixture metadata is stale.",
          severity: "error",
          assumption:
            "Provider mock fixture was checked at 2026-02-01 after staleAfter 2026-01-31.",
        },
      ],
    });
  });

  it("preserves provider-specific capability downgrade warnings", () => {
    const fixture = lookupProviderCapabilities("anthropic-style");

    if (fixture === undefined) {
      throw new Error("Anthropic-style fixture is missing.");
    }

    expect(
      checkProviderCapabilityRequirements(
        fixture,
        [
          {
            capability: "structured_outputs",
            required: false,
            reason:
              "Use text JSON fallback when native structured output is unavailable.",
          },
        ],
        {
          checkedAt: "2026-06-01",
        },
      ),
    ).toEqual({
      supported: true,
      warnings: [
        {
          assumption:
            "Use text JSON fallback when native structured output is unavailable.",
          capability: "structured_outputs",
          code: "downgraded_capability",
          message: "Optional provider capability is unavailable.",
          severity: "warning",
        },
      ],
    });
  });

  it("lists versioned cost-rate fixtures with source metadata", () => {
    const fixtures = listProviderCostRateFixtures();

    expect(
      fixtures.map((fixture) => ({
        currency: fixture.currency,
        model: fixture.model,
        provider: fixture.provider,
        sourceKind: fixture.source.kind,
        version: fixture.version,
      })),
    ).toEqual([
      {
        currency: "USD",
        model: "mock-default",
        provider: "mock",
        sourceKind: "fixture",
        version: PROVIDER_COST_RATE_FIXTURE_VERSION,
      },
      {
        currency: "USD",
        model: "openai-style-synthesis",
        provider: "openai-style",
        sourceKind: "fixture",
        version: PROVIDER_COST_RATE_FIXTURE_VERSION,
      },
      {
        currency: "USD",
        model: "anthropic-style-synthesis",
        provider: "anthropic-style",
        sourceKind: "fixture",
        version: PROVIDER_COST_RATE_FIXTURE_VERSION,
      },
      {
        currency: "USD",
        model: "litellm-compatible-synthesis",
        provider: "litellm-compatible",
        sourceKind: "fixture",
        version: PROVIDER_COST_RATE_FIXTURE_VERSION,
      },
    ]);
  });

  it("looks up cost-rate fixtures and returns citation metadata", () => {
    const fixture = lookupProviderCostRateFixture("mock", "mock-default");

    expect(fixture?.inputUsdPerMillionTokens).toBe(0);
    expect(
      fixture === undefined ? undefined : citeProviderCostRate(fixture),
    ).toEqual({
      currency: "USD",
      inputUsdPerMillionTokens: 0,
      model: "mock-default",
      observedAt: "2026-01-01",
      outputUsdPerMillionTokens: 0,
      provider: "mock",
      source: {
        kind: "fixture",
        label: "Mock cost-rate fixture",
        note: "Zero-cost deterministic mock backend fixture.",
        url: "https://github.com/migaki-dev/migaki/blob/main/packages/providers/src/fixtures.ts",
      },
      version: PROVIDER_COST_RATE_FIXTURE_VERSION,
    });
  });

  it("fails closed for unsupported required fixture capabilities", () => {
    expect(
      checkProviderFixtureRequirements("anthropic-style", [
        {
          capability: "structured_outputs",
          required: true,
          reason: "Native structured output lowering is required.",
        },
      ]),
    ).toEqual({
      supported: false,
      warnings: [
        {
          assumption: "Native structured output lowering is required.",
          capability: "structured_outputs",
          code: "unsupported_capability",
          message: "Required provider capability is unavailable.",
          severity: "error",
        },
      ],
    });
  });

  it("fails closed when a fixture id is unknown", () => {
    expect(
      checkProviderFixtureRequirements("unknown-provider", [
        {
          capability: "tool_calling",
          required: true,
        },
      ]),
    ).toEqual({
      supported: false,
      warnings: [
        {
          code: "capability_unknown",
          message: "Provider capability fixture is unknown.",
          severity: "error",
        },
      ],
    });
  });
});
