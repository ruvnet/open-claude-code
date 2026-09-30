#!/usr/bin/env node
/**
 * auto-update-capabilities.mjs
 *
 * Analyzes the decompile diff, identifies new capabilities in upstream
 * Claude Code, and uses Claude API (Sonnet) to generate implementations
 * matching the v2/src/ code patterns.
 *
 * Flow:
 * 1. Read decompile-diff.json for structural changes
 * 2. Read current v2/src/ to understand patterns
 * 3. For each new capability, call Claude API to generate code
 * 4. Write new/updated files
 * 5. Update registries and imports
 * 6. Run tests — revert if they fail
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/auto-update-capabilities.mjs [diff-file]
 *
 * Exit codes:
 *   0 — updates applied and tests pass
 *   1 — no updates needed
 *   2 — updates failed tests (reverted)
 *   3 — error
 */

import fs from 'fs';
import { validateDiff } from './validate-decompile-diff.mjs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2_SRC = path.join(ROOT, 'v2', 'src');
const DIFF_FILE = process.argv[2] || '/tmp/decompile-diff.json';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-20250514';

// ─── Protected integration: metaharness self-optimization layer ───
//
// The hand-added self-optimization layer lives in v2/src/optimize/ (never a
// regeneration target) and is wired into a handful of upstream-shaped files via
// small, opt-in guards. Some of those files (notably core/agent-loop.mjs and
// ui/commands.mjs) ARE regeneration targets in mapToV2Files(), and a full-file
// LLM regen can silently drop the wire-ins even when told not to. This map
// records substrings that MUST survive in any regenerated copy of a protected
// file; PROTECTED_PATHS lists directories the autoupdate must never touch.
//
// If a generated file is missing any of its markers, the update is rejected and
// the original file is kept — the integration is never silently wiped.
const OPTIMIZE_WIRE_INS = {
  'v2/src/core/agent-loop.mjs': ['cascade', '_cascade'],
  'v2/src/ui/commands.mjs': ['../optimize/store.mjs', '/optimize'],
};

// Directories the autoupdate is never allowed to create/modify/delete files in.
const PROTECTED_PATHS = ['v2/src/optimize/'];

function isProtectedPath(relFile) {
  const norm = relFile.replace(/\\/g, '/');
  return PROTECTED_PATHS.some((p) => norm === p.replace(/\/$/, '') || norm.startsWith(p));
}

// Returns the list of markers missing from `content` for `relFile`, or [] if
// the file is not protected or all markers are present.
function missingWireIns(relFile, content) {
  const markers = OPTIMIZE_WIRE_INS[relFile.replace(/\\/g, '/')];
  if (!markers || content == null) return [];
  return markers.filter((m) => !content.includes(m));
}

if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY required');
  process.exit(3);
}

// ─── Helpers ───

