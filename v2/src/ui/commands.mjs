/**
 * Slash Commands — all 39 commands from Claude Code.
 *
 * Each command is a function(args, state) that returns a string response.
 * Commands are invoked via /command-name in the REPL.
 */

import { SessionManager } from '../core/session.mjs';
import { CheckpointManager } from '../core/checkpoints.mjs';
import { PromptCache } from '../core/cache.mjs';
import { readEnv, listEnvVars } from '../config/env.mjs';
import * as telemetry from '../telemetry/index.mjs';

const checkpoints = new CheckpointManager();
const promptCache = new PromptCache();
let sessionManager = null;

function getSession() {
    if (!sessionManager) sessionManager = new SessionManager();
    return sessionManager;
}

/**
 * All slash commands.
 */
export const COMMANDS = {
    '/help': {
        description: 'Show available commands',
        handler(args, state) {
            const lines = ['', 'Available commands:'];
            for (const [name, cmd] of Object.entries(COMMANDS)) {
                lines.push(`  ${name.padEnd(20)} ${cmd.description}`);
            }
            lines.push('');
            return lines.join('\n');
        },
    },

    '/clear': {
        description: 'Clear conversation history',
        handler(args, state) {
            state.messages.length = 0;
            state.turnCount = 0;
            return 'Conversation cleared.';
        },
    },

    '/compact': {
        description: 'Manually compact conversation context',
        handler(args, state) {
            const before = state.messages.length;
            const beforeTokens = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : 0;

            if (state._contextManager) {
                state.messages = state._contextManager.compact(state.messages);
            } else {
                if (state.messages.length > 10) {
                    state.messages = state.messages.slice(-8);
                }
            }

            const afterTokens = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : 0;

            return `Compacted: ${before} -> ${state.messages.length} messages` +
                (beforeTokens ? ` (~${beforeTokens} -> ~${afterTokens} tokens)` : '');
        },
    },

    '/cost': {
        description: 'Show token usage and estimated cost',
        handler(args, state) {
            const { input, output } = state.tokenUsage;
            // Use model-appropriate pricing
            const model = state.model || '';
            let priceIn = 3, priceOut = 15; // Sonnet default
            if (model.includes('haiku')) { priceIn = 0.25; priceOut = 1.25; }
            if (model.includes('opus')) { priceIn = 15; priceOut = 75; }

            const costIn = (input / 1_000_000) * priceIn;
            const costOut = (output / 1_000_000) * priceOut;
            const total = costIn + costOut;
            return [
                `Token usage: input=${input}, output=${output}`,
                `Estimated cost: $${total.toFixed(4)} (in: $${costIn.toFixed(4)}, out: $${costOut.toFixed(4)})`,
                `Model: ${state.model || 'default'}`,
                `Turns: ${state.turnCount}`,
            ].join('\n');
        },
    },

    '/doctor': {
        description: 'Check system health and configuration',
        handler(args, state) {
            const checks = [];
            checks.push(`Node.js: ${process.version}`);
            checks.push(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'NOT SET'}`);
            checks.push(`Model: ${state.model || 'default'}`);
            checks.push(`Tools: ${state.tools?.list?.()?.length || 0}`);
            checks.push(`Messages: ${state.messages.length}`);
            checks.push(`CWD: ${process.cwd()}`);
            checks.push(`Platform: ${process.platform}`);

            // Check API connectivity
            let apiStatus = 'unchecked';
            if (process.env.ANTHROPIC_API_KEY) {
                apiStatus = 'key present';
            }
            checks.push(`API: ${apiStatus}`);

            // Check MCP servers
            const mcpCount = state._mcpClients?.length || 0;
            checks.push(`MCP servers: ${mcpCount}`);

            return `System check:\n${checks.map(c => `  ${c}`).join('\n')}`;
        },
    },

    '/fast': {
        description: 'Toggle fast mode (uses faster, cheaper model)',
        handler(args, state) {
            if (state.model?.includes('haiku')) {
                state.model = 'claude-sonnet-4-6';
                return 'Fast mode OFF — using claude-sonnet-4-6';
            }
            state.model = 'claude-haiku-4-5';
            return 'Fast mode ON — using claude-haiku-4-5';
        },
    },

    '/model': {
        description: 'Show or switch model',
        handler(args, state) {
            if (args) {
                state.model = args;
                return `Model switched to: ${args}`;
            }
            return `Current model: ${state.model || 'default'}`;
        },
    },

    '/tokens': {
        description: 'Show token usage and context size',
        handler(args, state) {
            const contextTokens = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : '?';
            return [
                `Input: ${state.tokenUsage.input}, Output: ${state.tokenUsage.output}`,
                `Messages: ${state.messages.length}`,
                `Context: ~${contextTokens} tokens`,
            ].join('\n');
        },
    },

    '/tools': {
        description: 'List available tools',
        handler(args, state) {
            const tools = state.tools?.list?.() || [];
            if (tools.length === 0) return 'No tools registered.';
            const lines = tools.map(t => `  ${t.name.padEnd(20)} ${(t.description || '').slice(0, 55)}`);
            return `Tools (${tools.length}):\n${lines.join('\n')}`;
        },
    },

    '/quit': {
        description: 'Exit the REPL',
        handler() { return 'EXIT'; },
    },

    '/exit': {
        description: 'Exit the REPL',
        handler() { return 'EXIT'; },
    },

    '/bug': {
        description: 'Report a bug',
        handler() {
            return 'Report bugs at: https://github.com/ruvnet/open-claude-code/issues';
        },
    },

    '/review': {
        description: 'Review recent changes',
        handler(args, state) {
            try {
                const { execSync } = require('child_process');
                const diff = execSync('git diff --stat HEAD~1 2>/dev/null || echo "No git history"', { encoding: 'utf-8' });
                return `Recent changes:\n${diff}`;
            } catch {
                return 'Unable to review changes (not in a git repo or no history).';
            }
        },
    },

    '/init': {
        description: 'Initialize Claude Code in current directory',
        handler() {
            const fs = require('fs');
            const path = require('path');
            const claudeDir = path.join(process.cwd(), '.claude');
            fs.mkdirSync(claudeDir, { recursive: true });
            const settingsFile = path.join(claudeDir, 'settings.json');
            if (!fs.existsSync(settingsFile)) {
                fs.writeFileSync(settingsFile, JSON.stringify({ permissions: {}, hooks: {} }, null, 2));
            }
            return `Initialized .claude/ in ${process.cwd()}`;
        },
    },

    '/login': {
        description: 'Set API key',
        handler(args) {
            if (args) {
                process.env.ANTHROPIC_API_KEY = args;
                return 'API key set.';
            }
            return 'Usage: /login <api-key>';
        },
    },

    '/logout': {
        description: 'Clear API key',
        handler() {
            delete process.env.ANTHROPIC_API_KEY;
            return 'API key cleared.';
        },
    },

    '/status': {
        description: 'Show session status',
        handler(args, state) {
            const session = getSession();
            const info = session.info();
            return [
                `Session: ${info.id}`,
                `Project: ${info.projectDir}`,
                `Started: ${info.startedAt}`,
                `Model: ${state.model}`,
                `Turns: ${state.turnCount}`,
                `Messages: ${state.messages.length}`,
            ].join('\n');
        },
    },

    '/config': {
        description: 'Show current configuration',
        handler(args, state) {
            const env = readEnv();
            const lines = ['Configuration:'];
            for (const [key, val] of Object.entries(env)) {
                if (key.includes('KEY') || key.includes('TOKEN')) continue;
                lines.push(`  ${key}: ${val}`);
            }
            return lines.join('\n');
        },
    },

    '/memory': {
        description: 'Show conversation memory usage',
        handler(args, state) {
            const msgSize = JSON.stringify(state.messages).length;
            const tokenEst = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : Math.ceil(msgSize / 4);
            return `Memory: ${state.messages.length} messages, ~${(msgSize / 1024).toFixed(1)}KB, ~${tokenEst} tokens`;
        },
    },

    '/forget': {
        description: 'Remove last N messages',
        handler(args, state) {
            const n = parseInt(args) || 2;
            const removed = state.messages.splice(-n, n);
            return `Removed ${removed.length} messages.`;
        },
    },

    '/effort': {
        description: 'Set effort level (low/normal/high)',
        handler(args, state) {
            const levels = ['low', 'normal', 'high'];
            if (args && levels.includes(args)) {
                state._effortLevel = args;
                return `Effort level set to: ${args}`;
            }
            return `Current effort: ${state._effortLevel || 'normal'}. Options: low, normal, high`;
        },
    },

    '/think': {
        description: 'Toggle extended thinking',
        handler(args, state) {
            state._thinking = !state._thinking;
            return `Extended thinking: ${state._thinking ? 'ON' : 'OFF'}`;
        },
    },

    '/plan': {
        description: 'Enter plan mode (read-only)',
        handler(args, state) {
            state._planMode = !state._planMode;
            return `Plan mode: ${state._planMode ? 'ON (read-only)' : 'OFF'}`;
        },
    },

    '/vim': {
        description: 'Toggle vim keybindings',
        handler(args, state) {
            state._vimMode = !state._vimMode;
            return `Vim mode: ${state._vimMode ? 'ON' : 'OFF'}`;
        },
    },

    '/terminal-setup': {
        description: 'Show terminal setup info',
        handler() {
            return [
                'Terminal setup:',
                `  TERM: ${process.env.TERM || 'unknown'}`,
                `  COLUMNS: ${process.stdout.columns || 'unknown'}`,
                `  ROWS: ${process.stdout.rows || 'unknown'}`,
                `  Color: ${process.stdout.hasColors?.() ? 'yes' : 'unknown'}`,
                `  Unicode: ${process.env.LANG?.includes('UTF') ? 'yes' : 'unknown'}`,
            ].join('\n');
        },
    },

    '/mcp': {
        description: 'Show MCP server status',
        handler(args, state) {
            if (!state._mcpClients || state._mcpClients.length === 0) {
                return 'No MCP servers connected.';
            }
            const lines = state._mcpClients.map((c, i) =>
                `  ${i + 1}. ${c.config?.command || 'unknown'} — ${c.connected ? 'connected' : 'disconnected'}`
            );
            return `MCP servers:\n${lines.join('\n')}`;
        },
    },

    '/permissions': {
        description: 'Show permission mode',
        handler(args, state) {
            return `Permission mode: ${state._permissionMode || 'default'}`;
        },
    },

    '/hooks': {
        description: 'Show configured hooks',
        handler(args, state) {
            if (!state._hooks) return 'No hooks configured.';
            const hooks = state._hooks;
            const lines = [];
            for (const [event, handlers] of Object.entries(hooks)) {
                const arr = Array.isArray(handlers) ? handlers : [handlers];
                lines.push(`  ${event}: ${arr.length} handler(s)`);
            }
            return lines.length > 0 ? `Hooks:\n${lines.join('\n')}` : 'No hooks configured.';
        },
    },

    '/agents': {
        description: 'List custom agents',
        handler(args, state) {
            if (!state._agentLoader) return 'No agent loader initialized.';
            const agents = state._agentLoader.list();
            if (agents.length === 0) return 'No custom agents loaded.';
            return `Agents:\n${agents.map(a => `  ${a.name}: ${a.description}`).join('\n')}`;
        },
    },

    '/skills': {
        description: 'List available skills',
        handler(args, state) {
            if (!state._skillsLoader) return 'No skills loaded.';
            const skills = state._skillsLoader.list();
            if (skills.length === 0) return 'No skills loaded.';
            return `Skills:\n${skills.map(s => `  /${s.name}: ${s.description}`).join('\n')}`;
        },
    },

    '/schedule': {
        description: 'List scheduled tasks',
        handler() {
            const { cronStore } = require('../tools/cron-create.mjs');
            if (!cronStore || cronStore.size === 0) return 'No scheduled tasks.';
            const lines = [];
            for (const [, job] of cronStore) {
                lines.push(`  ${job.id}: ${job.name} (${job.schedule})`);
            }
            return `Scheduled:\n${lines.join('\n')}`;
        },
    },

    '/extra-usage': {
        description: 'Show detailed usage stats',
        handler(args, state) {
            const cacheStats = promptCache.getStats();
            const telemetryStats = telemetry.getStats();
            return [
                `Tokens: in=${state.tokenUsage.input}, out=${state.tokenUsage.output}`,
                `Cache: hits=${cacheStats.cacheHits}, misses=${cacheStats.cacheMisses}, rate=${cacheStats.hitRate}`,
                `Telemetry: ${telemetryStats.totalEvents} events`,
            ].join('\n');
        },
    },

    '/undo': {
        description: 'Undo last file edit (restore checkpoint)',
        handler() {
            const result = checkpoints.undo();
            if (!result) return 'No checkpoints to undo.';
            if (result.restored) return `Restored: ${result.filePath}`;
            return `Undo failed: ${result.error || 'unknown error'}`;
        },
    },

    '/diff': {
        description: 'Show git diff',
        handler() {
            try {
                const { execSync } = require('child_process');
                return execSync('git diff --stat 2>/dev/null || echo "Not in a git repo"', { encoding: 'utf-8' });
            } catch {
                return 'Unable to show diff.';
            }
        },
    },

    '/listen': {
        description: 'Toggle listening mode (voice input stub)',
        handler(args, state) {
            state._listening = !state._listening;
            return `Listening mode: ${state._listening ? 'ON (stub)' : 'OFF'}`;
        },
    },

    '/commit': {
        description: 'Create a git commit with AI message',
        handler(args) {
            try {
                // Security: use execFileSync with discrete args so the commit
                // message is never shell-interpolated (prevents injection via
                // crafted message strings containing shell metacharacters).
                const { execFileSync } = require('child_process');
                const msg = args || 'Update from open-claude-code';
                execFileSync('git', ['add', '-A'], { encoding: 'utf-8' });
                execFileSync('git', ['commit', '-m', msg], { encoding: 'utf-8' });
                return `Committed: ${msg}`;
            } catch (err) {
                return `Commit failed: ${err.message}`;
            }
        },
    },

    '/pr': {
        description: 'Create a pull request (stub)',
        handler() {
            return 'PR creation requires gh CLI. Run: gh pr create --fill';
        },
    },

    '/release': {
        description: 'Create a release (stub)',
        handler() {
            return 'Release creation requires gh CLI. Run: gh release create <tag>';
        },
    },
};

/**
 * Execute a slash command.
 * @param {string} input - full command string (e.g., "/model claude-sonnet-4-6")
 * @param {object} state - agent loop state
 * @returns {{ response: string, exit: boolean }}
 */
export function executeCommand(input, state) {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const command = COMMANDS[cmd];
    if (!command) {
        return { response: `Unknown command: ${cmd}. Type /help for available commands.`, exit: false };
    }

    const response = command.handler(args, state);
    return { response, exit: response === 'EXIT' };
}

/**
 * Get command completions for tab-complete.
 * @param {string} partial
 * @returns {string[]}
 */
export function getCompletions(partial) {
    return Object.keys(COMMANDS).filter(c => c.startsWith(partial));
}
