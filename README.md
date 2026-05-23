<h1 align="center">Open Claude Code</h1>
<h3 align="center">Open Source Claude Code CLI — Reverse Engineered & Rebuilt</h3>

<p align="center">
  <em>A fully functional open source implementation of Anthropic's Claude Code CLI,<br/>
  built from decompiled source intelligence using <a href="https://github.com/ruvnet/rudevolution">ruDevolution</a>.</em>
</p>

<p align="center">
  <img alt="Tests" src="https://img.shields.io/badge/tests-913_passing-brightgreen?style=flat-square" />
  <img alt="Tools" src="https://img.shields.io/badge/tools-25-blue?style=flat-square" />
  <img alt="Commands" src="https://img.shields.io/badge/commands-40-blue?style=flat-square" />
  <img alt="npm" src="https://img.shields.io/npm/v/@ruvnet/open-claude-code?style=flat-square&label=npm" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
  <img alt="Nightly" src="https://img.shields.io/badge/nightly-verified_releases-brightgreen?style=flat-square" />
  <img alt="VSCode" src="https://img.shields.io/badge/VSCode-extension_v1.4.0-blue?style=flat-square&logo=visualstudiocode" />
</p>

> **Automated Nightly Releases** — Open Claude Code automatically detects new [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code) releases, runs 903+ tests to verify zero regressions, and publishes verified builds with AI-powered discovery analysis. See [Releases](https://github.com/ruvnet/open-claude-code/releases) | [ADR-001](docs/adr/ADR-001-nightly-verified-release-pipeline.md) | [pi.ruv.io](https://pi.ruv.io)

---

## ⚡ Quick Start

```bash
# Run instantly (no install)
npx @ruvnet/open-claude-code "explain this codebase"

# Or install globally
npm install -g @ruvnet/open-claude-code
occ "hello"

# Interactive mode
occ
```

**Requires:** `ANTHROPIC_API_KEY` environment variable set.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx @ruvnet/open-claude-code "what files are in this directory?"
```

---

## 🖥️ VSCode Extension

A **Cursor-style AI coding assistant** built directly into VSCode — no terminal required.

### Quick install (pre-built VSIX)

The extension package is included in the repo and ready to install:

```bash
code --install-extension vscode-extension/open-claude-code-1.4.0.vsix
```

Or use **Extensions → … → Install from VSIX…** and pick the file from the `vscode-extension/` folder.

### Build from source

```bash
cd vscode-extension
npm install
npm run package          # prepackage → package → postpackage
code --install-extension open-claude-code-1.4.0.vsix
```

### Highlights

- **Dedicated activity bar icon** — opens a full Cursor-style chat panel in the sidebar
- **`@claude` chat participant** — access Claude directly from VS Code's built-in Chat panel
- **Full tool access** — all 25+ agent tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, …)
- **Rich markdown + syntax highlighting** — code blocks with copy & Apply-to-file buttons
- **Copy whole answer** — ⎘ Copy button on every assistant reply copies the full response to the clipboard
- **Session memory** — the model remembers the **full conversation from the beginning** across VS Code restarts (Claude Premium-style); auto-saves after every response and restores on reopen
- **Chat history** — History button shows all past conversations (Cursor-style panel); "New" auto-saves the current session; sessions persist across VS Code restarts; up to 30 sessions are retained
- **▶ Resume** — any past session can be fully resumed: all messages are restored in the chat panel and the model's context is re-injected into the agent bridge
- **⚙ Settings shortcut** — gear button in the header opens the extension settings directly — no need to navigate through the marketplace
- **Streaming responses** — tokens arrive in real time with an animated cursor
- **Tool visualization** — collapsible cards showing each tool execution and result
- **`@file` context injection** — type `@filename` or click 📄 to add a file to the prompt
- **`@git` context chip** — type `@git` or click the git button to inject current branch, changed files, and diff summary into the conversation
- **`@errors` context chip** — type `@errors` or click the ⚠ button to inject all workspace errors and warnings (VSCode diagnostics) into the conversation
- **`@openfiles` autocomplete** — type `@openfiles` to pick from your currently open editor tabs
- **Auto-attach active file** — toggle the 🔗 button (or `openClaudeCode.autoAttachActiveFile` setting) to automatically include the active editor with every message
- **Context-full warning** — a banner appears when the context window exceeds 85%, with a quick "New chat" shortcut
- **Per-message response time** — each assistant reply shows how long it took to generate (visible on hover)
- **Ctrl/Cmd+Enter** — additional keyboard shortcut for sending a message
- **Multi-provider** — Anthropic Claude, OpenAI GPT, Google Gemini, NVIDIA NIM
- **Model & permission-mode selector** — switch model and mode directly from the UI
- **Session stats** — token count, cost estimate, and elapsed time always visible
- **Proactive workspace analysis** — the agent explores your project automatically before answering; never asks you to paste code

See [`vscode-extension/README.md`](./vscode-extension/README.md) for the full setup and configuration guide.

---

## 🧠 What Is This?

**Open Claude Code** is a ground-up open source rebuild of Anthropic's [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), informed by [ruDevolution's](https://github.com/ruvnet/rudevolution) AI-powered decompilation of the published npm package.

It's not a copy — it's a clean-room implementation that mirrors the actual Claude Code architecture: async generator agent loop, 25 tools, 4 MCP transports, 6 permission modes, hooks, settings chain, sessions, and more.

**1,581 tests. 61 files. 8,314 lines. 100% functional.**

---

## 📦 Installation

### npx (no install needed)

```bash
npx @ruvnet/open-claude-code "your prompt here"
```

### Global install

```bash
npm install -g @ruvnet/open-claude-code
occ "your prompt here"
```

### From source

```bash
git clone https://github.com/ruvnet/open-claude-code.git
cd open-claude-code/v2
export ANTHROPIC_API_KEY=sk-ant-...
node src/index.mjs "hello"
```

---

## 🖥️ Usage

### One-shot mode

```bash
occ "explain the auth module"
occ "fix the bug in server.js"
occ "create a REST API for user management"
occ "find all TODO comments in this project"
```

### Interactive REPL

```bash
occ
# > explain this codebase
# > /help
# > /tools
# > /model claude-opus-4-6
# > refactor the database layer
# > /cost
# > /exit
```

### CLI Options

```bash
occ [options] [prompt]

Options:
  -m, --model <model>          Model to use (default: claude-sonnet-4-6)
  -p, --print                  Print mode (non-interactive, output only)
  --permission-mode <mode>     Permission mode: default, auto, plan, acceptEdits, 
                               bypassPermissions, dontAsk
  --system-prompt <text>       Override system prompt
  --add-dir <path>             Additional CLAUDE.md directory
  --max-turns <n>              Maximum conversation turns
  --allowedTools <tools>       Comma-separated allowed tools
  --disallowedTools <tools>    Comma-separated denied tools
  --output-format <fmt>        Output: text, json, stream-json
  -v, --verbose                Verbose output
  -d, --debug                  Debug mode
  --version                    Show version
  -h, --help                   Show help
```

### Examples

```bash
# Use a different model
occ -m claude-opus-4-6 "design a database schema for a blog"

# Print mode (for piping)
occ -p "list all functions in src/" > functions.txt

# Plan mode (read-only, no edits)
occ --permission-mode plan "review the security of auth.js"

# Restrict tools
occ --allowedTools "Read,Glob,Grep" "find all API endpoints"

# With custom system prompt
occ --system-prompt "You are a senior Go developer" "review main.go"
```

---

## 🔧 Interactive Commands

40 slash commands available in REPL mode:

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model <name>` | Switch model mid-conversation |
| `/tools` | List available tools |
| `/tokens` | Show current token usage |
| `/cost` | Show session cost estimate |
| `/compact` | Compact context window |
| `/undo` | Undo last file edit |
| `/clear` | Clear conversation history |
| `/doctor` | Check API connectivity + health |
| `/fast` | Toggle fast mode (Haiku) |
| `/effort <level>` | Set effort: low, medium, high, max |
| `/resume [id]` | Resume a previous session |
| `/sessions` | List saved sessions |
| `/agents` | List custom agents |
| `/skills` | List available skills |
| `/hooks` | Show active hooks |
| `/config` | Show current settings |
| `/permissions` | Show permission mode |
| `/mcp` | Show MCP server status |
| `/memory` | Show memory usage |
| `/exit` | Exit |

---

## 🔨 Tools

25 built-in tools matching Claude Code's tool system:

| Tool | Description |
|------|-------------|
| **Bash** | Execute shell commands (sandboxed) |
| **Read** | Read files with line numbers |
| **Edit** | Replace strings in files |
| **Write** | Create/overwrite files |
| **Glob** | Find files by pattern |
| **Grep** | Search file contents (regex) |
| **LS** | List directory contents |
| **Agent** | Spawn sub-agents |
| **WebFetch** | Fetch URL content |
| **WebSearch** | Web search |
| **TodoWrite** | Task management |
| **NotebookEdit** | Edit Jupyter notebooks |
| **MultiEdit** | Atomic multi-file edits |
| **ToolSearch** | Discover deferred tools |
| **AskUser** | Prompt user for input |
| **Skill** | Invoke a skill |
| **SendMessage** | Agent team messaging |
| **CronCreate/Delete/List** | Scheduled tasks |
| **EnterWorktree/ExitWorktree** | Git worktree isolation |
| **RemoteTrigger** | Remote execution |
| **LSP** | Language server protocol |
| **ReadMcpResource** | Read MCP resources |

---

## ⚙️ Configuration

### Settings

Create `.claude/settings.json` in your project or `~/.claude/settings.json` globally:

```json
{
  "model": "claude-sonnet-4-6",
  "permissions": {
    "defaultMode": "auto"
  },
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "echo 'Running bash...'" }]
    }]
  },
  "autoCompactEnabled": true,
  "alwaysThinkingEnabled": true
}
```

Settings are loaded from 4 sources (in priority order):
1. `.claude/settings.local.json` (local, gitignored)
2. `.claude/settings.json` (project, shared)
3. `~/.claude/settings.json` (user global)
4. Managed policy (enterprise)

### CLAUDE.md

Create a `CLAUDE.md` in your project root to customize behavior:

```markdown
# Project Rules
- Always use TypeScript
- Follow TDD
- Keep files under 500 lines
```

CLAUDE.md files are loaded from: `~/.claude/CLAUDE.md` → parent directories → project root → `.claude/CLAUDE.md`.

### Custom Agents

Create `.claude/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Code review specialist
model: claude-sonnet-4-6
tools: [Read, Glob, Grep]
---

You are a thorough code reviewer. Check for bugs, security issues, and style.
```

### Skills

Create `.claude/skills/deploy/SKILL.md`:

```markdown
---
name: deploy
description: Deploy to production
---

1. Run tests: npm test
2. Build: npm run build
3. Deploy: ./scripts/deploy.sh
```

Invoke with `/deploy` in the REPL.

---

## 🔐 Multi-Provider Support

Works with 5 AI providers:

```bash
# Anthropic (default)
ANTHROPIC_API_KEY=... occ "hello"

# OpenAI
OPENAI_API_KEY=... occ -m gpt-4o "hello"

# Google
GOOGLE_AI_API_KEY=... occ -m gemini-2.5-flash "hello"

# AWS Bedrock
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... occ -m bedrock/claude-sonnet "hello"

# Google Vertex
GOOGLE_APPLICATION_CREDENTIALS=... occ -m vertex/claude-sonnet "hello"

# NVIDIA NIM (kimi-k2.5, deepseek-r1, and other thinking models supported)
NVIDIA_API_KEY=nvapi-... occ -m kimi-k2.5 "hello"
```

> **Note — NVIDIA models (Kimi K2.5, DeepSeek R1):** These models support **full tool-calling by default** — they can Read, Write, Bash, Grep, and run all 25+ agent tools exactly like Cursor or opencode. Set `NVIDIA_THINKING_MODE=true` (or toggle the `openClaudeCode.nvidiaThinkingMode` setting in the VSCode extension) to opt into extended reasoning mode; in that mode tools are replaced with a rich workspace snapshot injected into the system prompt (file tree + key file contents), since NVIDIA NIM does not allow tools and thinking simultaneously.

---

## 🔗 MCP Integration

Connect to MCP servers for additional tools:

```json
// .mcp.json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

Supports 4 transports: stdio, SSE, Streamable HTTP, WebSocket.

---

## 🔍 Background: The Claude Code Source Leak

On March 31, 2026, Anthropic accidentally shipped source maps in the Claude Code npm package, [exposing the full TypeScript source](https://www.sabrina.dev/p/claude-code-source-leak-analysis). This project takes a different approach — we use [ruDevolution](https://github.com/ruvnet/rudevolution) to analyze the **published npm package** legally and rebuild from that intelligence.

### What ruDevolution Found

| Discovery | Evidence |
|-----------|---------|
| 🤖 Agent Teams | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` |
| 🌙 Auto Dream Mode | `tengu_auto_dream_completed` |
| 🔮 claude-opus-4-6 | Unreleased model ID |
| 🔐 6 "amber" codenames | Internal feature gates |
| ☁️ Cloud Code Runner | BYOC compute |
| 📡 MCP Streamable HTTP | New transport |

[Download decompiled releases →](https://github.com/ruvnet/rudevolution/releases)

---

## ⚖️ Legal

This is a **clean-room implementation** — no leaked source used. Architecture informed by analysis of the published npm package, legal under US DMCA §1201(f), EU Software Directive Art. 6, UK CDPA §50B.

---

## 🆕 What's New

### v1.4.0 — Context Injection, Auto-Attach & UX Improvements

**Richer context injection**
- **`@git` chip** — type `@git` in the chat input (or click the new git toolbar button) to instantly inject the current branch name, `git status`, and `git diff --stat` as a context chip. The content is appended inline to your message so the model has full awareness of your working-tree state
- **`@errors` chip** — type `@errors` (or click the ⚠ toolbar button) to pull all workspace errors and warnings from the VSCode diagnostics API into the conversation, grouped by severity
- **`@openfiles` autocomplete** — type `@openfiles` to populate the `@` autocomplete dropdown with every file currently open in the editor, making it easy to add multiple files without typing paths
- **Auto-attach active file** — click the new 🔗 toolbar button (or set `openClaudeCode.autoAttachActiveFile: true` in settings) to automatically include the currently active editor file with every message you send — no need to type `@` every time

**UX improvements**
- **Context-full warning banner** — a visible warning appears above the input when context usage exceeds 85%, with a one-click "New chat" shortcut to start fresh before responses degrade
- **Per-message response time** — each assistant reply now shows how long it took to generate (e.g. `3.2s`) in the message header, visible on hover
- **Ctrl/Cmd+Enter** — added as a second keyboard shortcut for sending messages (in addition to plain Enter)
- **Consistent keyboard hint** — the input area now shows `Enter / Ctrl+Enter send` to surface the new shortcut

### v1.3.1 — Bridge Stability & Session Memory Fixes

- **Session memory loss fix** — agent bridge now auto-injects the full session history whenever a new bridge process is created (covers crashes, settings changes, and VS Code restarts)
- **Bridge queue stability** — message queue is drained reliably on bridge restart so in-flight requests are not lost
- **Max-turns UX hint** — when the agent loop hits its turn limit a visible `⚙ Max turns reached` notice is shown with instructions to continue

### v1.3.0 — Session Memory (Claude Premium-style)

**Session Memory algorithm** — the model now remembers the full conversation from the very beginning, just like Claude premium sessions:

- **Auto-persist active session** — the current conversation is automatically saved to VS Code `globalState` after every response. If you close and reopen VS Code, your conversation is fully restored — messages in the chat panel **and** the model's context in the bridge subprocess
- **Session resume from history** — every past conversation in the History panel now has a **▶ Resume** button. Clicking it:
  1. Saves your current in-progress chat to history
  2. Restores all messages of the selected session in the main chat panel
  3. Re-injects the full conversation into the agent loop (`resume` command in `agent-bridge.mjs`) so the model has complete memory of everything said — no context lost
- **New `resume` bridge protocol** — `agent-bridge.mjs` accepts `{"type":"resume","messages":[…]}` which converts the stored UI message format back to the Anthropic/OpenAI API message format and sets it directly on the agent loop's state
- **Auto-clear on new chat** — starting a new conversation clears the persisted active session so the next restart begins fresh

### v1.2.0 — Chat History, Settings Button & Copy Answer

**New UI features** _(this PR)_
- **⚙ Settings button** — a gear icon added to the chat header opens `openClaudeCode` settings directly; no more navigating through the Extensions marketplace
- **⎘ Copy whole answer** — each finalized assistant reply now has a `⎘ Copy` button in the message header; one click copies the full raw markdown response to the clipboard
- **Chat history panel (Cursor-style)** — clicking the new **History** header button opens a full-overlay panel listing all past sessions. Pressing **New** auto-saves the current conversation to history first. Sessions are persisted in VS Code `globalState` and survive restarts; up to 30 sessions are retained
- **Cursor-style session navigation** — click any session in the history list to view its messages read-only (with Copy buttons intact); a Back button returns to the session list

**Fix: Proactive workspace analysis for all models**
- All models now receive a strong agentic system prompt declaring the workspace `cwd` and instructing them to explore files with LS / Glob / Read / Grep / Bash before answering — never asking the user to paste code
- New `buildWorkspaceSnapshot` helper recursively walks the workspace (skipping `node_modules`, `.git`, `dist`, etc.) and returns a compact indented file tree capped at 200 entries
- New `buildWorkspaceContent` helper reads key project files (README, package.json, entry points, etc.) and returns their contents for inline injection — capped at 64 KB total
- **Kimi K2.5 and DeepSeek R1 now use full tool-calling by default** — Read, Write, Bash, Grep, and all 25+ tools work exactly like Cursor or opencode; thinking/reasoning mode is an opt-in setting (`NVIDIA_THINKING_MODE=true` or `openClaudeCode.nvidiaThinkingMode` in VSCode settings)
- When thinking mode IS enabled a rich workspace snapshot (file tree + key file contents) is injected into the system prompt with a purpose-built thinking-model system prompt
- Extension model descriptions updated; version bumped to 1.2.0

### v1.1.0 — VSCode Extension & Bug Fixes

**VSCode Extension — Cursor-style sidebar panel** _(PR #2)_
- New dedicated activity bar icon with a full-screen Cursor-style chat panel
- Rich markdown rendering, syntax-highlighted code blocks, copy & Apply-to-file buttons
- Streaming responses with animated cursor, tool visualization cards, extended thinking blocks
- `@file` context injection, file picker, model/mode selector, session stats, and stop button
- Pre-built VSIX committed to `vscode-extension/open-claude-code-1.1.0.vsix` — install with one command

**VSCode Extension — `@claude` Chat Participant** _(PR #1)_
- New `vscode-extension/` package exposing the `v2/src` agent loop as a native VSCode Chat participant
- Long-lived `agent-bridge.mjs` subprocess keeps conversation history across turns
- API key stored in VSCode `SecretStorage` — never written to disk in plaintext
- `/clear` and `/model` slash commands; configurable permission mode, max turns, and tool visibility

**Fix: NVIDIA NIM thinking models** _(PR #3)_
- `kimi-k2.5`, `deepseek-r1`, and other NVIDIA thinking models no longer crash with HTTP 400
- Tool array is now omitted for thinking models (the two parameters are mutually exclusive)
- Clean system prompt (without tool descriptions) is used for thinking-model calls

**VSCode extension package now tracked in git** _(PR #4)_
- `*.vsix` removed from `.gitignore` — the built package lives at `vscode-extension/open-claude-code-1.1.0.vsix`

---

## 📚 Related

- [ruDevolution](https://github.com/ruvnet/rudevolution) — AI-Powered JavaScript Decompiler
- [Decompiled Releases](https://github.com/ruvnet/rudevolution/releases) — Every Claude Code version
- [v2 Architecture (ADR-001)](./docs/adr/ADR-001-v2-architecture.md)
- [Path to 100% (ADR-002)](./docs/adr/ADR-002-path-to-100-percent.md)

<details>
<summary><b>Nightly Release Pipeline</b></summary>

### Automated Nightly Verified Releases (ADR-001)

Open Claude Code includes an automated nightly CI/CD pipeline that:

1. **Detects** new Claude Code releases from npm registry (03:00 UTC daily)
2. **Verifies** compatibility with 903+ tests, npm audit, and smoke tests
3. **Analyzes** changes using Claude Sonnet 4.6 AI-powered discovery
4. **Publishes** verified releases with detailed notes — only if ALL gates pass

```
Cron 03:00 UTC → npm check → 903+ tests → npm audit → AI analysis → verified release
```

**Manual trigger:**
```bash
gh workflow run nightly.yml -f force_release=true
```

**Required secrets:**
- `GITHUB_TOKEN` — automatic
- `ANTHROPIC_API_KEY` — optional, for AI discovery analysis

See [ADR-001](docs/adr/ADR-001-nightly-verified-release-pipeline.md) for full architecture.

### rudevolution Integration

The [rudevolution](https://github.com/ruvnet/rudevolution) submodule provides AI-powered decompilation analysis of Claude Code releases, tracking 34,759+ functions with 95.7% name accuracy. Used by the nightly pipeline for change discovery.

</details>

## 📄 License

MIT
