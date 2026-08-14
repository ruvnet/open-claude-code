# Flat Multi-Agent Coordination

Use this policy only when parallel work has disjoint file ownership and the coordinator can synthesize the result. A single agent remains the default for small work.

## Topology and capacity

- Use a flat team: only the coordinator may delegate.
- Workers must not delegate, spawn sub-workers, or transfer their assignment.
- Maximum active workers: 3. The coordinator counts separately and serializes work that shares a file boundary.
- The coordinator gives each worker a self-contained prompt; workers do not assume access to hidden chat context.

## Ownership

- Every assignment names one owner and non-overlapping file boundaries.
- There is one owner per file at a time. A worker may not edit a file outside `file_boundaries`.
- The coordinator resolves an ownership collision before work starts, records the blocked work unit, and redispatches only after boundaries are disjoint.

## Message protocol

Every assignment and status update uses these fields:

```text
work_id: stable task identifier
owner: one named worker
state: requested | running | completed | failed | cancelled | blocked
file_boundaries: exact files or directories the worker may change
allowed_tools: least-privilege tool list and approved commands
output_path: repository-relative path for sanitized findings or evidence
verification: exact checks and expected evidence
parent_notified: false until the coordinator receives the final status
```

The worker acknowledges boundaries before writing, writes a sanitized result to `output_path` before parent review, reports a concise result at every terminal state, and marks `parent_notified: true` only after the coordinator acknowledges receipt. The coordinator owns synthesis; workers return findings and evidence, not broad redesigns.

## Safety and approvals

- Prompts must prohibit reading, printing, copying, or embedding secrets. Do not include `.env` values or credentials in a work unit.
- Workers may perform only listed tools and local, reversible work. Network, deployment, database mutation, publishing, commits, and infrastructure actions require explicit user approval and must remain with the coordinator unless separately authorized.
- A worker must stop and report a blocker when scope, ownership, trust, or approval is unclear.

## Cancellation and review

1. The coordinator sends a cancellation message with `work_id` and reason.
2. The worker stops writing immediately, leaves completed safe changes intact, reports the current file list and verification, and sets `state: cancelled`.
3. The coordinator reviews the diff, test evidence, scope compliance, and secret safety before integrating or reassigning work.
4. Parent review is mandatory before a result can affect feature state, completion claims, external actions, or another worker's scope.
