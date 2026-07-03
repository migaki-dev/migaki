# Adaptive Policies v0

## Contracts

- Meta-observation contract: `migaki.meta-observation.v0`
- Policy diff contract: `migaki.policy-diff.v0`
- Policy proposal contract: `migaki.policy-proposal.v0`
- Policy bundle contract: `migaki.policy-bundle.v0`
- Owning package: `@migaki/runtime`
- Source of truth: `packages/runtime/src/adaptive-policy.ts`

Adaptive policies are Migaki's first self-observation contract. They let Migaki
record safe observations about its own reports and advice, propose explicit
policy changes, validate those changes, and accept policy bundles without
silently changing execution behavior.

## v0 Boundary

The v0 contract is advice-only. Adaptive policy artifacts may influence future
advice ranking, suppression, or wording after validation, but they must not
cache, replay, skip reads, parallelize operations, call providers, or change
execution plans.

Every proposal and accepted bundle carries:

- `scope: "advice"`
- `safety.effectMode: "advice_only"`
- `safety.prohibitedEffects`: `cache`, `parallelize`, `replay`, and
  `skip_reads`
- rollback text explaining how to disable the policy
- privacy and redaction metadata

## Meta-Observations

A `MetaObservation` records Migaki observing its own artifacts. It includes:

- version, id, observation time, and summary
- source kind such as `advice`, `codex_wrapper`, `execution_report`, or
  `policy_validator`
- subject kind such as `advice`, `opportunity`, `policy`, or `run`
- a signal such as `advice_emitted`, `advice_injected`,
  `advice_outcome_observed`, `opportunity_observed`, `policy_proposed`,
  `policy_validated`, or `policy_applied`
- evidence refs to reports, graphs, validators, proposals, or bundles
- privacy and redaction metadata

Meta-observations must use safe labels and references. They must not persist raw
prompts, file paths, shell commands, tool outputs, provider responses, customer
data, or credentials.

## Policy Proposals and Diffs

An `AdaptivePolicyProposal` is not active behavior. It contains:

- the meta-observation ids and run ids that caused the proposal
- a human-readable summary and rationale
- an `AdaptivePolicyDiff` with each rule addition, update, or removal
- validation status and validator references
- safety metadata and rollback text

An `AdaptivePolicyDiff` records each change with:

- operation: `add_rule`, `update_rule`, or `remove_rule`
- JSON path
- optional before/after values
- rationale, risk, and evidence refs

Policy diffs are intended for review, fixture testing, and later validator
gates. A proposal remains inert until validation and acceptance create a policy
bundle.

## Policy Bundles

An `AdaptivePolicyBundle` is the accepted, auditable policy artifact. It
contains:

- bundle id, name, status, creation time, and optional acceptance time
- provenance linking back to proposal id, policy diff id, and meta-observation
  ids
- evidence refs
- advice-targeted rules
- the same advice-only safety contract used by proposals
- privacy and redaction metadata

Implemented v0 rule targets are:

- `advice_ranking`
- `advice_suppression`
- `advice_wording`

Implemented v0 rule actions are:

- `emphasize`
- `deemphasize`
- `suppress`
- `annotate`

## Fixture

The golden fixture
`packages/runtime/src/fixtures/adaptive-policy-loop.json` demonstrates the first
complete loop:

1. a meta-observation for redacted file-reuse advice,
2. a proposal to add an advice-ranking rule,
3. an accepted bundle containing that rule.

The fixture intentionally contains no raw paths or commands. Tests validate all
three artifacts and reject proposals that do not explicitly forbid execution
effects.

## Compatibility

Changing required fields, version strings, safety semantics, validation
semantics, or serialized meaning is breaking. Adding optional fields can be a
compatible v0 extension only when older consumers can safely ignore them.

Policy artifacts are local and pre-release. Future work may add loaders,
validators, proposal engines, and advice integration, but those features must
preserve the v0 audit trail and must not introduce hidden execution behavior.
