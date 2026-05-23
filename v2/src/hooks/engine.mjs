/**
 * Hook Engine — pre/post tool use and stop hooks.
 *
 * Based on Claude Code's hooks system (6 event types):
 * - PreToolUse: can block tool execution
 * - PostToolUse: can modify results
 * - Stop: can prevent the agent from stopping
 * - Notification: inform external systems
 * - PrePrompt: modify user input
 * - PostResponse: modify assistant output
 *
 * Hooks are defined in settings.json under the "hooks" key.
 */

import { execSync } from 'child_process';

export class HookEngine {
    /**
     * @param {object} hooksConfig - hooks configuration from settings
     */
    constructor(hooksConfig = {}) {
        this.hooks = hooksConfig;
    }

    /**
     * Run pre-tool-use hooks. Returns { allow, message }.
     * If any hook returns deny, the tool call is blocked.
     *
     * @param {string} toolName - name of the tool being called
     * @param {object} input - tool input arguments
     * @returns {Promise<{allow: boolean, message?: string}>}
     */
    async runPreToolUse(toolName, input) {
        const hooks = this._getHooks('PreToolUse');
        for (const hook of hooks) {
            // Check if hook applies to this tool
            if (hook.toolName && hook.toolName !== toolName) continue;

            const result = await this._executeHook(hook, {
                event: 'PreToolUse',
                toolName,
                input,
            });

            if (result?.decision === 'deny' || result?.decision === 'block') {
                return { allow: false, message: result.message || `Blocked by hook: ${hook.name || 'unnamed'}` };
            }
        }
        return { allow: true };
    }

    /**
     * Run post-tool-use hooks. Can modify the result.
     *
     * @param {string} toolName - name of the tool that was called
     * @param {*} result - tool execution result
     * @returns {Promise<*>} possibly modified result
     */
    async runPostToolUse(toolName, result) {
        const hooks = this._getHooks('PostToolUse');
        let current = result;
        for (const hook of hooks) {
            if (hook.toolName && hook.toolName !== toolName) continue;

            const hookResult = await this._executeHook(hook, {
                event: 'PostToolUse',
                toolName,
                result: current,
            });

            if (hookResult?.modifiedResult !== undefined) {
                current = hookResult.modifiedResult;
            }
        }
        return current;
    }

    /**
     * Run stop hooks. Returns true if stop should proceed, false to continue.
     *
     * @returns {Promise<boolean>} whether to allow stopping
     */
    async runStop() {
        const hooks = this._getHooks('Stop');
        for (const hook of hooks) {
            const result = await this._executeHook(hook, { event: 'Stop' });
            if (result?.preventStop) {
                return false; // do not stop
            }
        }
        return true; // allow stop
    }

    /**
     * Run notification hooks (fire-and-forget).
     * @param {string} event - notification event name
     * @param {object} data - event data
     */
    async runNotification(event, data) {
        const hooks = this._getHooks('Notification');
        for (const hook of hooks) {
            try {
                await this._executeHook(hook, { event, ...data });
            } catch {
                // Notifications are best-effort
            }
        }
    }

    /**
     * Get hooks for a given event type.
     * @param {string} eventType
     * @returns {Array}
     */
    _getHooks(eventType) {
        if (!this.hooks || !this.hooks[eventType]) return [];
        const hooks = this.hooks[eventType];
        return Array.isArray(hooks) ? hooks : [hooks];
    }

    /**
     * Execute a single hook. Supports command (shell) and function hooks.
     *
     * Note: hook.command is an operator-configured shell string (defined in
     * settings.json by the user who controls this machine) — it is intentionally
     * executed as a shell command.  The tool input/context is passed ONLY via
     * environment variables (never interpolated into the command string) to
     * prevent escalation from tool input into the hook command itself.
     *
     * @param {object} hook - hook definition
     * @param {object} context - execution context
     * @returns {Promise<object|null>}
     */
    async _executeHook(hook, context) {
        try {
            if (hook.command) {
                // Ensure env values are strings (guards against prototype pollution
                // or non-string values from context objects breaking child_process).
                const env = {
                    ...process.env,
                    HOOK_EVENT: String(context.event || ''),
                    HOOK_TOOL: String(context.toolName || ''),
                    HOOK_INPUT: JSON.stringify(context.input || {}),
                };
                const output = execSync(hook.command, {
                    encoding: 'utf-8',
                    timeout: hook.timeout || 10000,
                    env,
                });
                try {
                    return JSON.parse(output.trim());
                } catch {
                    return { output: output.trim() };
                }
            }

            if (typeof hook.handler === 'function') {
                return await hook.handler(context);
            }

            return null;
        } catch (err) {
            if (hook.failOpen !== false) {
                // Default: fail open (allow)
                return null;
            }
            return { decision: 'deny', message: `Hook error: ${err.message}` };
        }
    }
}
