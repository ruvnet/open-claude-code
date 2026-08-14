# Harness Reliability

## Reliability Promise

The harness is reliable only when an agent can prove the active feature's
state, run the same quality gate locally and in CI, preserve protected files,
and leave a bounded restart record. File presence or an agent's self-report is
not verification.

## Required Gates

| Gate | Command or control | Passing evidence | Failure response |
| --- | --- | --- | --- |
| State | `node scripts/harness/validate-state.mjs` | Zero or one valid active feature, dependencies, evidence, and restart markers agree | Stop; repair state before changing scope. |
| Security | `node scripts/harness/secret-scan.mjs` plus the ecosystem dependency audit | No credential patterns and no advisories above the declared threshold | Stop; remove/rotate exposed data or remediate the dependency before publication. |
| Static checks | Project commands detected in `./init.sh` | Lint, type, compile, or equivalent checks pass | Stop; fix or record a pre-existing unrelated failure. |
| Regression tests | Project test command in `./init.sh` | All application and harness tests pass | Stop; add or repair the focused regression. |
| Build and smoke | Project build/runtime probes when applicable | Production build and isolated runtime probes pass | Stop; investigate runtime/build output. |
| Canonical gate | `./init.sh` | All preceding gates pass in the documented order | Do not mark a feature done or start deployment. |
| Safety policy | `node scripts/harness/validate-policy.mjs` | Default-deny policy is valid and has no broad/conflicting rule | Stop; correct the policy before relying on it. |

`bash ./init.sh` routes to the canonical gate. CI must invoke the same gate
before any publication or deployment job becomes eligible.

## Metrics

Record only aggregate, non-secret operational evidence. Do not collect command
arguments, file contents, credentials, tokens, customer data, or private
paths.

| Metric | Definition | Target | Review cadence |
| --- | --- | --- | --- |
| Canonical gate success | Successful `./init.sh` runs / attempted runs for the active feature | 100% before completion | Every completion claim |
| First-pass reliability | Features whose first final-gate attempt passes / completed features | Improve over time; explain regressions | Per feature |
| State agreement | Session starts/ends with no state disagreement / attempts | 100% | Per session |
| Policy coverage | Required policy categories validated / required categories | 100% | Policy change and release |
| Context-budget compliance | Sessions within the documented artifact budget / sampled sessions | 100% | Per session handoff |
| Unsafe mutation attempts | Blocked destructive, secret, network, or external mutations | 0 unapproved executions | Per incident and release |
| Recovery quality | Failed gates with a recorded actionable next step / failed gates | 100% | Per failure |

## Evidence Rules

1. Store command, ISO timestamp, exit result, pass/fail counts, and a concise
   non-secret note in feature state or the bounded progress log.
2. Evidence belongs to the feature that produced it and must be refreshed after
   a relevant source, policy, dependency, or verification change.
3. A passing partial check does not substitute for the canonical gate.
4. Failures are useful evidence: record the failing stage and the safest next
   action instead of changing status to done.

## Escalation

If a required gate fails, pause completion work. If the issue requires a
destructive action, network request, credential access, commit, push,
deployment, migration, or infrastructure change, obtain the explicit approval
described in `TOOL-SAFETY.md` first. CI remains the final authority for
publication and deployment.
