'use strict';

// Persistent, single-worker download queue. Designed to be testable without Electron.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
const SHA = /^[a-f0-9]{64}$/;
const STATES = new Set(['queued','paused','failed','complete']);
const MAX_BYTES = 5 * 1024 ** 3;
const publicTask = t => {
  const { id, title, version, phase, bytes, total, speed, eta, error, format, updatedAt } = t;
  return { id, title, version, phase, bytes, total, speed, eta, error, format, updatedAt,
    percent: total ? Math.min(100, Math.round(100 * bytes / total)) : 0 };
};
function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value || '');
  if (!match) return null;
  return { from: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? 0 : Number(match[3]) };
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

class DownloadManager {
  constructor({ directory, onChange = () => {}, onReady = async () => {}, request = fetch,
    maxBytes = MAX_BYTES, autoStart = true } = {}) {
    if (!directory) throw new Error('Downloadverzeichnis fehlt.');
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'downloads.json');
    this.onChange = onChange;
    this.onReady = onReady;
    this.request = request;
    this.maxBytes = maxBytes;
    this.autoStart = autoStart;
    this.tasks = new Map();
    this.active = null;
    this.controller = null;
    this.pausedByUser = false;
    this.closing = false;
    this.worker = null;
    this.writeChain = Promise.resolve();
  }
  _part(id) { if (!ID.test(id)) throw new Error('Ungültige Spiele-ID.'); return path.join(this.directory, id + '.part'); }
  list() { return [...this.tasks.values()].map(publicTask); }
  async init() {
    await fsp.mkdir(this.directory, { recursive: true });
    let saved = [];
    try { saved = JSON.parse(await fsp.readFile(this.file, 'utf8')); } catch {}
    if (!Array.isArray(saved)) saved = [];
    for (const t of saved.slice(0, 100)) {
      if (!t || !ID.test(t.id) || !SHA.test(t.sha256) || !/^https:\/\//.test(t.url || '') ||
          !/^\d+\.\d+\.\d+$/.test(t.version || '') || !['html','windows'].includes(t.format)) continue;
      const phase = STATES.has(t.phase) ? t.phase : 'queued';
      this.tasks.set(t.id, { ...t, phase, bytes: 0, total: 0, speed: 0, eta: null, error: null });
    }
    await this._reconcile();
    this._emit();
    if (this.autoStart) this._kick();
    return this.list();
  }
  async _reconcile() {
    for (const t of this.tasks.values()) {
      try { t.bytes = (await fsp.stat(this._part(t.id))).size; } catch { t.bytes = 0; }
      if (t.bytes > this.maxBytes) { await fsp.rm(this._part(t.id), { force: true }); t.bytes = 0; }
    }
  }
  _persist() {
    const rows = [...this.tasks.values()].map(({id,title,version,url,sha256,format,entry,phase,updatedAt}) =>
      ({id,title,version,url,sha256,format,entry,phase,updatedAt}));
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const temp = this.file + '.tmp-' + crypto.randomUUID();
      try {
        await fsp.writeFile(temp, JSON.stringify(rows, null, 2), { mode: 0o600 });
        // On Windows antivirus and indexers can briefly hold destination files.
        // Never remove the previous state file before a successful atomic rename.
        for(let attempt=0;attempt<4;attempt++){
          try { await fsp.rename(temp,this.file);return; }
          catch(error){
            if(process.platform!=='win32' || !['EPERM','EACCES','EBUSY'].includes(error.code) || attempt===3) throw error;
            await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));
          }
        }
      } finally { await fsp.rm(temp,{force:true}).catch(()=>{}); }
    });
    return this.writeChain;
  }
  _emit() { this.onChange(this.list()); }
  async enqueue(game) {
    const { id, title, release } = game || {};
    if (!ID.test(id || '') || !release || !SHA.test(release.sha256 || '') ||
        !/^\d+\.\d+\.\d+$/.test(release.version || '') ||
        !['html','windows'].includes(release.format || '') || !/^https:\/\//.test(release.url || '')) {
      throw new Error('Ungültiges Spiel-Release.');
    }
    const old = this.tasks.get(id);
    if (old && old.phase !== 'complete' && old.version === release.version && old.sha256 === release.sha256.toLowerCase() && old.url === release.url && old.format === release.format && old.entry === release.entry) {
      if (old.phase === 'paused' || old.phase === 'failed') return this.resume(id);
      return publicTask(old);
    }
    if (old && this.active === id) throw new Error('Dieses Spiel wird bereits heruntergeladen.');
    if (this.closing) throw new Error('Der Launcher wird beendet.');
    if (old && (old.version !== release.version || old.sha256 !== release.sha256)) await fsp.rm(this._part(id), { force: true });
    const t = { id, title: String(title || id).slice(0, 90), version: release.version, url: release.url,
      sha256: release.sha256.toLowerCase(), format: release.format, entry: release.entry, phase: 'queued',
      bytes: 0, total: 0, speed: 0, eta: null, error: null, updatedAt: new Date().toISOString() };
    this.tasks.set(id, t);
    await this._persist(); this._emit(); this._kick();
    return publicTask(t);
  }
  async pause(id) {
    const t = this.tasks.get(id);
    if (!t || !['queued','downloading','failed','paused'].includes(t.phase)) throw new Error('Download kann während der Installation nicht pausiert werden.');
    if (this.active === id) { this.pausedByUser = true; this.controller?.abort(); }
    t.phase = 'paused'; t.speed = 0; t.eta = null;
    await this._persist(); this._emit(); this._kick();
    return publicTask(t);
  }
  async resume(id) {
    const t = this.tasks.get(id);
    if (!t || !['paused','failed','queued'].includes(t.phase)) throw new Error('Download kann nicht fortgesetzt werden.');
    t.phase = 'queued'; t.error = null;
    await this._persist(); this._emit(); this._kick();
    return publicTask(t);
  }
  async move(id, direction) {
    if(!ID.test(id||'') || ![-1,1].includes(direction)) throw new Error('Ungültige Warteschlangenaktion.');
    const task=this.tasks.get(id);
    if(!task || task.phase!=='queued') throw new Error('Nur wartende Downloads können verschoben werden.');
    const rows=[...this.tasks.entries()];
    const waiting=rows.filter(([,t])=>t.phase==='queued').map(([key])=>key);
    const index=waiting.indexOf(id),target=index+direction;
    if(index<0 || target<0 || target>=waiting.length)return {ok:true,moved:false};
    const other=waiting[target];
    const pos=rows.findIndex(([key])=>key===id);
    const posOther=rows.findIndex(([key])=>key===other);
    [rows[pos],rows[posOther]]=[rows[posOther],rows[pos]];
    this.tasks=new Map(rows);
    await this._persist();this._emit();
    return {ok:true,moved:true};
  }
  async cancel(id) {
    const t = this.tasks.get(id);
    if (!t) throw new Error('Download nicht gefunden.');
    if (!['queued','downloading','paused','failed','complete'].includes(t.phase)) throw new Error('Bitte die Prüfung oder Installation abschließen lassen.');
    if (this.active === id) { this.pausedByUser = true; this.controller?.abort(); }
    // Removal of partial file is deferred if the worker still has the handle open.
    t.phase = 'canceled';
    if (this.active !== id) await fsp.rm(this._part(id), { force: true });
    await this._persist(); this._emit(); this._kick();
    return { ok: true };
  }
  _kick() {
    if (this.worker || !this.autoStart || this.closing) return;
    this.worker = this._work().finally(() => { this.worker = null; if (this.list().some(t => t.phase === 'queued')) this._kick(); });
  }
  async _work() {
    for (;;) {
      // Never start a fresh task while close() is waiting for the worker.
      // Without this guard, a queued resume after abort can deadlock shutdown.
      if (this.closing) break;
      const t = [...this.tasks.values()].find(item => item.phase === 'queued');
      if (!t) break;
      this.active = t.id;
      this.controller = new AbortController(); this.pausedByUser = false;
      try {
        t.phase = 'downloading'; t.speed = 0; t.eta = null; this._emit();
        await this._download(t, this.controller.signal);
        if (t.phase === 'canceled' || t.phase === 'paused') continue;
        t.phase = 'verifying'; this._emit();
        const actual = await hashFile(this._part(t.id));
        if (actual !== t.sha256) {
          await fsp.rm(this._part(t.id), { force: true });
          t.bytes = 0;
          throw new Error('SHA-256-Prüfsumme stimmt nicht. Archiv verworfen.');
        }
        t.phase = 'installing'; this._emit();
        await this.onReady({ ...t, archive: this._part(t.id) });
        if (t.phase !== 'canceled') {
          t.phase = 'complete'; t.speed = 0; t.eta = 0;
          await fsp.rm(this._part(t.id), { force: true });
          this._emit();
        }
      } catch (error) {
        if (t.phase !== 'paused' && t.phase !== 'canceled') {
          // A graceful app shutdown keeps partial bytes resumable after relaunch.
          t.phase = this.closing ? 'queued' : 'failed';
          t.error = this.closing ? null : String(error.message || error).slice(0, 200);
          t.speed = 0; t.eta = null; this._emit();
        }
      } finally {
        if (t.phase === 'canceled') { this.tasks.delete(t.id); await fsp.rm(this._part(t.id), { force: true }); }
        this.active = null; this.controller = null;
        await this._persist(); this._emit();
      }
    }
  }
  async _download(t, signal) {
    const file = this._part(t.id);
    let offset = 0;
    try { offset = (await fsp.stat(file)).size; } catch {}
    if (offset > this.maxBytes) throw new Error('Ungültiger Downloadcache.');
    let response = await this.request(t.url, { headers: offset ? { Range: 'bytes=' + offset + '-' } : {}, signal });
    if (offset && response.status === 416) {
      // A partial download can already contain the complete ZIP when Windows
      // was closed during verification/installation. Avoid downloading it again.
      const completeHash=await hashFile(file);
      if (completeHash === t.sha256) {
        t.total=offset; t.bytes=offset; t.speed=0; t.eta=0; this._emit();
        return;
      }
      await fsp.rm(file, { force: true }); offset = 0;
      response = await this.request(t.url, { signal });
    }
    if (offset && response.status === 200) { // Server ignores Range: safely restart at byte zero.
      offset = 0;
    }
    const range = parseContentRange(response.headers.get('content-range'));
    if (offset && response.status === 206 && range && (range.end < range.from || (range.total && range.total <= range.end))) throw new Error('Ungültiger Content-Range vom Downloadserver.');
    if (!response.ok || !response.body || (offset && (response.status !== 206 || !range || range.from !== offset)) || (!offset && response.status === 206)) {
      throw new Error('Downloadserver hat eine ungültige Antwort geliefert (HTTP ' + response.status + ').');
    }
    const headerLength = Number(response.headers.get('content-length'));
    const knownTotal = offset && range ? range.total : Number.isFinite(headerLength) && headerLength >= 0 ? headerLength : 0;
    if (knownTotal > this.maxBytes || offset > this.maxBytes) throw new Error('Archiv überschreitet das Größenlimit.');
    t.total = knownTotal; t.bytes = offset;
    const startTime = Date.now(); let lastEmit = startTime, previous = offset;
    const track = new Transform({ transform: (chunk, _enc, callback) => {
      if (signal.aborted) return callback(new Error('Abgebrochen'));
      t.bytes += chunk.length;
      if (t.bytes > this.maxBytes) return callback(new Error('Datei überschreitet das Größenlimit.'));
      const now = Date.now();
      if (now - lastEmit >= 250) {
        t.speed = Math.max(0, Math.round((t.bytes - previous) / Math.max((now - lastEmit) / 1000, .1)));
        t.eta = t.total && t.speed ? Math.ceil((t.total - t.bytes) / t.speed) : null;
        previous = t.bytes; lastEmit = now; this._emit();
      }
      callback(null, chunk);
    }});
    await pipeline(Readable.fromWeb(response.body), track, fs.createWriteStream(file, { flags: offset ? 'a' : 'w' }), { signal });
    t.speed = Math.round((t.bytes - offset) / Math.max((Date.now() - startTime) / 1000, .1));
    if (t.total && t.bytes !== t.total) throw new Error('Download unvollständig.');
    this._emit();
  }
  async close() {
    this.closing = true;
    this.controller?.abort();
    if (this.worker) await this.worker.catch(() => {});
    await this.writeChain.catch(() => {});
  }
}
module.exports = { DownloadManager, parseContentRange, hashFile };
