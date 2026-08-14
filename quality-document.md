# Harness Quality Model

Harness quality is the combination of structural completeness and operational reliability. Files and instructions are necessary, but they do not prove that invalid state is rejected, safety rules fail closed, cleanup is read-only, or deployment is gated.

## Evidence hierarchy

1. A fresh command result with timestamp and pass/fail counts.
2. A focused negative test that demonstrates the gate rejects a known-bad case.
3. A bounded, sanitized benchmark scenario that exercises the real repository implementation.
4. Structural presence and documentation checks.
5. Human claims without executable evidence, which carry no score.

## Required qualities

- State and lifecycle contracts agree and malformed input returns actionable errors.
- The canonical verification path proves application tests, typing, build, and production smoke behavior.
- Tool, secret, memory, path, and delegation boundaries fail closed.
- Context, memory, and reports remain bounded and sanitized.
- CI verification precedes immutable, protected, health-checked, rollbackable deployment.

## Benchmark output

`npm run harness:benchmark` runs representative read-only scenarios and writes a bounded JSON report under `reports/generated/`. Reports contain scenario identifiers, status, duration, and fixed evidence labels only. They exclude command output, environment values, credentials, absolute paths, file contents, and exception messages.

`npm run harness:assess` applies the evaluator rubric to structural artifacts and the operational benchmark. A high structural score cannot compensate for a failed operational scenario or critical gate.

## Review discipline

The implementer records evidence but does not make the final quality decision alone. Before completion, a reviewer checks the diff, reruns the canonical gate and benchmark, confirms the secret/audit results, and verifies that generated evidence is sanitized and reproducible.
