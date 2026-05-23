/**
 * Grep Tool — matches Claude Code's exact behavior.
 *
 * Features:
 * - Case insensitive (-i)
 * - Line numbers (-n, default true for content mode)
 * - Context lines (-A, -B, -C)
 * - output_mode: content, files_with_matches, count
 * - glob filter and type filter
 * - head_limit (default 250)
 * - multiline mode
 *
 * Security: uses execFileSync (array-based) so pattern, glob, type, and dir
 * are never interpolated into a shell string — no command injection.
 */
import { execFileSync } from 'child_process';
import path from 'path';

export const GrepTool = {
    name: 'Grep',
    description: 'Search file contents with regex (powered by ripgrep or grep).',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Regex pattern to search for' },
            path: { type: 'string', description: 'File or directory to search in' },
            '-i': { type: 'boolean', description: 'Case insensitive' },
            '-n': { type: 'boolean', description: 'Show line numbers (default true)' },
            '-A': { type: 'number', description: 'Lines after match' },
            '-B': { type: 'number', description: 'Lines before match' },
            '-C': { type: 'number', description: 'Context lines (before and after)' },
            context: { type: 'number', description: 'Alias for -C' },
            output_mode: {
                type: 'string',
                enum: ['content', 'files_with_matches', 'count'],
                description: 'Output mode (default: files_with_matches)',
            },
            glob: { type: 'string', description: 'Glob pattern to filter files' },
            type: { type: 'string', description: 'File type filter (e.g. js, py)' },
            head_limit: { type: 'number', description: 'Max output lines (default 250)' },
            multiline: { type: 'boolean', description: 'Enable multiline matching' },
        },
        required: ['pattern'],
    },
    validateInput(input) { return input.pattern ? [] : ['pattern required']; },
    async call(input) {
        try {
            const dir = path.resolve(input.path || '.');
            const mode = input.output_mode || 'files_with_matches';
            const limit = input.head_limit ?? 250;

            // Build grep command — try rg first, fall back to grep
            const args = [];
            const useRg = hasRipgrep();

            if (useRg) {
                args.push('rg');
                if (input['-i']) args.push('-i');
                if (input.multiline) args.push('-U', '--multiline-dotall');

                if (mode === 'files_with_matches') {
                    args.push('-l');
                } else if (mode === 'count') {
                    args.push('-c');
                } else {
                    // content mode
                    const showLineNumbers = input['-n'] !== false;
                    if (showLineNumbers) args.push('-n');
                }

                const ctx = input['-C'] || input.context;
                if (ctx && mode === 'content') args.push('-C', String(ctx));
                if (input['-A'] && mode === 'content') args.push('-A', String(input['-A']));
                if (input['-B'] && mode === 'content') args.push('-B', String(input['-B']));

                if (input.glob) args.push('--glob', input.glob);
                if (input.type) args.push('--type', input.type);

                args.push('--', input.pattern, dir);
            } else {
                args.push('grep', '-r');
                if (input['-i']) args.push('-i');

                if (mode === 'files_with_matches') {
                    args.push('-l');
                } else if (mode === 'count') {
                    args.push('-c');
                } else {
                    if (input['-n'] !== false) args.push('-n');
                }

                const ctx = input['-C'] || input.context;
                if (ctx && mode === 'content') args.push('-C', String(ctx));
                if (input['-A'] && mode === 'content') args.push('-A', String(input['-A']));
                if (input['-B'] && mode === 'content') args.push('-B', String(input['-B']));

                if (input.glob) args.push('--include', input.glob);

                args.push('--', input.pattern, dir);
            }

            // args[0] is the tool name (rg/grep); the rest are arguments.
            // Use execFileSync so nothing is shell-interpolated.
            const tool = args.shift(); // 'rg' or 'grep'
            let result;
            try {
                result = execFileSync(tool, args, {
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 30000,
                });
            } catch (e) {
                // exit code 1 from grep/rg means no matches — not an error
                result = e.stdout || '';
            }

            // Apply head_limit by slicing lines in JS (no shell pipe needed)
            if (limit > 0) {
                const lines = result.split('\n');
                if (lines.length > limit) {
                    result = lines.slice(0, limit).join('\n');
                }
            }

            return result.trim() || 'No matches found.';
        } catch {
            return 'No matches found.';
        }
    },
};

let _hasRg = null;
function hasRipgrep() {
    if (_hasRg !== null) return _hasRg;
    try {
        execFileSync('which', ['rg'], { encoding: 'utf-8', timeout: 5000 });
        _hasRg = true;
    } catch {
        _hasRg = false;
    }
    return _hasRg;
}
