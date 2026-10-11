import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentLoop} from '../../v2/src/core/agent-loop.mjs';
const names=['Read','Write','Bash','mcp__server__mutate'];
async function scenario(settings, expected) {
 const originalFetch=globalThis.fetch, key=process.env.ANTHROPIC_API_KEY;
 const calls=[],hookCalls=[],permissionCalls=[],requests=[],events=[];
 process.env.ANTHROPIC_API_KEY='test-fixture';
 globalThis.fetch=async(url, options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  return new Response(JSON.stringify({content:requests.length===1
   ? names.map((name,i)=>({type:'tool_use',id:'call'+i,name,input:{}}))
   : [{type:'text',text:'done'}],stop_reason:requests.length===1?'tool_use':'end_turn',
   usage:{input_tokens:10,output_tokens:10}}));
 };
 try {
  const tools={list:()=>names.map(name=>({name,description:name,input_schema:{type:'object'}})),
   call:async name=>{calls.push(name);return 'ok';}};
  const loop=createAgentLoop({model:'claude-sonnet-4-6',tools,settings:{stream:false,...settings},
   permissions:{check:async name=>{permissionCalls.push(name);return true;}},
   hooks:{runPreToolUse:async name=>{hookCalls.push(name);return {allow:true};},
    runStop:async()=>true,runPostToolUse:async(name,result)=>result}});
  for await(const event of loop.run('read only'))events.push(event);
  assert.deepEqual(calls,expected);
  assert.deepEqual(hookCalls,expected,'blocked tools must not execute hooks');
  assert.deepEqual(permissionCalls,expected);
  assert.equal(requests.length,2);
  for(const req of requests)assert.deepEqual((req.tools||[]).map(t=>t.name),expected);
  assert.equal(events.filter(e=>e.allowed===false).length,names.length-expected.length);
  const results=requests[1].messages.at(-1).content;
  for(const [index,name] of names.entries())if(!expected.includes(name)){
   assert.equal(results[index].is_error,true);
   assert.match(results[index].content,/blocked/);
  }
 }finally{
  globalThis.fetch=originalFetch;
  if(key===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=key;
 }
}
test('allow list hides and blocks invented Write Bash and MCP calls',()=>scenario({allowedTools:['Read']},['Read']));
test('deny list wins over allow list',()=>scenario({allowedTools:['Read','Bash'],disallowedTools:['Bash']},['Read']));
test('deny list independently blocks calls',()=>scenario({disallowedTools:['Write','Bash','mcp__server__mutate']},['Read']));
test('empty defaults preserve all existing tools',()=>scenario({allowedTools:[],disallowedTools:[]},names));
test('fully denied tools are neither advertised nor executed',()=>scenario({disallowedTools:names},[]));
test('malformed restrictions fail closed',()=>{
 for(const settings of [{allowedTools:'Read'},{disallowedTools:[null]},{allowedTools:['']}]){
  assert.throws(()=>createAgentLoop({settings,tools:{list:()=>[]}}),/array of nonempty tool names/);
 }
});
