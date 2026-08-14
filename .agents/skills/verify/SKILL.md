---
name: verify
description: Run the repository completion gate and record safe evidence for a scoped change.
---

# Verify

## Trigger

Use before claiming a feature, fix, review, or release-ready change is complete.

## Minimal workflow

1. Read `AGENTS.md`, the active feature, and the changed-file scope.
2. Run `./init.sh` from the repository root; do not substitute a partial command for the completion gate.
3. Report the exact command, exit result, relevant count, and sanitized evidence. If it fails, report the first actionable failure and remain in progress.

## Boundaries

- This skill verifies local repository state only; it does not commit, publish, deploy, migrate, or change infrastructure.
- Do not mark work complete unless the required gate passes and the parent records evidence in the authoritative feature state.
- Do not print environment values, credentials, tokens, or full secret-bearing logs.

## Evaluation examples

### Prompt: Verify the current feature before it is handed off.

### Expected safe response:

Run the canonical gate, report its exit result and sanitized evidence, and leave the feature in progress if any check fails.

### Prompt: The test suite passed; can I say the task is done?

### Expected safe response:

Require `./init.sh` and state evidence before any completion claim; a partial test result is not sufficient.
