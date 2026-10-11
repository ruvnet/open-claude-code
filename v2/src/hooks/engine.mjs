/**
 * Hook Engine: command, HTTP and function hooks for pre/post tool use and stop.
 * Legacy flat hooks retain millisecond timeouts and environment input.
 * Claude-style typed hooks use second timeouts and JSON stdin/POST input.
 * Prompt and agent evaluators are not supported.
 */
import { execSync, execFileSync } from 'node:child_process';

export class HookEngine {
    constructor(hooksConfig = {}) { this.hooks = hooksConfig; }

    async runPreToolUse(toolName, input) {
        for (const hook of this._getHooks('PreToolUse', toolName)) {
            const result = await this._executeHook(hook, { event: 'PreToolUse', toolName, input });
            const specific = result?.hookSpecificOutput;
            if (result?.continue === false || ['deny', 'block'].includes(result?.decision)
                || specific?.permissionDecision === 'deny') {
                return { allow: false, message: result.stopReason || result.message || result.reason
                    || specific?.permissionDecisionReason || `Blocked by hook: ${hook.name || 'unnamed'}` };
            }
        }
        return { allow: true };
    }

    async runPostToolUse(toolName, result) {
        let current = result;
        for (const hook of this._getHooks('PostToolUse', toolName)) {
            const output = await this._executeHook(hook, { event: 'PostToolUse', toolName, result: current });
            const specific = output?.hookSpecificOutput;
            if (output?.modifiedResult !== undefined) current = output.modifiedResult;
            if (toolName.startsWith('mcp__') && specific?.updatedMCPToolOutput !== undefined)
                current = specific.updatedMCPToolOutput;
        }
        return current;
    }

    async runStop() {
        for (const hook of this._getHooks('Stop')) {
            const result = await this._executeHook(hook, { event: 'Stop' });
            if (result?.preventStop || result?.decision === 'block') return false;
        }
        return true;
    }

    async runNotification(event, data) {
        for (const hook of this._getHooks('Notification')) {
            try { await this._executeHook(hook, { event, ...data }); } catch { /* best effort */ }
        }
    }

    _getHooks(eventType, toolName) {
        const configured = this.hooks?.[eventType];
        const entries = Array.isArray(configured) ? configured : configured ? [configured] : [];
        return entries.flatMap(entry => {
            if (entry.toolName && entry.toolName !== toolName) return [];
            if (entry.matcher && toolName) {
                try { if (!new RegExp(entry.matcher).test(toolName)) return []; }
                catch {
                    return (Array.isArray(entry.hooks) ? entry.hooks : [entry]).map(hook => ({
                        onFailure: hook.onFailure, failOpen: hook.failOpen,
                        handler: () => { throw new Error('Invalid hook matcher'); },
                    }));
                }
            }
            return Array.isArray(entry.hooks) ? entry.hooks : [entry];
        });
    }

    _timeout(hook) {
        const value = hook.timeout === undefined ? 10000 : Number(hook.timeout) * (hook.type ? 1000 : 1);
        if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid hook timeout');
        return Math.ceil(value);
    }

    _parseOutput(text, http = false) {
        const trimmed = text.trim();
        if (!trimmed) return null;
        let output;
        try { output = JSON.parse(trimmed); }
        catch {
            if (http || /^[\[{]/.test(trimmed)) throw new Error('Invalid hook JSON');
            return { output: trimmed };
        }
        if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Invalid hook output object');
        for (const key of ['continue', 'preventStop']) {
            if (output[key] !== undefined && typeof output[key] !== 'boolean') throw new Error('Invalid hook decision');
        }
        if (output.decision !== undefined && !['allow', 'deny', 'block', 'approve'].includes(output.decision))
            throw new Error('Invalid hook decision');
        const specific = output.hookSpecificOutput;
        if (specific !== undefined && (!specific || typeof specific !== 'object' || Array.isArray(specific)))
            throw new Error('Invalid hook-specific output');
        if (specific?.permissionDecision !== undefined && !['allow', 'deny', 'ask'].includes(specific.permissionDecision))
            throw new Error('Invalid hook permission decision');
        return output;
    }

    async _readHTTPResponse(response) {
        if (!response.body) return '';
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 1024 * 1024) {
                    await reader.cancel('Hook response exceeds 1 MiB');
                    throw new Error('Hook response exceeds 1 MiB');
                }
                chunks.push(value);
            }
            return Buffer.concat(chunks, size).toString('utf-8');
        } finally {
            reader.releaseLock();
        }
    }

    async _executeHook(hook, context) {
        try {
            const timeout = this._timeout(hook);
            const payload = { ...context, hook_event_name: context.event, tool_name: context.toolName,
                tool_input: context.input, tool_response: context.result };
            if (hook.type === 'http') {
                const allowed = new Set(hook.allowedEnvVars || []);
                const headers = Object.fromEntries(Object.entries(hook.headers || {}).map(([key, value]) =>
                    [key, String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
                        (_, braced, plain) => allowed.has(braced || plain) ? process.env[braced || plain] || '' : '')]));
                const response = await fetch(hook.url, { method: 'POST', redirect: 'error',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout) });
                if (!response.ok) throw new Error(`HTTP hook status ${response.status}`);
                return this._parseOutput(await this._readHTTPResponse(response), true);
            }
            if (hook.command) {
                const options = { encoding: 'utf-8', timeout,
                    input: JSON.stringify(payload), stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, HOOK_EVENT: String(context.event || ''),
                        HOOK_TOOL: String(context.toolName || ''), HOOK_INPUT: JSON.stringify(context.input || {}) } };
                const output = Array.isArray(hook.args) ? execFileSync(hook.command, hook.args, options)
                    : execSync(hook.command, options);
                return this._parseOutput(output);
            }
            if (typeof hook.handler === 'function') {
                return await hook.handler(context);
            }
            if (hook.type || hook.onFailure === 'block') throw new Error('Unsupported hook definition');
            return null;
        } catch (err) {
            // Exit 2 is an explicit veto, regardless of the configured failure mode.
            if (err.status === 2) return { decision: context.event === 'Stop' ? 'block' : 'deny', message: 'Hook blocked action (exit 2)' };
            // Stop failure must not create an endless retry loop.
            if (context.event !== 'Stop' && (hook.onFailure === 'block' || hook.failOpen === false))
                return { decision: 'deny', message: 'Hook failed; action blocked by failure policy' };
            return null;
        }
    }
}
