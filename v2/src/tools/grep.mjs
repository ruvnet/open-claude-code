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
import fs from 'fs';
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
            const searchTool = getSearchTool();
            const useRg = searchTool === 'rg';

            if (!searchTool) {
                return searchWithJavaScript(dir, input, mode, limit);
            }

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
                args.push(searchTool, '-r');
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

let _searchTool;
function getSearchTool() {
    if (_searchTool !== undefined) return _searchTool;
    for (const tool of ['rg', 'grep']) {
        try {
            execFileSync(tool, ['--version'], { timeout: 5000, stdio: 'ignore' });
            _searchTool = tool;
            return _searchTool;
        } catch {
            // Try the next executable.
        }
    }
    _searchTool = null;
    return _searchTool;
}

function searchWithJavaScript(root, input, mode, limit) {
    let expression;
    try {
        expression = new RegExp(input.pattern, input['-i'] ? 'i' : '');
    } catch {
        return 'No matches found.';
    }

    const output = [];
    const files = fs.statSync(root).isDirectory() ? collectFiles(root) : [root];
    for (const file of files) {
        if (input.glob && !matchesGlob(path.basename(file), input.glob)) continue;
        if (input.type && path.extname(file).slice(1) !== input.type) continue;

        let content;
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        if (content.includes('\0')) continue;

        const lines = content.split(/\r?\n/);
        const matches = [];
        lines.forEach((line, index) => {
            expression.lastIndex = 0;
            if (expression.test(line)) matches.push({ line, index });
        });
        if (matches.length === 0) continue;

        if (mode === 'files_with_matches') {
            output.push(file);
        } else if (mode === 'count') {
            output.push(`${file}:${matches.length}`);
        } else {
            for (const match of matches) {
                output.push(input['-n'] === false ? match.line : `${file}:${match.index + 1}:${match.line}`);
            }
        }
        if (limit > 0 && output.length >= limit) break;
    }

    return output.slice(0, limit > 0 ? limit : undefined).join('\n') || 'No matches found.';
}

function collectFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectFiles(fullPath));
        else if (entry.isFile()) files.push(fullPath);
    }
    return files;
}

function matchesGlob(filename, glob) {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${pattern}$`).test(filename);
}
