# Session Handoff

## Restart Contract

- **Feature:** `feat-001`
- **Branch:** `main`
- **Objective:** Upgrade the repository to the complete harness profile and establish a passing baseline.
- **Status:** in-progress
- **Canonical next action:** Diagnose the eight Windows-specific project test failures, then rerun `./init.sh`.

## Verification Contract

- **Command:** `./init.sh`
- **Result:** Fail
- **Count:** 983/991
- **Captured:** 2026-08-14T21:47:32+12:00

State, policy, secret scanning, and static compile checks passed. The project test stage exited 1 with 983 passed and 8 failed. No passing baseline or completion claim is recorded.

## Harness Evidence

- Source skill acceptance tests: 12/12 passed, including all three agent-target throwaway scaffolds.
- Complete structural validation: 100/100; evaluation coverage: 14/14.
- Operational benchmark: 8/8 passed; automated assessment: 100/100.
- Secret scan: 469 tracked and prospective text files checked; no credential patterns found.
- Session-end check: exit 1 because `./init.sh` is not passing.
- Independent review is still required.

## Changed Scope

- Complete Codex-targeted harness scaffold.
- Strict state, lifecycle, context, memory, policy, hooks, coordination, skills, CI/security, and evaluation layers.
- Active feature specification under `specs/feat-001-project-baseline`.

## Risks / Boundaries

- **Protected files:** Never read, print, copy, or delete secrets, ignored environment files, or unrelated user assets.
- **Package manager:** Use npm for the active `v2` package; do not install or alter dependencies without explicit scope.
- **External mutations:** Commit, push, deployment, migration, production-data, and infrastructure changes require an explicit request.

## Next Session Startup

1. Read `AGENTS.md`, the state files, and `specs/feat-001-project-baseline`.
2. Run `node scripts/harness/session-start.mjs` and stop on any error.
3. Run `./init.sh` before expanding scope.
4. Keep `feat-001` in progress until the canonical gate passes with exact structured evidence.
