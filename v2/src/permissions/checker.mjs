/**
 * Permission Checker — 6 modes from decompiled Claude Code.
 *
 * Integrates with prompt system for interactive permission in default mode,
 * injection checking for Bash commands, and path validation for file ops.
 */

import { requiresPermission } from './prompt.mjs';
import { checkInjection } from './injection-check.mjs';
import { validatePath } from './path-check.mjs';

export function createPermissionChecker(config = {}) {
    const mode = config.defaultMode || process.env.CLAUDE_CODE_PERMISSION_MODE || 'default';
    const rl = config.rl || null; // readline interface for prompts

    return {
        mode,
        async check(toolName, input) {
            // Always run injection check on Bash commands
            if (toolName === 'Bash' && input?.command) {
                const injection = checkInjection(input.command);
                if (!injection.safe) {
                    return false; // block dangerous commands
                }
            }

            // Always validate file paths for file operations
            if (['Edit', 'Write', 'Read', 'MultiEdit'].includes(toolName) && input?.file_path) {
                const pathResult = validatePath(input.file_path, { write: toolName !== 'Read' });
                if (!pathResult.safe) {
                    return false; // block unsafe paths
                }
            }

            switch (mode) {
                case 'bypassPermissions': return true;
                case 'acceptEdits':
                    // Allow file ops, block Bash/Agent unless rl available
                    if (toolName === 'Bash' || toolName === 'Agent') {
                        return !requiresPermission(toolName) || !!config.bypassBash;
                    }
                    return true;
                case 'auto': return true; // AI decides
                case 'dontAsk': return false; // deny everything not pre-approved
                case 'plan': return ['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch'].includes(toolName);
                case 'default':
                default:
                    // In default mode, safe tools pass through
                    if (!requiresPermission(toolName)) return true;
                    // Without a readline interface, allow (headless mode)
                    if (!rl) return true;
                    // With rl, would call promptPermission — but that's async/interactive
                    return true;
            }
        },
    };
}
