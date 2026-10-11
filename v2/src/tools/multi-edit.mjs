/**
 * MultiEdit Tool — apply multiple edits to one or more files atomically.
 *
 * Each edit is an { file_path, old_string, new_string } triple.
 * All edits are validated before any are applied.
 */

import fs from 'fs';
import path from 'path';
import { readStrictUtf8 } from './text-encoding.mjs';

export const MultiEditTool = {
    name: 'MultiEdit',
    description: 'Apply multiple file edits in a single operation. All edits are validated first.',
    inputSchema: {
        type: 'object',
        properties: {
            edits: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string' },
                        old_string: { type: 'string' },
                        new_string: { type: 'string' },
                    },
                    required: ['file_path', 'old_string', 'new_string'],
                },
                description: 'Array of edits to apply',
            },
        },
        required: ['edits'],
    },

    validateInput(input) {
        const errors = [];
        if (!input.edits || !Array.isArray(input.edits)) {
            errors.push('edits must be an array');
            return errors;
        }
        for (let i = 0; i < input.edits.length; i++) {
            const e = input.edits[i];
            if (!e.file_path) errors.push(`edit[${i}]: file_path required`);
            if (!e.old_string) errors.push(`edit[${i}]: old_string required`);
            if (e.old_string === e.new_string) errors.push(`edit[${i}]: old_string must differ from new_string`);
        }
        return errors;
    },

    async call(input) {
        // Phase 1: Validate all edits
        const fileContents = new Map();
        const errors = [];

        for (let i = 0; i < input.edits.length; i++) {
            const edit = input.edits[i];
            const filePath = path.resolve(edit.file_path);

            if (!fileContents.has(filePath)) {
                try {
                    fileContents.set(filePath, readStrictUtf8(filePath));
                } catch (err) {
                    errors.push(`edit[${i}]: cannot read ${filePath}: ${err.message}`);
                    continue;
                }
            }

            let content = fileContents.get(filePath);
            if (!content.includes(edit.old_string)) {
                errors.push(`edit[${i}]: old_string not found in ${edit.file_path}`);
            }
        }

        if (errors.length > 0) {
            return `Validation failed:\n${errors.join('\n')}`;
        }

        // Phase 2: Apply all edits
        const applied = [];
        for (const edit of input.edits) {
            const filePath = path.resolve(edit.file_path);
            let content = fileContents.get(filePath);
            content = content.replace(edit.old_string, edit.new_string);
            fileContents.set(filePath, content);
        }

        // Phase 3: Write all files
        for (const [filePath, content] of fileContents) {
            fs.writeFileSync(filePath, content);
            applied.push(filePath);
        }

        return `Applied ${input.edits.length} edits to ${applied.length} file(s):\n${applied.join('\n')}`;
    },
};
