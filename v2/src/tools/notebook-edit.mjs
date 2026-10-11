/**
 * NotebookEdit Tool — edit Jupyter notebook (.ipynb) cells.
 *
 * Supports operations:
 * - insert: add a new cell at a position
 * - replace: replace content of an existing cell
 * - delete: remove a cell
 */

import fs from 'fs';
import path from 'path';
import { readStrictUtf8 } from './text-encoding.mjs';

export const NotebookEditTool = {
    name: 'NotebookEdit',
    description: 'Edit Jupyter notebook cells. Supports insert, replace, and delete operations.',
    inputSchema: {
        type: 'object',
        properties: {
            notebook_path: { type: 'string', description: 'Path to the .ipynb file' },
            operation: {
                type: 'string',
                enum: ['insert', 'replace', 'delete'],
                description: 'Operation to perform',
            },
            cell_index: { type: 'number', description: 'Cell index (0-based)' },
            cell_type: {
                type: 'string',
                enum: ['code', 'markdown', 'raw'],
                description: 'Cell type (for insert/replace)',
            },
            source: { type: 'string', description: 'Cell content (for insert/replace)' },
        },
        required: ['notebook_path', 'operation', 'cell_index'],
    },

    validateInput(input) {
        const errors = [];
        if (!input.notebook_path) errors.push('notebook_path required');
        if (!['insert', 'replace', 'delete'].includes(input.operation)) {
            errors.push('operation must be insert, replace, or delete');
        }
        if (typeof input.cell_index !== 'number') errors.push('cell_index must be a number');
        if (input.operation !== 'delete' && !input.source) errors.push('source required for insert/replace');
        return errors;
    },

    async call(input) {
        const filePath = path.resolve(input.notebook_path);

        try {
            const raw = readStrictUtf8(filePath);
            const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
            const notebook = JSON.parse(bom ? raw.slice(1) : raw);

            if (!notebook.cells || !Array.isArray(notebook.cells)) {
                return 'Error: invalid notebook format (no cells array)';
            }

            const cellType = input.cell_type || 'code';
            const sourceLines = (input.source || '').split('\n').map(l => l + '\n');

            switch (input.operation) {
                case 'insert': {
                    const newCell = {
                        cell_type: cellType,
                        metadata: {},
                        source: sourceLines,
                        ...(cellType === 'code' ? { outputs: [], execution_count: null } : {}),
                    };
                    const idx = Math.min(input.cell_index, notebook.cells.length);
                    notebook.cells.splice(idx, 0, newCell);
                    break;
                }
                case 'replace': {
                    if (input.cell_index >= notebook.cells.length) {
                        return `Error: cell_index ${input.cell_index} out of range (${notebook.cells.length} cells)`;
                    }
                    notebook.cells[input.cell_index].source = sourceLines;
                    if (cellType) notebook.cells[input.cell_index].cell_type = cellType;
                    break;
                }
                case 'delete': {
                    if (input.cell_index >= notebook.cells.length) {
                        return `Error: cell_index ${input.cell_index} out of range (${notebook.cells.length} cells)`;
                    }
                    notebook.cells.splice(input.cell_index, 1);
                    break;
                }
            }

            const newline = raw.includes('\r\n') ? '\r\n' : '\n';
            const trailing = raw.match(/(?:\r?\n)+$/)?.[0] || '';
            const serialized = JSON.stringify(notebook, null, 1).replace(/\n/g, newline);
            fs.writeFileSync(filePath, bom + serialized + trailing);
            return `Notebook updated: ${input.operation} at cell ${input.cell_index} (${notebook.cells.length} cells total)`;
        } catch (err) {
            return `Error: ${err.message}`;
        }
    },
};
