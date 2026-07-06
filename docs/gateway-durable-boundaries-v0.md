# Gateway and Durable Replay Boundaries v0

## Contracts

- Boundary contract: `migaki.gateway-durable-boundary.v0`
- Related provider contract: `migaki.litellm-compatible-adapter.v0`
- Related evidence contracts: `migaki.evidence-event.v0`,
  `migaki.evidence-bundle.v0`, and `migaki.trace-artifact.v0`
- Owning packages: `@migaki/providers` and `@migaki/runtime`
- Source of truth: `packages/providers/src/litellm-compatible.ts`,
  `packages/runtime/src/evidence.ts`,
  `packages/runtime/src/evidence-bundle.ts`, and
  `packages/runtime/src/mock-trace.ts`

Living design context is in the
[Risks and Open Questions](https://github.com/migaki-dev/migaki/wiki/Risks-and-Open-Questions),
[Adapters and Backends](https://github.com/migaki-dev/migaki/wiki/Adapters-and-Backends),
[Provider Capabilities](https://github.com/migaki-dev/migaki/wiki/Provider-Capabilities),
and
[Execution Evidence Bundles](https://github.com/migaki-dev/migaki/wiki/Execution-Evidence-Bundles)
wiki pages. This document resolves the v0 repository contract for gateway and
durable replay boundaries.

## Gateway Boundary

Migaki owns portable execution intent, deterministic or report-only optimization
passes, provider-capability checks, lowered request metadata, and evidence for
the assumptions it used. Provider gateways own concrete upstream execution after
lowering. Migaki must not silently duplicate gateway policy; when it depends on
gateway behavior, it records that dependency as an assumption or warning.

| Decision area | Migaki owns                                                                                                          | Gateway owns                                                                                                         | Evidence requirement                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Routing       | Static route proposals and provider allow/deny constraint checks.                                                    | Concrete upstream provider or model route selection after the request reaches the gateway.                           | `routing_decision` events for Migaki proposals; gateway-owned route selection recorded as an adapter assumption when delegated.        |
| Fallback      | Plan-level fallback candidates that satisfy mIR constraints and validators.                                          | Provider fallback policy, fallback order, and live failover after lowering.                                          | `retry_fallback_decision` events for Migaki planning; gateway fallback recorded as a gateway assumption.                               |
| Budget        | Cost estimates, budget constraints, and warnings when capability or cost data is missing or stale.                   | Live spend limits, quota enforcement, rate limits, and rejected requests.                                            | Estimates and warnings must name provider capability fixtures and drift risk instead of treating budgets as proven invoices.           |
| Retry         | Retry boundaries in mIR, including side-effect checks and idempotency, policy, or approval evidence requirements.    | Transport-level retries, provider retry policy, and gateway retry budgets after lowering.                            | Migaki retries must fail closed for `unknown` or unsafe side effects; delegated retry policy is recorded as a gateway assumption.      |
| Cache         | Stable-prefix detection, cache layout reporting, mIR `cache_read` or `cache_write` nodes, and cache-policy metadata. | Provider-side cache application, gateway cache storage, eviction, and cache hit accounting.                          | Cache plans and downgrade warnings must distinguish Migaki metadata from provider or gateway cache behavior.                           |
| Observability | Evidence bundles, redaction records, local reports, replay metadata, and exported handles.                           | Gateway telemetry, provider logs, request metrics, and monitoring retention.                                         | Evidence may link to external trace handles but must not copy raw prompts, provider responses, credentials, or local paths by default. |
| Replay        | Deterministic mock trace replay, metadata-only replay handles, and observed-trajectory reuse decisions.              | No provider gateway replay authority is assumed. Provider responses are not replayable through a gateway by default. | Any provider response reuse requires explicit validators, policies, freshness, privacy, and side-effect evidence.                      |

## LiteLLM-Compatible Adapter Assumptions

The LiteLLM-compatible adapter lowers model nodes into deterministic
gateway-compatible chat request shapes. Its metadata and `gatewayAssumptions`
record these gateway-owned responsibilities:

- `provider_routing`
- `connectivity`
- `budget_enforcement`
- `fallback_policy`
- `retry_policy`
- `cache_backend`
- `observability`

These assumptions do not prove that a live gateway is correctly configured.
They state which responsibilities Migaki intentionally delegated when producing
the lowered request shape. Required provider capabilities still fail closed when
the fixture is missing, stale, or unsupported.

## Durable Replay Boundary

Durable workflow engines, such as Temporal, LangGraph, or another runtime, own
workflow history, persisted state, scheduling, and state replay. Migaki replay is
narrower:

- `migaki.trace-artifact.v0` replay checks deterministic mock-backed execution
  artifacts.
- Evidence bundles record replay mode, handles, redactions, and omitted data.
- Observed-trajectory comparison reports potentially reusable nodes and blocked
  reasons; it does not execute, skip work, or serve prior outputs.
- mIR retry or replay-sensitive consumers must use the side-effect classes
  `read_only`, `idempotent_mutation`, `non_idempotent_mutation`,
  `approval_required`, and `unknown`; missing or `unknown` side-effect evidence
  fails closed.

When a durable runtime owns history replay, Migaki evidence should attach to the
runtime's workflow or step identifiers as handles. Migaki may optimize or report
on model, retrieval, tool, validation, and context work inside workflow steps,
but it must not become the workflow history store or decide durable state replay.

## Compatibility

Changing which system owns routing, fallback, budget, retry, cache,
observability, or replay decisions is a compatibility change. Adding a new
gateway responsibility is compatible only when older consumers can safely ignore
the new value and the adapter tests document the evidence assumption. Removing a
responsibility, changing replay meaning, or weakening side-effect fail-closed
semantics is breaking and requires a new contract version plus migration notes.
