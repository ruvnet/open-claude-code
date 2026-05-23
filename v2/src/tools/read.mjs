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
            pages: { type: 'string', description: 'Page range for PDF files (e.g. "1-5")' },
        },
        required: ['file_path'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.file_path) errors.push('file_path is required');
        return errors;
    },
    async call(input) {
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

        // Binary detection
        try {
            const fd = fs.openSync(filePath, 'r');
            const buf = Buffer.alloc(8192);
            const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
            fs.closeSync(fd);
            if (isBinary(buf.subarray(0, bytesRead))) {
                return `Error: ${filePath} appears to be a binary file. Cannot display binary content.`;
            }
        } catch (e) {
            return `Error: ${e.message}`;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const start = input.offset || 0;
            const limit = input.limit || DEFAULT_LIMIT;
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
