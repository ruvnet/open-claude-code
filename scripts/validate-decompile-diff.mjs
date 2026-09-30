#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVersion, PACKAGE } from './upstream-source.mjs';
export function validateDiff(diff, currentVersion, previousVersion) {
  assertVersion(currentVersion); assertVersion(previousVersion);
  const fail = message => { throw new Error(`Invalid decompilation diff: ${message}`); };
  if (diff?.schemaVersion !== 1 || diff.status !== 'complete' || diff.error || diff.package !== PACKAGE) fail('not a complete supported result');
  if (diff.versions?.current !== currentVersion || diff.versions?.previous !== previousVersion) fail('version mismatch');
  for (const [side, version, key] of [['previous', previousVersion, 'prevModules'], ['current', currentVersion, 'newModules']]) {
    const proof = diff.evidence?.[side];
    if (proof?.version !== version || !['javascript', 'bun-elf64-source'].includes(proof.packaging) || proof.sourceSyntaxValid !== true) fail(`${side} source not validated`);
    for (const field of ['sourceModules', 'processedSourceModules', 'sourceBytes', 'categoryCount']) if (!Number.isSafeInteger(proof[field]) || proof[field] <= 0) fail(`${side} empty ${field}`);
    if (proof.sourceModules !== proof.processedSourceModules || proof.categoryCount !== diff.summary?.[key] || proof.witness?.valid !== true || proof.witness?.chains !== proof.sourceModules || (!Number.isSafeInteger(proof.witness?.records) || proof.witness.records < proof.sourceModules * 3) || proof.witness?.algorithm !== 'sha256') fail(`${side} incomplete evidence`);
    if (!Number.isSafeInteger(proof.assetCount) || proof.assetCount < 0 || proof.graphModules !== proof.sourceModules + proof.assetCount || proof.sourceBytes !== diff.metrics?.[side]?.source?.sizeBytes) fail(`${side} coverage/metrics mismatch`);
    for (const field of ['tarballSha256', 'sourceManifestSha256']) if (!/^[a-f0-9]{64}$/.test(proof[field] || '')) fail(`${side} missing ${field}`);
    if (proof.packaging === 'bun-elf64-source' && !/^[a-f0-9]{64}$/.test(proof.binarySha256 || '')) fail(`${side} missing binary hash`);
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(proof.integrity || '')) fail(`${side} missing npm integrity`);
  }
  for (const [list, counter] of [['addedModules', 'addedModuleCount'], ['removedModules', 'removedModuleCount'], ['changedModules', 'changedModuleCount']]) {
    if (!Array.isArray(diff[list]) || diff[list].length !== diff.summary[counter]) fail(`${list} count mismatch`);
  }
  return diff;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const [, , filename, current, previous] = process.argv; validateDiff(JSON.parse(fs.readFileSync(filename, 'utf8')), current, previous); console.log('Complete decompilation evidence verified'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
