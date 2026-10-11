import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SkillsLoader} from '../../v2/src/skills/loader.mjs';
test('skills CLI symlinks, project precedence, broken links and reload', async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'occ-skills-test-'));
 const cwd=process.cwd(),home=process.env.HOME;
 try{
  const project=path.join(temp,'project'),user=path.join(temp,'home');
  const global=path.join(user,'.claude/skills/demo');
  const target=path.join(project,'.agents/skills/demo');
  fs.mkdirSync(global,{recursive:true});fs.mkdirSync(target,{recursive:true});
  fs.mkdirSync(path.join(project,'.claude/skills'),{recursive:true});
  fs.writeFileSync(path.join(global,'SKILL.md'),'---\nname: demo\n---\nGLOBAL');
  fs.writeFileSync(path.join(target,'SKILL.md'),'---\nname: demo\n---\nPROJECT');
  const link=path.join(project,'.claude/skills/demo');
  fs.symlinkSync(target,link,'dir');
  fs.symlinkSync(path.join(temp,'missing'),path.join(project,'.claude/skills/broken'),'dir');
  process.chdir(project);process.env.HOME=user;
  const loader=new SkillsLoader().load();
  assert.equal(loader.list().length,1);
  assert.match(await loader.run('demo'),/PROJECT/);
  fs.unlinkSync(link);loader.load();assert.match(await loader.run('demo'),/GLOBAL/);
  fs.rmSync(global,{recursive:true});loader.load();assert.equal(loader.list().length,0);
 }finally{process.chdir(cwd);if(home===undefined)delete process.env.HOME;else process.env.HOME=home;fs.rmSync(temp,{recursive:true,force:true});}
});
