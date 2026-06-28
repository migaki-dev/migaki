# @migaki/providers

Owns provider capability contracts, backend interfaces, provider-specific request construction surfaces, and deterministic mock backend entrypoints.

The v0 public API exports versioned provider capability declarations, provider warnings, lowered execution plans, execution results, and the backend interface used by future adapters.

Deterministic capability fixtures are available for mock, OpenAI-style, Anthropic-style, and LiteLLM-compatible backends. They are fixtures for tests and evidence assumptions, not live provider documentation.

`createMockExecutionBackend` provides the v0 deterministic mock backend. It
lowers mIR nodes into mock execution steps, executes fixture responses without
network calls, aggregates fixture usage, records fake-clock execution logs, and
supports injected retryable failures for replay and evidence tests.

`createFetchCompatibleProviderWrapper` wraps provider-style HTTP calls behind an
injected transport. It records sanitized request/response metadata, retry
attempts, provider assumptions, and redaction decisions without persisting
authorization headers or body content by default.

`lowerOpenAIStyleModelRequest` and `createOpenAIStyleAdapter` provide the v0
OpenAI-style lowering path. They construct deterministic request shapes from
mIR model nodes, consult capability fixtures for structured output, tool
calling, and cache behavior, and execute only through injected fake transports.

`lowerAnthropicStyleModelRequest` and `createAnthropicStyleAdapter` provide the
v0 Anthropic-style lowering path. They lower mIR model nodes into deterministic
message request shapes, represent fixture-backed explicit cache breakpoints,
and execute only through injected fake transports.
