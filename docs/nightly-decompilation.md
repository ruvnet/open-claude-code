# Nightly decompilation contract

## Supported inputs and safety

Run with Node.js 24 or newer and the checked-in `rudevolution` submodule. The
published 2.1.284 sources use explicit resource management (`using`), which the
previous Node.js 20 runtime cannot parse.

The resolver requests metadata for the **exact version**, rather than applying
`latest` package metadata to an older version. Legacy packages use their declared
JavaScript CLI. Current native packages resolve the exact pinned
`@anthropic-ai/claude-code-linux-x64` optional dependency and recover the shipped
JavaScript source from its ELF64 `.bun` section.

Downloads are limited to HTTPS `registry.npmjs.org`, size-bounded and verified
against npm's SHA-512 integrity before reading tar members. Package identity is
checked again inside the tarball. The package is never installed and its binary,
postinstall script and JavaScript are never executed. Archive members are streamed
to memory, never extracted to paths. Output filenames are generated numeric IDs;
embedded names remain metadata.

The ELF/Bun reader checks section, graph and pointer bounds, the trailer, module
record layout, entry point, source encoding and source coverage. It supports the
52-byte Bun module record format described in
[Bun's source](https://github.com/oven-sh/bun/blob/bf42a525d59fbaaa56e47f050fd6384e53c51f5c/src/standalone_graph/StandaloneModuleGraph.rs).
Unknown formats, missing source, malformed archives and integrity mismatches fail
closed. This is **source extraction**, not bytecode disassembly. Non-executable
assets are inventoried separately and never presented as decompiled source.

## What the result proves

Every recovered executable JavaScript module is parsed without linking or
evaluation, then processed by ruDevolution's Node keyword classifier. Each witness
is verified against both the input source and every classified output's hash.
The output retains the exact npm version, tarball integrity, tarball/binary
SHA-256, source manifest hash, counts and witness status.

The classifier produces categorized source fragments. They are not necessarily
independently runnable modules. Function/class counts are lexical estimates.
The pipeline does **not** claim original identifier recovery, Rust MinCut/Louvain
partitioning, export-symbol reconstruction or semantic equivalence. Content hashes
catch equal-length edits that the previous size-threshold comparison missed.

## Failure and release gates

Both versions must succeed. Missing/partial results produce a nonzero exit and no
success JSON. A schema/evidence gate runs before artifact consumers and publication.
Skipping optional AI analysis does not skip decompilation. Missing/malformed
artifacts block auto-update and release; there is no fail-open decompile retry.

Only after the verified release is successfully created are both
`last-known-claude-version.txt` and `last-decompiled-claude-version.txt` advanced.
A failed push is a workflow failure. The new success marker is intentionally absent
until that point: old releases that advanced the original marker despite failed
decompilation are retried on the next scheduled run even if npm has no newer release.
Runs are serialized to prevent simultaneous nightly state advancement.

The discovery artifact contains the diff, manifests and witnesses (hashes and
metadata), not recovered proprietary source. For a local investigation, full
recovered source and classified output are retained only when `--output-dir` is
explicitly supplied.

## Reproduce without publishing

```sh
git submodule update --init --recursive
node --test scripts/test/*.test.mjs
node scripts/decompile-and-diff.mjs 2.1.285 2.1.284 \
  --output-dir /tmp/occ-decompile > /tmp/occ-diff.json
node scripts/validate-decompile-diff.mjs /tmp/occ-diff.json 2.1.285 2.1.284
python3 scripts/format-diff-summary.py /tmp/occ-diff.json 2.1.284 2.1.285
```

These commands do not call the AI API, create a release, advance repository state,
or execute recovered code.

## Validation evidence (2026-09-30)

Official npm tarballs were fetched, integrity-checked, source-recovered, parsed and
processed end to end on Node.js 24.19.0:

| Version | Executable JS modules | Source bytes | Classified categories | Verified witness chains |
| --- | ---: | ---: | ---: | ---: |
| 2.1.284 | 2,151 | 40,525,922 | 47 | 2,151 |
| 2.1.285 | 2,123 | 39,932,971 | 47 | 2,123 |

The diff identifies 46 changed categories; neither added nor removed categories
are fabricated from a failed side. Each binary also contains 229 separately
inventoried non-executable assets.

| Version | Native tarball SHA-256 | Native binary SHA-256 |
| --- | --- | --- |
| 2.1.284 | `642690c3afaa22029c17341e520d8c35ca85857fce6dcc9ecd90ef5e3c7f1027` | `5cd90aabd83f8a15136c35aa37bb1d92b348993573316643dc3fe4e04afbf88f` |
| 2.1.285 | `3fea1abf2d5f42236ebf7e59126698e347ac80437a145dd6e85b87c8c3341ffe` | `33dad1ec615a2e08cc78b494f05c110e49916de2c79d78ec8799ebf46b233d29` |

Regression tests cover malformed/out-of-bounds ELF/Bun data, unsupported layouts,
missing source/entry points, integrity failure, invalid source, non-execution,
wrong/partial/error evidence, equal-size changes, one-sided failures, legacy npm
resolution and retrying unvalidated releases. No production nightly was manually
triggered and no release was published as part of this validation.
