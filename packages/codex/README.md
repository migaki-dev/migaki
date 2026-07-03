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
- `Stop`

The adapter scopes runs by Codex turn:

```ts
runId = `codex-turn-${safeTurnId}`;
```

Artifacts are written through `LocalStore(".migaki")`:

- `.migaki/runs/<runId>/events.jsonl`
- `.migaki/runs/<runId>/graph.json`
- `.migaki/runs/<runId>/report.md`

Raw prompt text, permission request payloads, permission tool intent, pause
reasons, tool input, tool output, assistant messages, transcript paths, and
working directories are not persisted by default. The adapter stores stable
fingerprints and redaction metadata instead.

`PermissionRequest` events are recorded as point-in-time observations of
approval and sandbox friction. Safe enum-like fields such as approval status,
permission decision, sandbox mode, sandbox permission mode, tool name, and
request ids may appear in metadata. Arbitrary request text, nested tool intent,
and pause reasons are fingerprinted and omitted.

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
redirection, command substitution, glob-like path tokens, unknown commands, and
ambiguous arguments; the only supported command prefix is the repository's exact
`. scripts/env &&` or `source scripts/env &&` setup prefix.

## Dogfood Hooks

The repository-level `.codex/hooks.json` registers the supported hook
events and points them at the built hook entrypoint:

```sh
node "$(git rev-parse --show-toplevel)/packages/codex/dist/hook.js"
```

Run `pnpm build` before trusting or using these hooks so the entrypoint exists.
Project hooks must also be reviewed and trusted in Codex, for example through
`/hooks` in the CLI.
