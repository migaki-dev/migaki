# Provider Capabilities v0

## Contracts

- Provider contract: `migaki.providers.v0`
- Provider cost rate fixture contract: `migaki.provider-cost-rates.v0`
- Mock backend contract: `migaki.mock-backend.v0`
- OpenAI-style adapter contract: `migaki.openai-style-adapter.v0`
- Anthropic-style adapter contract: `migaki.anthropic-style-adapter.v0`
- LiteLLM-compatible adapter contract:
  `migaki.litellm-compatible-adapter.v0`
- Owning package: `@migaki/providers`
- Source of truth: `packages/providers/src/contracts.ts`,
  `packages/providers/src/fixtures.ts`, `packages/providers/src/mock-backend.ts`,
  `packages/providers/src/openai-style.ts`,
  `packages/providers/src/anthropic-style.ts`, and
  `packages/providers/src/litellm-compatible.ts`

Living design context is in the
[Provider Capabilities](https://github.com/migaki-dev/migaki/wiki/Provider-Capabilities)
and
[Adapters and Backends](https://github.com/migaki-dev/migaki/wiki/Adapters-and-Backends)
wiki pages. This document describes the implemented repository contract.

## Capability Declarations

`ProviderCapabilities` describes observed or fixture-backed support for a
provider backend. The implemented backend kinds are `mock`, `openai_style`,
`anthropic_style`, `litellm_compatible`, and `custom`.

The v0 capability fields include:

- provider id, backend kind, version, observation time, and source
- maximum context tokens when known
- prompt caching, explicit cache breakpoints, automatic caching, batching,
  structured outputs, tool calling, reasoning controls, remote MCP, and zero
  data retention support
- cache TTL options when known

Capability sources are `docs`, `fixture`, `manual`, or `observed`. Fixture data
is deterministic test data and evidence input. It is not live provider
documentation.

## Capability Checks

`checkProviderCapabilityRequirements` compares declared requirements with a
capability fixture and returns a supported boolean plus structured warnings.
Required missing capabilities produce `error` warnings and fail closed.
Optional missing capabilities produce downgrade warnings.

Implemented warning codes are `capability_unknown`, `context_limit_exceeded`,
`downgraded_capability`, `retention_unavailable`, and
`unsupported_capability`.

## Backend Lowering

An `ExecutionBackend` exposes `lower(plan)` and `execute(loweredPlan)`.
`LoweredExecutionPlan` includes provider id, backend id, source plan id, steps,
assumptions, warnings, optional metadata, and `migaki.providers.v0`.

`ExecutionResult` includes lowered plan id, status, outputs, optional usage,
optional error, warnings, and `migaki.providers.v0`.

Lowered steps preserve the source mIR node id and identify the lowered kind,
request reference, input context, output context, and assumption references.

## Implemented Backends and Adapters

`createMockExecutionBackend` is the deterministic v0 backend. It lowers mIR
nodes to mock execution steps, executes fixture responses without network
calls, aggregates usage, records fake-clock execution logs, and supports
injected retryable failures for replay and evidence tests.

`createFetchCompatibleProviderWrapper` wraps provider-style HTTP calls behind
an injected transport. It records sanitized request and response metadata,
retry attempts, provider assumptions, and redaction decisions. It does not
persist authorization headers or body content by default.

`lowerOpenAIStyleModelRequest` and `createOpenAIStyleAdapter` lower model calls
into deterministic OpenAI-style request shapes using injected transports only.
They cover structured output, tool calling, and cache behavior through
capability fixtures.

`lowerAnthropicStyleModelRequest` and `createAnthropicStyleAdapter` lower model
calls into deterministic Anthropic-style request shapes using injected
transports only. They represent fixture-backed explicit cache breakpoints.

`lowerLiteLLMCompatibleModelRequest` and `createLiteLLMCompatibleAdapter` lower
model calls into deterministic LiteLLM-compatible chat request shapes using
injected transports only. They record gateway assumptions that distinguish
Migaki lowering from gateway-owned provider routing, connectivity, budget
enforcement, fallback policy, and observability.

## Compatibility

Provider and backend contracts are compatibility surfaces. Changing capability
names, backend kinds, required lowered plan fields, warning semantics, or
execution result status meaning is breaking. Updating fixture observations is
compatible only when the change is documented, tested, and does not silently
weaken required capability checks.

Breaking provider contract changes require a new contract version, migration
notes, and fixture tests that show old and new behavior. Provider-specific
behavior belongs in adapters and backends, not in mIR or core pass logic.
