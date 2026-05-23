/**
 * prepare-bundle.js
 *
 * Pre-package script: copies the v2/src tree into the extension directory so
 * that `vsce package` can include it in the VSIX.
 *
 * The agent-bridge.mjs subprocess needs v2/src at runtime.  When the
 * extension is run from source (F5 / development), ../v2/src is available
 * via the sibling directory.  When installed from a VSIX the extension lives
 * in a self-contained folder, so v2/src must be bundled inside it.
 *
 * Run automatically via the `prepackage` npm script.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const SRC  = path.resolve(__dirname, '..', '..', 'v2', 'src');
const DEST = path.resolve(__dirname, '..', 'v2', 'src');

if (!fs.existsSync(SRC)) {
    console.error(`ERROR: Source not found: ${SRC}`);
    process.exit(1);
}

console.log(`Bundling v2/src into extension…`);
console.log(`  from: ${SRC}`);
console.log(`  to:   ${DEST}`);

if (fs.existsSync(DEST)) {
    fs.rmSync(DEST, { recursive: true, force: true });
}

// Ensure parent directory exists
fs.mkdirSync(path.dirname(DEST), { recursive: true });

// fs.cpSync requires Node ≥ 16.7 (satisfied by current VS Code engine requirements).
fs.cpSync(SRC, DEST, { recursive: true });

console.log('Done — v2/src bundled.');
