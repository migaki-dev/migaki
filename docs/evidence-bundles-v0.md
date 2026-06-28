# Evidence Bundles v0

## Contracts

- Evidence event contract: `migaki.evidence-event.v0`
- Evidence bundle contract: `migaki.evidence-bundle.v0`
- Mock trace artifact contract: `migaki.trace-artifact.v0`
- Owning package: `@migaki/runtime`
- Source of truth: `packages/runtime/src/evidence.ts`,
  `packages/runtime/src/evidence-bundle.ts`, and
  `packages/runtime/src/mock-trace.ts`

Living design context is in the
[Execution Evidence Bundles wiki page](https://github.com/migaki-dev/migaki/wiki/Execution-Evidence-Bundles).
This document describes the implemented repository contract.

## Evidence Events

Every evidence event has:

- `version`: `migaki.evidence-event.v0`
- `id`, `kind`, and `summary`
- `source`: `cli`, `pass`, `provider`, `runtime`, or `validator`
- `privacy`: privacy class, replay mode, and optional retention policy
- `redaction`: mode, reason, and optional refs
- optional refs plus a kind-specific payload

Implemented event kinds are:

- `pass_decision`
- `warning`
- `capability_assumption`
- `context_change`
- `estimate`
- `validator_result`
- `routing_decision`
- `retry_fallback_decision`
- `policy_decision`

Event validation checks JSON shape, required fields, enum values, and version.

## Evidence Bundles

An `EvidenceBundle` has `migaki.evidence-bundle.v0` and records:

- run id and creation time
- original and optimized plan references
- pass summaries
- full plan diff and context diff entries
- warnings
- grouped evidence sections for estimates, provider assumptions, routing,
  retry/fallback, policy decisions, and validator results
- replay metadata
- redaction records
- export mode: `full`, `metadata_only`, or `redacted`

`createEvidenceBundle` groups event sections deterministically and applies
export-mode behavior. In `metadata_only` mode, full-trace evidence events are
omitted and recorded as redactions. In `redacted` mode, sensitive events become
redacted event shells and redaction records.

Serialization is deterministic for golden fixtures and CI artifacts. Validation
returns structured errors or throws `EvidenceBundleValidationFailure` through
the parsing helpers.

## Mock Trace Artifacts

`MockExecutionTraceArtifact` has `migaki.trace-artifact.v0` and captures
deterministic mock-backed execution:

- artifact id and trace id
- backend contract and mock backend version
- plan reference
- lowered execution steps and result snapshot
- fixture responses
- timing, usage estimates, validator results, redactions, and optional evidence
  bundle reference

`replayMockExecutionTrace` replays the trace through the deterministic mock
backend and reports `matched` or `mismatched` plus mismatch details. Trace
artifacts are for deterministic replay checks, not live provider traces.

## Privacy and Redaction

Evidence must say what it omitted or redacted. Redaction records include path,
mode, reason, optional event id, optional privacy class, and optional refs.
Sensitive privacy classes are treated conservatively when redacted exports are
created.

Evidence bundles should carry metadata needed to audit decisions without
copying prompts, customer data, raw provider responses, or credentials into
fixtures by default.

## Compatibility

Changing event kinds, required event fields, bundle section names, redaction
semantics, replay metadata shape, or deterministic serialization meaning is
breaking. Adding optional event fields or new grouped sections can be
compatible only when older consumers can safely ignore them.

Breaking evidence changes require a new contract version, migration notes, and
golden fixture tests. Serialized artifacts must always include their version
fields.
