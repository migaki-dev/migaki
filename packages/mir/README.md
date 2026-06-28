# @migaki/mir

Owns the provider-neutral mIR contract: TypeScript types, runtime validation entrypoints, schema artifacts, and example plan fixtures.

The v0 contract exports `MIRPlan`, node, edge, context block, constraints, metadata, policy types, and runtime validation helpers for `migaki.mir.v0`. JSON Schema export is intentionally left to later v0 issues.

Example plans live under `src/examples/` and are covered by validation tests so future pass, evidence, CLI, and demo work can depend on stable fixtures.
