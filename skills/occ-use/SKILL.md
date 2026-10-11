---
name: occ-use
description: Run Open Claude Code (OCC) for coding tasks and verify its CLI installation. Use when asked to use OCC, select its provider, or perform a bounded coding task through its CLI.
---

# Use Open Claude Code

1. Identify the requested repository and task. Inspect its instructions before executing.
2. Check the pinned CLI without a provider call:
   `npx --yes @ruvnet/open-claude-code@2.1.2 --version`
   Expect `v2.1.2`. Use `--help` for the exact supported flags.
3. Use an existing provider binding. Anthropic uses ANTHROPIC_API_KEY; OpenAI compatible providers use OPENAI_API_KEY and optionally OPENAI_BASE_URL. Never display, copy, or persist credentials. This skill supplies no credentials or permissions.
4. For a read task, restrict tools and turns:
   `npx --yes @ruvnet/open-claude-code@2.1.2 --print --allowedTools Read --max-turns 4 "Read README.md and summarize the project."`
   For OpenAI compatible providers, also pass `--model gpt-4.1-mini` (or another supported OpenAI model ID); routing depends on the model name, not the API key alone. Provider calls may incur charges.
5. For edits, preserve repository instructions and user scope. Do not assume that installing this skill authorizes publishing, deletion, or external messages.
6. Report the command exit status, observed result, and any missing provider access. Do not claim full upstream Claude Code parity.

If asked only to explain or plan, do not execute the task. If asked to verify installation, stop after version and help unless live inference was requested.
