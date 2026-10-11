#!/usr/bin/env node
// Real installers and Claude CLI; model transport is a deterministic local fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {SkillsLoader} from '../v2/src/skills/loader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.argv[2] || root;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'occ-plugin-e2e-'));
const home=path.join(temp,'home'),project=path.join(temp,'project');
fs.mkdirSync(home);fs.mkdirSync(project);fs.mkdirSync(path.join(temp,'npm-prefix/lib'),{recursive:true});
const env={PATH:process.env.PATH,HOME:home,USERPROFILE:home,CLAUDE_CONFIG_DIR:path.join(home,'.claude'),npm_config_prefix:path.join(temp,'npm-prefix'),CI:'true',NO_COLOR:'1',DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',npm_config_userconfig:path.join(temp,'npmrc')};
fs.writeFileSync(env.npm_config_userconfig,'');
function run(cmd,args,extra={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(cmd,args,{cwd:project,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0)reject(new Error(cmd+' '+args.slice(0,3).join(' ')+' failed '+code+' '+signal+' '+stderr+' '+stdout));else resolve(stdout);});
 });
}
const names=['occ-use','occ-diagnose','occ-verify-release'];
let server;
try{
 const skillsArgs=['--yes','skills@1.7.2'];
 await run('npx',[...skillsArgs,'add',source,'--agent','claude-code','--skill',...names,'--yes']);
 const loader=new SkillsLoader().load(project);
 for(const name of names){
  assert(loader.get(name),'missing installed skill '+name);
  assert.match(await loader.run(name),new RegExp('Skill: '+name));
  const installed=fs.readFileSync(path.join(project,'.claude/skills',name,'SKILL.md'),'utf8');
  assert.equal(installed,fs.readFileSync(path.join(root,'skills',name,'SKILL.md'),'utf8'));
 }
 await run('npx',[...skillsArgs,'add',source,'--agent','claude-code','--skill',...names,'--yes']);
 assert.equal(new SkillsLoader().load(project).list().length,3,'reinstall duplicates');
 await run('npx',[...skillsArgs,'remove',...names,'--agent','claude-code','--yes']);
 assert.equal(new SkillsLoader().load(project).list().length,0,'skills uninstall');
 await run('claude',['plugin','validate',path.join(root,'.claude-plugin/plugin.json'),'--strict']);
 await run('claude',['plugin','validate',path.join(root,'.claude-plugin/marketplace.json'),'--strict']);
 await run('claude',['plugin','marketplace','add',source]);
 await run('claude',['plugin','install','occ@ruvnet-occ']);
 const list=JSON.parse(await run('claude',['plugin','list','--json']));
 assert(JSON.stringify(list).includes('occ@ruvnet-occ'),'plugin not installed');
 const inventory=await run('claude',['plugin','details','occ@ruvnet-occ']);
 for(const name of names)assert(inventory.includes(name),'missing plugin skill '+name);
 let expected='',observed=false;
 server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.url.includes('/messages/count_tokens')){res.setHeader('content-type','application/json');res.end(JSON.stringify({input_tokens:100}));return;}
  if(req.url.includes('/messages')){
   const data=JSON.parse(raw);
   if(JSON.stringify(data.messages).includes(expected))observed=true;
   const message={id:'msg_occ_fixture',type:'message',role:'assistant',model:data.model,content:[{type:'text',text:'OCC_SKILL_LOADED'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:8}};
   if(data.stream){
    res.setHeader('content-type','text/event-stream');
    const send=(type,d)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...d})+'\n\n');
    send('message_start',{message:{...message,content:[],stop_reason:null}});
    send('content_block_start',{index:0,content_block:{type:'text',text:''}});
    send('content_block_delta',{index:0,delta:{type:'text_delta',text:'OCC_SKILL_LOADED'}});
    send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:8}});send('message_stop',{});res.end();
   }else{res.setHeader('content-type','application/json');res.end(JSON.stringify(message));}
  }else{res.setHeader('content-type','application/json');res.end('{}');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const titles=['# Use Open Claude Code','# Diagnose Open Claude Code','# Verify an Open Claude Code release'];
 for(let i=0;i<names.length;i++){
  expected=titles[i];observed=false;
  const output=await run('claude',['--print','--model','claude-sonnet-4-6','--max-turns','1','/occ:'+names[i]],{ANTHROPIC_API_KEY:'local-fixture-only',ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.address().port});
  assert(observed,'Claude did not expand '+names[i]);
  assert(output.includes('OCC_SKILL_LOADED'),'Claude response missing');
 }
 await run('claude',['plugin','update','occ@ruvnet-occ']);
 await run('claude',['plugin','uninstall','occ@ruvnet-occ']);
 assert(!JSON.stringify(JSON.parse(await run('claude',['plugin','list','--json']))).includes('occ@ruvnet-occ'));
 await run('claude',['plugin','marketplace','remove','ruvnet-occ']);
 console.log(JSON.stringify({status:'passed',source,skills:3,checks:['npx skills install','OCC symlink discovery and prompts','idempotent reinstall','skills uninstall','strict manifests','Claude marketplace install','three native skill invocations with mock model transport','plugin update','plugin uninstall'],claudeVersion:(await run('claude',['--version'])).trim(),skillsVersion:'1.7.2'}));
}finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});}
