# Migaki Project Profile

Use this repository-local profile with generic project automation skills such as
`project-main-loop`, `project-issue-to-pr`, `project-pr-review-merge`, and
`project-retrospective`. Resolve relative paths from the repository root.

```yaml
project_name: Migaki
project_slug: migaki
scm: github
repo: migaki-dev/migaki
repo_path: .
default_branch: main
worktree_parent: ..
wiki_url: https://github.com/migaki-dev/migaki/wiki

scm_commands:
  github: Prefer GitHub app tools exposed by tool_search; use gh as fallback.

objective: >
  Optimize logical AI workflows and observed agent trajectories under explicit
  constraints, then emit auditable evidence for why each optimization, reuse
  decision, lowering choice, or adaptation is acceptable.

source_policy: >
  Treat required_sources as an authority index for targeted reads, not a
  startup preload list. Use GitHub metadata, file lists, headings, rg, recent
  diffs, and small excerpts before reading full files. Read a full source only
  when a specific decision, edit, review finding, or completion check requires
  it. Dependency text in issue bodies is authoritative alongside native GitHub
  issue dependencies.

required_sources:
  - .agents/AGENTS.md
  - README.md, especially Project Scope
  - CONTRIBUTING.md
  - docs/README.md
  - docs/mir-v0.md
  - docs/pass-contracts-v0.md
  - docs/provider-capabilities-v0.md
  - docs/evidence-bundles-v0.md
  - docs/adaptive-policies-v0.md
  - docs/cli-v0.md
  - docs/migaki-artifacts/README.md when promoted artifacts are touched
  - wiki Project Scope
  - wiki v0 Roadmap
  - wiki Whitepaper Notes
  - wiki Risks
  - wiki Examples
  - wiki Benchmarks
  - whitepaper v0.4 Initial Scope
  - whitepaper v0.4 Verification
  - whitepaper v0.4 Long-Term Vision
  - relevant package READMEs, tests, fixtures, examples, and wiki pages for the affected area

local_ci:
  canonical: . scripts/env && mise run check
  fallback:
    - . scripts/env && mise run format:check
    - . scripts/env && mise run lint
    - . scripts/env && mise run typecheck
    - . scripts/env && mise run test
    - . scripts/env && mise run test:e2e
    - . scripts/env && mise run build
    - . scripts/env && mise run bootstrap:check

status_labels:
  ready: status:ready
  claimed: status:claimed
  blocked: status:blocked
  review: status:in-review
  needs_user: status:needs-user
  done: closed or merged
  stale: stale claim comment or status:needs-user

priority_labels:
  - priority:p0
  - priority:p1

area_labels:
  - area:mir
  - area:repo
  - area:context
  - area:runtime
  - area:evidence
  - area:providers
  - area:cli
  - area:examples
  - area:evaluation

kind_labels:
  - kind:foundation
  - kind:runtime
  - kind:schema
  - kind:pass
  - kind:provider
  - kind:cli
  - kind:docs
  - kind:example

domain_focus:
  issue_selection:
    - Enforce the repository-wide semaphore before new work: do not start new issue work while any open issue is status:claimed or status:in-review.
    - Prefer status:ready stage:v0 work, with priority:p0 before priority:p1.
    - Treat dependency text in issue bodies as authoritative alongside native GitHub issue dependencies; skip issues with open blockers.
    - Prefer PR-sized work that tightens mIR, runtime, pass, evidence, provider, CLI, or evaluation contracts for the v0 demo.
  review_checks:
    - Verify TypeScript exports, contract docs, schemas, fixtures, tests, and README claims stay aligned.
    - Check every optimization or lowering claim has evidence, warnings, validators, or explicit acceptance criteria.
    - Verify evidence privacy: raw prompts, tool inputs, tool outputs, provider responses, secrets, and local file paths must not leak into default artifacts.
    - For provider, gateway, or adapter work, fail closed when capabilities are unknown and keep provider-specific behavior out of core planning.
  safety_constraints:
    - Use pnpm only through mise tasks or mise exec; do not run npm, yarn, bun, or bare workspace tools.
    - Do not introduce live model provider, gateway, registry, Docker network, or cloud dependencies in unit tests.
    - Treat Migaki Codex dogfooding as observation and advice only; hooks must not mutate prompts, cache work, replay tool calls, skip reads, or parallelize actions.
    - Do not claim optimization from token reduction alone; require validator, benchmark, or evidence-bundle support.

completion_criteria:
  - The v0 RAG workflow can be represented as mIR, optimized by deterministic passes, lowered, validated, replayed, and reported with evidence.
  - mIR, pass, runtime, provider, evidence, adaptive policy, and CLI contract docs match the implemented TypeScript exports and fixtures.
  - Local . scripts/env && mise run check and required GitHub code-quality checks pass for merged work.
  - Open priority:p0 stage:v0 issues are complete, blocked with specific next steps, or intentionally deferred.
  - Wiki and repository docs are concise, current, and free of unsupported optimization claims.
```
