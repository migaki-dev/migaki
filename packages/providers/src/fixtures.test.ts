import { describe, expect, it } from "vitest";

import {
  PROVIDER_CAPABILITY_FIXTURE_VERSION,
  checkProviderFixtureRequirements,
  citeProviderCapabilities,
  listProviderCapabilityFixtures,
  lookupProviderCapabilities,
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
        sourceKind: fixture.source.kind,
        version: fixture.version,
      })),
    ).toEqual([
      {
        observedAt: "2026-01-01",
        sourceKind: "fixture",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
      },
      {
        observedAt: "2026-01-01",
        sourceKind: "fixture",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
      },
      {
        observedAt: "2026-01-01",
        sourceKind: "fixture",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
      },
      {
        observedAt: "2026-01-01",
        sourceKind: "fixture",
        version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
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
      observedAt: "2026-01-01",
      provider: "anthropic-style",
      source: {
        kind: "fixture",
        note: "Anthropic-style fixture with explicit cache breakpoint assumptions.",
      },
      version: PROVIDER_CAPABILITY_FIXTURE_VERSION,
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
