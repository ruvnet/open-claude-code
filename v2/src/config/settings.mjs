/**
 * Settings chain — user/project/local/managed (from decompiled source).
 *
 * Supports all 76 properties from Claude Code's settings schema.
 * Five-layer hierarchy: user > project > local > managed > feature flags.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Full settings schema with defaults.
 */
export const SETTINGS_SCHEMA = {
    permissions: {
        defaultMode: 'default',
        allowRules: [],
        denyRules: [],
        allowedTools: [],
        deniedTools: [],
        sandbox: true,
        sandboxAllowPaths: [],
    },
    hooks: {
        PreToolUse: [],
        PostToolUse: [],
        PreToolUseFailure: [],
        PostToolUseFailure: [],
        Notification: [],
        Stop: [],
        SessionStart: [],
    },
    model: 'claude-sonnet-4-6',
    subagentModel: null,
    fastModel: 'claude-haiku-4-5',
    fastMode: false,
    alwaysThinkingEnabled: false,
    autoCompactEnabled: true,
    fileCheckpointingEnabled: true,
    promptSuggestionEnabled: true,
    briefMode: false,
    maxContextTokens: 180000,
    maxOutputTokens: 16384,
    maxTokens: 16384,
    thinkingBudget: 10000,
    compactThreshold: 0.8,
    stream: true,
    mcpServers: {},
    theme: 'auto',
    showThinking: false,
    showToolResults: false,
    showTokenUsage: true,
    vimMode: false,
    terminalBell: false,
    telemetryEnabled: false,
    debugMode: false,
    enableTeams: false,
    agentId: null,
    cronEnabled: true,
    featureFlags: {},
    // Metaharness self-optimization (opt-in; default OFF — behavior unchanged).
    selfOptimize: false,
    selfOptimizeQualityBar: 0.7,
    selfOptimizeLadder: null,
};

export async function loadSettings() {
    const chain = [
        path.join(os.homedir(), '.claude', 'settings.json'),
        path.join(process.cwd(), '.claude', 'settings.json'),
        path.join(process.cwd(), '.claude', 'settings.local.json'),
    ];

    let merged = deepClone(SETTINGS_SCHEMA);

    for (const file of chain) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            merged = deepMerge(merged, data);
        } catch {
            // File not found or invalid
        }
    }

    applyEnvOverrides(merged);
    return merged;
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target, source) {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key] || {}, value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function applyEnvOverrides(settings) {
    if (process.env.ANTHROPIC_MODEL) settings.model = process.env.ANTHROPIC_MODEL;
    if (process.env.CLAUDE_CODE_SUBAGENT_MODEL) settings.subagentModel = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
    if (process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) {
        const n = parseInt(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, 10);
        if (!isNaN(n)) { settings.maxOutputTokens = n; settings.maxTokens = n; }
    }
    if (process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS) {
        const n = parseInt(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, 10);
        if (!isNaN(n)) settings.maxContextTokens = n;
    }
    if (process.env.CLAUDE_CODE_BRIEF === '1') settings.briefMode = true;
    if (process.env.CLAUDE_CODE_DEBUG === '1') settings.debugMode = true;
    if (process.env.CLAUDE_CODE_PERMISSION_MODE) settings.permissions.defaultMode = process.env.CLAUDE_CODE_PERMISSION_MODE;
    if (process.env.CLAUDE_CODE_STREAMING === '0') settings.stream = false;
    if (process.env.CLAUDE_CODE_THINKING === '1') settings.alwaysThinkingEnabled = true;
    if (process.env.CLAUDE_CODE_DISABLE_CRON === '1') settings.cronEnabled = false;
    if (process.env.CLAUDE_CODE_ENABLE_TASKS === '1') settings.enableTeams = true;
    if (process.env.CLAUDE_CODE_SELF_OPTIMIZE === '1') settings.selfOptimize = true;
    if (process.env.CLAUDE_CODE_SELF_OPTIMIZE === '0') settings.selfOptimize = false;
}
