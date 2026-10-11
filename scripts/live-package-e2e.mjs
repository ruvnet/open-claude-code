#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const artifact=process.argv[2];
if(!artifact || !process.env.AI_API_KEY) throw new Error('Artifact and AI_API_KEY required');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'occ-live-e2e-'));
try{
  const env={PATH:process.env.PATH,HOME:temp,CI:'true',NO_COLOR:'1',npm_config_userconfig:path.join(temp,'npmrc')};
  fs.writeFileSync(env.npm_config_userconfig,'');
  const install=spawnSync('npm',['install','--ignore-scripts','--no-audit','--no-fund',path.resolve(artifact)],{cwd:temp,env,encoding:'utf8',timeout:90000});
  if(install.status!==0) throw new Error('Live E2E artifact installation failed');
  const marker=crypto.randomUUID();
  fs.writeFileSync(path.join(temp,'fixture.txt'),marker);
  const cli=path.join(temp,'node_modules/.bin/occ');
  const result=spawnSync(cli,['--model','gpt-4.1-mini','--print','--allowedTools','Read','--max-turns','4','--output-format','stream-json','Use Read to read fixture.txt. Your final response MUST be only the file contents: no introduction, quotes, Markdown, or explanation.'],{
    cwd:temp,env:{...env,OPENAI_API_KEY:process.env.AI_API_KEY,OPENAI_BASE_URL:'https://openrouter.ai/api/v1'},
    encoding:'utf8',timeout:60000});
  if(result.status!==0) throw new Error('Live CLI failed (provider response omitted)');
  const events=result.stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  if(events.some(e=>e.type==='error')) throw new Error('Live CLI reported an error');
  if(!events.some(e=>e.type==='result'&&e.tool==='Read'&&JSON.stringify(e.result).includes(marker))) throw new Error('Live Read result not verified');
  if(!events.some(e=>e.type==='assistant'&&String(e.content).trim()===marker)) throw new Error('Final live response did not match fixture');
  console.log(JSON.stringify({status:'passed',provider:'OpenRouter',model:'gpt-4.1-mini',checks:['installed package','live Read tool result','exact fresh fixture response']}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
