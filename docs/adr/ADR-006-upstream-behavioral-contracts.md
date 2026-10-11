# ADR-006: Upstream behavioral contracts

Status: Accepted, 2026-10-11

## Inputs and scope
Upstream public changelog versions2.1.295 and2.1.296 describe hook failure/veto contracts, large reads, and invalidUTF8 edit refusal. OCC issue17 identifies delegation and lifecycle safety gaps. These are behavioral specifications; lexical counts are not implementation evidence.

## Implemented contracts
Command and HTTP hooks can fail closed using onFailure:block. Exit2 always vetoes. continue:false and structured permissionDecision:deny block tool execution without stopping the conversation. Blocked tool results carry is_error:true. MCP updatedMCPToolOutput replaces only MCP results. Invalid regex matchers execute nothing and retain each child hook failure policy. HTTP output is bounded to1MiB, redirects fail, timeout bounds fetch/read; only allowlisted variables interpolate into headers.

Read allow_large bypasses the implicit2000line limit, preserves explicitoffset/limit, and respects16MiB/100000line ceilings. A bounded descriptor snapshot protects against file growth. Edit,MultiEdit,NotebookEdit decode strictUTF8 and reject invalid bytes before writes, while preserving Unicode,BOM,CRLF,trailingnewlines. MultiEdit validates all files before writing any.

Subagent tools intersect parent advertisements and requested tools. Parent checker and hooks remain authoritative, including recursive delegation. Standalone children use read-only plan permissions. Worktree requests fail explicitly. Children default to10provider requests,depth2,maxdepth3,backgroundconcurrency4. Explicit model overrides remain part of the existing API; this is not a provider budget policy.

maxTurns now bounds model requests for each user task, including continuations. turnCount retains its user prompt meaning. Malformed maxTurns fails closed.

## Evidence and acceptance
Run node --test scripts/test/*.test.mjs, npm test --prefix v2, npm audit, plugin E2E, packed package E2E, live provider E2E, and fresh registry E2E. Behavioral tests assert unchanged invalid file bytes, no excluded child execution, model budget exhaustion, hook failure denial, and next model turn after denial. Installed artifact tests exercise largeRead,encodingrefusal,andhookfailure through shippedmodules. Publication uses the exact tested tarball and verifies SHA512.

## Remaining limitations
No LLM prompt/agent hook evaluator, async hooks, complete managed policy chain, full provider parity, session persistence/checkpoint lifecycle or actual subagent worktree isolation is established. The lifecycle issue17 stays open. Capability proposals remain advisory. Do not treat this release as full upstream parity.

## Rollback
Pin2.1.2 if needed or revert changes through a new release. Published npm versions are immutable. Do not weaken tests to restore a passing signal.
