#!/usr/bin/env node
/** Structural evidence creates review proposals, never guessed code.
 * Exit 0: validated report, updates empty. Exit 3: invalid evidence.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateDiff } from './validate-decompile-diff.mjs';
export function proposalsFromDiff(diff, current, previous) {
  validateDiff(diff, current || diff.versions?.current, previous || diff.versions?.previous);
  const proposals = [
    ...(diff.addedModules || []).map(m => ({kind:'added_category', name:m.name})),
    ...(diff.removedModules || []).map(m => ({kind:'removed_category', name:m.name})),
    ...(diff.changedModules || []).map(m => ({kind:'changed_category', name:m.name, sizeDelta:m.sizeDelta, functionDelta:m.funcDelta})),
  ];
  return {status:proposals.length ? 'proposals_only' : 'no_changes', applied:false,
    updates:[], proposals, previousVersion:previous || diff.versions?.previous,
    newVersion:current || diff.versions?.current, implementationBlocked:proposals.length > 0,
    reason:'Lexical counts do not establish semantic capabilities. Implementation requires concrete behavioral specifications, source evidence and new behavioral tests with zero regressions. No source files were modified.'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const diff = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/decompile-diff.json', 'utf8'));
    console.log(JSON.stringify(proposalsFromDiff(diff, process.env.NEW_VERSION, process.env.PREVIOUS_VERSION), null, 2));
  } catch {
    console.error('Capability proposal failed: missing or invalid version-bound evidence.');
    process.exitCode = 3;
  }
}
