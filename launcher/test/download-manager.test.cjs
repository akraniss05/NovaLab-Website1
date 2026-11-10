'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DownloadManager, parseContentRange } = require('../src/download-manager.cjs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  while (!fn()) { if (Date.now() - start > timeout) throw new Error('Timeout'); await delay(30); }
}
async function fixture(t, { acceptsRange = true, chunkDelay = 0, repeat = 70000 } = {}) {
  const content = Buffer.from('NOVALAB'.repeat(repeat));
  const sha256 = createHash('sha256').update(content).digest('hex');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'novalab-dlm-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const headersSeen = [];
  const server = http.createServer(async (req, res) => {
    headersSeen.push(req.headers.range || null);
    let offset = 0;
    if (acceptsRange && req.headers.range) offset = Number(req.headers.range.match(/^bytes=(\d+)-$/)?.[1] || 0);
    if (acceptsRange && req.headers.range && offset >= content.length) {
      res.writeHead(416, {'content-range': 'bytes */' + content.length});res.end();return;
    }
    res.writeHead(offset ? 206 : 200, {
      'content-length': content.length - offset,
      ...(offset ? { 'content-range': `bytes ${offset}-${content.length - 1}/${content.length}` } : {})
    });
    for (let i = offset; i < content.length; i += 8192) {
      if (res.destroyed) break;
      res.write(content.subarray(i, Math.min(i + 8192, content.length)));
      if (chunkDelay) await delay(chunkDelay);
    }
    res.end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => server.close());
  return {dir, content, sha256, headersSeen, url: `http://127.0.0.1:${server.address().port}/game.zip`};
}
function game(f, id='orbit-dash', sha256=f.sha256) {
  return { id, title:'Orbit Dash', release: { version:'1.0.0', format:'html', entry:'index.html', sha256, url: f.url.replace('http:', 'https:') } };
}
function manager(f, ready, options = {}) {
  return new DownloadManager({ directory: f.dir, onReady: ready, request: (url, opts) => fetch(f.url, opts), ...options });
}
test('parseContentRange checks byte offsets', () => {
  assert.deepEqual(parseContentRange('bytes 500-999/1000'), { from:500, end:999, total:1000 });
  assert.equal(parseContentRange('invalid'),null);
});
test('queue completes, verifies SHA and installs onReady', async t => {
  const f = await fixture(t);
  let called = 0;
  const dl = manager(f, async task => { assert.equal(task.id,'orbit-dash'); called++; });
  t.after(() => dl.close());
  await dl.init(); await dl.enqueue(game(f));
  await waitFor(()=>dl.list()[0].phase==='complete');
  assert.equal(called,1);
  assert.equal(dl.list()[0].bytes,f.content.length);
});
test('bad digest prevents install and removes corrupt archive', async t => {
  const f = await fixture(t);
  let installed = false;
  const dl = manager(f, async()=>{installed=true;}); t.after(()=>dl.close());
  await dl.init(); await dl.enqueue(game(f,'orbit-dash','0'.repeat(64)));
  await waitFor(()=>dl.list()[0].phase==='failed');
  assert.equal(installed,false);
  assert.match(dl.list()[0].error,/SHA-256/);
});
test('persisted queue and partial download survive restart (HTTP range)', async t => {
  const f = await fixture(t,{chunkDelay:5});
  const dl = manager(f,async()=>{}); await dl.init();
  await dl.enqueue(game(f));
  await waitFor(()=>dl.list()[0].bytes>30000);
  await dl.pause('orbit-dash');
  await waitFor(()=>dl.active===null);
  const before = dl.list()[0].bytes;
  assert.ok(before>0);
  await dl.close();
  let installed=false;
  const reboot = manager(f,async()=>{installed=true;}); t.after(()=>reboot.close());
  await reboot.init();
  assert.equal(reboot.list()[0].phase,'paused');
  await reboot.resume('orbit-dash');
  await waitFor(()=>reboot.list()[0].phase==='complete',12000);
  assert.equal(installed,true);
  assert.ok(f.headersSeen.some(x=>x?.startsWith('bytes=')));
});
test('server ignoring Range causes safe restart instead of corrupt append', async t => {
  const f = await fixture(t,{acceptsRange:false,chunkDelay:4});
  const dl = manager(f,async()=>{}); await dl.init(); await dl.enqueue(game(f));
  await waitFor(()=>dl.list()[0].bytes>30000);
  await dl.pause('orbit-dash'); await waitFor(()=>dl.active===null);
  await dl.close();
  let installed=false;
  const reboot=manager(f,async()=>{installed=true;});t.after(()=>reboot.close());
  await reboot.init();await reboot.resume('orbit-dash');
  await waitFor(()=>reboot.list()[0].phase==='complete',12000);
  assert.equal(installed,true);
});
test('cancel deletes partial bytes and removes task', async t=>{
  const f=await fixture(t,{chunkDelay:8});
  const dl=manager(f,async()=>{});t.after(()=>dl.close());
  await dl.init(); await dl.enqueue(game(f));
  await waitFor(()=>dl.list()[0].bytes>30000);
  await dl.cancel('orbit-dash');
  await waitFor(()=>dl.list().length===0);
  assert.equal(dl.list().length,0);
});

test('graceful shutdown preserves unfinished request and resumes the existing cache',async t=>{
  const f=await fixture(t);
  const fs=require('node:fs/promises');
  const prefix=f.content.subarray(0,90000);
  await fs.writeFile(path.join(f.dir,'orbit-dash.part'),prefix);
  // The request is intentionally held before headers. This deterministically
  // exercises an actual unfinished request and its AbortSignal on every OS.
  let requested=false;
  const stalled=new DownloadManager({directory:f.dir,onReady:async()=>{},request:(_url,{signal})=>{
    requested=true;
    return new Promise((_resolve,reject)=>{
      if(signal.aborted)return reject(new Error('aborted'));
      signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
    });
  }});
  await stalled.init();await stalled.enqueue(game(f));
  await waitFor(()=>requested && stalled.list()[0].phase==='downloading');
  await stalled.close();
  assert.equal(stalled.list()[0].phase,'queued');
  assert.equal((await fs.stat(path.join(f.dir,'orbit-dash.part'))).size,prefix.length);
  const reboot=manager(f,async()=>{});t.after(()=>reboot.close());
  await reboot.init();
  await waitFor(()=>reboot.list()[0].phase==='complete',12000);
  assert.ok(f.headersSeen.some(x=>x?.startsWith('bytes=')),'expected a real HTTP Range retry');
});
test('updated digest for same version cannot silently reuse stale partial bytes',async t=>{
  const f=await fixture(t,{chunkDelay:7});
  const dl=manager(f,async()=>{});t.after(()=>dl.close());
  await dl.init();await dl.enqueue(game(f));
  await waitFor(()=>dl.list()[0].bytes>30000);
  await dl.pause('orbit-dash');
  await waitFor(()=>dl.active===null);
  const badHash='a'.repeat(64);
  await dl.enqueue(game(f,'orbit-dash',badHash));
  await waitFor(()=>dl.list()[0].phase==='failed',12000);
  assert.match(dl.list()[0].error,/SHA-256/);
  assert.equal(dl.list()[0].bytes,0);
});
test('an empty saved queue starts without a download request',async t=>{
  const f=await fixture(t);
  const dl=manager(f,async()=>{throw new Error('must not install')});
  t.after(()=>dl.close());
  await dl.init();
  assert.deepEqual(dl.list(),[]);
  assert.equal(dl.active,null);
  assert.deepEqual(f.headersSeen,[]);
});

test('fully downloaded ZIP is SHA verified after HTTP 416 instead of fetched twice',async t=>{
  const f=await fixture(t);
  const fs=require('node:fs/promises');
  await fs.writeFile(path.join(f.dir,'orbit-dash.part'),f.content);
  let installed=false;
  const dl=manager(f,async()=>{installed=true;});t.after(()=>dl.close());
  await dl.init();await dl.enqueue(game(f));
  await waitFor(()=>dl.list()[0].phase==='complete');
  assert.equal(installed,true);
  assert.equal(f.headersSeen.length,1,'cached complete package must not be downloaded again');
  assert.equal(f.headersSeen[0],'bytes='+f.content.length+'-');
});
