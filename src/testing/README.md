# Test Helpers

Shared test helpers live here so v0 work can use deterministic fakes instead of live providers or call-count mocks.

Use `FakeClock` when testing timeouts, retries, expiry, or ordering. Advance fake time with `advanceBy` or `advanceTo`; never use real sleeps in unit tests.

Use `FakeTransport` or the same pattern for provider and backend boundaries. Queue deterministic responses or errors, call the boundary, and assert against `exchanges` to prove the request and result contract.

Use fixture helpers for golden text and stable JSON output. Use `defineInvariantCases` to keep invariant table tests named, non-empty, and duplicate-free.
