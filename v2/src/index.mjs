#!/usr/bin/env node
/**
 * open-claude-code v2
 *
 * Open source implementation of Claude Code CLI architecture.
 * Based on ruDevolution decompilation of Claude Code v2.1.91.
 *
 * Architecture mirrors the actual Claude Code internals:
 * - Async generator agent loop (13 event types)
 * - 25+ tools with validateInput/call interface
 * - MCP client (stdio/SSE/WS/sHTTP transports)
 * - 6 permission modes + sandbox
 * - Context compaction + auto-compaction
 * - Hooks system (7 events)
 * - Settings chain (5 layers, 76 properties)
 * - Multi-provider support (Anthropic, OpenAI, Google)
 * - Custom agents and skills
 * - Session management and checkpoints
 * - Prompt caching
 * - 39 slash commands
 * - Telemetry stub
 */

import { createAgentLoop } from './core/agent-loop.mjs';
import { createToolRegistry } from './tools/registry.mjs';
import { createPermissionChecker } from './permissions/checker.mjs';
import { loadSettings } from './config/settings.mjs';
import { parseArgs, getUsageText } from './config/cli-args.mjs';
import { HookEngine } from './hooks/engine.mjs';
import { McpClient } from './mcp/client.mjs';
import { AgentLoader } from './agents/loader.mjs';
import { SkillsLoader } from './skills/loader.mjs';
import { SessionManager } from './core/session.mjs';
import { CheckpointManager } from './core/checkpoints.mjs';
import { PromptCache } from './core/cache.mjs';
import { readEnv } from './config/env.mjs';
import * as telemetry from './telemetry/index.mjs';

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // Handle --version
    if (args.showVersion) {
        console.log('open-claude-code v2.0.0-alpha.1');
        process.exit(0);
    }

    // Handle --help
    if (args.showHelp) {
        console.log(getUsageText());
        process.exit(0);
    }

    const settings = await loadSettings();
    const env = readEnv();

    // Apply CLI overrides to settings
    if (args.permissionMode) settings.permissions = { ...settings.permissions, defaultMode: args.permissionMode };
    if (args.systemPrompt) settings.systemPromptOverride = args.systemPrompt;
    if (args.addDirs?.length) settings.addDirs = args.addDirs;
    if (args.maxTurns) settings.maxTurns = args.maxTurns;
    if (args.verbose) settings.verbose = true;
    if (args.debug) settings.debug = true;

    const tools = createToolRegistry();
    const permissions = createPermissionChecker(settings.permissions);
    const hooks = new HookEngine(settings.hooks);

    // Apply tool allow/deny lists
    if (args.allowedTools) settings.allowedTools = args.allowedTools;
    if (args.disallowedTools) settings.disallowedTools = args.disallowedTools;

    // Load custom agents
    const agentLoader = new AgentLoader();
    agentLoader.load();

    // Load skills
    const skillsLoader = new SkillsLoader();
    skillsLoader.load();

    // Wire skill tool
    const skillTool = tools.get('Skill');
    if (skillTool) skillTool._skillsLoader = skillsLoader;

    // Session management
    const sessionManager = new SessionManager();
    const checkpointManager = new CheckpointManager();
    const promptCache = new PromptCache();

    // Connect MCP servers if configured
    const mcpClients = [];
    if (settings.mcpServers) {
        for (const [name, config] of Object.entries(settings.mcpServers)) {
            try {
                const client = new McpClient(config);
                await client.connect();
                const mcpTools = await client.listTools();
                tools.registerMcpTools(mcpTools, (toolName, toolArgs) => client.callTool(toolName, toolArgs));
                mcpClients.push(client);
            } catch (err) {
                console.error(`MCP server "${name}" failed to connect: ${err.message}`);
            }
        }
    }

    // Wire MCP resource tool
    const mcpResourceTool = tools.get('ReadMcpResource');
    if (mcpResourceTool) mcpResourceTool._mcpClients = mcpClients;

    const loop = createAgentLoop({
        model: args.model || settings.model || 'claude-sonnet-4-6',
        tools,
        permissions,
        settings,
        hooks,
    });

    // Attach extra state for commands to access
    loop.state._agentLoader = agentLoader;
    loop.state._skillsLoader = skillsLoader;
    loop.state._mcpClients = mcpClients;
    loop.state._hooks = settings.hooks;
    loop.state._permissionMode = settings.permissions?.defaultMode || 'default';
    loop.state._sessionManager = sessionManager;
    loop.state._checkpointManager = checkpointManager;
    loop.state._promptCache = promptCache;

    telemetry.track('session.start', { model: loop.state.model });

    // Graceful shutdown
    const cleanup = async () => {
        telemetry.track('session.end', {
            turns: loop.state.turnCount,
            tokens: loop.state.tokenUsage,
        });
        for (const client of mcpClients) {
            await client.disconnect().catch(() => {});
        }
    };
    process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
    process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

    if (args.prompt) {
        // Non-interactive: run prompt and exit (no Ink — plain stdout)
        const outputFormat = args.outputFormat || 'text';
        const results = [];

        for await (const event of loop.run(args.prompt)) {
            if (outputFormat === 'json') {
                results.push(event);
            } else if (outputFormat === 'stream-json') {
                console.log(JSON.stringify(event));
            } else {
                handleEvent(event, settings);
            }
        }

        if (outputFormat === 'json') {
            // Extract final text
            const texts = results
                .filter(e => e.type === 'assistant')
                .map(e => e.content)
                .filter(Boolean);
            console.log(JSON.stringify({
                result: texts.join('\n'),
                usage: loop.state.tokenUsage,
                model: loop.state.model,
            }));
        } else {
            console.log('');
        }

        await cleanup();
    } else {
        // Interactive: use Ink React TUI
        try {
            const { startInkApp } = await import('./ui/app.mjs');
            const inkInstance = startInkApp(loop, settings);

            // Wait for Ink to exit (user pressed Ctrl+C or /quit)
            await inkInstance.waitUntilExit();
        } catch (err) {
            // Fallback to readline REPL if Ink fails (e.g. no TTY, missing deps)
            if (settings.debug) {
                console.error(`Ink UI unavailable (${err.message}), falling back to readline REPL`);
            }
            const { startRepl } = await import('./ui/repl.mjs');
            await startRepl(loop, settings);
        }
        await cleanup();
    }
}

function handleEvent(event, settings = {}) {
    switch (event.type) {
        case 'stream_request_start':
            break;
        case 'stream_event':
            process.stdout.write(event.text || '');
            break;
        case 'thinking':
            if (process.env.SHOW_THINKING || settings.verbose) {
                process.stdout.write(`\x1b[2m${event.text}\x1b[0m`);
            }
            break;
        case 'assistant':
            if (!event._streamed && event.content) console.log(event.content);
            break;
        case 'tool_progress':
            process.stderr.write(`\x1b[33m[${event.tool}]\x1b[0m running...\n`);
            break;
        case 'result':
            break;
        case 'compaction':
            process.stderr.write(`\x1b[2m[compaction #${event.count}]\x1b[0m\n`);
            break;
        case 'hookPermissionResult':
            if (!event.allowed) {
                process.stderr.write(`\x1b[31m[blocked: ${event.tool}]\x1b[0m\n`);
            }
            break;
        case 'error':
            console.error(`\x1b[31mError: ${event.message}\x1b[0m`);
            break;
        case 'stop':
            break;
        default:
            break;
    }
}

main().catch(e => { console.error(e); process.exit(1); });
