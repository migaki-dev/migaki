---
name: migaki-issue-runner
description: Pick up and complete a GitHub issue from Migaki by explicit issue number or by the next open, non-blocked issue in the repository-wide queue. Use when asked to work an issue queue, continue a loop/goal that processes issues, claim an issue with a label semaphore, check active work and dependencies, optionally scope by an explicit milestone, consult the wiki for product conflicts, implement under AGENTS.md and CONTRIBUTING.md, open an auto-merge PR, and ensure the issue closes after merge.
---

# Migaki Issue Runner

Use this skill to run GitHub issue work for `migaki-dev/migaki` one issue at a
time. It supports either:

- an explicit issue number, for example `#42`
- the next open, non-blocked issue in the repository-wide queue
- the next unblocked issue in a named milestone, only when the user explicitly
  requests that milestone

If the user asks for the current stage, next issue, issue queue, or loop without
naming a specific issue or milestone, use the repository-wide open issue queue.
Do not restrict selection to milestone `v0` unless the user explicitly asks for
that milestone.

## State Labels

Use labels as the issue semaphore. By default, treat the semaphore as
repository-wide: do not start any new issue while another issue is claimed or in
review. Create or repair these labels idempotently before the first run:

```sh
ensure_label() {
  name=$1
  color=$2
  description=$3
  gh label create "$name" --repo migaki-dev/migaki --color "$color" \
    --description "$description" ||
    gh label edit "$name" --repo migaki-dev/migaki --color "$color" \
      --description "$description"
}

ensure_label "status:ready" 0E8A16 "Ready to be picked up"
ensure_label "status:claimed" D93F0B "Claimed by an agent or contributor"
ensure_label "status:in-review" 1D76DB "Implementation PR is open"
ensure_label "status:blocked" B60205 "Blocked by dependencies or external state"
ensure_label "status:needs-user" D876E3 "Needs user/product decision"
```

Meanings:

- `status:ready`: selectable if dependencies are closed.
- `status:claimed`: active implementation semaphore. Do not start another issue.
- `status:in-review`: PR exists and is waiting for CI, review, or merge. Do not
  start another issue.
- `status:blocked`: skip until the blocker is resolved.
- `status:needs-user`: skip until the user answers or product docs are updated.

## Dependency Format

Read dependencies from the issue body. Recognize these lines case-insensitively:

```md
Depends on: #12, #18
Blocked by: #12
Dependencies:
- #12
- #18
```

An issue is unblocked only when every referenced dependency issue is closed.
If dependency text is ambiguous, comment with the ambiguity, add
`status:needs-user`, and stop.

## Workflow

### 1. Determine Scope

Resolve the user request into one of these scopes:

- **Explicit issue**: work only that issue, even if it is outside a milestone.
- **Repository-wide queue**: work the next open, non-blocked issue in the
  repository, regardless of milestone. Use this by default when the user asks
  for the current stage, next issue, issue queue, or loop without naming a
  specific issue or milestone.
- **Milestone queue**: work the next unblocked issue in the named milestone only
  when the user explicitly names a milestone, for example `v0`.

Do not silently reinterpret outdated stage names as milestones. If issue text
uses an old stage name, keep the selected scope unchanged and update issue
wording only when that is part of the requested scope or the user confirms it.

### 2. Prepare The Repository

Start from a clean local checkout:

```sh
git status --short --branch
git switch main
git fetch origin main
git merge --ff-only origin/main
```

Read `.agents/AGENTS.md` and `CONTRIBUTING.md` before implementation. Follow
their TDD, fake-over-mock, versioning, toolchain, hook, and handoff rules.

### 3. Check For Active Work

Do not claim a new issue if any issue work is already active, unless the user
explicitly allows parallel work.

Check claimed and in-review issues repository-wide:

```sh
gh issue list --repo migaki-dev/migaki --state open \
  --label status:claimed --json number,title,assignees,labels,updatedAt
gh issue list --repo migaki-dev/migaki --state open \
  --label status:in-review --json number,title,assignees,labels,updatedAt
```

For an explicit issue, also check that issue's labels and linked PRs.

Always check open PRs:

```sh
gh pr list --repo migaki-dev/migaki --state open \
  --json number,title,headRefName,isDraft,labels,closingIssuesReferences,mergeStateStatus
```

Treat any open PR as active issue work if it closes an issue, carries a relevant
status label, or uses a matching `codex/issue-*` branch. If active work exists,
report it and stop. In loop mode, continue the active PR/issue rather than
claiming a new one.