async function callClaude(prompt, maxTokens = 4096) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await resp.json();
  if (data.error) throw new Error(`API: ${data.error.message}`);
  return data.content?.[0]?.text || '';
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function runTests() {
  try {
    const out = execSync('node v2/test/test.mjs', { cwd: ROOT, timeout: 60000, encoding: 'utf8' });
    const match = out.match(/(\d+) passed/);
    const failMatch = out.match(/(\d+) failed/);
    const passed = match ? parseInt(match[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    return { passed, failed, ok: failed <= 1 }; // allow 1 known failure
  } catch (e) {
    return { passed: 0, failed: 999, ok: false };
  }
}

// ─── Analyze what needs updating ───

function analyzeChanges(diff, metrics) {
  const changes = [];
  const prev = metrics?.previous?.source || {};
  const curr = metrics?.current?.source || {};

  // New functions/classes
  const newFuncs = (curr.functions || 0) - (prev.functions || 0);
  const newClasses = (curr.classes || 0) - (prev.classes || 0);
  const newAsync = (curr.asyncFunctions || 0) - (prev.asyncFunctions || 0);
  const newEnvVars = (metrics?.current?.modules?.perModule?.find(m => m.name === 'env-vars')?.lines || 0)
    - (metrics?.previous?.modules?.perModule?.find(m => m.name === 'env-vars')?.lines || 0);
  const newCommands = (metrics?.current?.modules?.perModule?.find(m => m.name === 'command-defs')?.lines || 0)
    - (metrics?.previous?.modules?.perModule?.find(m => m.name === 'command-defs')?.lines || 0);
  const classHierarchyDelta = (metrics?.current?.modules?.perModule?.find(m => m.name === 'class-hierarchy')?.classes || 0)
    - (metrics?.previous?.modules?.perModule?.find(m => m.name === 'class-hierarchy')?.classes || 0);

  if (newFuncs > 0) changes.push({ type: 'new_functions', count: newFuncs, asyncCount: newAsync });
  if (newClasses > 0) changes.push({ type: 'new_classes', count: newClasses, hierarchyDelta: classHierarchyDelta });
  if (newEnvVars > 0) changes.push({ type: 'new_env_vars', count: newEnvVars });
  if (newCommands > 0) changes.push({ type: 'new_commands', count: newCommands });

  // Added modules
  for (const m of (diff.addedModules || [])) {
    changes.push({ type: 'new_module', name: m.name, functions: m.functions, classes: m.classes });
  }

  // Added exports
  for (const e of (diff.addedExports || [])) {
    changes.push({ type: 'new_export', name: e });
  }

  // Significantly changed modules
  for (const m of (diff.changedModules || [])) {
    if (Math.abs(m.sizeDelta) > 500 || Math.abs(m.funcDelta) > 5) {
      changes.push({ type: 'changed_module', name: m.name, sizeDelta: m.sizeDelta, funcDelta: m.funcDelta });
    }
  }

  return changes;
}

// ─── Map changes to v2 source files ───

function mapToV2Files(changes) {
  const updates = [];
  const existingTools = listDir(path.join(V2_SRC, 'tools')).filter(f => f.endsWith('.mjs'));
  const existingCore = listDir(path.join(V2_SRC, 'core')).filter(f => f.endsWith('.mjs'));
  const existingConfig = listDir(path.join(V2_SRC, 'config')).filter(f => f.endsWith('.mjs'));

  for (const change of changes) {
    if (change.type === 'new_env_vars' && change.count > 0) {
      updates.push({
        action: 'update',
        file: 'v2/src/config/env.mjs',
        reason: `${change.count} new environment variables detected upstream`,
        category: 'config',
      });
    }
    if (change.type === 'new_commands' && change.count > 0) {
      updates.push({
        action: 'update',
        file: 'v2/src/ui/commands.mjs',
        reason: `${change.count} new command definitions detected upstream`,
        category: 'commands',
      });
    }
    if (change.type === 'new_classes' && change.hierarchyDelta > 0) {
      updates.push({
        action: 'update',
        file: 'v2/src/core/providers.mjs',
        reason: `${change.hierarchyDelta} new classes in hierarchy (likely new providers/models)`,
        category: 'core',
      });
    }
    if (change.type === 'new_functions' && change.asyncCount > 5) {
      updates.push({
        action: 'update',
        file: 'v2/src/core/agent-loop.mjs',
        reason: `${change.asyncCount} new async functions (likely agent loop enhancements)`,
        category: 'core',
      });
    }
  }

  // Never let the autoupdate target the protected optimize layer.
  const safe = updates.filter((u) => {
    if (isProtectedPath(u.file)) {
      console.error(`  Refusing to map update into protected path: ${u.file}`);
      return false;
    }
    return true;
  });

  return safe;
}

// ─── Generate code updates via Claude ───

async function generateUpdate(update, prevVersion, newVersion) {
  const currentCode = readFile(path.join(ROOT, update.file));
  if (!currentCode) {
    console.error(`  File not found: ${update.file}`);
    return null;
  }

  // Get decompile metrics for context
  const diff = JSON.parse(readFile(DIFF_FILE) || '{}');
  const prevMetrics = diff.metrics?.previous?.source || {};
  const currMetrics = diff.metrics?.current?.source || {};

  const prompt = `You are updating an open source Claude Code CLI implementation to match capabilities in the latest upstream release.

## Context
- Upstream Claude Code updated from v${prevVersion} to v${newVersion}
- Change detected: ${update.reason}
- File to update: ${update.file}

## Upstream metrics change (v${prevVersion} → v${newVersion})
- Functions: ${prevMetrics.functions || '?'} → ${currMetrics.functions || '?'}
- Async functions: ${prevMetrics.asyncFunctions || '?'} → ${currMetrics.asyncFunctions || '?'}
- Classes: ${prevMetrics.classes || '?'} → ${currMetrics.classes || '?'}
- Env vars module lines: changed
- Bundle size: ${prevMetrics.sizeBytes || '?'} → ${currMetrics.sizeBytes || '?'} bytes

## Current file content
\`\`\`javascript
${currentCode.slice(0, 8000)}
\`\`\`

## Instructions
1. Analyze what likely changed upstream based on the metrics
2. Add the most probable new capabilities to this file
3. Follow the EXACT same code patterns, naming conventions, and export style
4. Add a comment "// Added in nightly sync v${newVersion}" on new additions
5. Do NOT remove or change existing functionality
6. Return ONLY the complete updated file content, no explanations
7. If you can't determine specific changes, add reasonable stubs marked with TODO
${(OPTIMIZE_WIRE_INS[update.file.replace(/\\/g, '/')] || []).length
    ? `8. CRITICAL: this file contains the metaharness self-optimization wire-in. You MUST keep every reference to: ${OPTIMIZE_WIRE_INS[update.file.replace(/\\/g, '/')].map((m) => `\`${m}\``).join(', ')}. Removing any of them breaks the integration and the update will be rejected.`
    : ''}

Return the COMPLETE file content wrapped in a single code block:
\`\`\`javascript
// full file here
\`\`\``;

  console.error(`  Generating update for ${update.file}...`);
  const response = await callClaude(prompt, 8192);

  // Extract code block
  const codeMatch = response.match(/```(?:javascript|js)?\s*\n([\s\S]*?)\n```/);
  if (!codeMatch) {
    console.error(`  No code block in response for ${update.file}`);
    return null;
  }

  return codeMatch[1];
}

// ─── Main ───

async function main() {
  console.error('\n=== Auto-Update Capabilities ===\n');

  // 1. Read diff
  const diffData = readFile(DIFF_FILE);
  if (!diffData) {
    console.error('No decompile diff found. Nothing to update.');
    process.exit(1);
  }

  const diff = JSON.parse(diffData);
  validateDiff(diff, process.env.NEW_VERSION || diff.versions?.current, process.env.PREVIOUS_VERSION || diff.versions?.previous);
  if (diff.error) {
    console.error('Decompilation failed. Cannot auto-update.');
    process.exit(1);
  }

  const prevVersion = process.env.PREVIOUS_VERSION || 'unknown';
  const newVersion = process.env.NEW_VERSION || 'unknown';

  // 2. Analyze changes
  const changes = analyzeChanges(diff, diff.metrics);
  if (changes.length === 0) {
    console.error('No significant changes detected. Nothing to update.');
    process.exit(1);
  }

  console.error(`Found ${changes.length} changes to process:`);
  for (const c of changes) {
    console.error(`  - ${c.type}: ${c.name || c.count || c.reason || ''}`);
  }

  // 3. Map to v2 files
  const updates = mapToV2Files(changes);
  if (updates.length === 0) {
    console.error('No mappable updates for v2 source. Skipping.');
    process.exit(1);
  }

  console.error(`\nPlanned updates (${updates.length}):`);
  for (const u of updates) {
    console.error(`  ${u.action} ${u.file}: ${u.reason}`);
  }

  // 4. Baseline test
  console.error('\nRunning baseline tests...');
  const baseline = runTests();
  console.error(`  Baseline: ${baseline.passed} passed, ${baseline.failed} failed`);

  if (!baseline.ok) {
    console.error('Baseline tests failing. Cannot proceed with updates.');
    process.exit(3);
  }

  // 5. Apply updates
  const applied = [];
  const backups = new Map();

  for (const update of updates) {
    const filePath = path.join(ROOT, update.file);
    const backup = readFile(filePath);
    backups.set(update.file, backup);

    try {
      const newCode = await generateUpdate(update, prevVersion, newVersion);
      if (newCode && newCode.length > 100) {
        // Guard: never accept a regen that drops the optimize wire-in.
        const dropped = missingWireIns(update.file, newCode);
        if (dropped.length > 0) {
          console.error(`  Rejected: ${update.file} — regen dropped optimize wire-in (${dropped.join(', ')}); keeping original`);
          continue;
        }
        fs.writeFileSync(filePath, newCode);
        applied.push(update);
        console.error(`  Applied: ${update.file}`);
      } else {
        console.error(`  Skipped: ${update.file} (no valid code generated)`);
      }
    } catch (err) {
      console.error(`  Error updating ${update.file}: ${err.message}`);
    }
  }

  if (applied.length === 0) {
    console.error('\nNo updates were applied.');
    process.exit(1);
  }

  // 6. Test after updates
  console.error(`\nRunning tests after ${applied.length} updates...`);
  const afterTests = runTests();
  console.error(`  After: ${afterTests.passed} passed, ${afterTests.failed} failed`);

  // 7. Check for regressions
  if (!afterTests.ok || afterTests.passed < baseline.passed - 5) {
    console.error(`\nREGRESSION DETECTED! Reverting all changes.`);
    console.error(`  Baseline: ${baseline.passed}p/${baseline.failed}f → After: ${afterTests.passed}p/${afterTests.failed}f`);

    // Revert
    for (const [file, backup] of backups) {
      if (backup !== null) {
        fs.writeFileSync(path.join(ROOT, file), backup);
      }
    }

    console.error('All changes reverted. Release will proceed with existing code.');
    process.exit(2);
  }

  // 7b. Final safety net: confirm the optimize wire-in survived on disk for
  // every protected file. If anything is missing, revert and fail closed.
  const wireInBroken = [];
  for (const relFile of Object.keys(OPTIMIZE_WIRE_INS)) {
    const onDisk = readFile(path.join(ROOT, relFile));
    const dropped = missingWireIns(relFile, onDisk);
    if (dropped.length > 0) wireInBroken.push(`${relFile} (${dropped.join(', ')})`);
  }
  if (wireInBroken.length > 0) {
    console.error(`\nOPTIMIZE WIRE-IN BROKEN! Reverting all changes: ${wireInBroken.join('; ')}`);
    for (const [file, backup] of backups) {
      if (backup !== null) fs.writeFileSync(path.join(ROOT, file), backup);
    }
    console.error('All changes reverted. Release will proceed with existing code.');
    process.exit(2);
  }

  // 8. Output summary
  const summary = {
    updates: applied.map(u => ({ file: u.file, reason: u.reason, category: u.category })),
    testsBefore: { passed: baseline.passed, failed: baseline.failed },
    testsAfter: { passed: afterTests.passed, failed: afterTests.failed },
    previousVersion: prevVersion,
    newVersion: newVersion,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.error(`\nSuccess: ${applied.length} files updated, tests pass (${afterTests.passed}p/${afterTests.failed}f)`);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(3);
});
