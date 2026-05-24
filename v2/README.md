# open-claude-code v2 — Technical Guide

## Quick Start

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node src/index.mjs "hello"          # one-shot
node src/index.mjs                   # interactive REPL
node src/index.mjs -m claude-opus-4-6 -p "explain this"  # print mode

# Or use DeepSeek
export DEEPSEEK_API_KEY=sk-...
node src/index.mjs -m deepseek-v4-flash "hello"
node src/index.mjs -m deepseek-reasoner "explain this"
```

## Architecture

```
v2/src/
├── core/                    # Core engine
│   ├── agent-loop.mjs       # Async generator (13 event types, recursive)
│   ├── streaming.mjs        # SSE handler (all event types)
│   ├── context-manager.mjs  # Token tracking + compaction
│   ├── system-prompt.mjs    # CLAUDE.md loading + cache boundary
│   ├── session.mjs          # Save/resume/teleport
│   ├── checkpoints.mjs      # File checkpointing + undo
│   ├── cache.mjs            # Prompt caching
│   ├── rate-limiter.mjs     # 429/529 handling + backoff
│   ├── providers.mjs        # 6 AI providers (Anthropic, OpenAI, Google, DeepSeek, Bedrock, Vertex)
│   └── scheduler.mjs        # Cron task scheduling
├── tools/                   # 25 tools
│   ├── registry.mjs         # validateInput/call interface
│   ├── bash.mjs             # Shell (sandboxed, timeout, background)
│   ├── read.mjs             # File read (PDF, binary detect, line nums)
│   ├── edit.mjs             # Edit (replace_all, uniqueness check)
│   ├── write.mjs            # Write (mkdir, overwrite protection)
│   ├── glob.mjs             # Glob (proper matching, mtime sort)
│   ├── grep.mjs             # Grep (-i/-n/-A/-B/-C, ripgrep)
│   ├── agent.mjs            # Subagent (worktree, background, model)
│   ├── web-fetch.mjs        # URL fetch
│   ├── web-search.mjs       # Web search
│   ├── todo-write.mjs       # Task management
│   ├── notebook-edit.mjs    # Jupyter notebooks
│   ├── multi-edit.mjs       # Atomic multi-file edits
│   ├── ls.mjs               # Directory listing
│   ├── tool-search.mjs      # Deferred tool discovery
│   ├── ask-user.mjs         # User prompts
│   ├── skill.mjs            # Skill invocation
│   ├── send-message.mjs     # Agent team messaging
│   ├── cron-create.mjs      # Scheduled tasks
│   ├── cron-delete.mjs
│   ├── cron-list.mjs
│   ├── enter-worktree.mjs   # Git worktree
│   ├── exit-worktree.mjs
│   ├── remote-trigger.mjs   # Remote execution
│   ├── lsp.mjs              # Language server
│   └── read-mcp-resource.mjs
├── mcp/                     # MCP protocol
│   ├── client.mjs           # JSON-RPC client
│   ├── transport-sse.mjs    # SSE transport
│   ├── transport-shttp.mjs  # Streamable HTTP
│   └── transport-ws.mjs     # WebSocket
├── permissions/              # Security
│   ├── checker.mjs          # 6 modes + interactive prompts
│   ├── sandbox.mjs          # bubblewrap/seatbelt
│   ├── injection-check.mjs  # Command injection detection
│   ├── path-check.mjs       # File path validation
│   └── prompt.mjs           # Permission prompting
├── hooks/
│   └── engine.mjs           # PreToolUse/PostToolUse/Stop/Notification
├── agents/
│   ├── loader.mjs           # Agent definition loader
│   ├── parser.mjs           # JSON/MD frontmatter parser
│   └── teams.mjs            # Multi-agent teams
├── skills/
│   ├── loader.mjs           # Skill discovery
│   └── runner.mjs           # Skill execution
├── plugins/
│   └── loader.mjs           # Plugin discovery + git clone
├── auth/
│   └── oauth.mjs            # PKCE OAuth flow
├── config/
│   ├── settings.mjs         # 4-source deep merge
│   ├── cli-args.mjs         # All CLI flags
│   └── env.mjs              # 104 env vars
├── ui/
│   ├── repl.mjs             # Interactive REPL
│   ├── ink-app.mjs          # Rich terminal output
│   └── commands.mjs         # 40 slash commands
├── telemetry/
│   └── index.mjs            # Telemetry stub
└── index.mjs                # Entry point

test/
└── test.mjs                 # 1,581 tests
```

## Stats

| Metric | Value |
|--------|:-----:|
| Source files | 61 |
| Lines of code | 8,314 |
| Tests | 956+ (0 failures) |
| Tools | 25 |
| Slash commands | 40 |
| MCP transports | 4 |
| AI providers | 6 |
| Env vars | 106 |
| Permission modes | 6 |

## Supported Providers

open-claude-code supports **6 AI providers**. Switch between them using the `--model` flag or `/model` slash command.

| Provider | Env Key | Models |
|----------|---------|--------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-4-6` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4o-mini`, `o1-preview`, `o1-mini`, `o3-mini` |
| Google | `GOOGLE_API_KEY` / `GEMINI_API_KEY` | `gemini-2.0-flash`, `gemini-2.0-pro`, `gemini-1.5-flash` |
| **DeepSeek** | `DEEPSEEK_API_KEY` | `deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash`, `deepseek-v4-pro` |
| AWS Bedrock | `AWS_ACCESS_KEY_ID` | `anthropic.claude-3-sonnet`, `anthropic.claude-3-haiku` |
| Google Vertex AI | `GOOGLE_APPLICATION_CREDENTIALS` | `claude-sonnet-4-6@anthropic` |

### DeepSeek Details

DeepSeek uses an **OpenAI-compatible API** (`https://api.deepseek.com/v1/chat/completions`) with Bearer token auth.

- `deepseek-chat` — V3 general-purpose model
- `deepseek-reasoner` — R1 reasoning model (emits `reasoning_content` displayed as thinking blocks)
- `deepseek-v4-flash` — V4 fast/cheap model
- `deepseek-v4-pro` — V4 premium model

Set a custom base URL with `DEEPSEEK_BASE_URL` (default: `https://api.deepseek.com`).

```bash
export DEEPSEEK_API_KEY="sk-..."
export DEEPSEEK_BASE_URL="https://api.deepseek.com"  # optional, for self-hosted

occ -m deepseek-chat "write a script"
occ -m deepseek-reasoner "prove this theorem"
occ -m deepseek-v4-flash "quick question"
occ -m deepseek-v4-pro "complex task"
```

DeepSeek pricing is automatically reflected in `/cost`:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|:---------------------:|:----------------------:|
| `deepseek-chat` | $0.27 | $1.10 |
| `deepseek-reasoner` | $0.55 | $2.19 |
| `deepseek-v4-flash` | $0.15 | $0.60 |
| `deepseek-v4-pro` | $0.35 | $1.50 |

## Tests

```bash
node test/test.mjs
# Tests: 956 total, 956 passed, 0 failed
```
