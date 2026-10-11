# ADR-004: Verified npm publication and truthful automation

Status: Accepted
Date: 2026-10-11

## Problem

Nightly success concealed invalid AI credentials and no applied updates. GitHub prereleases did not publish npm artifacts. Package identity and CLI version differed from the documented distribution. API failures returned success exit codes, and OpenAI-compatible tool calls broke because the streaming path expected Anthropic events and discarded assistant tool history.

## Decision

Publish @ruvnet/open-claude-code from one sequential, required-gate workflow. Test the packed artifact before publication, verify its registry SHA-512 integrity, reinstall that exact registry version, and only then advance upstream checkpoints. Attach a source commit and artifact integrity receipt to the GitHub release. Stable and nightly distribution tags are separate. Daily runs use nightly; latest is an explicit manual input.

AI analysis uses a validated OpenRouter credential provided through GitHub repository secrets from the protected ruOS binding. Authentication, HTTP, malformed response and truncation failures stop release. Secrets are never placed in command arguments, source or receipts.

Structural differences produce proposals only. Counts cannot prove new semantic features. Remove speculative source rewriting, TODO generation, permissive regression tolerances and automatic merging of guessed implementations. New implementation work requires a concrete behavioral specification, provenance and tests.

## Threat model

Assets: npm publishing credential, provider credential, package integrity and user trust.
Boundaries: recovered upstream source is untrusted; provider responses are advisory; packed artifacts cross into a public immutable registry.
Controls: source is parsed without execution; dependency installation disables lifecycle scripts; AI errors are sanitized; mock CLI tests exclude real credentials; live tests allow only Read against temporary fixtures; npm publishes an integrity-checked tarball. No upstream source fragments are copied into generated executable code.

The workflow token has repository contents and issue write access for releases, checkpoint commits and failure reports. npm uses a scoped repository secret; migrate to trusted publishing when registry configuration is available.

## Validation

Unit suite: 1008 passed. Script regression suite: 40 passed. Installed package tests cover version, help, Anthropic streaming Read, OpenAI-compatible Read with preserved tool history, missing keys and authentication failures. Live OpenRouter test verifies a random file value through actual tool execution. npm audit reported zero vulnerabilities on 2026-10-11.

Full upstream feature parity, Google live behavior, Bedrock and Vertex support are not claimed. AI proposals are not implemented features. Existing architecture ADR completion labels are historical, not current parity evidence.

## Recovery

A failed gate does not advance upstream checkpoints. A published npm version is immutable: do not overwrite it; fix and increment the version. Registry integrity mismatch stops immediately. Revert source via a reviewed Git commit and publish a new version; change distribution tags only deliberately.
