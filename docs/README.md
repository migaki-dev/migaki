# Migaki v0 Contract Docs

This directory contains repository-versioned technical contract documentation for
the code that ships in this repository. The wiki remains the living place for
product design, roadmap, and longer-form rationale.

The TypeScript exports are still the executable source of truth. These docs map
those exports into stable contract references for contributors, reviewers, and
downstream integrators.

## Contracts

- [mIR v0](./mir-v0.md) describes `migaki.mir.v0` plans, nodes, context blocks,
  constraints, and validation.
- [Pass Contracts v0](./pass-contracts-v0.md) describes optimization passes,
  the pass runner, plan diffs, and implemented deterministic passes.
- [Provider Capabilities v0](./provider-capabilities-v0.md) describes provider
  capability fixtures, backend lowering contracts, execution results, and
  adapter responsibilities.
- [Evidence Bundles v0](./evidence-bundles-v0.md) describes evidence events,
  evidence bundles, redaction behavior, and mock trace replay artifacts.
- [CLI v0](./cli-v0.md) describes the `report` and `replay` command surfaces.
- [Adaptive Policies v0](./adaptive-policies-v0.md) describes
  meta-observations, policy proposals, policy diffs, and accepted policy
  bundles for auditable advice-only adaptation.

## Wiki Context

- [Repository Shape](https://github.com/migaki-dev/migaki/wiki/Repository-Shape)
  explains why technical contracts live in the repository.
- [v0 Roadmap](https://github.com/migaki-dev/migaki/wiki/v0-Roadmap) tracks
  product milestone scope.
- [mIR](https://github.com/migaki-dev/migaki/wiki/mIR),
  [Optimization Passes](https://github.com/migaki-dev/migaki/wiki/Optimization-Passes),
  [Provider Capabilities](https://github.com/migaki-dev/migaki/wiki/Provider-Capabilities),
  and
  [Execution Evidence Bundles](https://github.com/migaki-dev/migaki/wiki/Execution-Evidence-Bundles)
  provide living design context.

## Compatibility Policy

The workspace packages are currently `0.0.0`, and the public contracts are v0
pre-release contracts. Even before package publication, changes should follow
the repository's semantic-versioning rules:

- Adding optional fields or new enum values is a compatible v0 extension only
  when older consumers can safely ignore them.
- Removing fields, changing required fields, changing validation semantics, or
  changing serialized output meaning is breaking.
- Breaking changes require a new contract version string, migration notes, and
  tests that make old and new behavior explicit.
- Serialized artifacts must include version fields and must not silently change
  shape.
