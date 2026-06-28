# @migaki/providers

Owns provider capability contracts, backend interfaces, provider-specific request construction surfaces, and deterministic mock backend entrypoints.

The v0 public API exports versioned provider capability declarations, provider warnings, lowered execution plans, execution results, and the backend interface used by future adapters.

Deterministic capability fixtures are available for mock, OpenAI-style, Anthropic-style, and LiteLLM-compatible backends. They are fixtures for tests and evidence assumptions, not live provider documentation.
