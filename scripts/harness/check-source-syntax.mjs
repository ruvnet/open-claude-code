#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = path.resolve('v2', 'src');

function collectModules(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectModules(fullPath);
        return entry.isFile() && entry.name.endsWith('.mjs') ? [fullPath] : [];
    });
}

const modules = collectModules(sourceRoot).sort();
for (const modulePath of modules) {
    execFileSync(process.execPath, ['--check', modulePath], { stdio: 'inherit' });
}

console.log(`Static compile check passed: ${modules.length} modules.`);
