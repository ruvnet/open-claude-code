import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HookEngine } from '../../v2/src/hooks/engine.mjs';

const command = (code, options = {}) => ({ type: 'command', command: process.execPath,
    args: ['-e', code], onFailure: 'block', ...options });
const pre = hook => new HookEngine({ PreToolUse: [hook] }).runPreToolUse('Bash', { command: 'echo safe' });

test('command startup failure blocks only when requested', async () => {
    assert.equal((await pre({ command: '/missing/occ-hook', onFailure: 'block' })).allow, false);
    assert.equal((await pre({ command: '/missing/occ-hook' })).allow, true);
    assert.equal((await pre({ command: '/missing/occ-hook', failOpen: false })).allow, false);
});
test('unexpected command exits cannot grant permission', async () => {
    assert.equal((await pre(command('console.log(JSON.stringify({decision:"allow"})); process.exit(3)'))).allow, false);
    assert.equal((await pre(command('process.exit(3)', { onFailure: 'continue' }))).allow, true);
});
test('exit 2 is an explicit veto even without failure policy', async () => {
    assert.equal((await pre(command('process.exit(2)', { onFailure: 'continue' }))).allow, false);
});
test('command timeout is blocked and typed units are seconds', async () => {
    assert.equal((await pre(command('setTimeout(()=>{},10000)', { timeout: 0.05 }))).allow, false);
    const engine = new HookEngine();
    assert.equal(engine._timeout({ timeout: 50 }), 50);
    assert.equal(engine._timeout({ type: 'command', timeout: 0.05 }), 50);
});
test('malformed JSON and invalid decision schema fail closed', async () => {
    for (const text of ['{bad', '[]', 'null', '{"continue":"false"}', '{"decision":"maybe"}',
        '{"hookSpecificOutput":{"permissionDecision":"maybe"}}']) {
        assert.equal((await pre(command('console.log(' + JSON.stringify(text) + ')'))).allow, false);
    }
    assert.equal((await pre(command('console.log("plain informational output")'))).allow, true);
});
test('continue false denies a tool and retains the stop reason', async () => {
    const result = await pre(command('console.log(JSON.stringify({continue:false,stopReason:"policy"}))'));
    assert.deepEqual(result, { allow: false, message: 'policy' });
});
test('Claude nested matching and structured permission denial', async () => {
    const engine = new HookEngine({ PreToolUse: [{ matcher: '^Bash$', hooks: [
        command('console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"restricted"}}))')
    ] }] });
    assert.deepEqual(await engine.runPreToolUse('Bash', {}), { allow: false, message: 'restricted' });
    assert.equal((await engine.runPreToolUse('Read', {})).allow, true);
});
test('typed command receives JSON stdin without shell interpolation', async () => {
    const result = await pre(command('let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{let p=JSON.parse(s);console.log(JSON.stringify({decision:p.tool_name==="Bash"&&p.tool_input.command==="echo safe"?"deny":"allow"}));});'));
    assert.equal(result.allow, false);
});
test('legacy flat matching and environment input remain available', async () => {
    const engine = new HookEngine({ PreToolUse: [{ toolName: 'Read',
        handler: ctx => ({ decision: ctx.input.path === 'secret' ? 'deny' : 'allow' }) }] });
    assert.equal((await engine.runPreToolUse('Bash', { path: 'secret' })).allow, true);
    assert.equal((await engine.runPreToolUse('Read', { path: 'secret' })).allow, false);
});
test('PostToolUse MCP replacement is propagated and limited to MCP tools', async () => {
    const engine = new HookEngine({ PostToolUse: [{ handler: ctx => ({
        hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: { safe: ctx.result.secret ? true : false } }
    }) }] });
    assert.deepEqual(await engine.runPostToolUse('mcp__fixture__read', { secret: 'hidden' }), { safe: true });
    assert.deepEqual(await engine.runPostToolUse('Read', { secret: 'hidden' }), { secret: 'hidden' });
});
test('Stop hook failures do not cause endless retries', async () => {
    assert.equal(await new HookEngine({ Stop: [command('process.exit(3)')] }).runStop(), true);
    assert.equal(await new HookEngine({ Stop: [command('process.exit(2)')] }).runStop(), false);
    assert.equal(await new HookEngine({ Stop: [{ handler: () => ({ decision: 'block' }) }] }).runStop(), false);
});
test('unsupported evaluator does not silently allow a protected tool', async () => {
    assert.equal((await pre({ type: 'prompt', prompt: 'Check it', onFailure: 'block' })).allow, false);
});

