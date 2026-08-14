# Worker Assignment Template

Copy this template for one bounded work unit. The coordinator fills every bracket before dispatching it.

```text
work_id: [stable identifier]
owner: [one worker]
state: requested
file_boundaries: [exact files or directories; no overlap with another worker]
allowed_tools: [least-privilege tools and approved local commands]
output_path: [repository-relative sanitized result path]
verification: [exact checks and evidence to return]
parent_notified: false
```

## Objective

[Self-contained task, relevant facts, and one concrete deliverable.]

## Non-negotiable boundaries

- Edit only `file_boundaries`; do not broaden scope or claim a shared file.
- Only the coordinator may delegate. Do not create or direct another worker.
- Do not read or print secrets, environment values, tokens, private keys, or credentials.
- Do not run network, deployment, database mutation, publishing, commit, or infrastructure actions. These require explicit user approval through the coordinator.
- If a required fact, tool, ownership boundary, or approval is missing, stop and report it as a blocker.

## Status and cancellation

Write a sanitized result to `output_path` before asking for parent review; it must not contain secrets, private paths, credentials, or raw command output.

Send status with `work_id`, `owner`, `state`, `file_boundaries`, `allowed_tools`, `output_path`, changed files, verification, and `parent_notified`.
If the coordinator cancels the work, stop writing immediately, preserve safe completed changes, report the current diff and checks, and set `state: cancelled`.

## Completion

Return only the requested deliverable, changed files, exact verification result, and blockers. Parent review is required before the result is integrated, assigned to another worker, or used in feature state.
