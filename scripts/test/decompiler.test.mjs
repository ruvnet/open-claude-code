import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { extractBunSources, verifyIntegrity, assertVersion, sha256, fetchUpstreamSources } from '../upstream-source.mjs';
import { computeDiff, extractSignature, validateDecompilation, runDiff } from '../decompile-and-diff.mjs';
import { validateDiff } from '../validate-decompile-diff.mjs';
const require = createRequire(import.meta.url);
const { decompileSource } = require('../../rudevolution/npm/src/decompiler');
const root = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '../..');
const cli = path.join(root, 'scripts/decompile-and-diff.mjs');

function nativeFixture({ encoding = 1, source = 'export function bash(){return "bash tool";}', loader = 1, format = 1, side = 0, entry = 0 } = {}) {
  const graph = Buffer.alloc(4096);
  const name = Buffer.from('/$bunfs/root/cli');
  const content = Buffer.from(source, encoding === 2 ? 'utf16le' : 'latin1');
  name.copy(graph, 0); content.copy(graph, 128);
  const table = 2048;
  graph.writeUInt32LE(0, table); graph.writeUInt32LE(name.length, table + 4);
  graph.writeUInt32LE(128, table + 8); graph.writeUInt32LE(content.length, table + 12);
  graph.set([encoding, loader, format, side], table + 48);
  const end = table + 52;
  graph.writeBigUInt64LE(BigInt(end), end);
  graph.writeUInt32LE(table, end + 8); graph.writeUInt32LE(52, end + 12); graph.writeUInt32LE(entry, end + 16);
  Buffer.from('\n---- Bun! ----\n').copy(graph, end + 32);
  const data = graph.subarray(0, end + 48);
  const binary = Buffer.alloc(8192);
  Buffer.from('7f454c46', 'hex').copy(binary); binary[4] = 2; binary[5] = 1;
  binary.writeBigUInt64LE(64n, 40); binary.writeUInt16LE(64, 58); binary.writeUInt16LE(3, 60); binary.writeUInt16LE(1, 62);
  const names = Buffer.from('\0.shstrtab\0.bun\0'); names.copy(binary, 256);
  binary.writeUInt32LE(1, 128); binary.writeBigUInt64LE(256n, 128 + 24); binary.writeBigUInt64LE(BigInt(names.length), 128 + 32);
  binary.writeUInt32LE(11, 192); binary.writeBigUInt64LE(512n, 192 + 24); binary.writeBigUInt64LE(BigInt(data.length + 8), 192 + 32);
  binary.writeBigUInt64LE(BigInt(data.length), 512); data.copy(binary, 520);
  return { binary, table: 520 + table, footer: 520 + end };
}
test('extracts real source through ELF section/module pointers, not marker scanning', () => {
  const { binary } = nativeFixture();
  Buffer.from('\n---- Bun! ----\n').copy(binary, 7800); // decoy marker outside .bun
  const result = extractBunSources(binary);
  assert.equal(result.sources.length, 1); assert.match(result.sources[0].source, /export function bash/);
  assert.equal(result.entryPoint, '/$bunfs/root/cli'); assert.equal(result.assets.length, 0);
});
test('decodes UTF-16 JavaScript', () => assert.match(extractBunSources(nativeFixture({ encoding: 2, source: 'export const text="世界";' }).binary).sources[0].source, /世界/));
for (const [name, change] of [
  ['non-ELF', b => b.fill(0, 0, 4)],
  ['big endian', b => b[5] = 2],
  ['unsafe section offset', b => b.writeBigUInt64LE(2n ** 63n, 40)],
  ['out-of-range section table', b => b.writeBigUInt64LE(8190n, 40)],
  ['out-of-range section names', b => b.writeBigUInt64LE(8190n, 128 + 24)],
  ['out-of-range graph', b => b.writeBigUInt64LE(999999n, 512)],
  ['unknown module layout', (b, f) => b.writeUInt32LE(44, f.footer + 12)],
  ['bad graph size', (b, f) => b.writeBigUInt64LE(99999n, f.footer)],
  ['bad module offset', (b, f) => b.writeUInt32LE(0xffffffff, f.table + 8)],
  ['bad entrypoint', (b, f) => b.writeUInt32LE(1, f.footer + 16)],
  ['empty source', (b, f) => b.writeUInt32LE(0, f.table + 12)],
  ['bytecode without source encoding', (b, f) => b[f.table + 48] = 0],
  ['unknown executable loader', (b, f) => b[f.table + 49] = 2],
  ['missing JavaScript entrypoint', (b, f) => { b[f.table + 49] = 13; b[f.table + 50] = 0; b[f.table + 51] = 1; }],
  ['bad trailer', (b, f) => b[f.footer + 33] = 0],
]) test(`fails closed for ${name}`, () => { const f = nativeFixture(); change(f.binary, f); assert.throws(() => extractBunSources(f.binary)); });
test('checks npm SHA-512 integrity', () => {
  const content = Buffer.from('published tarball'); const sri = `sha512-${createHash('sha512').update(content).digest('base64')}`;
  verifyIntegrity(content, sri); assert.throws(() => verifyIntegrity(Buffer.from('tampered'), sri)); assert.throws(() => verifyIntegrity(content, 'sha1-fake'));
});
test('requires exact safe versions', () => { for (const v of ['latest', 'unknown', '../2.1.285', '2.1.285\nfoo', '2.1.285;exit']) assert.throws(() => assertVersion(v)); assertVersion('2.1.285'); });
test('uses actual content and lexical metrics from ruDevolution schema', () => {
  const source = 'function bash(){ return "tool bash"; }'; const result = decompileSource(source, { useRust: false });
  validateDecompilation(result, source); const sig = extractSignature(result);
  assert(sig.functions > 0); assert(sig.modules.every(m => m.size > 0 && m.hash.length === 64));
  result.modules[0].content += ' changed'; assert.throws(() => validateDecompilation(result, source), /witness/);
});
test('rejects zero-module, missing and invalid witnesses', () => {
  assert.throws(() => validateDecompilation({ modules: [] }, ''));
  const result = decompileSource('function bash(){return "bash";}', { useRust: false });
  result.witness.root = 'bad'; assert.throws(() => validateDecompilation(result, 'function bash(){return "bash";}'));
  assert.throws(() => extractSignature(null));
});
test('detects equal-size changes and class-only edits by content hash', () => {
  const before = { modules: [{ name: 'core', size: 10, functions: 1, classes: 0, hash: 'a' }], functions: 1, classes: 0 };
  const after = { modules: [{ name: 'core', size: 10, functions: 1, classes: 1, hash: 'b' }], functions: 1, classes: 1 };
  assert.equal(computeDiff(before, after).summary.changedModuleCount, 1);
});
function recovered(version, source = 'export function bash(){ return "bash tool"; }') {
  return { sources: [{ name: 'cli.mjs', source, format: 'module', entryPoint: true, embeddedSha256: sha256(source) }], assets: [], graphModules: 1, entryPoint: 'cli.mjs', provenance: { version, package: '@anthropic-ai/claude-code', packaging: 'javascript', tarballSha256: 'a'.repeat(64), integrity: `sha512-${'a'.repeat(86)}==` } };
}
test('both versions must succeed; one-sided and two-sided failures never produce a diff', async () => {
  for (const bad of ['2.1.284', '2.1.285', 'both']) await assert.rejects(runDiff('2.1.285', '2.1.284', { loadSources: async v => { if (bad === 'both' || bad === v) throw new Error('fetch failed'); return recovered(v); } }), /fetch failed/);
});
test('invalid JavaScript is rejected without executing source', async () => {
  await assert.rejects(runDiff('2.1.285', '2.1.284', { loadSources: async v => recovered(v, 'export function (') }));
  const marker = path.join(os.tmpdir(), 'occ-source-must-not-execute');
  const source = `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'bad'); export function bash(){return 'bash';}`;
  const diff = await runDiff('2.1.285', '2.1.284', { loadSources: async v => recovered(v, source) });
  assert.equal(fs.existsSync(marker), false); assert.equal(validateDiff(diff, '2.1.285', '2.1.284'), diff);
});
test('writes evidence and validates full result; rejects partial/error/wrong-version results', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-test-'));
  try {
    const diff = await runDiff('2.1.285', '2.1.284', { loadSources: async v => recovered(v), outputDir });
    assert(fs.existsSync(path.join(outputDir, 'previous/recovered/00000.mjs')));
    assert(fs.existsSync(path.join(outputDir, 'current/witness.json')));
    validateDiff(diff, '2.1.285', '2.1.284');
    for (const change of [d => d.error = 'failed', d => d.status = 'partial', d => d.evidence.current.sourceModules++, d => d.evidence.previous.witness.valid = false, d => delete d.evidence.current.witness.records, d => d.versions.current = '1.0.0', d => d.evidence.current.sourceBytes = 0, d => d.summary.changedModuleCount++]) {
      const bad = structuredClone(diff); change(bad); assert.throws(() => validateDiff(bad, '2.1.285', '2.1.284'));
    }
    assert.throws(() => validateDiff({ error: 'decompilation_failed', summary: {} }, '2.1.285', '2.1.284'));
  } finally { fs.rmSync(outputDir, { recursive: true, force: true }); }
});
test('CLI failure exits nonzero and emits no success JSON', () => {
  const result = spawnSync(process.execPath, [cli, 'unknown', '2.1.284'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
});
test('workflow always decompiles and gates consumers before release/version advancement', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/nightly.yml'), 'utf8');
  const analyze = workflow.split('  analyze:\n')[1].split('  autoupdate:\n')[0];
  assert(!analyze.split('    steps:')[0].includes('skip_ai_analysis'));
  assert(!analyze.includes('Decompilation failed or returned empty'));
  for (const name of ['autoupdate', 'release']) {
    const job = workflow.split(`  ${name}:\n`)[1].split('    steps:')[0];
    assert(job.includes("needs.analyze.result == 'success'")); assert(job.includes("needs.analyze.outputs.diff_available == 'true'"));
  }
  assert(!workflow.includes('Run decompiler if diff missing'));
  assert(workflow.indexOf('- name: Update last-known version') > workflow.indexOf('- name: Create GitHub release'));
  assert(!workflow.includes('Could not push version update'));
  assert(workflow.includes('Validate decompile evidence before release'));
  assert(workflow.includes('needs: [detect, verify, analyze, autoupdate, release]'));
});
test('detection retries previously green but unvalidated releases and stops after validated publication', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-detect-'));
  try {
    fs.copyFileSync(path.join(root, 'scripts/check-claude-release.sh'), path.join(temp, 'check.sh'));
    fs.writeFileSync(path.join(temp, 'last-known-claude-version.txt'), '2.1.285\n');
    fs.writeFileSync(path.join(temp, 'curl'), '#!/bin/sh\nprintf \'{"version":"2.1.285"}\'\n', { mode: 0o755 });
    const run = () => spawnSync('bash', [path.join(temp, 'check.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${temp}:${process.env.PATH}` } });
    assert.equal(run().status, 0); assert.equal(run().stdout.trim(), '2.1.285');
    fs.writeFileSync(path.join(temp, 'last-decompiled-claude-version.txt'), '2.1.284\n'); assert.equal(run().status, 0);
    fs.writeFileSync(path.join(temp, 'last-decompiled-claude-version.txt'), '2.1.285\n'); assert.equal(run().status, 1);
    fs.writeFileSync(path.join(temp, 'curl'), '#!/bin/sh\nprintf \'{"version":"bad;version"}\'\n', { mode: 0o755 }); assert.equal(run().status, 2);
    fs.writeFileSync(path.join(temp, 'curl'), '#!/bin/sh\nprintf invalid-json\n', { mode: 0o755 }); assert.equal(run().status, 2);
    fs.writeFileSync(path.join(temp, 'curl'), '#!/bin/sh\nexit 22\n', { mode: 0o755 }); assert.equal(run().status, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('legacy npm resolver honors the requested version/bin and verifies tarball integrity', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-registry-test-'));
  const originalFetch = globalThis.fetch;
  try {
    fs.mkdirSync(path.join(temp, 'package'));
    const manifest = { name: '@anthropic-ai/claude-code', version: '2.1.91', type: 'module', bin: { claude: './cli.mjs' } };
    fs.writeFileSync(path.join(temp, 'package/package.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(temp, 'package/cli.mjs'), 'export function bash(){return "tool bash";}');
    const bytes = execFileSync('tar', ['czf', '-', '-C', temp, 'package']);
    const metadata = { ...manifest, dist: { tarball: 'https://registry.npmjs.org/@anthropic-ai/claude-code/-/fixture.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } };
    let tamper = false;
    globalThis.fetch = async url => new Response(url.endsWith('.tgz') ? (tamper ? Buffer.from('bad tarball') : bytes) : JSON.stringify(metadata));
    const result = await fetchUpstreamSources('2.1.91');
    assert.equal(result.sources.length, 1); assert.equal(result.sources[0].name, 'package/cli.mjs'); assert.equal(result.provenance.version, '2.1.91');
    tamper = true; await assert.rejects(fetchUpstreamSources('2.1.91'), /integrity mismatch/); tamper = false;
    metadata.dist.tarball = 'https://evil.example/fixture.tgz'; await assert.rejects(fetchUpstreamSources('2.1.91'), /non-registry/);
    metadata.version = '2.1.92'; await assert.rejects(fetchUpstreamSources('2.1.91'), /different package\/version/);
  } finally { globalThis.fetch = originalFetch; fs.rmSync(temp, { recursive: true, force: true }); }
});
test('formatter rejects errors instead of reporting an unavailable successful summary', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'occ-format-test-'));
  try {
    const filename = path.join(temp, 'diff.json'); fs.writeFileSync(filename, '{"error":"decompilation_failed","summary":{}}');
    const result = spawnSync('python3', [path.join(root, 'scripts/format-diff-summary.py'), filename], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('validates current upstream using syntax on the required Node 24 runtime', async () => {
  const source = 'export function bash(){ using i = { [Symbol.dispose](){} }; return "bash tool"; }';
  const diff = await runDiff('2.1.285', '2.1.284', { loadSources: async v => recovered(v, source) });
  validateDiff(diff, '2.1.285', '2.1.284');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/nightly.yml'), 'utf8');
  assert(workflow.includes("NODE_VERSION: '24'"));
});
