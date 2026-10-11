import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('tampered tarball is refused before contacting npm',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'occ-release-test-'));
  try{
    const p={name:'@ruvnet/open-claude-code',version:'2.1.1',filename:'test.tgz',integrity:'sha512-invalid'};
    fs.writeFileSync(path.join(dir,'test.tgz'),'tampered');
    fs.writeFileSync(path.join(dir,'pack.json'),JSON.stringify([p]));
    const result=spawnSync(process.execPath,[path.join(root,'scripts/publish-verified.mjs'),path.join(dir,'pack.json'),dir,'latest'],{encoding:'utf8',timeout:5000});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Refusing altered tarball/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unapproved distribution tag cannot publish',()=>{
  const result=spawnSync(process.execPath,[path.join(root,'scripts/publish-verified.mjs'),'/missing','/missing','arbitrary'],{encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid npm channel/);
});