### 4. Pick The Issue

For an explicit issue:

```sh
gh issue view <issue-number> --repo migaki-dev/migaki \
  --json number,title,body,state,labels,assignees,milestone
```

For the repository-wide queue:

```sh
gh issue list --repo migaki-dev/migaki --state open --limit 100 \
  --json number,title,body,labels,assignees,milestone,createdAt,updatedAt
```

For an explicitly named milestone queue:

```sh
gh issue list --repo migaki-dev/migaki --milestone "<milestone>" --state open \
  --limit 100 --json number,title,body,labels,assignees,milestone,createdAt,updatedAt
```

Select the first issue that satisfies all conditions:

- has `status:ready` or no status label
- does not have `status:claimed`, `status:in-review`, `status:blocked`, or
  `status:needs-user`
- has no open dependency issues
- is not already associated with an open PR
- is atomic enough to complete in one focused PR

Prefer lower issue numbers unless the issue labels or body define priority. If
no issue is ready, report the blocked/empty queue and stop.

### 5. Claim The Issue

Immediately before claiming, repeat the active-work checks. If still clear,
claim the issue:

```sh
gh issue edit <issue-number> --repo migaki-dev/migaki \
  --add-label status:claimed --remove-label status:ready
gh issue comment <issue-number> --repo migaki-dev/migaki \
  --body "Claimed for implementation by Codex. I will open a PR that closes this issue."
git switch -c codex/issue-<issue-number>-<short-slug>
```

If the label edit fails or another actor claimed the issue, stop and report the
race. Do not steal stale labels without explicit user approval.

### 6. Resolve Product Context

Use the issue as the source of implementation scope. Consult the repository
wiki when the issue references product language, mIR semantics, stage scope,
provider behavior, evidence format, or architecture.

Suggested wiki read path:

```sh
tmpdir=$(mktemp -d)
git clone --depth=1 https://github.com/migaki-dev/migaki.wiki.git "$tmpdir/wiki"
rg -n "<issue keywords>" "$tmpdir/wiki"
```

If the issue, wiki, `AGENTS.md`, or `CONTRIBUTING.md` conflict:

1. Do not guess.
2. Comment on the issue with the conflict summary.
3. Add `status:needs-user` and remove `status:claimed`.
4. Ask the user whether to update the issue, the wiki, or both.

Only edit wiki or issue scope after the user confirms the intended product
decision.

### 7. Implement

Follow the repo standards:

- write the failing test, fixture, or invariant check first for behavior work
- use fakes over mocks for providers, gateways, clocks, filesystems, transports,
  caches, and container runtimes
- inject clocks so tests can time travel
- keep package boundaries semantically meaningful
- keep commits focused and signed
- run the narrowest relevant checks, then `mise run check`

If the issue proves non-atomic, stop before broadening the scope. Comment with a
proposed split, add `status:needs-user`, and ask the user to confirm whether to
split or rewrite the issue.

### 8. Open The PR

Before pushing:

```sh
git status --short --branch
mise run check
```

Commit, push, and create the PR. The PR body must include a closing keyword:

```md
Closes #<issue-number>
```

After PR creation:

```sh
gh issue edit <issue-number> --repo migaki-dev/migaki \
  --remove-label status:claimed --add-label status:in-review
gh pr merge <pr-number> --repo migaki-dev/migaki --auto --squash
```

If auto-merge cannot be enabled, inspect the reason. Fix check failures when
they are in scope. If blocked by permissions, branch protection, missing user
decision, or external state, comment on the issue/PR and report the blocker.

### 9. Finish After Merge

Wait for required checks when feasible. Once the PR merges:

1. Confirm the PR merge commit is verified.
2. Confirm the issue closed through `Closes #<issue-number>`.
3. If the issue stayed open, close it manually with a comment linking the merged
   PR.
4. Remove active status labels from the issue if it is still visible as open.
5. Fast-forward local `main`.
6. Report PR URL, issue number, checks run, and any residual risk.

### 10. Loop Mode

When running under a loop/goal:

- If there is any open issue-work PR, continue that PR first.
- If any issue is `status:claimed`, continue that issue first.
- If the last PR merged and the issue closed, return to active-work checks and
  pick the next unblocked issue in the same queue scope.
- Stop when the queue is empty, all remaining issues are blocked, a user
  decision is required, or a non-recoverable check/permission failure occurs.

Never claim a second issue while one issue is claimed or in review unless the
user explicitly allows parallel work.
