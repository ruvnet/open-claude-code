# Harness Evaluator Rubric

## Scoring

| Category | Weight |
| --- | ---: |
| State and lifecycle integrity | 20 |
| Verification and application correctness | 25 |
| Safety, secrets, and path containment | 25 |
| Context, memory, and coordination | 15 |
| CI, deployment, and recovery | 15 |

Passing requires at least 90/100 and every critical gate below. A category receives its weight only when all mapped scenarios pass; partial evidence is reported but receives zero for that category.

## Critical gates

- Current feature state validates and a known-invalid fixture is rejected.
- Canonical `./init.sh` succeeds with exact counts and any required runtime smoke evidence.
- Policy evaluation denies secret paths and the committed-secret scan has no findings.
- Memory, lifecycle, cleanup, and coordination checks remain bounded and non-destructive.
- CI verification is a dependency of image publication and protected production deployment.
- The published image uses the commit SHA, health is checked, and rollback evidence is retained.

Any failed operational scenario makes the assessment fail even when every structural artifact exists. Missing, stale, malformed, or unsanitized benchmark evidence also fails assessment.

## Independent review

Independent review reruns the assessment from a fresh process, inspects failures without trusting implementer prose, and confirms that no test was weakened, skipped, or converted to advisory-only. Repository-host settings that cannot be encodedâ€”especially required production-environment reviewersâ€”must be checked separately before an actual deployment.
