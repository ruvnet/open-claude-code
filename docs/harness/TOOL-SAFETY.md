# Tool Safety Policy

## Source of Truth

`.agents/policy.yml` is the declarative, fail-closed tool policy. It uses the
JSON subset of YAML deliberately: JSON is valid YAML, and restricting the
format lets the repository validate every field without a permissive parser or
an extra runtime dependency.

Run `npm run harness:policy:validate` after changing the policy. The validator
is read-only and rejects malformed, incomplete, broad, or conflicting rules.

## Decision Model

Rules are evaluated in this order: **deny**, **approval**, **allow**. Anything
not named by an allow rule is denied. An untrusted workspace, unknown tool,
concurrent mutation, and recursive delegation are denied by default.

| Category | Policy decision | Requirement |
| --- | --- | --- |
| Non-secret inspection | Allow | Read only the smallest relevant non-protected path. |
| File creation, edits, overwrite, move, delete, or dependency install | Approval | The current task must explicitly authorize the target and scope. |
| User-owned assets, Git metadata, dependencies, and build output | Approval | Confirm the exact path and preserve user-owned work. |
| `.env`, nested environment files, certificates, keys, and credentials | Deny | Do not read, print, log, persist, upload, or rewrite their contents. |
| Destructive shell/database commands | Approval | Confirm exact target, recovery path, and user authorization first. |
| Network/package downloads | Approval | Confirm purpose, destination, and trust boundary first. |
| Commit, push, PR, deploy, migration, production-data, or infrastructure mutation | Approval | Require an explicit current-task request; never infer it from coding work. |

Approval means a current, explicit user authorization for the named action. It
does not turn a secret-path denial into approval, does not permit a broad
wildcard target, and does not bypass repository or platform permissions.

## Operating Rules

1. Classify every call using its arguments, not only the tool name. A search of
   a protected path is sensitive even if search is normally read-only.
2. Serialize all mutations. Parallelize only independent, non-secret,
   read-only inspection.
3. Do not use shell indirection, encoded commands, or alternate tools to evade
   a denied or approval-required action.
4. Keep policy output metadata-only. Never include secret values in command
   output, tests, fixtures, memory, reports, or review comments.
5. Stop and ask for direction when an action crosses the configured policy or
   an ownership boundary.

## Opt-in Lifecycle Hooks

`.agents/hooks/hooks.json` declares the project-local lifecycle callbacks.
`node scripts/harness/session-start.mjs` and `node scripts/harness/session-end.mjs` consume that
configuration and invoke a callback only when `HARNESS_TRUST_MODE=trusted`.
Every other value, including an absent or malformed setting, is fail-closed and
reports the hook as disabled. The configured callbacks are metadata-only: they
do not load environment files, reveal sensitive values, write state, call the
network, or invoke external systems.

## Human Review Checklist

Before granting an approval-required action, verify the precise target, scope,
expected result, rollback/recovery path, and whether the action touches an
external system. For any destructive or external mutation, record the approval
and resulting verification evidence in the active feature's bounded state.
