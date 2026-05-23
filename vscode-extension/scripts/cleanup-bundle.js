/**
 * cleanup-bundle.js
 *
 * Post-package script: removes the v2/src copy that was created by
 * prepare-bundle.js, keeping the vscode-extension directory clean.
 *
 * Run automatically via the `postpackage` npm script.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DEST = path.resolve(__dirname, '..', 'v2');

if (fs.existsSync(DEST)) {
    console.log(`Removing bundled copy: ${DEST}`);
    fs.rmSync(DEST, { recursive: true, force: true });
    console.log('Done.');
} else {
    console.log('Nothing to clean up.');
}
