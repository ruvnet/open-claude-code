import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReadTool, hasBeenRead } from '../../v2/src/tools/read.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-upstream-read-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
function fixture(name, text) {
    const file_path = path.join(dir, name);
    fs.writeFileSync(file_path, text);
    return file_path;
}
test('Read retains the 2000 line default and opt in reads the complete large text', async () => {
    const text = Array.from({ length: 2501 }, (_, i) => 'line' + (i + 1) + 'x'.repeat(150)).join('\n');
    const file_path = fixture('large.txt', text);
    const normal = await ReadTool.call({ file_path });
    assert.match(normal, /Showing lines 1-2000/);
    assert.doesNotMatch(normal, /2501\tline2501/);
    const full = await ReadTool.call({ file_path, allow_large: true });
    assert.match(full, /2501\tline2501/);
    assert.equal(full.split('\n').length, 2501);
    assert.equal(hasBeenRead(file_path), true);
    assert.equal(await ReadTool.call({ file_path, allow_large: false }), normal);
});
test('allow_large retains explicit offset and limit', async () => {
    const file_path = fixture('range.txt', 'a\nb\nc\nd');
    assert.equal(await ReadTool.call({ file_path, allow_large: true, offset: 2, limit: 2 }), '3\tc\n4\td');
});
test('invalid arguments are rejected before filesystem access', async () => {
    for (const input of [null, [], {}, { file_path: 2 }, { file_path: 'a\0b' },
        { file_path: 'x', allow_large: 'true' }, { file_path: 'x', offset: -1 },
        { file_path: 'x', offset: 1.5 }, { file_path: 'x', limit: 0 },
        { file_path: 'x', limit: Infinity }, { file_path: 'x', pages: 2 }]) {
        assert.ok(ReadTool.validateInput(input).length);
        assert.match(await ReadTool.call(input), /^Error:/);
    }
});
test('byte hard ceiling rejects sparse huge files before allocating content', async () => {
    const file_path = fixture('huge.txt', '');
    fs.truncateSync(file_path, 16 * 1024 * 1024 + 1);
    for (const allow_large of [false, true]) assert.match(await ReadTool.call({ file_path, allow_large }), /16 MiB hard limit/);
    assert.equal(hasBeenRead(file_path), false);
});
test('line ceiling remains active with allow_large', async () => {
    const file_path = fixture('many.txt', '\n'.repeat(100000));
    assert.match(await ReadTool.call({ file_path, allow_large: true }), /100000 line hard limit/);
    assert.equal(hasBeenRead(file_path), false);
});
test('binary, missing, directory and empty behavior is preserved', async () => {
    assert.match(await ReadTool.call({ file_path: fixture('binary', 'a\0b'), allow_large: true }), /binary/);
    assert.match(await ReadTool.call({ file_path: path.join(dir, 'missing') }), /not found/);
    assert.match(await ReadTool.call({ file_path: dir }), /directory/);
    assert.equal(await ReadTool.call({ file_path: fixture('empty', ''), allow_large: true }), '[File exists but is empty]');
});

test('a file growing during read returns an error and closes the descriptor', async () => {
    const file_path = fixture('changing.txt', 'abc');
    const original = fs.readSync;
    let observedFd;
    fs.readSync = (...args) => {
        observedFd = args[0];
        fs.appendFileSync(file_path, 'growth');
        return original(...args);
    };
    try {
        assert.match(await ReadTool.call({ file_path, allow_large: true }), /changed while reading/);
    } finally {
        fs.readSync = original;
    }
    assert.equal(hasBeenRead(file_path), false);
    assert.throws(() => fs.fstatSync(observedFd), { code: 'EBADF' });
});
