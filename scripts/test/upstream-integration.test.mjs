import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentLoop} from '../../v2/src/core/agent-loop.mjs';
import {HookEngine} from '../../v2/src/hooks/engine.mjs';
async function withModel(fn){
 const saved=globalThis.fetch,key=process.env.ANTHROPIC_API_KEY;
 process.env.ANTHROPIC_API_KEY='test-fixture';
 try{await fn();}finally{globalThis.fetch=saved;if(key===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=key;}
}
const response=content=>new Response(JSON.stringify({content,stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1}}));
test('hook continue false denies call as error but continues the model turn',()=>withModel(async()=>{
 const requests=[],events=[];let executed=0;
 globalThis.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);requests.push(body);return response(requests.length===1?[{type:'tool_use',id:'blocked',name:'Write',input:{}}]:[{type:'text',text:'recovered'}]);};
 const tools={list:()=>[{name:'Write',input_schema:{type:'object'}}],call:async()=>{executed++;return 'mutation';}};
 const hooks=new HookEngine({PreToolUse:[{handler:async()=>({continue:false,stopReason:'policy veto'})}]});
 const loop=createAgentLoop({model:'claude-sonnet-4-6',tools,permissions:{check:async()=>true},settings:{stream:false,maxTurns:3},hooks});
 for await(const e of loop.run('write'))events.push(e);
 assert.equal(executed,0);assert.equal(requests.length,2);
 const blocked=requests[1].messages.at(-1).content[0];
 assert.equal(blocked.is_error,true);assert.match(blocked.content,/hook/);
 assert(events.some(e=>e.type==='assistant'&&e.content==='recovered'));
}));
test('maxTurns bounds provider requests across tool continuations',()=>withModel(async()=>{
 let requests=0,executed=0;const events=[];
 globalThis.fetch=async()=>{requests++;return response([{type:'tool_use',id:'read'+requests,name:'Read',input:{}}]);};
 const tools={list:()=>[{name:'Read',input_schema:{type:'object'}}],call:async()=>{executed++;return 'ok';}};
 const loop=createAgentLoop({model:'claude-sonnet-4-6',tools,permissions:{check:async()=>true},settings:{stream:false,maxTurns:2}});
 for await(const e of loop.run('loop'))events.push(e);
 assert.equal(requests,2);assert.equal(executed,2);assert(events.some(e=>e.reason==='max_turns'));
 for await(const e of loop.run('another'))events.push(e);
 assert.equal(requests,4,'new user task gets fresh bounded budget');
}));
test('real Agent dispatch inherits parent restrictions against malicious child calls',()=>withModel(async()=>{
 const {createToolRegistry}=await import('../../v2/src/tools/registry.mjs');
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'occ-child-integration-'));
 const target=path.join(temp,'forbidden.txt');const requests=[];
 try{
  globalThis.fetch=async(url,opts)=>{
   const body=JSON.parse(opts.body);requests.push(body);
   let content;
   if(requests.length===1)content=[{type:'tool_use',id:'delegate',name:'Agent',input:{prompt:'attempt forbidden tools',allowed_tools:['Agent','Read','Write','Bash']}}];
   else if(requests.length===2){assert.deepEqual(body.tools.map(t=>t.name),['Read','Agent']);content=[{type:'tool_use',id:'write',name:'Write',input:{file_path:target,content:'forbidden'}},{type:'tool_use',id:'bash',name:'Bash',input:{command:'touch '+target}}];}
   else if(requests.length===3){assert(body.messages.at(-1).content.every(r=>r.is_error===true));content=[{type:'text',text:'child denied'}];}
   else content=[{type:'text',text:'parent done'}];
   return response(content);
  };
  const loop=createAgentLoop({model:'claude-sonnet-4-6',tools:createToolRegistry(),permissions:{check:async()=>true},settings:{stream:false,allowedTools:['Read','Agent'],maxTurns:4}});
  for await(const e of loop.run('delegate')){}
  assert.equal(requests.length,4);assert(!fs.existsSync(target),'excluded child tools must not mutate');
  assert.match(requests[3].messages.at(-1).content[0].content,/child denied/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}));
test('malformed model-call limits fail closed',()=>{
 for(const value of [0,-1,NaN,Infinity,'2',1.5])assert.throws(()=>createAgentLoop({settings:{maxTurns:value},tools:{list:()=>[]}}),/positive safe integer/);
});
test('empty child capabilities prevent hook execution for invented calls',()=>withModel(async()=>{
 const {createToolRegistry}=await import('../../v2/src/tools/registry.mjs');
 const requests=[],hookNames=[];
 globalThis.fetch=async(url,opts)=>{
  const body=JSON.parse(opts.body);requests.push(body);let content;
  if(requests.length===1)content=[{type:'tool_use',id:'delegate',name:'Agent',input:{prompt:'no tools',allowed_tools:[]}}];
  else if(requests.length===2){assert.equal((body.tools||[]).length,0);content=[{type:'tool_use',id:'write',name:'Write',input:{file_path:'/unused',content:'x'}}];}
  else if(requests.length===3){assert.equal(body.messages.at(-1).content[0].is_error,true);content=[{type:'text',text:'child done'}];}
  else content=[{type:'text',text:'done'}];
  return response(content);
 };
 const hooks={runPreToolUse:async name=>{hookNames.push(name);return {allow:true};},runPostToolUse:async(name,result)=>result,runStop:async()=>true};
 const loop=createAgentLoop({model:'claude-sonnet-4-6',tools:createToolRegistry(),permissions:{check:async()=>true},settings:{stream:false,maxTurns:4,allowedTools:['Agent','Read']},hooks});
 for await(const event of loop.run('delegate')){}
 assert.deepEqual(hookNames,['Agent']);assert.equal(requests.length,4);
}));
