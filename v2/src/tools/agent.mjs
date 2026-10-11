/**
 * Agent Tool — spawn a subagent with its own agent loop.
 *
 * Features:
 * - subagent_type parameter
 * - worktree isolation is rejected until implemented
 * - run_in_background option
 * - model override
 */

import { createAgentLoop } from '../core/agent-loop.mjs';
import { createPermissionChecker } from '../permissions/checker.mjs';

export const AgentTool = {
    name: 'Agent',
    description: 'Spawn a subagent to handle a task. The subagent has its own context and tools.',
    inputSchema: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description: 'The task for the subagent to perform',
            },
            allowed_tools: {
                type: 'array',
                items: { type: 'string' },
                description: 'Subset of parent tools the subagent can use (default: inherited tools)',
            },
            subagent_type: {
                type: 'string',
                description: 'Type of subagent (e.g. coder, reviewer, researcher)',
            },
            isolation: {
                type: 'string',
                enum: ['default', 'worktree'],
                description: 'Isolation mode. Worktree requests are currently rejected.',
            },
            run_in_background: {
                type: 'boolean',
                description: 'Run in background and return immediately',
            },
            model: {
                type: 'string',
                description: 'Override model for this subagent',
            },
        },
        required: ['prompt'],
    },

    validateInput(input) {
        const errors = [];
        if (typeof input?.prompt !== 'string' || !input.prompt.trim()) errors.push('prompt is required');
        if (input?.allowed_tools !== undefined && (!Array.isArray(input.allowed_tools) || !input.allowed_tools.every(n => typeof n === 'string'))) errors.push('allowed_tools must be an array of tool names');
        return errors;
    },

    // Track background subagents
    _backgroundAgents: new Map(),
    _nextBgId: 0,

    async call(input, context = {}) {
        const errors = AgentTool.validateInput(input);
        if (errors.length) throw new Error(errors.join(', '));
        if (input.isolation && input.isolation !== 'default') throw new Error('Subagent worktree isolation is not implemented.');
        const { createToolRegistry } = await import('./registry.mjs');
        const policy = createSubagentPolicy(input, context, createToolRegistry());
        const model = input.model || context.model || process.env.SUBAGENT_MODEL || 'claude-sonnet-4-6';
        const { tools, permissions } = policy;
        if (input.run_in_background && [...AgentTool._backgroundAgents.values()].filter(a => a.status === 'running').length >= 4) throw new Error('Background subagent concurrency limit reached.');

        // Build type-specific system prompt prefix
        let systemPrefix = '';
        if (input.subagent_type) {
            const typePrompts = {
                coder: 'You are a coding agent. Write clean, tested code.',
                reviewer: 'You are a code reviewer. Analyze code for bugs and improvements.',
                researcher: 'You are a research agent. Find and summarize information.',
                tester: 'You are a testing agent. Write and run tests.',
                planner: 'You are a planning agent. Break down tasks into steps.',
            };
            systemPrefix = typePrompts[input.subagent_type] || `You are a ${input.subagent_type} agent.`;
        }

        const fullPrompt = systemPrefix
            ? `${systemPrefix}\n\nTask: ${input.prompt}`
            : input.prompt;

        const loop = createAgentLoop({
            model,
            tools,
            permissions,
            settings: policy.settings,
            hooks: policy.hooks,
        });

        if (input.run_in_background) {
            const bgId = ++AgentTool._nextBgId;
            const entry = { id: bgId, status: 'running', result: null, prompt: input.prompt };
            AgentTool._backgroundAgents.set(bgId, entry);

            // Run in background
            runSubagent(loop, fullPrompt).then(result => {
                entry.status = 'completed';
                entry.result = result;
            }).catch(err => {
                entry.status = 'error';
                entry.result = err.message;
            });

            return `Subagent started in background: id=${bgId}`;
        }

        return runSubagent(loop, fullPrompt);
    },
};

async function runSubagent(loop, prompt) {
    const results = [];
    try {
        for await (const event of loop.run(prompt)) {
            if (event.type === 'assistant' && event.content) {
                results.push(event.content);
            }
            if (event.type === 'error') throw new Error(event.message || 'Subagent failed');
            if (event.type === 'result') {
                results.push(`[tool:${event.tool}] ${String(event.result).slice(0, 500)}`);
            }
        }
    } catch (err) {
        return `Subagent error: ${err.message}`;
    }

    return results.join('\n') || 'Subagent completed with no output.';
}

const SAFE_STANDALONE_TOOLS = ['Read', 'Glob', 'Grep', 'LS'];
const MAX_CHILD_TURNS = 10;
const MAX_DELEGATION_DEPTH = 3;

/** Child capabilities are an intersection, never a fresh grant. */
export function createSubagentPolicy(input, context = {}, registry) {
    const errors = AgentTool.validateInput(input);
    if (errors.length) throw new Error(errors.join(', '));
    if (input.isolation && input.isolation !== 'default') {
        throw new Error('Subagent worktree isolation is not implemented; refusing to run without isolation.');
    }
    const depth = context.delegationDepth ?? 0;
    const maxDepth = Math.min(context.settings?.maxDelegationDepth ?? 2, MAX_DELEGATION_DEPTH);
    if (!Number.isInteger(depth) || depth < 0 || !Number.isInteger(maxDepth) || depth >= maxDepth) {
        throw new Error('Subagent delegation depth limit reached.');
    }
    const inheritedNames = context.allowedToolNames ?? SAFE_STANDALONE_TOOLS;
    if (!Array.isArray(inheritedNames) || !inheritedNames.every(n => typeof n === 'string')) {
        throw new Error('Invalid parent tool policy.');
    }
    const requested = new Set(input.allowed_tools ?? inheritedNames);
    const allowed = new Set(inheritedNames.filter(name => requested.has(name) && registry.has(name)));
    const parentPermissions = context.permissions ?? createPermissionChecker({ defaultMode: 'plan' });
    if (typeof parentPermissions.check !== 'function') throw new Error('Invalid parent permission checker.');
    const childContext = {
        ...context,
        allowedToolNames: [...allowed],
        delegationDepth: depth + 1,
        settings: {
            ...context.settings,
            stream: false,
            allowedTools: [...allowed],
            maxTurns: Math.min(context.settings?.maxTurns || MAX_CHILD_TURNS, MAX_CHILD_TURNS),
            maxDelegationDepth: maxDepth,
            delegationDepth: depth + 1,
        },
    };
    const permissions = {
        mode: parentPermissions.mode,
        async check(name, toolInput) {
            return allowed.has(name) && await parentPermissions.check(name, toolInput) === true;
        },
    };
    childContext.permissions = permissions;
    const tools = {
        list: () => registry.list().filter(tool => allowed.has(tool.name)),
        has: name => allowed.has(name),
        get: name => allowed.has(name) ? registry.get(name) : undefined,
        async call(name, toolInput) {
            if (!await permissions.check(name, toolInput)) throw new Error('Subagent tool denied: ' + name);
            // Explicit context propagation also works with older registry dispatchers.
            if (name === 'Agent') return AgentTool.call(toolInput, childContext);
            return registry.call(name, toolInput, childContext);
        },
    };
    return { ...childContext, tools, permissions };
}
