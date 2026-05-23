/**
 * ExitWorktree Tool — exit and clean up a git worktree.
 */

import { execFileSync } from 'child_process';

export const ExitWorktreeTool = {
    name: 'ExitWorktree',
    description: 'Exit the current git worktree and return to the original directory.',
    inputSchema: {
        type: 'object',
        properties: {
            cleanup: {
                type: 'boolean',
                description: 'Remove the worktree branch after exiting (default: true)',
            },
        },
        required: [],
    },

    validateInput() { return []; },

    async call(input) {
        const { EnterWorktreeTool } = await import('./enter-worktree.mjs');
        const wt = EnterWorktreeTool._activeWorktree;

        if (!wt) {
            return 'Not currently in a worktree.';
        }

        const cleanup = input.cleanup !== false;

        try {
            process.chdir(wt.originalCwd);

            if (cleanup) {
                try {
                    // Security: pass path and branch as discrete args — no shell injection
                    execFileSync('git', ['worktree', 'remove', wt.path, '--force'], {
                        encoding: 'utf-8',
                        stdio: 'pipe',
                    });
                    execFileSync('git', ['branch', '-D', wt.branch], {
                        encoding: 'utf-8',
                        stdio: 'pipe',
                    });
                } catch {
                    // Best effort cleanup
                }
            }

            EnterWorktreeTool._activeWorktree = null;
            return `Exited worktree. Returned to ${wt.originalCwd}${cleanup ? ' (cleaned up)' : ''}`;
        } catch (err) {
            return `Error exiting worktree: ${err.message}`;
        }
    },
};
