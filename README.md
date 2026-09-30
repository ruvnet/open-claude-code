<h1 align="center">Open Claude Code</h1>
<h3 align="center">Open Source Claude Code CLI — Reverse Engineered & Rebuilt</h3>

<p align="center">
  <em>A fully functional open source implementation of Anthropic's Claude Code CLI,<br/>
  built from decompiled source intelligence using <a href="https://github.com/ruvnet/rudevolution">ruDevolution</a>.</em>
</p>

<p align="center">
  <img alt="Tests" src="https://img.shields.io/badge/tests-991_passing-brightgreen?style=flat-square" />
  <img alt="Tools" src="https://img.shields.io/badge/tools-25-blue?style=flat-square" />
  <img alt="Commands" src="https://img.shields.io/badge/commands-40-blue?style=flat-square" />
  <img alt="npm" src="https://img.shields.io/npm/v/@ruvnet/open-claude-code?style=flat-square&label=npm" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
  <img alt="Nightly" src="https://img.shields.io/badge/nightly-verified_releases-brightgreen?style=flat-square" />
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
```

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
2. **Verifies** compatibility with the full test suite, npm audit, and smoke tests
3. **Recovers and decompiles** the shipped JavaScript in both upstream versions; validates source syntax and witness hashes before optional AI discovery
4. **Publishes** verified releases with detailed notes — only if ALL gates pass

```
Cron 03:00 UTC → npm check → tests/audit → validated source diff → optional AI → verified release
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

The nightly pipeline uses the pinned [rudevolution](https://github.com/ruvnet/rudevolution) submodule's Node keyword classifier on recovered JavaScript. It supports legacy JavaScript npm packages and the source embedded in current Linux ELF64 Bun packages. It does not claim original-name recovery, Rust graph partitioning, or bytecode decompilation. See [decompilation validation](docs/nightly-decompilation.md) for the source, witness, failure, and verification contracts.

</details>

## 📄 License

MIT
