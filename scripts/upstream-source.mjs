/** Fetch released source without installing or executing upstream code.
 * Native support deliberately targets Linux ELF64 Bun's 52-byte module table.
 * Format reference (Bun, MIT):
 * https://github.com/oven-sh/bun/blob/bf42a525d59fbaaa56e47f050fd6384e53c51f5c/src/standalone_graph/StandaloneModuleGraph.rs
 * Unknown layouts fail closed; this is not a bytecode decompiler.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PACKAGE = '@anthropic-ai/claude-code';
const PLATFORM_PACKAGE = `${PACKAGE}-linux-x64`;
const REGISTRY = 'https://registry.npmjs.org';
const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_BINARY = 512 * 1024 * 1024;
const MAX_SOURCE = 128 * 1024 * 1024;
const TRAILER = Buffer.from('\n---- Bun! ----\n');
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function assertVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected an exact upstream version, received ${JSON.stringify(version)}`);
  }
}
function range(buffer, offset, size, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > buffer.length - size) {
    throw new Error(`Out-of-bounds ${label}`);
  }
  return buffer.subarray(offset, offset + size);
}
function u64(buffer, offset) {
  const value = range(buffer, offset, 8, '64-bit integer').readBigUInt64LE();
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe 64-bit integer');
  return Number(value);
}
function cstring(buffer, offset) {
  range(buffer, offset, 1, 'string');
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error('Unterminated section name');
  return buffer.subarray(offset, end).toString('utf8');
}

export function extractBunSources(binary) {
  if (binary.length < 64 || binary.subarray(0, 4).toString('hex') !== '7f454c46' || binary[4] !== 2 || binary[5] !== 1) {
    throw new Error('Unsupported native format: expected little-endian ELF64');
  }
  const sectionOffset = u64(binary, 40);
  const entrySize = binary.readUInt16LE(58), count = binary.readUInt16LE(60), namesIndex = binary.readUInt16LE(62);
  if (entrySize !== 64 || !count || namesIndex >= count) throw new Error('Unsupported ELF section table');
  range(binary, sectionOffset, count * entrySize, 'ELF section table');
  const section = index => binary.subarray(sectionOffset + index * entrySize, sectionOffset + (index + 1) * entrySize);
  const namesSection = section(namesIndex);
  const names = range(binary, u64(namesSection, 24), u64(namesSection, 32), 'ELF section names');
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const header = section(i);
    if (cstring(names, header.readUInt32LE(0)) === '.bun') candidates.push(header);
  }
  if (candidates.length !== 1) throw new Error('Expected exactly one .bun section');
  const header = candidates[0];
  const sectionBytes = range(binary, u64(header, 24), u64(header, 32), '.bun section');
  const graph = range(sectionBytes, 8, u64(sectionBytes, 0), 'Bun graph');
  if (graph.length < 48 || !graph.subarray(-TRAILER.length).equals(TRAILER)) throw new Error('Invalid Bun graph trailer');
  const footer = graph.subarray(graph.length - 48, graph.length - 16);
  const byteCount = u64(footer, 0);
  if (byteCount !== graph.length - 48) throw new Error('Invalid Bun graph byte count');
  const data = graph.subarray(0, byteCount);
  const tableOffset = footer.readUInt32LE(8), tableBytes = footer.readUInt32LE(12), entryPointId = footer.readUInt32LE(16);
  // Current Bun CompiledModuleGraphFile: six StringPointers + four u8 enums.
  if (!tableBytes || tableBytes % 52 !== 0 || tableBytes / 52 > 100000 || entryPointId >= tableBytes / 52) {
    throw new Error('Unsupported or invalid Bun module table');
  }
  const table = range(data, tableOffset, tableBytes, 'Bun module table');
  const sources = [], assets = [], seen = new Set();
  let sourceBytes = 0;
  for (let i = 0; i < tableBytes / 52; i++) {
    const record = table.subarray(i * 52, (i + 1) * 52);
    const strings = [];
    for (let p = 0; p < 48; p += 8) {
      strings.push(range(data, record.readUInt32LE(p), record.readUInt32LE(p + 4), 'Bun module pointer'));
    }
    const name = new TextDecoder('utf-8', { fatal: true }).decode(strings[0]);
    if (!name.startsWith('/$bunfs/') || /[\x00-\x1f]/.test(name) || name.includes('\\') || name.split('/').includes('..') || seen.has(name)) throw new Error('Invalid or duplicate Bun module name');
    seen.add(name);
    const [encoding, loader, format, side] = record.subarray(48);
    if (encoding > 2 || side > 1 || format > 2) throw new Error(`Unsupported Bun module metadata: ${name}`);
    if (loader === 1 && side === 0) {
      if (!strings[1].length || ![1, 2].includes(format) || ![1, 2].includes(encoding)) throw new Error(`Missing JavaScript source: ${name}`);
      if (encoding === 2 && strings[1].length % 2 !== 0) throw new Error(`Invalid UTF-16 source: ${name}`);
      sourceBytes += strings[1].length;
      if (sourceBytes > MAX_SOURCE) throw new Error('Embedded source exceeds size limit');
      const source = strings[1].toString(encoding === 1 ? 'latin1' : 'utf16le');
      if (source.includes('\0')) throw new Error(`Binary data in JavaScript source: ${name}`);
      sources.push({ name, source, format: format === 1 ? 'module' : 'commonjs', embeddedSha256: sha256(strings[1]), entryPoint: i === entryPointId });
    } else {
      // Never silently omit a different kind of server executable module.
      if (side === 0 || format !== 0) throw new Error(`Unsupported executable Bun module: ${name}`);
      assets.push({ name, bytes: strings[1].length, loader, encoding, sha256: sha256(strings[1]) });
    }
  }
  if (!sources.some(source => source.entryPoint)) throw new Error('Bun entry point has no supported JavaScript source');
  return { sources, assets, sourceBytes, entryPoint: sources.find(source => source.entryPoint).name, graphModules: tableBytes / 52 };
}

export function verifyIntegrity(bytes, integrity) {
  const match = typeof integrity === 'string' && integrity.match(/^sha512-([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error('Missing or unsupported npm SHA-512 integrity');
  const expected = Buffer.from(match[1], 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('npm tarball integrity mismatch');
}
async function fetchBytes(url, maxBytes) {
  const parsed = new URL(url);
  if (parsed.origin !== REGISTRY || parsed.username || parsed.password) throw new Error('Refusing non-registry package URL');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Registry HTTP ${response.status}: ${url}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Registry response exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function packageMetadata(name, version) {
  const metadata = JSON.parse((await fetchBytes(`${REGISTRY}/${name}/${version}`, 1024 * 1024)).toString('utf8'));
  if (metadata.name !== name || metadata.version !== version) throw new Error('Registry returned a different package/version');
  return metadata;
}
function safeArchiveName(name) {
  return name.startsWith('package/') && !name.split('/').includes('..') && !name.includes('\\') && !/[\x00-\x1f]/.test(name);
}
async function withPackage(metadata, consume) {
  const bytes = await fetchBytes(metadata.dist?.tarball, MAX_ARCHIVE);
  verifyIntegrity(bytes, metadata.dist?.integrity);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'occ-upstream-'));
  try {
    const archive = path.join(temp, 'package.tgz');
    await fs.writeFile(archive, bytes);
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim().split('\n');
    if (names.some(name => !safeArchiveName(name)) || new Set(names).size !== names.length) throw new Error('Unsafe or duplicate npm archive paths');
    // Stream only the named member to memory; no files, links, or scripts from the archive are installed.
    const read = (name, maxBuffer = MAX_SOURCE) => {
      if (!safeArchiveName(name) || !names.includes(name)) throw new Error(`Missing package member: ${name}`);
      return execFileSync('tar', ['-xOzf', archive, '--', name], { maxBuffer, timeout: 120000 });
    };
    const manifest = JSON.parse(read('package/package.json', 1024 * 1024));
    if (manifest.name !== metadata.name || manifest.version !== metadata.version) throw new Error('Tarball package identity mismatch');
    return await consume({ names, read, manifest, provenance: { package: metadata.name, version: metadata.version, tarball: metadata.dist.tarball, integrity: metadata.dist.integrity, tarballSha256: sha256(bytes) } });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

export async function fetchUpstreamSources(version) {
  assertVersion(version);
  const metadata = await packageMetadata(PACKAGE, version);
  const nativeVersion = metadata.optionalDependencies?.[PLATFORM_PACKAGE];
  if (nativeVersion) {
    if (nativeVersion !== version) throw new Error('Native dependency must be pinned to the same exact version');
    const native = await packageMetadata(PLATFORM_PACKAGE, version);
    return withPackage(native, ({ read, provenance }) => {
      const binary = read('package/claude', MAX_BINARY);
      return { ...extractBunSources(binary), provenance: { ...provenance, wrapperPackage: PACKAGE, wrapperVersion: version, packaging: 'bun-elf64-source', binarySha256: sha256(binary) } };
    });
  }
  return withPackage(metadata, ({ names, read, manifest, provenance }) => {
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.claude;
    const candidate = bin ? `package/${bin.replace(/^\.\//, '')}` : 'package/cli.js';
    if (!/\.(?:[cm]?js)$/.test(candidate) || /(?:wrapper|install)\.[cm]?js$/.test(candidate) || !names.includes(candidate)) {
      throw new Error('Unsupported upstream packaging: no source CLI or pinned Linux native dependency');
    }
    const bytes = read(candidate);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!source.trim() || source.includes('\0')) throw new Error('Empty or binary CLI source');
    return { sources: [{ name: candidate, source, format: manifest.type === 'module' || candidate.endsWith('.mjs') ? 'module' : 'commonjs', embeddedSha256: sha256(bytes), entryPoint: true }], assets: [], graphModules: 1, sourceBytes: bytes.length, entryPoint: candidate, provenance: { ...provenance, packaging: 'javascript' } };
  });
}
