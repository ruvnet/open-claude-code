#!/usr/bin/env node
/** Recover shipped JavaScript, run ruDevolution's Node keyword classifier on
 * every source module, verify witnesses, and compare category content hashes.
 * This does not recover original identifiers or prove semantic equivalence.
 * Usage: node scripts/decompile-and-diff.mjs NEW PREVIOUS [--output-dir DIR]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { assertVersion, fetchUpstreamSources, sha256, PACKAGE } from './upstream-source.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
function engine() {
  const base = path.join(dirname, '..', 'rudevolution', 'npm', 'src', 'decompiler');
  return { ...require(base), ...require(path.join(base, 'metrics.js')) };
}
export function validateDecompilation(result, source) {
  const { verifyWitnessChain } = engine();
  if (!result || !Array.isArray(result.modules) || !result.modules.length || result.modules.some(m => typeof m.name !== 'string' || !m.name || typeof m.content !== 'string' || !m.content.trim())) {
    throw new Error('Empty or invalid ruDevolution output');
  }
  const verified = verifyWitnessChain(result.witness, source);
  if (!verified.valid || result.witness.module_hashes?.length !== result.modules.length) throw new Error('Invalid decompilation witness');
  for (let i = 0; i < result.modules.length; i++) {
    const actual = result.modules[i], claimed = result.witness.module_hashes[i];
    if (actual.name !== claimed.name || sha256(actual.content) !== claimed.hash) throw new Error('Decompiled content does not match witness');
  }
  return verified;
}
export function extractSignature(result) {
  if (!result?.modules?.length || !result.metrics?.source) throw new Error('Missing complete decompilation result');
  const { computeMetrics } = engine();
  const modules = result.modules.map(m => {
    const metrics = computeMetrics(m.content);
    return { name: m.name, functions: metrics.functions + metrics.arrowFunctions, classes: metrics.classes, size: Buffer.byteLength(m.content), hash: sha256(m.content) };
  });
  // ruDevolution's lexical counts are estimates, not AST symbol counts. Do not
  // invent export names from its modules (which have content, not exports[]).
  return { modules, functions: result.metrics.source.functions + result.metrics.source.arrowFunctions, classes: result.metrics.source.classes };
}
export function computeDiff(previous, current) {
  const old = new Map(previous.modules.map(m => [m.name, m]));
  const now = new Map(current.modules.map(m => [m.name, m]));
  const addedModules = current.modules.filter(m => !old.has(m.name));
  const removedModules = previous.modules.filter(m => !now.has(m.name));
  const changedModules = current.modules.flatMap(m => {
    const prev = old.get(m.name);
    return prev && prev.hash !== m.hash ? [{ name: m.name, sizeDelta: m.size - prev.size, funcDelta: m.functions - prev.functions, classDelta: m.classes - prev.classes, previousSha256: prev.hash, currentSha256: m.hash }] : [];
  });
  return { summary: { prevModules: previous.modules.length, newModules: current.modules.length, prevFunctions: previous.functions, newFunctions: current.functions, prevClasses: previous.classes, newClasses: current.classes, addedModuleCount: addedModules.length, removedModuleCount: removedModules.length, changedModuleCount: changedModules.length }, addedModules, removedModules, changedModules };
}
export async function decompile(version, { loadSources = fetchUpstreamSources, outputDir } = {}) {
  assertVersion(version);
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required to parse current upstream JavaScript (using declarations)');
  console.error(`Recovering and decompiling ${PACKAGE}@${version}...`);
  const recovered = await loadSources(version);
  if (!recovered?.sources?.length || !recovered.provenance || !recovered.sources.some(m => m.entryPoint)) throw new Error('No complete recovered source graph');
  const validation = JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', path.join(dirname, 'validate-source.mjs')], {
    input: JSON.stringify(recovered.sources), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000,
  }));
  if (validation.valid !== true || validation.modules !== recovered.sources.length) throw new Error('Source syntax validation incomplete');
  const { decompileSource, computeModuleMetrics } = engine();
  const categories = new Map(), witnesses = [], sourceMetrics = {};
  const sourceManifest = [];
  if (outputDir) await fs.mkdir(path.join(outputDir, 'recovered'), { recursive: true });
  for (const [index, item] of recovered.sources.entries()) {
    const result = decompileSource(item.source, { useRust: false, witness: true });
    const verified = validateDecompilation(result, item.source);
    for (const [key, value] of Object.entries(result.metrics.source)) sourceMetrics[key] = (sourceMetrics[key] || 0) + value;
    for (const module of result.modules) {
      if (!categories.has(module.name)) categories.set(module.name, []);
      categories.get(module.name).push(module.content);
    }
    const sourceHash = sha256(item.source);
    witnesses.push({ name: item.name, ...result.witness });
    const record = { name: item.name, format: item.format, entryPoint: item.entryPoint, bytes: Buffer.byteLength(item.source), sourceSha256: sourceHash, embeddedSha256: item.embeddedSha256, decompiledModules: result.modules.length, witnessRoot: verified.root };
    sourceManifest.push(record);
    if (outputDir) {
      // Only numeric generated names become paths; embedded names stay data.
      await fs.writeFile(path.join(outputDir, 'recovered', `${String(index).padStart(5, '0')}.${item.format === 'module' ? 'mjs' : 'cjs'}`), item.source);
    }
  }
  const modules = [...categories].sort(([a], [b]) => a.localeCompare(b)).map(([name, fragments]) => ({ name, content: fragments.join('\n\n') }));
  if (!modules.length) throw new Error('Decompilation produced no categories');
  const metrics = { source: sourceMetrics, modules: computeModuleMetrics(modules), engine: 'rudevolution-node-keyword', method: 'lexical estimates; categories are classified source fragments, not independently runnable modules' };
  const evidence = { version, ...recovered.provenance, entryPoint: recovered.entryPoint, sourceSyntaxValid: true, sourceModules: recovered.sources.length, processedSourceModules: sourceManifest.length, sourceBytes: sourceMetrics.sizeBytes, sourceManifestSha256: sha256(JSON.stringify(sourceManifest)), assetCount: recovered.assets.length, graphModules: recovered.graphModules, categoryCount: modules.length, witness: { valid: true, records: witnesses.reduce((n, w) => n + w.chain.length, 0), chains: witnesses.length, algorithm: 'sha256' } };
  if (outputDir) {
    await fs.writeFile(path.join(outputDir, 'decompiled.json'), JSON.stringify({ modules, metrics }));
    await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify({ evidence, sources: sourceManifest, assets: recovered.assets }, null, 2));
    await fs.writeFile(path.join(outputDir, 'witness.json'), JSON.stringify(witnesses));
  }
  console.error(`  Validated ${sourceManifest.length} source modules, ${sourceMetrics.sizeBytes} source bytes, ${modules.length} categories, ${witnesses.length} verified witness chains`);
  return { modules, metrics, evidence };
}
export async function runDiff(newVersion, previousVersion, options = {}) {
  assertVersion(newVersion); assertVersion(previousVersion);
  // Sequential processing bounds memory for native packages. Either failure is fatal.
  const previous = await decompile(previousVersion, { ...options, outputDir: options.outputDir && path.join(options.outputDir, 'previous') });
  const current = newVersion === previousVersion ? previous : await decompile(newVersion, { ...options, outputDir: options.outputDir && path.join(options.outputDir, 'current') });
  const diff = { schemaVersion: 1, status: 'complete', package: PACKAGE, versions: { previous: previousVersion, current: newVersion }, ...computeDiff(extractSignature(previous), extractSignature(current)), metrics: { previous: previous.metrics, current: current.metrics }, evidence: { previous: previous.evidence, current: current.evidence }, witness: { previous: previous.evidence.witness, current: current.evidence.witness } };
  if (options.outputDir) await fs.writeFile(path.join(options.outputDir, 'diff.json'), JSON.stringify(diff, null, 2));
  return diff;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [newVersion, previousVersion, flag, outputDir, ...extra] = process.argv.slice(2);
  if (!newVersion || !previousVersion || (flag && (flag !== '--output-dir' || !outputDir)) || extra.length) {
    console.error('Usage: node scripts/decompile-and-diff.mjs NEW PREVIOUS [--output-dir DIR]');
    process.exitCode = 2;
  } else {
    runDiff(newVersion, previousVersion, { outputDir }).then(diff => console.log(JSON.stringify(diff, null, 2))).catch(error => {
      console.error(`Decompilation failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
