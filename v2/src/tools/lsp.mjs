/**
 * LSP Tool — Language Server Protocol integration stub.
 *
 * Provides a tool interface for language server features:
 * - diagnostics (errors/warnings)
 * - completions
 * - hover information
 * - go-to-definition
 * - references
 *
 * This is a stub implementation. Full LSP would spawn an actual language
 * server process and communicate via JSON-RPC.
 */

import { execFileSync } from 'child_process';
import path from 'path';

export const LspTool = {
    name: 'LSP',
    description: 'Query language server for diagnostics, completions, hover, and definitions.',
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['diagnostics', 'completions', 'hover', 'definition', 'references'],
                description: 'LSP action to perform',
            },
            file: {
                type: 'string',
                description: 'File path to query',
            },
            line: {
                type: 'number',
                description: 'Line number (0-based)',
            },
            character: {
                type: 'number',
                description: 'Character position (0-based)',
            },
            language: {
                type: 'string',
                description: 'Language ID (e.g., "typescript", "python")',
            },
        },
        required: ['action', 'file'],
    },

    validateInput(input) {
        const errors = [];
        if (!input.action) errors.push('action is required');
        if (!input.file) errors.push('file is required');
        return errors;
    },

    async call(input) {
        const filePath = path.resolve(input.file);
        const action = input.action;

        switch (action) {
            case 'diagnostics':
                return getDiagnostics(filePath, input.language);
            case 'completions':
                return `[LSP stub] Completions at ${filePath}:${input.line}:${input.character} not yet implemented.`;
            case 'hover':
                return `[LSP stub] Hover at ${filePath}:${input.line}:${input.character} not yet implemented.`;
            case 'definition':
                return `[LSP stub] Go-to-definition at ${filePath}:${input.line}:${input.character} not yet implemented.`;
            case 'references':
                return `[LSP stub] Find references at ${filePath}:${input.line}:${input.character} not yet implemented.`;
            default:
                return `Unknown LSP action: ${action}`;
        }
    },
};

function getDiagnostics(filePath, language) {
    const ext = path.extname(filePath);
    const lang = language || extToLanguage(ext);

    // Security: use execFileSync with explicit args arrays so filePath is
    // never shell-interpolated — no command injection via crafted file names.
    try {
        switch (lang) {
            case 'typescript':
            case 'javascript': {
                let result = '';
                try {
                    result = execFileSync(
                        'npx',
                        ['tsc', '--noEmit', '--pretty', 'false', filePath],
                        { encoding: 'utf-8', timeout: 15000 }
                    );
                } catch (e) {
                    result = e.stdout || e.stderr || '';
                }
                return result.trim() || 'No diagnostics.';
            }
            case 'python': {
                let result = '';
                try {
                    result = execFileSync(
                        'python3',
                        ['-m', 'py_compile', filePath],
                        { encoding: 'utf-8', timeout: 10000 }
                    );
                } catch (e) {
                    result = e.stderr || e.stdout || '';
                }
                return result.trim() || 'No diagnostics.';
            }
            default:
                return `[LSP stub] No diagnostic provider for language: ${lang}`;
        }
    } catch (err) {
        return `Diagnostics error: ${err.message}`;
    }
}

function extToLanguage(ext) {
    const map = {
        '.ts': 'typescript', '.tsx': 'typescript',
        '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
        '.py': 'python',
        '.rs': 'rust', '.go': 'go', '.java': 'java',
        '.rb': 'ruby', '.php': 'php', '.cs': 'csharp',
    };
    return map[ext] || 'unknown';
}
