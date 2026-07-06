# mIR v0

## Contract

- Contract id: `migaki.mir.v0`
- Owning package: `@migaki/mir`
- Source of truth: `packages/mir/src/types.ts` and
  `packages/mir/src/validation.ts`
- Primary exports: `MIR_V0_VERSION`, `MIRPlan`, `validateMIRPlan`,
  `isMIRPlan`, `assertMIRPlan`, `MIRValidationFailure`

mIR is Migaki's provider-neutral execution representation. Applications and
agent frameworks own product strategy. mIR owns the execution-relevant graph
that Migaki can validate, optimize, lower, replay, benchmark, and audit.

The living product rationale is in the
[mIR wiki page](https://github.com/migaki-dev/migaki/wiki/mIR). This document
describes the implemented repository contract.

## Plan Shape

A v0 plan is a `MIRPlan` object with these required top-level fields:

- `version`: must equal `migaki.mir.v0`.
- `id`: stable plan identifier.
- `metadata`: includes required `createdAt` and optional application,
  framework, description, tags, and trace id.
- `constraints`: execution, provider, replay, audit, retention, cache, cost,
  latency, quality, validator, approval, and data policy constraints.
- `context`: context blocks referenced by nodes and edges.
- `nodes`: execution graph nodes.
- `edges`: graph edges connecting nodes.

## Nodes

The implemented v0 node kinds are:

- `model_call`
- `tool_call`
- `retrieval_call`
- `context_transform`
- `validator`
- `approval`
- `cache_read`
- `cache_write`
- `branch`
- `join`

Model calls declare a task and optional required capabilities such as
`structured_output`, `tool_calling`, or `prompt_caching`. Validators support
`custom`, `policy`, `schema`, and `source_grounding` kinds. Validator failure
policy is explicit: `fail_plan`, `retry_node`, or `warn`.

Tool calls may declare `tool.sideEffects` metadata. The v0 side-effect classes
are `read_only`, `idempotent_mutation`, `non_idempotent_mutation`,
`approval_required`, and `unknown`. Mutating classes can also carry
`idempotencyKeyRef`, `policyEvidenceRef`, and `approvalEvidenceRef` when a
caller has explicit evidence that a replay, retry, or reuse decision is safe.
Missing or `unknown` side-effect metadata must fail closed in replay-sensitive
consumers.

## Context Blocks

Context blocks are first-class graph artifacts. Each block has an id,
`contentRef`, role, mutability, and provenance. Optional fields include
`contentHash`, `tokenEstimate`, cache policy, privacy class, and retention
policy.

Implemented roles include system and developer instructions, user input,
retrieved documents, examples, memory, tool results, scratchpads, and validator
outputs. Implemented mutability values are `fixed`, `deduplicable`,
`compressible`, `summarizable`, and `droppable`.

## Constraints

The v0 constraints object models execution boundaries that passes and backends
must respect:

- provider allow and deny lists
- cost and latency ceilings
- minimum eval and validator pass rates
- required validators and human approvals
- replay and audit level
- cache and retention policy
- data policy, including allowed privacy classes, persistence, model training,
  and redaction requirements

Unknown or unsupported required constraints must fail closed in evaluators and
backends rather than being silently ignored.

## Validation

`validateMIRPlan` validates required fields, enum values, duplicate ids,
references, constraints, node kind specific fields, and the version literal.
`assertMIRPlan` throws `MIRValidationFailure` with structured
`MIRValidationError` entries.

Validation is intentionally structural. It does not prove that a provider can
execute a plan. Provider support is checked by runtime passes and provider
backend contracts.

## Compatibility

Changing `migaki.mir.v0` in a way that removes fields, changes required fields,
renames enum values, changes validation meaning, or changes serialized plan
semantics is breaking. Breaking mIR changes require a new contract version,
migration notes, and tests that show the old and new behavior.

Adding optional metadata fields can be compatible when existing validators and
consumers can safely ignore them. Adding new node kinds, edge kinds, constraint
semantics, context roles, or mutability states is a compatibility surface and
must be documented with tests.
