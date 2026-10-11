#!/usr/bin/env node
// Test the actual distributable in an isolated installation, without real credentials.
// Usage: node scripts/package-e2e.mjs [path/to/package.tgz | @ruvnet/open-claude-code@VERSION]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'occ-package-e2e-'));
const home = path.join(temp, 'home');
await mkdir(home);
const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home,
    CI: 'true', NO_COLOR: '1', npm_config_userconfig: path.join(temp, 'empty-npmrc') };
await writeFile(env.npm_config_userconfig, '');
function run(command, args, cwd = temp, extraEnv = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env: { ...env, ...extraEnv },
            stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (signal) reject(new Error(`Command terminated by ${signal}: ${command}`));
            else resolve({ code, stdout, stderr });
        });
    });
}
function success(result, label) {
    assert.equal(result.code, 0, `${label}: ${result.stderr}\n${result.stdout}`);
}
let server;
try {
    const spec = process.argv[2];
    const registrySpec = spec && /^@ruvnet\/open-claude-code@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec);
    let tarball = registrySpec ? spec : spec && path.resolve(spec);
    if (!tarball) {
        const pack = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], path.join(root, 'v2'));
        success(pack, 'npm pack');
        tarball = path.join(temp, JSON.parse(pack.stdout)[0].filename);
    }
    const install = await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball]);
    success(install, 'clean package installation');
    const cli = path.join(temp, 'node_modules', '.bin', 'occ');
    const installedRoot = path.resolve(path.dirname(await realpath(cli)), '..');
    const installed = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
    let manifest;
    if (registrySpec) {
        manifest = { name: '@ruvnet/open-claude-code', version: spec.slice(spec.lastIndexOf('@') + 1) };
    } else {
        const metadata = await run('tar', ['-xOf', tarball, 'package/package.json']);
        success(metadata, 'read packed metadata');
        manifest = JSON.parse(metadata.stdout);
    }
    assert.equal(installed.name, manifest.name);
    assert.equal(installed.version, manifest.version);
    const version = await run(cli, ['--version']);
    success(version, '--version');
    assert.ok(version.stdout.trim().endsWith(`v${manifest.version}`), 'CLI version must match package metadata');
    const help = await run(cli, ['--help']);
    success(help, '--help');
    assert.match(help.stdout, /--print/);

    const marker = `package-e2e-${randomUUID()}`;
    const fixture = path.join(temp, 'fixture.txt');
    await writeFile(fixture, marker);
    let calls = 0, sawToolResult = false, failureMode = false, serverError;
    let openaiMode = false, openaiCalls = 0, openaiSawToolResult = false;
    server = createServer(async (req, res) => {
        try {
            assert.equal(req.url, openaiMode ? '/chat/completions' : '/v1/messages');
            assert.equal(req.method, 'POST');
            assert.equal(openaiMode ? req.headers.authorization : req.headers['x-api-key'],
                openaiMode ? 'Bearer local-test-credential' : 'local-test-credential');
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const body = JSON.parse(raw);
            calls++;
            if (failureMode) {
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'local rejection' } }));
                return;
            }
            if (openaiMode) {
                openaiCalls++;
                assert.notEqual(body.stream, true);
                assert.ok(body.tools.some(tool => tool.function?.name === 'Read'));
                const result = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'openai-read');
                if (openaiCalls > 1) {
                    assert.ok(result, 'OpenAI request contains tool result');
                    assert.ok(result.content.includes(marker), 'OpenAI result contains actual fixture content');
                    const assistant = body.messages.find(message => message.role === 'assistant' &&
                        message.tool_calls?.some(call => call.id === 'openai-read'));
                    assert.ok(assistant, 'OpenAI assistant tool call history preserved');
                    const call = assistant.tool_calls.find(call => call.id === 'openai-read');
                    assert.equal(call.function.name, 'Read');
                    assert.equal(JSON.parse(call.function.arguments).file_path, fixture);
                    openaiSawToolResult = true;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ choices: [{ index: 0,
                    message: result ? { role: 'assistant', content: 'Verified ' + marker }
                        : { role: 'assistant', content: null, tool_calls: [{
                            id: 'openai-read', type: 'function',
                            function: { name: 'Read', arguments: JSON.stringify({ file_path: fixture }) }
                        }] },
                    finish_reason: result ? 'stop' : 'tool_calls'
                }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
                return;
            }
            assert.equal(body.stream, true);
            assert.ok(body.tools.some(tool => tool.name === 'Read'));
            const toolResult = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [])
                .find(block => block.type === 'tool_result' && block.tool_use_id === 'read-fixture');
            if (calls > 1) {
                assert.ok(toolResult, 'second request includes actual tool result');
                assert.notEqual(toolResult.is_error, true);
                assert.ok(JSON.stringify(toolResult.content).includes(marker), 'tool read unique fixture content');
                sawToolResult = true;
            }
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            emit({ type: 'message_start', message: { usage: { input_tokens: 1 } } });
            const block = toolResult ? { type: 'text', text: '' }
                : { type: 'tool_use', id: 'read-fixture', name: 'Read', input: {} };
            emit({ type: 'content_block_start', index: 0, content_block: block });
            emit({ type: 'content_block_delta', index: 0, delta: toolResult
                ? { type: 'text_delta', text: `Verified ${marker}` }
                : { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: fixture }) } });
            emit({ type: 'content_block_stop', index: 0 });
            emit({ type: 'message_delta', delta: { stop_reason: toolResult ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 1 } });
            emit({ type: 'message_stop' });
            res.end();
        } catch (error) {
            serverError = error;
            res.writeHead(500);
            res.end('Mock provider assertion failed');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const apiEnv = { ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        ANTHROPIC_API_KEY: 'local-test-credential' };
    const args = ['--model', 'claude-sonnet-4-20250514', '--print', 'Read fixture.txt and report its contents.'];
    const roundtrip = await run(cli, args, temp, apiEnv);
    if (serverError) throw serverError;
    success(roundtrip, 'installed CLI agent and Read tool roundtrip');
    assert.equal(calls, 2);
    assert.ok(sawToolResult);
    assert.ok(roundtrip.stdout.includes(marker), 'CLI prints final provider response');

    failureMode = true;
    const rejected = await run(cli, args, temp, apiEnv);
    if (serverError) throw serverError;
    assert.notEqual(rejected.code, 0, 'provider authentication failure must exit nonzero');
    assert.match(rejected.stdout + rejected.stderr, /401|authentication_error/);
    const missing = await run(cli, args, temp, { ANTHROPIC_BASE_URL: apiEnv.ANTHROPIC_BASE_URL });
    assert.notEqual(missing.code, 0, 'missing credentials must exit nonzero');
    assert.match(missing.stdout + missing.stderr, /ANTHROPIC_API_KEY/);
    openaiMode = true;
    failureMode = false;
    const openaiEnv = { OPENAI_BASE_URL: apiEnv.ANTHROPIC_BASE_URL,
        OPENAI_API_KEY: 'local-test-credential' };
    const openaiArgs = ['--model', 'gpt-4.1-mini', '--print', 'Read fixture.txt and report its contents.'];
    const openaiResult = await run(cli, openaiArgs, temp, openaiEnv);
    if (serverError) throw serverError;
    success(openaiResult, 'OpenAI compatible CLI tool roundtrip');
    assert.equal(openaiCalls, 2);
    assert.ok(openaiSawToolResult);
    assert.ok(openaiResult.stdout.includes(marker));
    failureMode = true;
    const openaiRejected = await run(cli, openaiArgs, temp, openaiEnv);
    if (serverError) throw serverError;
    assert.notEqual(openaiRejected.code, 0, 'OpenAI authentication failure exits nonzero');
    assert.match(openaiRejected.stdout + openaiRejected.stderr, /401|authentication_error/);
    console.log(JSON.stringify({ status: 'passed', package: installed.name, version: installed.version,
        checks: ['clean tarball installation', 'version', 'help', 'streaming Read tool roundtrip',
            'provider failure exit', 'missing credential exit', 'OpenAI Read tool roundtrip', 'OpenAI failure exit'], provider: 'local mock; no live API called' }));
} finally {
    if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    await rm(temp, { recursive: true, force: true });
}
