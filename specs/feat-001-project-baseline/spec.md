# Project Baseline

Feature ID: feat-001
Feature Directory: specs/feat-001-project-baseline
Status: in-progress

## Objective

Install the complete coding-agent harness and establish a passing, restartable baseline for the active `v2` Node.js package.

## Acceptance Criteria

1. All ten complete-harness subsystems are present and structurally validated.
2. The canonical `./init.sh` gate exits 0 from the repository root.
3. Exact verification evidence and a restartable handoff are recorded without secrets or private paths.

## Boundaries

- Harness artifacts and the existing `v2` verification path are in scope.
- Product behavior changes are out of scope until the baseline is healthy.
- Commit, push, deployment, migration, production data, and infrastructure mutation require a separate explicit request.

## Latest verification

- Command: `./init.sh`
- Captured: 2026-08-14T21:47:32+12:00
- Exit code: 1
- Result: Fail
- Count: 983/991 passed; 8 failed
- Note: State, policy, secret scanning, and static compile checks passed. Current test failures are Windows-specific path and formatting expectations.
