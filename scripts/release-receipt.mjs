#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const [metaFile, sha] = process.argv.slice(2);
const [p] = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
if (p.name !== '@ruvnet/open-claude-code' || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid release identity');
if (path.basename(p.filename) !== p.filename) throw new Error('Invalid artifact path');
const bytes = fs.readFileSync(path.join('dist', p.filename));
const integrity = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
if (integrity !== p.integrity) throw new Error('Artifact integrity mismatch');
console.log(JSON.stringify({schemaVersion:1, sourceCommit:sha, package:p.name, version:p.version,
  filename:p.filename, integrity, sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
  gates:['unit tests','decompiler regression tests','AI error regression tests','dependency audit','syntax','installed CLI tool roundtrip','auth failure exit'],
  capabilityUpdates:'proposals only; no generated implementation promoted'}, null, 2));
