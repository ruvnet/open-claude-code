/**
 * Read Tool — matches Claude Code's exact behavior.
 *
 * Features:
 * - pages parameter for PDF files
 * - Binary file detection
 * - Default 2000 line limit
 * - Line number prefix (cat -n format)
 * - Graceful file not found handling
 * - Tracks read files for Edit/Write verification
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const DEFAULT_LIMIT = 2000;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_LINES = 100000;

// Read a bounded snapshot even if the file grows after the initial stat.
function readTextSnapshot(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        if (size > MAX_TEXT_BYTES) throw new Error('Text file exceeds the 16 MiB hard limit.');
        const buffer = Buffer.alloc(size + 1);
        let total = 0;
        while (total < buffer.length) {
            const count = fs.readSync(fd, buffer, total, buffer.length - total, total);
            if (!count) break;
            total += count;
        }
        if (total > size) throw new Error('File changed while reading; retry the read.');
        if (isBinary(buffer.subarray(0, total))) throw new Error('File appears to be binary. Cannot display binary content.');
        return buffer.toString('utf-8', 0, total);
    } finally {
        fs.closeSync(fd);
    }
}

// Track which files have been read (used by Edit and Write tools)
const readFiles = new Set();

export function hasBeenRead(filePath) {
    return readFiles.has(path.resolve(filePath));
}

export function markRead(filePath) {
    readFiles.add(path.resolve(filePath));
}

// Binary detection: check for null bytes in first 8KB
function isBinary(buffer) {
    const len = Math.min(buffer.length, 8192);
    for (let i = 0; i < len; i++) {
        if (buffer[i] === 0) return true;
    }
    return false;
}

export const ReadTool = {
    name: 'Read',
    description: 'Read a file from the local filesystem.',
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            offset: { type: 'number', description: 'Line number to start reading from (0-based)' },
            limit: { type: 'number', description: 'Number of lines to read (default 2000)' },
            allow_large: { type: 'boolean', description: 'Read beyond the default 2000 lines; explicit offset/limit still apply. Text is capped at 16 MiB and 100000 lines.' },
            pages: { type: 'string', description: 'Page range for PDF files (e.g. "1-5")' },
        },
        required: ['file_path'],
    },
    validateInput(input) {
        const errors = [];
        if (!input || typeof input !== 'object' || Array.isArray(input)) return ['input must be an object'];
        if (typeof input.file_path !== 'string' || !input.file_path.trim() || input.file_path.includes('\0')) errors.push('file_path must be a nonempty string without null bytes');
        if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) errors.push('offset must be a nonnegative safe integer');
        if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1)) errors.push('limit must be a positive safe integer');
        if (input.allow_large !== undefined && typeof input.allow_large !== 'boolean') errors.push('allow_large must be a boolean');
        if (input.pages !== undefined && typeof input.pages !== 'string') errors.push('pages must be a string');
        return errors;
    },
    async call(input) {
        const errors = this.validateInput(input);
        if (errors.length) return `Error: ${errors.join('; ')}`;
        const filePath = path.resolve(input.file_path);

        // Check existence
        if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
        }

        // Check if directory
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            return `Error: ${filePath} is a directory, not a file. Use Bash with ls to list directory contents.`;
        }

        // PDF handling
        if (filePath.endsWith('.pdf')) {
            return readPdf(filePath, input.pages);
        }

        if (!stat.isFile()) return 'Error: Read requires a regular file.';

        try {
            const content = readTextSnapshot(filePath);
            if (content.split('\n', MAX_TEXT_LINES + 1).length > MAX_TEXT_LINES) return 'Error: Text file exceeds the 100000 line hard limit.';
            const lines = content.split('\n');
            const start = input.offset ?? 0;
            const limit = input.limit ?? (input.allow_large ? MAX_TEXT_LINES : DEFAULT_LIMIT);
            const end = Math.min(start + limit, lines.length);

            // Track as read
            readFiles.add(filePath);

            // Handle empty files
            if (content === '' || (content.length === 0)) {
                return '[File exists but is empty]';
            }

            const output = lines
                .slice(start, end)
                .map((l, i) => `${start + i + 1}\t${l}`)
                .join('\n');

            if (end < lines.length) {
                return output + `\n\n[File has ${lines.length} lines total. Showing lines ${start + 1}-${end}. Use offset/limit for more.]`;
            }

            return output;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};

function readPdf(filePath, pages) {
    // PDF reading requires external tools; provide a best-effort
    // text extraction using a simple approach.
    // Security: use execFileSync with an explicit args array so filePath and
    // page numbers are never shell-interpolated (no injection possible).
    try {
        const args = [];
        if (pages) {
            const parts = pages.split('-');
            const first = parseInt(parts[0], 10);
            const last = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(first) && !isNaN(last) && first > 0 && last >= first) {
                args.push('-f', String(first), '-l', String(last));
            } else {
                args.push('-f', '1', '-l', '20');
            }
        } else {
            args.push('-f', '1', '-l', '20');
        }
        args.push(filePath, '-');

        const text = execFileSync('pdftotext', args, {
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 1024 * 1024,
        });
        return text || `[PDF file at ${filePath} — could not extract text. Use a PDF viewer.]`;
    } catch {
        return `[PDF file at ${filePath} — pdftotext not available. Install poppler-utils for PDF support.]`;
    }
}