test('HTTP hook deny, failure, timeout and header interpolation contract', async t => {
    let body, headers;
    const server = http.createServer((req, res) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
            body = JSON.parse(data); headers = req.headers;
            if (req.url === '/timeout') return;
            if (req.url === '/error') { res.writeHead(503); res.end('{}'); return; }
            if (req.url === '/bad') { res.end('not JSON'); return; }
            res.end(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'HTTP policy' } }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); delete process.env.OCC_HOOK_TEST_VALUE; });
    const base = 'http://127.0.0.1:' + server.address().port;
    process.env.OCC_HOOK_TEST_VALUE = 'public-test-value';
    const hook = { type: 'http', url: base, timeout: 1, onFailure: 'block',
        headers: { 'X-Test-Allowed': '$OCC_HOOK_TEST_VALUE', 'X-Test-Denied': '$OCC_HOOK_TEST_VALUE' },
        allowedEnvVars: ['OCC_HOOK_TEST_VALUE'] };
    // Only names listed in allowedEnvVars are interpolated.
    hook.headers['X-Test-Denied'] = '$OCC_HOOK_NOT_LISTED';
    assert.deepEqual(await pre(hook), { allow: false, message: 'HTTP policy' });
    assert.equal(body.hook_event_name, 'PreToolUse');
    assert.equal(body.tool_name, 'Bash');
    assert.equal(headers['x-test-allowed'], 'public-test-value');
    assert.equal(headers['x-test-denied'], '');
    for (const path of ['/error', '/bad']) {
        assert.equal((await pre({ ...hook, url: base + path })).allow, false);
        assert.equal((await pre({ ...hook, url: base + path, onFailure: 'continue' })).allow, true);
    }
    assert.equal((await pre({ ...hook, url: base + '/timeout', timeout: 0.05 })).allow, false);
    assert.equal((await pre({ ...hook, url: 'http://127.0.0.1:1' })).allow, false);
});

test('invalid matcher never executes flat or nested commands and preserves failure policy', async t => {
    const { mkdtemp, access, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'occ-hook-matcher-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const marker = join(directory, 'executed');
    const hook = command('require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',"bad")');
    for (const entry of [{ ...hook, matcher: '[' }, { matcher: '[', hooks: [hook] }]) {
        const engine = new HookEngine({ PreToolUse: [entry] });
        assert.equal((await engine.runPreToolUse('Bash', {})).allow, false);
        await assert.rejects(access(marker));
    }
    const engine = new HookEngine({ PreToolUse: [{ matcher: '[', hooks: [{ ...hook, onFailure: 'continue' }] }] });
    assert.equal((await engine.runPreToolUse('Bash', {})).allow, true);
    await assert.rejects(access(marker));
    const legacy = new HookEngine({ PreToolUse: [{ matcher: '[', hooks: [{ ...hook, onFailure: undefined, failOpen: false }] }] });
    assert.equal((await legacy.runPreToolUse('Bash', {})).allow, false);
    await assert.rejects(access(marker));
});
test('HTTP hook response larger than 1 MiB is canceled and honors failure policy', async t => {
    const server = http.createServer((req, res) => {
        req.resume();
        res.end(JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 1) }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const hook = { type: 'http', url: 'http://127.0.0.1:' + server.address().port, timeout: 2, onFailure: 'block' };
    assert.equal((await pre(hook)).allow, false);
    assert.equal((await pre({ ...hook, onFailure: 'continue' })).allow, true);
});
