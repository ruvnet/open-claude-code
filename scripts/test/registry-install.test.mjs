import test from 'node:test';
import assert from 'node:assert/strict';
import { installWithPropagationRetry as install } from '../registry-install.mjs';
const failure = code => ({ code: 1, stderr: 'npm error code ' + code });
function clock() {
    let time = 0;
    return { now: () => time, sleep: async ms => { time += ms; } };
}
for (const code of ['ETARGET', 'E404']) {
    test('registry propagation ' + code + ' retries until installation succeeds', async () => {
        const attempts = [], ok = { code: 0, stderr: '' };
        const result = await install(async (index, timeout) => {
            attempts.push([index, timeout]);
            return index < 2 ? failure(code) : ok;
        }, { registry: true, ...clock() });
        assert.equal(result, ok);
        assert.deepEqual(attempts, [[0, 90000], [1, 90000], [2, 90000]]);
    });
}
test('local tarball failures never retry', async () => {
    let attempts = 0;
    await install(async () => { attempts++; return failure('ETARGET'); }, clock());
    assert.equal(attempts, 1);
});
test('authentication, integrity and arbitrary output fail immediately', async () => {
    for (const code of ['E401', 'E403', 'EINTEGRITY', 'ENOTFOUND']) {
        let attempts = 0;
        await install(async () => { attempts++; return failure(code); }, { registry: true, ...clock() });
        assert.equal(attempts, 1);
    }
    let attempts = 0;
    await install(async () => { attempts++; return { code: 1, stderr: 'assertion mentions ETARGET' }; },
        { registry: true, ...clock() });
    assert.equal(attempts, 1);
});
test('propagation retries stop at five minute deadline', async () => {
    const time = clock(), attempts = [];
    const result = await install(async (index, timeout) => {
        attempts.push([index, timeout]);
        return failure('ETARGET');
    }, { registry: true, ...time });
    assert.equal(result.code, 1);
    assert.equal(time.now(), 300000);
    assert.equal(attempts.length, 60);
    assert.equal(attempts.at(-1)[1], 5000);
});
test('execution errors are not retried', async () => {
    let attempts = 0;
    await assert.rejects(install(async () => {
        attempts++;
        throw new Error('process timeout');
    }, { registry: true, ...clock() }), /process timeout/);
    assert.equal(attempts, 1);
});
