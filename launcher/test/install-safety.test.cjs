'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {assertManagedInstall}=require('../src/install-safety.cjs');

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'novalab-ownership-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const id='nova-test';
 const dir=path.join(root,id);
 await fs.mkdir(dir);
 await fs.writeFile(path.join(dir,'index.html'),'saved game data that must survive');
 return {root,dir,id};
}
async function marker(dir,id,version){
 await fs.writeFile(path.join(dir,'.novalab-install.json'),JSON.stringify({id,version}));
}

test('managed folder with exact marker is accepted',async t=>{
 const f=await fixture(t);
 await marker(f.dir,f.id,'1.2.3');
 assert.equal(await assertManagedInstall(f.root,f.id,'1.2.3'),f.dir);
});
test('unrelated unmarked directory is protected, including legacy records',async t=>{
 const f=await fixture(t);
 await assert.rejects(assertManagedInstall(f.root,f.id,'1.2.3'),/Installationsmarkierung/);
 assert.equal(await fs.readFile(path.join(f.dir,'index.html'),'utf8'),'saved game data that must survive');
});
test('different version and different game IDs are rejected',async t=>{
 const f=await fixture(t);await marker(f.dir,'other-game','1.2.3');
 await assert.rejects(assertManagedInstall(f.root,f.id,'1.2.3'),/stimmt nicht/);
 await marker(f.dir,f.id,'1.2.3');
 await assert.rejects(assertManagedInstall(f.root,f.id,'4.0.0'),/stimmt nicht/);
});
test('corrupted marker and symbolic marker are rejected',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,'.novalab-install.json'),'{ broken json');
 await assert.rejects(assertManagedInstall(f.root,f.id,'1.0.0'),/beschädigt/);
 await fs.rm(path.join(f.dir,'.novalab-install.json'));
 const outside=path.join(f.root,'foreign.txt');await fs.writeFile(outside,'{"id":"nova-test","version":"1.0.0"}');
 await fs.symlink(outside,path.join(f.dir,'.novalab-install.json'),'file');
 await assert.rejects(assertManagedInstall(f.root,f.id,'1.0.0'),/Installationsmarkierung/);
});
test('directory symlink is not treated as an owned game',async t=>{
 const f=await fixture(t);await marker(f.dir,f.id,'1.0.0');
 const foreign=path.join(f.root,'foreign');
 await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'important-save.txt'),'keep me');
 await fs.rm(f.dir,{recursive:true});await fs.symlink(foreign,f.dir,'dir');
 await assert.rejects(assertManagedInstall(f.root,f.id,'1.0.0'),/Link/);
 assert.equal(await fs.readFile(path.join(foreign,'important-save.txt'),'utf8'),'keep me');
});
test('invalid ids and versions cannot leave managed root',async t=>{
 const f=await fixture(t);
 await assert.rejects(assertManagedInstall(f.root,'../../other','1.0.0'),/Ungültige/);
 await assert.rejects(assertManagedInstall(f.root,f.id,'../1.0.0'),/Ungültige/);
});
