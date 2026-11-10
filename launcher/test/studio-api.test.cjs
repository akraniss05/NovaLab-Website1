'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const API='https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/novalab-studio-api';
const LIVE=process.env.NOVALAB_RUN_LIVE_TESTS==='1';
async function request(path,opts={}) {
 const response=await fetch(API+'/'+path,{...opts,signal:AbortSignal.timeout(12000)});
 const data=await response.json();
 return {response,data};
}
test('Studio catalog is publicly readable with real game array',{skip:!LIVE},async()=>{
 const {response,data}=await request('catalog');
 assert.equal(response.status,200);
 assert.ok(Array.isArray(data.games));
 for(const game of data.games){
  assert.match(game.id,/^community-[a-z0-9-]+$/);
  if(game.release){
   assert.match(game.release.sha256,/^[a-f0-9]{64}$/);
   assert.ok(['html','windows'].includes(game.release.format));
  }
 }
});
test('Studio list rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('list');
 assert.equal(response.status,403);
});
test('Studio edit rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'community-security-test',title:'Attacker',summary:'Unauthorized'})});
 assert.equal(response.status,403);
});
test('Studio publish rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'community-security-test',visibility:'published'})});
 assert.equal(response.status,403);
});