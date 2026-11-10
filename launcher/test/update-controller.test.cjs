'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController } = require('../src/update-controller.cjs');
function rig(packaged = true) {
  const updater = new EventEmitter();
  let checks = 0, downloads = 0, restarts = 0;
  updater.checkForUpdates = async () => { checks++; updater.emit('update-available', {version: '0.4.0'}); return { updateInfo: { version: '0.4.0' } }; };
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 56, total: 100, transferred: 56 }); updater.emit('update-downloaded', {version: '0.4.0'}); };
  updater.quitAndInstall = () => { restarts++; };
  const events = [];
  const service = createUpdateController({updater, app:{isPackaged:packaged,getVersion:()=> '0.3.0'}, notify: s => events.push(s), platform: "win32"});
  return { service, updater, events, counts:()=>({checks,downloads,restarts}) };
}
test('update check is single flight and can download', async () => {
  const r=rig();
  const [a,b]=await Promise.all([r.service.check(),r.service.check()]);
  assert.equal(a.status,'available'); assert.equal(b.status,'available');
  assert.equal(r.counts().checks,1);
  const result=await r.service.download();
  assert.equal(result.status,'downloaded');
  assert.equal(r.counts().downloads,1);
  await r.service.check(); assert.equal(r.counts().checks,1);
});
test('retry works after updater network errors', async () => {
  const r=rig();
  r.updater.checkForUpdates = async () => { throw new Error('getaddrinfo ENOTFOUND github.com') };
  let a=await r.service.check(); assert.equal(a.status,'error');
  assert.match(a.message,/Internetverbindung/);
  r.updater.checkForUpdates = async()=>{r.updater.emit('update-not-available');};
  a=await r.service.check(); assert.equal(a.status,'current');
});
test('manual update mode never installs on a normal quit', async () => {
  const r=rig(); assert.equal(r.updater.autoInstallOnAppQuit,false);
  await r.service.check(); await r.service.download();
  assert.equal(r.service.restart().ok,true);
  assert.equal(r.service.snapshot().status,'installing');
});
test('no update check in development builds',async()=>{
  const r=rig(false);const a=await r.service.check();assert.equal(a.status,'development');assert.equal(r.counts().checks,0);
});
test('updates require availability',async()=>{
  const r=rig();await assert.rejects(()=>r.service.download(),/zuerst prüfen/);
});
