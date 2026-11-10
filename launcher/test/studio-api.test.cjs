'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const API='https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/novalab-studio-api';
const LIVE=process.env.NOVALAB_RUN_LIVE_TESTS==='1';
async function request(path,opts={}) {
 // Live Windows runner network is occasionally delayed; retry only transport timeouts,
 // never failed HTTP assertions or unexpected API responses.
 for(let attempt=0;attempt<2;attempt++){
  try {
   const response=await fetch(API+'/'+path,{...opts,signal:AbortSignal.timeout(20000)});
   const data=await response.json();
   return {response,data};
  } catch(error) {
   if(attempt===1 || !['TimeoutError','AbortError','TypeError'].includes(error?.name)) throw error;
  }
 }
 throw new Error('Network request was not completed');
}
test('Studio catalog is publicly readable with real game array',{skip:!LIVE},async()=>{
 const {response,data}=await request('catalog');
 assert.equal(response.status,200);
 assert.ok(Array.isArray(data.games));
 assert.ok(Array.isArray(data.excludedIds),'Public catalog includes archive suppression list');
 const code=data.games.find(g=>g.id==='community-novalab-code');
 if(code){
   assert.equal(code.type,'app');
   assert.equal(code.release?.format,'windows');
   assert.match(code.release?.sha256||'',/^[a-f0-9]{64}$/);
   assert.ok(code.cover?.startsWith('https://akraniss05.github.io/'));
   assert.ok(code.banner?.startsWith('https://akraniss05.github.io/'));
 }
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
test('Legacy catalog management rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('legacy-list');
 assert.equal(response.status,403);
});
test('Permanent deletion rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('delete',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({id:'community-security-test',confirmTitle:'Unauthorized'})});
 assert.equal(response.status,403);
});
test('Bulk archive rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('bulk-archive',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({ids:['orbit-dash'],archive:true})});
 assert.equal(response.status,403);
});
test('GitHub catalog visibility rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('legacy-visibility',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({id:'orbit-dash',hide:true})});
 assert.equal(response.status,403);
});

test('Studio delete rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'community-security-test',confirmTitle:'Attacker'})});
 assert.equal(response.status,403);
});
test('Studio bulk archive rejects anonymous access',{skip:!LIVE},async()=>{
 const {response}=await request('bulk-archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:['orbit-dash'],archive:true})});
 assert.equal(response.status,403);
});
test('Studio legacy catalog is admin-only',{skip:!LIVE},async()=>{
 const {response}=await request('legacy-list');
 assert.equal(response.status,403);
});
