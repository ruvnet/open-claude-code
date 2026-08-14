# Context Map

## Purpose

Load only the information needed for the current decision. This keeps a new
session restartable without copying repository history, secret values, or an
unbounded transcript into agent context.

## Tier 1: Startup Metadata (always load)

Read these small, bounded files before making a change:

1. `AGENTS.md` and any nearest path-scoped instruction file.
2. `feature_list.json`, `progress.md`, and `session-handoff.md`.
3. `.agents/memory/active-feature.json` and the memory index when it exists.
4. The active feature's `spec.md` and `tasks.md`.

Do not load `.env`, `.env.*`, certificates, private keys, generated output, or
unrelated feature specifications. Report their presence only when a safety
check requires it; never place their contents in context, logs, memory, or a
test fixture.

**Budget:** at most 48 KiB of startup metadata. If a source exceeds its
documented cap, read its heading/index and follow the recovery pointer instead
of loading the whole file.

## Tier 2: Activated Instructions (load when a task needs them)

| Trigger | Load | Stop condition |
| --- | --- | --- |
| Editing application code | `.github/copilot-instructions.md` and the nearest relevant source/test files | The requested behavior and local conventions are clear. |
| Editing harness state or lifecycle | `feature-list.schema.json`, `scripts/harness/`, and the matching harness tests | The validator contract is clear. |
| Changing a documented workflow | The active feature's plan, contract, and affected operator document | The canonical command and evidence format are identified. |
| Using a project skill | Its `SKILL.md` under `.agents/skills` and only its required referenced material | The skill's required action is complete. |
| Delegating work | `.agents/coordination.md` and the assigned work-unit record | Ownership, outputs, tools, and verifier are explicit. |

**Budget:** 24 KiB for activated instructions. Keep a path-and-reason list for
anything larger, then read the smallest relevant section on demand.

## Tier 3: Task Resources (load just in time)

Read architecture documents, API contracts, migration history, source modules,
command output, or external documentation only for the active task. Prefer a
targeted search followed by one file or one section. Do not preload whole
directories, prior chat transcripts, dependency trees, or unrelated product
areas.

**Budget:** 48 KiB of task resources per decision. Summarize durable facts with
their file pointer; keep transient command output out of durable memory.

## Session Budget and Compaction

| Context block | Maximum | Recovery action |
| --- | ---: | --- |
| Startup metadata | 48 KiB | Read index/heading plus linked target. |
| Activated instructions | 24 KiB | Load only the triggered section. |
| Task resources | 48 KiB | Search, then inspect a narrow excerpt. |
| Working notes | 12 KiB | Replace with a dated decision summary. |
| **Total loaded artifacts** | **132 KiB** | Stop loading and compact before continuing. |

At 80% of the total budget, compact older working notes into: objective,
decisions, changed paths, verification evidence, risks, and next action. Keep
the current task and its immediately relevant files uncompressed. Delegated
work starts with its own bounded context and returns a disk-backed result,
rather than inheriting the coordinator's transcript.

## Explicit Invalidation Points

Reload the named source after these mutations; never rely on a stale in-memory
summary:

| Mutation | Invalidate and reload |
| --- | --- |
| `feature_list.json`, `progress.md`, or handoff changes | Startup metadata and active-feature state. |
| Specification, task, or contract changes | Active-feature plan and task scope. |
| `package.json`, lockfile, CI, or verification-script changes | Command contract, dependency assumptions, and verification evidence. |
| Schema, API, or storage changes | Shared contract, affected route/storage code, and focused tests. |
| Branch, rebase, merge, or worktree changes | Git status, ownership boundaries, and active task files. |
| Memory index/topic changes | Memory index and the modified topic only. |
| Policy, hook, skill, or coordination changes | The changed policy/instruction plus its validator or evaluation test. |

## Context Exit Criteria

Before ending a session, retain only restartable state: active objective,
durable decisions, changed paths, verification command/result, open risks, and
one concrete next action. Everything else is reloaded from the repository when
needed.
