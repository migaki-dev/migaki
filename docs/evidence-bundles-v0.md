# Evidence Bundles v0

## Contracts

- Evidence event contract: `migaki.evidence-event.v0`
- Evidence bundle contract: `migaki.evidence-bundle.v0`
- Evidence privacy policy contract: `migaki.evidence-privacy-policy.v0`
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
- privacy policy reference: export matrix version, export mode, and whether
  full-trace export was explicitly opted into
- export mode: `full`, `metadata_only`, or `redacted`

`createEvidenceBundle` groups event sections deterministically and applies
export-mode behavior. The default export mode is `metadata_only`. In
`metadata_only` mode, full-trace evidence events are omitted and recorded as
redactions. In `redacted` mode, sensitive events become redacted event shells and
redaction records. `full` exports require explicit code opt-in with
`allowFullTraceExport: true`.

## Evidence Privacy Export Matrix

The `migaki.evidence-privacy-policy.v0` matrix defines what raw sensitive fields
may appear in each export mode:

| Field               | `metadata_only` | `redacted`                             | `full`                                          |
| ------------------- | --------------- | -------------------------------------- | ----------------------------------------------- |
| Prompts             | omitted         | redacted shell or record               | may appear only with explicit full-trace opt-in |
| Tool inputs         | omitted         | redacted shell or record               | may appear only with explicit full-trace opt-in |
| Tool outputs        | omitted         | redacted shell or record               | may appear only with explicit full-trace opt-in |
| Provider responses  | omitted         | redacted shell or record               | may appear only with explicit full-trace opt-in |
| File paths          | omitted         | redacted shell, fingerprint, or record | may appear only with explicit full-trace opt-in |
| Customer data       | omitted         | redacted shell or record               | may appear only with explicit full-trace opt-in |
| Credentials         | omitted         | redaction record only                  | raw credentials must not appear                 |
| Local machine paths | omitted         | redacted shell, fingerprint, or record | may appear only with explicit full-trace opt-in |

Default local reports, promoted artifacts, evidence bundles, comparison reports,
and reuse-decision artifacts must use `metadata_only` or `redacted` policy
references unless a caller deliberately requests a full export in code.
Full-trace opt-in is never inferred from CLI defaults, promotion, comparison, or
reuse advice.

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

## Gateway and Durable Replay Evidence

Gateway-owned routing, fallback, budget enforcement, retry policy, cache backend
behavior, and observability must be represented as assumptions when Migaki
delegates them during lowering. Migaki evidence records what it planned,
validated, downgraded, or delegated; it does not prove a gateway's live policy,
provider route, telemetry retention, cache hit, invoice, or failover behavior.

Durable workflow engines own workflow history and state replay. Migaki evidence
may carry workflow, run, or step handles so a durable runtime can correlate
Migaki decisions with its history, but Migaki evidence bundles are not the
durable history store. The detailed ownership contract is
[Gateway and Durable Replay Boundaries v0](./gateway-durable-boundaries-v0.md).

## Privacy and Redaction

Evidence must say what it omitted or redacted. Redaction records include path,
mode, reason, optional event id, optional privacy class, and optional refs.
Sensitive privacy classes are treated conservatively when redacted exports are
created.

Evidence bundles should carry metadata needed to audit decisions without
copying prompts, customer data, raw provider responses, or credentials into
fixtures by default.

## File-Reuse Evidence Semantics

Repeated redacted file fingerprints are useful coaching evidence, but they are
advisory by default. A repeated fingerprint means Migaki observed the same
caller-safe redacted identity more than once; it does not prove that the file was
unchanged, that two source commands returned equivalent bytes, or that a future
read can be skipped.

The `file_reuse` opportunity report represents this explicitly:

- repeated identity is `observed` through a `redacted_fingerprint`
- freshness is `unknown` unless the run captures comparable file-version,
  content-digest, or modification-time evidence for each read-like call
- freshness is `unavailable` when the adapter attempted to capture a safe
  signal but can only report a safe unavailable reason
- source equivalence is `unknown` unless the run captures enough evidence to
  prove the commands, ranges, and output transforms are equivalent
- source equivalence is `unavailable` when command shape, range, or output
  transform evidence cannot be safely established
- automatic skip is disallowed by default, including while freshness or source
  equivalence is `unknown` or `unavailable`

`file_reuse` stays `needs_review` even when both evidence fields are verified.
Reports and advice may coach an agent to check prior context or read the
smallest missing range once, but they must not imply cache, replay, suppressed
reads, or other hidden execution behavior.
File-reuse decision artifacts inherit the `metadata_only` evidence privacy
policy: raw file paths, commands, tool inputs, and tool outputs stay omitted or
represented by redacted fingerprints plus explicit omission records.

## Observed Trajectory Comparison Semantics

The `migaki.observed-trajectory-comparison.v0` contract compares two
`migaki.execution-graph.v0` runs without executing, replaying, caching, or
skipping work. It classifies exact reusable model-call nodes, exact reusable
tool-call nodes, changed nodes, and blocked reuse candidates. Reusable means
"potentially reusable under the comparison contract"; it is not permission to
serve prior outputs or suppress future execution.

Every candidate records cache-key equality, dependency equality, runtime
compatibility, validator requirements, policy constraints, freshness
constraints, status, and side-effect checks. Unknown or missing evidence fails
closed into a blocked candidate with blocker reasons and warning metadata.
Estimated avoidable tokens, cost, and latency are included only when the
observed graph already carries those metrics.
Comparison artifacts include a `privacyPolicy` reference to
`migaki.evidence-privacy-policy.v0` and use `metadata_only` by default; they do
not carry raw prompts, tool payloads, provider responses, credentials, or local
machine paths.

Tool-call comparison uses the same side-effect vocabulary as mIR:
`read_only`, `idempotent_mutation`, `non_idempotent_mutation`,
`approval_required`, and `unknown`. Read-only tool calls can be classified as
potentially reusable when the other checks pass. Idempotent or
approval-required mutations require matching idempotency, policy, and approval
evidence as applicable. Non-idempotent, unknown, or under-evidenced tool
operations remain blocked. Native GitHub, tool, provider, or other API
mutations are never replayable from observation alone; they require explicit
policy evidence before any narrower decision can be reported.

Execution-report `parallelism` opportunities intentionally do not assign these
classes. They are sequence-only dependency-review prompts, remain `blocked`, and
require a reviewer or later pass to prove data independence, side-effect class,
and user-visible ordering before any parallel execution is allowed.

## Compatibility

Changing event kinds, required event fields, bundle section names, redaction
semantics, replay metadata shape, or deterministic serialization meaning is
breaking. Adding optional event fields or new grouped sections can be
compatible only when older consumers can safely ignore them.

Breaking evidence changes require a new contract version, migration notes, and
golden fixture tests. Serialized artifacts must always include their version
fields.
