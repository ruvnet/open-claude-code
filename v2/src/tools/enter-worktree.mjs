/**
 * EnterWorktree Tool — create and enter a git worktree for isolation.
 *
 * Creates a temporary worktree branch so edits do not affect the main branch.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import os from 'os';

export const EnterWorktreeTool = {
    name: 'EnterWorktree',
    description: 'Create a git worktree for isolated file editing.',
    inputSchema: {
        type: 'object',
        properties: {
            branch: {
                type: 'string',
                description: 'Branch name for the worktree (auto-generated if omitted)',
            },
            path: {
                type: 'string',
                description: 'Directory for the worktree (temp dir if omitted)',
            },
        },
        required: [],
    },

    // Shared state for active worktree
    _activeWorktree: null,

    validateInput() { return []; },

    async call(input) {
        if (this._activeWorktree) {
            return `Already in worktree at ${this._activeWorktree.path}. Use ExitWorktree first.`;
        }

        try {
            // Verify we are in a git repo
            // Security: execFileSync so arguments are not shell-interpolated
            execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf-8' });
        } catch {
            return 'Error: not inside a git repository';
        }

        const branch = input.branch || `occ-worktree-${Date.now()}`;
        const worktreePath = input.path || path.join(os.tmpdir(), `occ-wt-${Date.now()}`);
        const originalCwd = process.cwd();

        try {
            // Security: pass branch and worktreePath as discrete args — no shell injection
            execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath], {
                encoding: 'utf-8',
                stdio: 'pipe',
            });

            this._activeWorktree = {
                path: worktreePath,
                branch,
                originalCwd,
            };

            process.chdir(worktreePath);

            return `Entered worktree:\n  Branch: ${branch}\n  Path: ${worktreePath}\n  Original: ${originalCwd}`;
        } catch (err) {
            return `Error creating worktree: ${err.message}`;
        }
    },
};
