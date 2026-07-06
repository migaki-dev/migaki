# @migaki/codex

Codex lifecycle-hook adapter for Migaki execution observations.

This package reads one Codex hook JSON object from stdin, maps supported
turn-scoped events into generic `@migaki/runtime` execution events, and exits
`0` with no stdout. It is observation-only: it does not block, rewrite, cache,
replay, route, or otherwise change Codex behavior.

Supported hook events:

- `UserPromptSubmit`
- `PermissionRequest`
- `PreToolUse`
- `PostToolUse`
- `PreCompact`
- `PostCompact`
- `SubagentStart`
- `SubagentStop`
- `SessionStart`
- `Stop`

Most supported events scope runs by Codex turn:

```ts
runId = `codex-turn-${safeTurnId}`;
```

`SessionStart` is thread/session-scoped because Codex may emit it without a
normal turn id. Migaki records those events in an explicit session run instead
of silently merging them into a later turn:

```ts
runId = `codex-session-${safeSessionOrThreadId}`;
```

Artifacts are written through `LocalStore(".migaki")`:

- `.migaki/runs/<runId>/events.jsonl`
- `.migaki/runs/<runId>/graph.json`
- `.migaki/runs/<runId>/report.md`

Raw prompt text, permission request payloads, permission tool intent, pause
reasons, tool input, tool output, assistant messages, transcript paths, and
working directories are not persisted by default. The adapter stores stable
fingerprints and redaction metadata instead.

When `MIGAKI_CODEX_LOCAL_CONTEXT=1` is set by a trusted project hook, file
artifacts may also include local dogfood hints for the current machine:
repo-relative paths, simple line-range labels, safe command shapes, and a
git-blob or stat version hint. This mode is for local `.migaki` coaching only;
raw prompts, raw commands, raw outputs, transcript paths, and absolute paths are
still omitted.

`PermissionRequest` events are recorded as point-in-time observations of
approval and sandbox friction. Safe enum-like fields such as approval status,
permission decision, sandbox mode, sandbox permission mode, tool name, and
request ids may appear in metadata. Arbitrary request text, nested tool intent,
and pause reasons are fingerprinted and omitted.

`PreCompact` and `PostCompact` events are recorded as a start/finish pair for a
context-compaction boundary. Safe pressure metadata such as context-window
percent, token counts, trigger, and compact ids may appear in metadata. Raw
compact summaries, inspected-file summaries, acceptance criteria, reasons, and
payload text are fingerprinted and omitted.

`SubagentStart` and `SubagentStop` events are recorded as a start/finish pair
for delegated work with `subagent` operation kind and `workScope: "subagent"`
metadata. Safe subagent ids, agent names, parent session/turn ids, task ids, and
statuses may appear in metadata. Raw delegated prompts, tasks, results,
transcripts, and nested tool payloads are fingerprinted and omitted.

`SessionStart` events are recorded as point-in-time `session_boundary` nodes in
the session-scoped run. Safe startup/resume/clear/compact boundary labels,
session ids, thread ids, and source fields may appear in metadata. Raw startup
prompts, reasons, compact summaries, transcript paths, and payload text are
fingerprinted and omitted.

Read-like Codex tool inputs also emit redacted `file` artifacts when the hook
payload exposes a safe plain-string path field or a conservative read-like Bash
command:

- `Read.file_path`
- `Grep.path`
- `Glob.path`
- `LS.path`
- `Bash.command` for strict read-only forms using `cat`, `sed`, `nl`, `head`,
  `tail`, or `wc`

The adapter normalizes these paths only to compute a stable fingerprint. Raw
and normalized paths are omitted from events, graphs, and reports. Bash command
text is also omitted. Bash extraction fails closed for shell control flow,
unsafe tokens, or unsupported command shapes. When a normalized path can be
statted, the adapter records safe freshness metadata such as content digest,
mtime, and size. When command shape, range, and output transform are safely
knowable, it records a source-equivalence key. Missing or unsafe evidence is
reported with a safe unavailable reason, not raw path, command, or file content.
redirection, command substitution, glob-like path tokens, unknown commands, and
ambiguous arguments; the only supported command prefix is the repository's exact
`. scripts/env &&` or `source scripts/env &&` setup prefix.

## Dogfood Hooks

The repository-level `.codex/hooks.json` registers the supported hook
events and points them at the built hook entrypoint:

```sh
MIGAKI_CODEX_LOCAL_CONTEXT=1 node "$(git rev-parse --show-toplevel)/packages/codex/dist/hook.js"
```

Run `pnpm build` before trusting or using these hooks so the entrypoint exists.
Project hooks must also be reviewed and trusted in Codex, for example through
`/hooks` in the CLI. Hook trust is path-scoped, so Codex-created worktrees must
be trusted independently. Use `mise run migaki:doctor` from a worktree to check
project trust, hook trust, store writability, and latest real-run evidence.
