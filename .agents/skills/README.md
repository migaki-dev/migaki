# Agent Skills

Place reusable, task-specific agent skills in this directory.

Use a skill when instructions are too detailed or situational for the always-on `.agents/AGENTS.md` file. Keep each skill focused on one workflow, include clear trigger language, and prefer executable scripts or fixtures over large copied snippets.

Current skills:

- `migaki-issue-runner`: picks up an explicit GitHub issue or the next
  unblocked issue in a named milestone such as `v0`, claims it with a status
  label, implements it under repository standards, and opens an auto-merge PR
  that closes the issue.
