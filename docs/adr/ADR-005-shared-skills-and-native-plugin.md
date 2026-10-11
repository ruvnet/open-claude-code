# ADR-005: Shared skills and native Claude Code plugin

Status: Accepted, 2026-10-11

## Decision
Maintain three canonical skills in skills/. Distribute them through the skills CLI and a native Claude Code plugin named occ, listed in the ruvnet-occ marketplace. Publish the CLI as @ruvnet/open-claude-code version 2.1.2.

## Contracts
The plugin installs instructions only: no hooks, MCP servers, background processes, or secrets. Skills cannot grant authorization. The CLI remains a separate npm distribution. Native plugin packaging does not establish support for arbitrary Claude plugins in OCC.

The OCC loader follows skill directory symlinks, as emitted by skills 1.7.2. Project skills override global skills, broken symlinks are ignored, and reload clears removed entries. Installed skills are trusted prompt content.

## Verification
Run 1008 CLI unit tests, script regressions, npm audit, packed CLI E2E, and live provider E2E. Run scripts/plugin-e2e.mjs under Node24 with Claude Code2.1.283: real skill install, prompt loading, reinstall, removal; strict manifests; real marketplace/plugin install, all three skill expansions via local mock model transport, update, removal. Repeat the distribution test from public GitHub after merge.

Do not label mock model transport as live inference. No broader provider parity claim follows.

## Tool policy repair
Allowed and denied tool name lists are enforced both in model advertisements and before hooks or dispatch. Explicit deny wins. Empty lists preserve the existing default. Malformed lists fail closed. Adversarial model tests attempt unadvertised Write, Bash, and MCP calls and require zero executions.

## Registry propagation
A failed nightly published its npm artifact but encountered ETARGET on immediate installation. Retry registry ETARGET/E404 only, with fresh cache and prefer-online, within five minutes. All behavioral assertions, auth failures, and integrity failures remain immediate failures. Checkpoints advance only after fresh registry verification.

## Rollback
Uninstall occ@ruvnet-occ or remove the three skills using npx skills. Pin the prior npm CLI version if needed. Never overwrite a published version. Reverse source changes through a new commit.
