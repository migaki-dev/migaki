# @migaki/runtime

Owns deterministic execution planning, optimization pass orchestration, plan diffs, evidence construction, tracing, and replay artifact handling.

The v0 public API exports the optimization pass contract. Passes must declare identity, version, capability metadata, safety expectations, and return an updated plan with diff, evidence, and warnings.
