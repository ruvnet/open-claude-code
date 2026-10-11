---
name: occ-verify-release
description: Verify Open Claude Code package integrity, release tests, and automation evidence. Use when asked whether an OCC release is published, tested, or fully automated.
---

# Verify an Open Claude Code release

1. Resolve the exact package version and source commit. Check npm metadata for `@ruvnet/open-claude-code` and its intended distribution tag.
2. Download the exact tarball and compare its SHA512 integrity with npm metadata and the release receipt. Metadata visibility alone does not prove fresh installation works.
3. In a disposable directory and home, install with lifecycle scripts disabled. Run version/help and the repository's `scripts/package-e2e.mjs` against that exact tarball or registry version.
4. If live provider testing is authorized, run `scripts/live-package-e2e.mjs` with an existing protected AI_API_KEY binding. Never put a credential in a command argument or evidence file. A mock test is not a live provider test.
5. Inspect the GitHub Actions conclusion and every required gate. Queued, skipped, or failed runs do not prove unattended publication. Check that checkpoints advance only after registry installation and release verification.
6. Report source commit, version, test results, registry integrity, and outstanding gaps separately. Capability proposals are not implemented capabilities.
7. This skill verifies evidence. Publish, merge, change tags, or modify secrets only when the user has authorized those actions.
