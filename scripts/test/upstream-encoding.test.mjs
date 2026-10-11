import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EditTool } from '../../v2/src/tools/edit.mjs';
import { MultiEditTool } from '../../v2/src/tools/multi-edit.mjs';
import { NotebookEditTool } from '../../v2/src/tools/notebook-edit.mjs';
import { markRead } from '../../v2/src/tools/read.mjs';

function fixture(t, bytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-encoding-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'target');
    fs.writeFileSync(file, bytes);
    markRead(file);
    return file;
}

const invalid = [
    ['latin1', Buffer.from([0x61, 0xe9, 0x62])],
    ['truncated', Buffer.from([0x61, 0xe2, 0x82])],
    ['overlong', Buffer.from([0x61, 0xc0, 0xaf])],
    ['surrogate', Buffer.from([0x61, 0xed, 0xa0, 0x80])],
    ['out-of-range', Buffer.from([0x61, 0xf4, 0x90, 0x80, 0x80])],
    ['stray-continuation', Buffer.from([0x61, 0x80])],
    ['utf16', Buffer.from([0xff, 0xfe, 0x61, 0x00])],
    ['after-bom', Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0xff])],
];
for (const [name, bytes] of invalid) {
    test('Edit refuses ' + name + ' without changing bytes', async t => {
        const file = fixture(t, bytes);
        const result = await EditTool.call({ file_path: file, old_string: 'a', new_string: 'z' });
        assert.match(result, /not valid UTF-8.*Refusing/);
        assert.deepEqual(fs.readFileSync(file), bytes);
    });
    test('NotebookEdit refuses ' + name + ' without changing bytes', async t => {
        const original = Buffer.concat([Buffer.from('{"cells":[],"metadata":"'), bytes, Buffer.from('"}')]);
        const file = fixture(t, original);
        const result = await NotebookEditTool.call({ notebook_path: file, operation: 'insert', cell_index: 0, source: 'ok' });
        assert.match(result, /not valid UTF-8.*Refusing/);
        assert.deepEqual(fs.readFileSync(file), original);
    });
}
for (const eol of ['\n', '\r\n']) {
    for (const bom of ['', '\uFEFF']) {
        test('Edit preserves UTF-8 text, BOM, and newline ' + JSON.stringify([eol, bom]), async t => {
            const original = bom + 'café 你好 🙂' + eol + 'target' + eol;
            const file = fixture(t, original);
            assert.match(await EditTool.call({ file_path: file, old_string: 'target', new_string: 'été' }), /File updated/);
            assert.deepEqual(fs.readFileSync(file), Buffer.from(original.replace('target', 'été')));
        });
        test('MultiEdit preserves UTF-8 text, BOM, and newline ' + JSON.stringify([eol, bom]), async t => {
            const original = bom + 'café 你好 🙂' + eol + 'target' + eol;
            const file = fixture(t, original);
            assert.match(await MultiEditTool.call({ edits: [{ file_path: file, old_string: 'target', new_string: 'été' }] }), /Applied 1 edits/);
            assert.deepEqual(fs.readFileSync(file), Buffer.from(original.replace('target', 'été')));
        });
    }
}
test('MultiEdit validates encoding in every file before any write', async t => {
    const goodBytes = Buffer.from('target café\r\n');
    const badBytes = Buffer.from([0x61, 0xe9]);
    const good = fixture(t, goodBytes);
    const bad = fixture(t, badBytes);
    const result = await MultiEditTool.call({ edits: [
        { file_path: good, old_string: 'target', new_string: 'changed' },
        { file_path: bad, old_string: 'a', new_string: 'b' },
    ] });
    assert.match(result, /Validation failed:.*not valid UTF-8/s);
    assert.deepEqual(fs.readFileSync(good), goodBytes);
    assert.deepEqual(fs.readFileSync(bad), badBytes);
});
for (const eol of ['\n', '\r\n']) {
    for (const bom of ['', '\uFEFF']) {
        for (const trailing of ['', eol, eol + eol]) {
            test('NotebookEdit preserves UTF-8, BOM, EOL, and trailing newline ' + JSON.stringify([eol, bom, trailing]), async t => {
                const notebook = { cells: [{ cell_type: 'markdown', metadata: {}, source: ['café 你好 🙂\n'] }], metadata: { label: 'été' }, nbformat: 4 };
                const original = bom + JSON.stringify(notebook, null, 1).replace(/\n/g, eol) + trailing;
                const file = fixture(t, original);
                const result = await NotebookEditTool.call({ notebook_path: file, operation: 'replace', cell_index: 0, cell_type: 'markdown', source: '新しい café 🙂' });
                assert.match(result, /Notebook updated/);
                const actual = fs.readFileSync(file, 'utf8');
                assert.equal(actual.startsWith('\uFEFF'), Boolean(bom));
                assert.equal(actual.match(/(?:\r?\n)+$/)?.[0] || '', trailing);
                assert.equal(actual.includes('\r\n'), eol === '\r\n');
                const parsed = JSON.parse(bom ? actual.slice(1) : actual);
                assert.deepEqual(parsed.cells[0].source, ['新しい café 🙂\n']);
                assert.deepEqual(parsed.metadata, notebook.metadata);
            });
        }
    }
}
test('Valid literal replacement characters remain editable', async t => {
    const file = fixture(t, '\uFFFD target');
    assert.match(await EditTool.call({ file_path: file, old_string: 'target', new_string: 'ok' }), /File updated/);
    assert.equal(fs.readFileSync(file, 'utf8'), '\uFFFD ok');
});
