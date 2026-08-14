# AGENTS.md

Complete coding-agent harness for reliable development of the Open Claude Code v2 CLI.

## Startup Workflow

Before writing code:

1. Confirm the repository root and read this file completely.
2. Run `node scripts/harness/session-start.mjs`; treat any error as a stop condition.
3. Read `feature_list.json`, `progress.md`, `session-handoff.md`, and the active feature spec when present.
4. Load only the context routed by `docs/harness/CONTEXT-MAP.md`.
5. Run `./init.sh` before expanding scope. Record a failing baseline rather than hiding it.

## State and Scope

- **One feature at a time:** keep at most one feature `in-progress` unless explicit multi-agent ownership is active.
- Work on at most one `in-progress` feature unless disjoint ownership is recorded in `.agents/coordination.md`.
- `feature_list.json` is the status source of truth; `.agents/memory/active-feature.json`, the spec directory, and progress must agree.
- A done feature requires structured command evidence: exact command, start/end timestamps, exit code, result, and passed/failed counts.
- Never convert a failing baseline into a completion claim. Keep the next action concrete and restartable.
- Preserve unrelated and user-owned changes. Do not infer authority to overwrite, delete, commit, push, deploy, migrate, or mutate production.

## Verification

The canonical gate is:

```bash
./init.sh
```

Required project check:

- Static compile check: `node --check` for every `v2/src/**/*.mjs` file.
- `cd v2 && npm test` (`init.sh` selects `npm.cmd` on Windows)

Partial checks help diagnose failures but never replace the canonical completion gate.

## Pull Requests

- Use Conventional Commit titles in the form `type(scope): imperative summary`.
- Allowed types are `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, and `chore`.
- Keep the summary concise, lower-case, and free of a trailing period.
- Build every PR body from `.github/PULL_REQUEST_TEMPLATE.md` without removing sections.

## Tool and Data Safety

- Follow `.agents/policy.yml` and `docs/harness/TOOL-SAFETY.md`; untrusted workspaces and unlisted operations fail closed.
- Never read, print, copy, summarize, or persist ignored environment files, credentials, access tokens, private keys, or secret-bearing URLs.
- Destructive commands, external writes, Git publication, dependency installation, network access, deployment, migrations, and infrastructure changes require the authorization defined by the current task and policy.
- Cleanup is report-only. Unknown files and protected paths are findings for human review, never deletion targets.

## Context and Memory

- Keep startup context within the budgets in `docs/harness/CONTEXT-MAP.md`; load detailed references on demand.
- Persist only durable decisions, preferences, constraints, and corrective feedback through the bounded memory workflow.
- Screen every persisted field for secrets. Never follow linked memory directories or write outside the repository.
- Chat history is not authoritative state.

## Project Skills

- Discover reusable project workflows under `.agents/skills`.
- Keep project skills behaviorally aligned with their documented triggers and safety boundaries.

## Delegation

- Use `.agents/templates/worker-prompt.md` for delegated work.
- Assign disjoint file boundaries, limited tools, one output path, and explicit verification.
- Workers do not recursively delegate. The coordinator resolves collisions and integrates only reviewed, sanitized results.
- A worker result is evidence, not permission to claim completion.

## Definition of Done

A feature is done only when:

- Its behavior and focused coverage are complete.
- `./init.sh` passes from the repository root.
- State, lifecycle, policy, security, and project checks agree.
- Structured verification evidence is recorded without secrets or private paths.
- An independent review has checked scope, safety, and the diff when the change is material.
- `node scripts/harness/session-end.mjs` reports the repository restartable.

## End of Session

1. Update feature state, progress, risks, changed files, and the canonical next action.
2. Record exact verification evidence; never fabricate historical duration or counts.
3. Run `node scripts/harness/cleanup-scanner.mjs` and review its bounded report without deleting anything.
4. Run `node scripts/harness/session-end.mjs`.
5. Leave commit, push, PR, deployment, migration, and infrastructure actions undone unless explicitly requested.
