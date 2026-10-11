#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [metaFile, dir, tag] = process.argv.slice(2);
if (!['latest','nightly'].includes(tag)) throw new Error('Invalid npm channel');
const [p] = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
if (p.name !== '@ruvnet/open-claude-code' || path.basename(p.filename) !== p.filename) throw new Error('Invalid package identity');
const artifact = path.resolve(dir,p.filename);
const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(artifact)).digest('base64');
if (integrity !== p.integrity) throw new Error('Refusing altered tarball');
const url = 'https://registry.npmjs.org/' + encodeURIComponent(p.name) + '/' + encodeURIComponent(p.version);
async function lookup() {
  const r = await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if (r.status===404) return null;
  if (!r.ok) throw new Error('Registry lookup HTTP '+r.status);
  const d=await r.json();
  if (d.name!==p.name || d.version!==p.version) throw new Error('Registry identity mismatch');
  return d;
}
let existing=await lookup();
if (!existing) {
  const result=spawnSync('npm',['publish',artifact,'--access','public','--tag',tag,'--ignore-scripts'],{stdio:'inherit',timeout:120000});
  if (result.status!==0) throw new Error('npm publication failed');
}
for(let n=0;n<60;n++){
  const d=await lookup();
  if(d){
    if(d.dist?.integrity!==integrity) throw new Error('Published integrity differs from tested artifact');
    const tagsResponse=await fetch('https://registry.npmjs.org/-/package/'+encodeURIComponent(p.name)+'/dist-tags',{signal:AbortSignal.timeout(15000)});
    if(!tagsResponse.ok) throw new Error('Cannot verify npm distribution tag');
    const tags=await tagsResponse.json();
    if(tags[tag]!==p.version){
      const tagged=spawnSync('npm',['dist-tag','add',p.name+'@'+p.version,tag],{stdio:'inherit',timeout:30000});
      if(tagged.status!==0) throw new Error('Distribution tag update failed');
      const checked=await fetch('https://registry.npmjs.org/-/package/'+encodeURIComponent(p.name)+'/dist-tags',{signal:AbortSignal.timeout(15000)});
      if(!checked.ok || (await checked.json())[tag]!==p.version) throw new Error('Distribution tag verification failed');
    }
    console.log(JSON.stringify({published:true,package:p.name,version:p.version,integrity,source:'npm registry'}));
    process.exit(0);
  }
  await new Promise(r=>setTimeout(r,5000));
}
throw new Error('Published artifact not visible; checkpoint must not advance');
