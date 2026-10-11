---
name: occ-diagnose
description: Diagnose Open Claude Code installation, provider authentication, skill discovery, and CLI failures. Use when OCC fails to start, returns errors, or cannot find an installed skill.
---

# Diagnose Open Claude Code

1. Capture the failing command, exit status, Node version, and OCC version. Redact credentials and sensitive provider response bodies.
2. Require Node 20 or newer. Verify `npx --yes @ruvnet/open-claude-code@2.1.2 --version` and `--help` before a provider call.
3. For authentication failures, check only whether the required environment variable is present. Never print its value. Match ANTHROPIC_API_KEY to Anthropic or OPENAI_API_KEY to an OpenAI compatible endpoint. Routing depends on the model name: use `--model gpt-4.1-mini` for an OpenAI compatible route. Check base URL and model selection without exposing credentials.
4. For a newly published npm version returning ETARGET or E404, retry metadata/install with a fresh cache and prefer-online for at most five minutes. Do not treat authentication, integrity, or behavioral failures as propagation delays.
5. For missing skills, inspect project `.claude/skills/<name>/SKILL.md` and user `~/.claude/skills/<name>/SKILL.md`. OCC 2.1.2 follows directory symlinks; project skills override user skills. A broken symlink is ignored.
6. Claude Code plugins and OCC's custom PluginLoader are different contracts. This repository's native plugin supplies skills to Claude Code; it does not make OCC support every third party Claude plugin.
7. Reproduce with the smallest allowed tool set, retain sanitized evidence, and propose a targeted fix. Do not delete user configuration or rotate secrets without authorization.
