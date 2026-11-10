'use strict';

const { app, BrowserWindow, ipcMain, shell, nativeTheme, session, protocol, dialog, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createUpdateController } = require('./update-controller.cjs');
const { DownloadManager, hashFile } = require('./download-manager.cjs');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const extractZip = require('extract-zip');

const WEBSITE = 'https://akraniss05.github.io/NovaLab-Website1/';
const DISCORD = 'https://discord.gg/SZhYa6Nnmy';
const REMOTE_CATALOG = 'https://raw.githubusercontent.com/akraniss05/NovaLab-Website1/main/launcher/catalog.json';
const COMMUNITY_API = 'https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/novalab-launcher-api';
const STUDIO_API = 'https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/novalab-studio-api';
const STUDIO_MEDIA_ORIGIN = 'https://ekgxotvvhkmeuxvuwbei.supabase.co';
const ACADEMY_URL = 'https://liverylab-academy.dev/';
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_MINI_ARCHIVE_BYTES = 120 * 1024 * 1024;
const MAX_MINI_UNPACKED_BYTES = 300 * 1024 * 1024;
const GAME_PARTITION = 'persist:novalab-mini-games';
const MINI_EXTENSIONS = new Set(['.html','.htm','.css','.js','.mjs','.json','.txt','.svg','.png','.jpg','.jpeg','.gif','.webp','.ico','.woff','.woff2','.ttf','.mp3','.ogg','.wav','.mp4','.webm','.wasm','.glb','.gltf']);
protocol.registerSchemesAsPrivileged([{ scheme: 'novalab-game', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const ALLOWED_GAME_ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
const APP_ID = 'com.novalabstudios.launcher';
const gameRoot = () => path.resolve(settings.installRoot || path.join(app.getPath('userData'), 'installed-games'));
const statePath = () => path.join(app.getPath('userData'), 'games.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const statsPath = () => path.join(app.getPath('userData'), 'game-stats.json');
let win;
let installed = {};
let settings = { checkUpdatesAutomatically: true, installRoot: '' };
let gameStats = {};
let downloads = null;
const runningGames = new Map();
let catalog = [];
let catalogSource = 'local';
let activeDownload = null;
let updaterState = { status: 'idle', message: 'Bereit zur Updateprüfung.', progress: 0 };
let updateController = null;
let gameProtocolReady = false;
let token = '';
let account = null;
let uploadFile = null;
let academyWindow = null;
let publisherWindow = null;
let publisherBuildFile = null;
const authPath = () => path.join(app.getPath('userData'), 'session.bin');

function readJson(filename, fallback) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return fallback; }
}
async function writeJsonAtomic(filename, data) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + '.tmp-' + crypto.randomUUID();
  await fsp.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(temporary, filename);
}
function notify(type, payload = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('launcher:event', { type, ...payload });
}
function isValidRelease(release) {
  if (!release || typeof release !== 'object') return false;
  if (typeof release.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][a-zA-Z0-9.-]+)?$/.test(release.version)) return false;
  if (typeof release.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(release.sha256)) return false;
  const format = release.format || 'windows';
  if (!['windows','html'].includes(format)) return false;
  if (typeof release.entry !== 'string' || !/^[a-zA-Z0-9_ .()/-]+$/i.test(release.entry) || release.entry.startsWith('/') || release.entry.split('/').includes('..') || !release.entry.includes('.')) return false;
  if (format === 'windows' && !/\.exe$/i.test(release.entry)) return false;
  if (format === 'html' && !/\.html?$/i.test(release.entry)) return false;
  try {
    const url = new URL(release.url);
    const legacyRelease = url.hostname === 'github.com' && /^\/akraniss05\/[a-zA-Z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+\.zip$/i.test(url.pathname);
    const miniDownload = url.hostname === 'raw.githubusercontent.com' && /^\/akraniss05\/NovaLab-Website1\/main\/launcher\/mini-games\/downloads\/[a-z0-9-]+\/[a-z0-9.-]+\.zip$/i.test(url.pathname);
    const communityDownload = url.hostname === 'ekgxotvvhkmeuxvuwbei.supabase.co' && /^\/storage\/v1\/object\/public\/novalab-launcher-games\/community-[a-z0-9-]+\/[0-9]+\.[0-9]+\.[0-9]+\/[a-f0-9-]+\.zip$/i.test(url.pathname);
    return url.protocol === 'https:' && (legacyRelease || (format === 'html' && miniDownload) || communityDownload) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function cleanStudioMedia(url) {
  if (typeof url !== 'string') return '';
  try {
    const link=new URL(url);
    return link.origin===STUDIO_MEDIA_ORIGIN &&
      /^\/storage\/v1\/object\/public\/novalab-studio-media\/community-[a-z0-9-]+\/[a-f0-9-]+\.(?:png|jpg|webp|mp4|webm)$/.test(link.pathname) && !link.search && !link.hash ? url : '';
  } catch { return ''; }
}
function normalizeCatalog(raw) {
  if (!Array.isArray(raw)) throw new Error('Katalog muss eine Liste sein.');
  const used = new Set();
  return raw.slice(0, 48).filter(item => {
    if (!item || !ALLOWED_GAME_ID.test(item.id || '') || used.has(item.id)) return false;
    used.add(item.id); return true;
  }).map(item => ({
    id: item.id,
    title: String(item.title || item.id).slice(0, 90),
    subtitle: String(item.subtitle || '').slice(0, 130),
    description: String(item.description || '').slice(0, 1000),
    type: ['game', 'app', 'tool'].includes(item.type) ? item.type : 'game',
    status: String(item.status || 'In Entwicklung').slice(0, 60),
    tags: (Array.isArray(item.tags) ? item.tags : []).slice(0, 6).map(x => String(x).slice(0, 28)),
    accent: /^#[0-9a-f]{6}$/i.test(item.accent || '') ? item.accent : '#8f73ff',
    website: isSafeExternal(item.website) ? item.website : '',
    genre: String(item.genre||'Indie').slice(0,40),
    developer: String(item.developer||'NovaLab Studios').slice(0,80),
    publisher: String(item.publisher||'NovaLab Studios').slice(0,80),
    featured: item.featured===true,
    cover: cleanStudioMedia(item.cover),
    banner: cleanStudioMedia(item.banner),
    screenshots: (Array.isArray(item.screenshots)?item.screenshots:[]).slice(0,20).map(cleanStudioMedia).filter(Boolean),
    videos: (Array.isArray(item.videos)?item.videos:[]).slice(0,8).map(cleanStudioMedia).filter(Boolean),
    requirements: { minimum: String(item.requirements?.minimum||'').slice(0,1000), recommended: String(item.requirements?.recommended||'').slice(0,1000) },
    release: isValidRelease(item.release) ? {
      version: item.release.version,
      url: item.release.url,
      sha256: item.release.sha256.toLowerCase(),
      entry: item.release.entry,
      format: item.release.format === 'html' ? 'html' : 'windows',
      size: Number.isSafeInteger(item.release.size) && item.release.size>=0 ? item.release.size : null,
      changelog: String(item.release.changelog||'').slice(0,5000),
      updatedAt: String(item.release.updated_at||'').slice(0,80)
    } : null
  }));
}
function isSafeExternal(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'github.com' || url.hostname === 'discord.gg' || url.hostname === 'liverylab-academy.dev' || url.hostname === 'akraniss05.github.io');
  } catch { return false; }
}
async function communityRequest(route, options = {}) {
  const headers = { 'User-Agent': 'NovaLab-Launcher', ...(options.json ? { 'content-type': 'application/json' } : {}) };
  if (options.auth !== false && token) headers.authorization = 'Bearer ' + token;
  const response = await fetch(COMMUNITY_API + '/' + route, { method: options.method || 'GET', headers,
    body: options.form || (options.json ? JSON.stringify(options.json) : undefined),
    signal: AbortSignal.timeout(options.form ? 85000 : 13000) });
  const text = await response.text();
  if (text.length > 250000) throw new Error('Antwort des NovaLab-Servers ist zu groß.');
  let data = {};
  try { data = JSON.parse(text); } catch { throw new Error('NovaLab-Server ist gerade nicht erreichbar.'); }
  if (!response.ok) throw new Error(String(data.error || 'Serverfehler').slice(0, 180));
  return data;
}
async function saveToken(value) {
  token = value;
  if (!value) { await fsp.rm(authPath(), { force: true }).catch(() => {}); return; }
  if (safeStorage.isEncryptionAvailable()) {
    await fsp.writeFile(authPath(), safeStorage.encryptString(value), { mode: 0o600 });
  }
}
async function restoreAccount() {
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(authPath())) {
      token = safeStorage.decryptString(await fsp.readFile(authPath()));
    }
    if (token) account = (await communityRequest('me')).account;
  } catch { await saveToken(''); account = null; }
  notify('auth', { account });
}
function validateAccountData(data) {
  if (typeof data?.username !== 'string' || typeof data?.password !== 'string') throw new Error('Benutzername und Passwort fehlen.');
  if (data.username.length > 24 || data.password.length > 128) throw new Error('Eingaben sind zu lang.');
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipHTML(data) {
  const filename = Buffer.from('index.html');
  const crc = crc32(data);
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26); filename.copy(local, 30);
  const directory = Buffer.alloc(46 + filename.length);
  directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x0800, 8); directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(filename.length, 28); filename.copy(directory, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, directory, end]);
}
function openAcademy() {
  if (academyWindow && !academyWindow.isDestroyed()) { academyWindow.focus(); return; }
  academyWindow = new BrowserWindow({ title: 'NovaLab Academy', width: 1320, height: 900, minWidth: 750, minHeight: 530,
    backgroundColor: '#0c101d', autoHideMenuBar: true, webPreferences: { nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, partition: 'persist:novalab-academy' } });
  academyWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  academyWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  academyWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ACADEMY_URL)) { event.preventDefault(); if (isSafeExternal(url)) shell.openExternal(url).catch(() => {}); }
  });
  academyWindow.loadURL(ACADEMY_URL);
  academyWindow.on('closed', () => { academyWindow = null; });
}
async function chooseGameFile() {
  const res = await dialog.showOpenDialog(win, { title: 'HTML-Mini-Game oder ZIP-Paket wählen', properties: ['openFile'],
    filters: [{ name: 'NovaLab Mini-Games', extensions: ['html', 'zip'] }] });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  const target = res.filePaths[0];
  const stat = await fsp.stat(target);
  if (!stat.isFile() || stat.size > 12 * 1024 * 1024 || stat.size < 30) throw new Error('Datei muss zwischen 30 Bytes und 12 MB groß sein.');
  uploadFile = target;
  return { name: path.basename(target), size: stat.size };
}
async function publishGame(form) {
  if (!account || account.role !== 'admin' || account.mustChangePassword) throw new Error('Admin-Zugriff erforderlich. Bitte zuerst das Startpasswort ändern.');
  if (!uploadFile) throw new Error('Bitte zuerst ein HTML-Spiel oder eine ZIP-Datei auswählen.');
  const title = String(form?.title || '').trim();
  const id = 'community-' + String(form?.slug || '').toLowerCase().trim();
  const version = String(form?.version || '').trim();
  const description = String(form?.description || '').trim();
  if (!/^community-[a-z0-9][a-z0-9-]{2,49}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version) || title.length < 3 || title.length > 80 || description.length > 900) throw new Error('Spielname, Kurzbeschreibung, ID oder Version ungültig.');
  let archive;
  const original = await fsp.readFile(uploadFile);
  if (/\.html$/i.test(uploadFile)) {
    if (original.length > 3 * 1024 * 1024 || !/<(?:html|!doctype)/i.test(original.toString('utf8').slice(0, 4096))) throw new Error('Bitte eine gültige HTML-Datei bis 3 MB auswählen.');
    archive = zipHTML(original);
  } else if (/\.zip$/i.test(uploadFile)) {
    await checkMiniArchive(uploadFile);
    archive = original;
  } else throw new Error('Nur HTML und ZIP werden unterstützt.');
  if (archive.length > 12 * 1024 * 1024) throw new Error('ZIP darf höchstens 12 MB groß sein.');
  const payload = new FormData();
  payload.set('id', id); payload.set('title', title); payload.set('description', description); payload.set('version', version);
  payload.set('file', new Blob([archive], { type: 'application/zip' }), id + '-' + version + '.zip');
  const result = await communityRequest('upload', { method: 'POST', form: payload });
  uploadFile = null;
  await loadCatalog();
  return result;
}


async function studioRequest(route, options={}) {
  const headers={ 'User-Agent':'NovaLab-Launcher', ...(options.json?{'content-type':'application/json'}:{}) };
  if(options.auth!==false && token)headers.authorization='Bearer '+token;
  const response=await fetch(STUDIO_API+'/'+route,{method:options.method||'GET',headers,
    body:options.form || (options.json?JSON.stringify(options.json):undefined),
    signal:AbortSignal.timeout(options.form?90000:16000)});
  const raw=await response.text();
  if(raw.length>600000)throw new Error('Studio-Antwort zu groß.');
  let data;
  try{data=JSON.parse(raw);}catch{throw new Error('Studio-Server ist nicht erreichbar.');}
  if(!response.ok)throw new Error(String(data.error||'Studio-Anfrage fehlgeschlagen.').slice(0,240));
  return data;
}
function checkPublisherAuth() {
  if(!account || account.role!=='admin' || account.mustChangePassword || !token)
    throw new Error('Admin-Anmeldung erforderlich. Ändere zuerst dein Startpasswort.');
}
function openPublisher() {
  checkPublisherAuth();
  if(publisherWindow && !publisherWindow.isDestroyed()){publisherWindow.focus();return {ok:true};}
  publisherWindow=new BrowserWindow({
    title:'NovaLab Launcher · Administration',width:1520,height:920,minWidth:1040,minHeight:650,
    backgroundColor:'#080c1a',show:false,autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'publisher-preload.cjs'),
      sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:!app.isPackaged
    }
  });
  publisherWindow.loadFile(path.join(__dirname,'renderer','publisher.html'));
  publisherWindow.once('ready-to-show',()=>publisherWindow?.show());
  publisherWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  publisherWindow.webContents.on('will-navigate',e=>e.preventDefault());
  publisherWindow.on('closed',()=>{publisherWindow=null;publisherBuildFile=null;});
  return {ok:true};
}
function verifyPublisher(event) {
  if(!publisherWindow || publisherWindow.isDestroyed() ||
    event.sender!==publisherWindow.webContents ||
    event.senderFrame!==publisherWindow.webContents.mainFrame ||
    !event.senderFrame.url.startsWith('file://') ||
    !event.senderFrame.url.endsWith('/publisher.html'))
    throw new Error('Nicht autorisierte Publisher-Anfrage.');
  checkPublisherAuth();
}
function registerPublisher(name,fn){
  ipcMain.handle('studio:'+name,async(event,...args)=>{verifyPublisher(event);return fn(...args);});
}
async function uploadPublisherMedia(data){
  const {id,kind,alt}=data||{};
  if(typeof id!=='string'||!/^community-[a-z0-9][a-z0-9-]{2,49}$/.test(id) ||
     !['cover','banner','screenshot','video'].includes(kind))throw new Error('Ungültige Medienangaben.');
  const isVideo=kind==='video';
  const selected=await dialog.showOpenDialog(publisherWindow,{
    title:isVideo?'Trailer auswählen':'Bild auswählen',properties:['openFile'],
    filters:isVideo?[{name:'Video',extensions:['mp4','webm']}]:[{name:'Bild',extensions:['png','jpg','jpeg','webp']}]
  });
  if(selected.canceled || !selected.filePaths[0])return {canceled:true};
  const filePath=selected.filePaths[0],ext=path.extname(filePath).toLowerCase();
  const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm'};
  if(!types[ext] || isVideo!==types[ext].startsWith('video/'))throw new Error('Dieser Dateityp wird nicht unterstützt.');
  const info=await fsp.stat(filePath);
  if(!info.isFile()||info.size<100||info.size>(isVideo?8:5)*1024*1024)throw new Error('Datei zu groß oder ungültig.');
  const bytes=await fsp.readFile(filePath);
  const form=new FormData();
  form.set('id',id);form.set('kind',kind);form.set('alt',String(alt||'').slice(0,160));
  form.set('file',new Blob([bytes],{type:types[ext]}),path.basename(filePath));
  return studioRequest('media',{method:'POST',form});
}
async function choosePublisherBuild(){
  const res=await dialog.showOpenDialog(publisherWindow,{title:'Spielpaket auswählen',properties:['openFile'],
    filters:[{name:'NovaLab Spiel',extensions:['zip','html']}]});
  if(res.canceled||!res.filePaths[0])return {canceled:true};
  const filePath=res.filePaths[0],info=await fsp.stat(filePath);
  if(!info.isFile()||info.size<50||info.size>12*1024*1024)throw new Error('Spielpaket muss zwischen 50 Byte und 12 MB groß sein.');
  publisherBuildFile=filePath;
  return {name:path.basename(filePath),size:info.size};
}
async function uploadPublisherBuild(data){
  if(!publisherBuildFile)throw new Error('Bitte zuerst eine HTML- oder ZIP-Datei auswählen.');
  const f=data||{},id=String(f.id||''),format=String(f.format||''),version=String(f.version||'');
  if(!/^community-[a-z0-9][a-z0-9-]{2,49}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version) ||
     !['html','windows'].includes(format))throw new Error('Ungültige Build-Eingaben.');
  const filePath=publisherBuildFile;
  let archive;
  if(/\.html$/i.test(filePath)){
    if(format!=='html'||String(f.entry)!=='index.html')throw new Error('Einzelne HTML-Dateien benötigen index.html als Startdatei.');
    const contents=await fsp.readFile(filePath);
    if(contents.length>3*1024*1024||!/<(?:html|!doctype)/i.test(contents.toString('utf8').slice(0,4096)))
      throw new Error('HTML-Datei ist ungültig oder zu groß.');
    archive=zipHTML(contents);
  }else{
    if(!/\.zip$/i.test(filePath))throw new Error('Datei muss ein ZIP-Archiv sein.');
    if(format==='html')await checkMiniArchive(filePath);
    else await checkNativeArchive(filePath);
    archive=await fsp.readFile(filePath);
  }
  if(archive.length>12*1024*1024)throw new Error('ZIP ist größer als 12 MB.');
  const form=new FormData();
  for(const key of ['id','version','format','entry','channel','changelog'])form.set(key,String(f[key]||''));
  form.set('file',new Blob([archive],{type:'application/zip'}),id+'-'+version+'.zip');
  const result=await studioRequest('upload-build',{method:'POST',form});
  publisherBuildFile=null;
  return result;
}

async function loadCatalog() {
  const bundled = normalizeCatalog(readJson(path.join(__dirname, '..', 'catalog.json'), []));
  catalog = bundled;
  catalogSource = 'local';
  try {
    const response = await fetch(REMOTE_CATALOG, { signal: AbortSignal.timeout(8500), cache: 'no-store', headers: { 'User-Agent': 'NovaLab-Launcher' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    if (text.length > 100000) throw new Error('Katalog zu groß');
    const remote = normalizeCatalog(JSON.parse(text));
    if (remote.length) { catalog = remote; catalogSource = 'online'; }
  } catch { /* Local catalog keeps the launcher usable offline. */ }
  try {
    const remote = await communityRequest('catalog', { auth: false });
    if (Array.isArray(remote.games)) {
      const merged = normalizeCatalog([...remote.games, ...catalog]);
      if (merged.length) { catalog = merged; catalogSource = 'online'; }
    }
  } catch { /* Community API may be offline. Bundled games remain available. */ }
  try {
    const studio=await studioRequest('catalog',{auth:false});
    if(Array.isArray(studio.games)&&studio.games.length){
      catalog=normalizeCatalog([...studio.games,...catalog]);
      catalogSource='online';
    }
  }catch{/* Studio-Katalog offline: bisherige Spiele bleiben verfügbar. */}
  notify('catalog', { games: catalog, source: catalogSource });
  return { games: catalog, source: catalogSource };
}
function snapshot() {
  return { games: catalog, installed, stats: gameStats, downloads: downloads?.list() || [], source: catalogSource, settings, update: updaterState, version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, activeDownload: downloads?.active, account };
}
function localGamePath(id) {
  if (!ALLOWED_GAME_ID.test(id || '')) throw new Error('Ungültige Spiele-ID.');
  const root = installed[id] ? (installed[id].installRoot || path.join(app.getPath('userData'), 'installed-games')) : gameRoot();
  return path.join(path.resolve(root), id);
}
function gameById(id) { return catalog.find(g => g.id === id); }
function verifySender(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('file://')) {
    throw new Error('Ungültige Launcher-Anfrage');
  }
}
function safeEntry(base, entry) {
  const target = path.resolve(base, ...entry.split('/'));
  if (!target.startsWith(path.resolve(base) + path.sep)) throw new Error('Ungültiger Spielpfad');
  return target;
}
async function legacyDownloadArchive(url, dest, expectedHash, id, maxBytes = MAX_ARCHIVE_BYTES) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  let total = 0;
  const hash = crypto.createHash('sha256');
  let lastProgress = 0;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'NovaLab-Launcher' } });
    if (!response.ok || !response.body) throw new Error('Download fehlgeschlagen (HTTP ' + response.status + ')');
    const contentTypeLength = Number(response.headers.get('content-length')) || 0;
    if (contentTypeLength > maxBytes) throw new Error('Datei überschreitet die Größenbegrenzung');
    const progress = new Transform({
      transform(chunk, enc, cb) {
        total += chunk.length;
        if (total > maxBytes) return cb(new Error('Download ist zu groß'));
        hash.update(chunk);
        if (Date.now() - lastProgress > 160 || total === contentTypeLength) {
          notify('download', { id, phase: 'downloading', bytes: total, total: contentTypeLength, percent: contentTypeLength ? Math.min(100, Math.round(total * 100 / contentTypeLength)) : 0 });
          lastProgress = Date.now();
        }
        cb(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(dest, { flags: 'wx' }));
    if (hash.digest('hex') !== expectedHash) throw new Error('SHA-256-Prüfsumme stimmt nicht. Installation abgebrochen.');
  } finally { clearTimeout(timeout); }
}
function checkMiniArchive(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      let count = 0, uncompressed = 0, done = false, hasIndex = false;
      const fail = err => { if (!done) { done = true; zip.close(); reject(err); } };
      zip.on('error', fail);
      zip.on('entry', entry => {
        count++;
        uncompressed += entry.uncompressedSize;
        const name = entry.fileName;
        if (name === 'index.html') hasIndex = true;
        const parts = name.split('/');
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (count > 500 || uncompressed > MAX_MINI_UNPACKED_BYTES || name.includes('\\') || name.startsWith('/') || parts.some(p => p === '..' || p === '.') || /:/.test(name) || type === 0o120000) return fail(new Error('Ungültige oder zu große Mini-Game-ZIP'));
        if (!name.endsWith('/') && !MINI_EXTENSIONS.has(path.extname(name).toLowerCase())) return fail(new Error('Nicht erlaubter Dateityp: ' + name));
        zip.readEntry();
      });
      zip.on('end', () => { if (!done) { done = true; if (!hasIndex) reject(new Error('Das ZIP muss index.html im Hauptverzeichnis enthalten.')); else resolve(); } });
      zip.readEntry();
    });
  });
}
async function checkNativeArchive(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      let count = 0, size = 0, done = false;
      const fail = e => { if (!done) { done = true; zip.close(); reject(e); } };
      zip.on('error', fail);
      zip.on('entry', entry => {
        const name = entry.fileName;
        const parts = name.split('/');
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        count++; size += entry.uncompressedSize;
        if (count > 6000 || size > 10 * 1024 ** 3 || name.includes('\\') || name.startsWith('/') ||
            parts.some(p => p === '.' || p === '..') || /[:\x00-\x1f]/.test(name) ||
            mode === 0o120000 || (mode && mode !== 0o100000 && mode !== 0o040000)) {
          return fail(new Error('Unsicheres oder zu großes Windows-Spielarchiv.'));
        }
        zip.readEntry();
      });
      zip.on('end', () => { if (!done) { done = true; resolve(); } });
      zip.readEntry();
    });
  });
}
async function markPlay(id, startedAt) {
  const seconds = Math.max(1, Math.min(365 * 86400, Math.round((Date.now() - startedAt) / 1000)));
  gameStats[id] = { ...(gameStats[id] || {}), seconds: (gameStats[id]?.seconds || 0) + seconds,
    lastPlayed: new Date().toISOString(), sessions: (gameStats[id]?.sessions || 0) + 1 };
  await writeJsonAtomic(statsPath(), gameStats);
  notify('stats', { stats: gameStats });
  runningGames.delete(id);
}
async function installVerifiedGame(task) {
  if (process.platform !== 'win32') throw new Error('Spielinstallationen sind bislang nur unter Windows verfügbar.');
  const game = gameById(task.id);
  if (!game || !game.release || game.release.version !== task.version || game.release.sha256 !== task.sha256) {
    throw new Error('Katalogänderung während des Downloads. Bitte erneut starten.');
  }
  if (task.format === 'html') await checkMiniArchive(task.archive);
  else await checkNativeArchive(task.archive);
  const root = path.resolve(installed[task.id] ? (installed[task.id].installRoot || path.join(app.getPath('userData'), 'installed-games')) : gameRoot());
  await fsp.mkdir(root, { recursive: true });
  // A per-user or user-selected root; every installed game remains inside a dedicated ID directory.
  const destination = path.join(root, task.id);
  const working = await fsp.mkdtemp(path.join(root, '.novalab-install-'));
  const unpacked = path.join(working, 'next');
  const backup = path.join(working, 'previous');
  const previous = installed[task.id];
  let backedUp = false, activated = false;
  try {
    await fsp.mkdir(unpacked);
    await extractZip(task.archive, { dir: unpacked });
    const relative = task.entry.split('/');
    const entry = safeEntry(unpacked, task.entry);
    const resolved = await fsp.realpath(entry), realRoot = await fsp.realpath(unpacked);
    if (!resolved.startsWith(realRoot + path.sep) || !(await fsp.stat(resolved)).isFile() ||
        (task.format === 'html' ? !/\.html?$/i.test(task.entry) : !/\.exe$/i.test(task.entry))) {
      throw new Error('Startdatei fehlt oder Archiv ist ungültig.');
    }
    // Installer-owned marker prevents accidental deletion of unrelated directories.
    await fsp.writeFile(path.join(unpacked, '.novalab-install.json'), JSON.stringify({ id: task.id, version: task.version }));
    if (fs.existsSync(destination)) {
      const link = await fsp.lstat(destination);
      if (link.isSymbolicLink()) throw new Error('Installationsverzeichnis ist ein Link.');
      if (!previous) throw new Error('Ein fremder Ordner mit dieser Spiele-ID existiert bereits. Dateien bleiben unangetastet.');
      if (previous.installRoot) {
        const marker = readJson(path.join(destination, '.novalab-install.json'), null);
        if (marker?.id !== task.id || marker?.version !== previous.version) {
          throw new Error('Installationsmarkierung ungültig. Fremde Dateien werden nicht überschrieben.');
        }
      }
      if (previous?.installRoot && path.resolve(previous.installRoot) !== root) throw new Error('Installationspfad-Konflikt.');
      await fsp.rename(destination, backup); backedUp = true;
    }
    await fsp.rename(unpacked, destination); activated = true;
    installed[task.id] = { version: task.version, entry: task.entry, format: task.format,
      installRoot: root, installedAt: new Date().toISOString() };
    await writeJsonAtomic(statePath(), installed);
    notify('installed', { id: task.id, installed });
  } catch (error) {
    if (activated) await fsp.rm(destination, { recursive: true, force: true });
    if (backedUp) await fsp.rename(backup, destination);
    if (previous) installed[task.id] = previous; else delete installed[task.id];
    throw error;
  } finally {
    await fsp.rm(working, { recursive: true, force: true }).catch(() => {});
  }
}
const GAME_CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const CONTENT_TYPES = { '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.mp4':'video/mp4', '.webm':'video/webm', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.txt':'text/plain; charset=utf-8', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json' };
function prepareMiniGames() {
  if (gameProtocolReady) return;
  gameProtocolReady = true;
  const part = session.fromPartition(GAME_PARTITION);
  part.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  part.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('novalab-game://') }));
  part.protocol.handle('novalab-game', async request => {
    try {
      const url = new URL(request.url);
      const id = url.hostname;
      if (!ALLOWED_GAME_ID.test(id) || !installed[id] || installed[id].format !== 'html') return new Response('Nicht installiert', {status: 404});
      const subPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!subPath || subPath.includes('\\') || subPath.split('/').some(part => !part || part === '.' || part === '..')) return new Response('Ungültiger Pfad', {status: 403});
      const base = await fsp.realpath(localGamePath(id));
      const target = safeEntry(base, subPath);
      const resolved = await fsp.realpath(target);
      if (!resolved.startsWith(base + path.sep) || !MINI_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return new Response('Zugriff verweigert', {status: 403});
      const info = await fsp.stat(resolved);
      if (!info.isFile() || info.size > 80 * 1024 * 1024) return new Response('Asset zu groß', {status: 413});
      const content = await fsp.readFile(resolved);
      return new Response(content, {status: 200, headers: { 'content-type': CONTENT_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'content-security-policy': GAME_CSP, 'x-content-type-options':'nosniff' }});
    } catch { return new Response('Datei nicht gefunden', {status: 404}); }
  });
}
function openMiniGame(id, entry, title) {
  prepareMiniGames();
  const window = new BrowserWindow({
    title: 'NovaLab Mini Game · ' + title, width: 1100, height: 760, minWidth: 620, minHeight: 480,
    backgroundColor: '#0a0c19', autoHideMenuBar: true,
    webPreferences: { partition: GAME_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged }
  });
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('novalab-game://' + id + '/')) event.preventDefault(); });
  const started = Date.now();
  runningGames.set(id, window);
  window.on('closed', () => markPlay(id, started).catch(() => {}));
  window.loadURL('novalab-game://' + id + '/' + entry.split('/').map(encodeURIComponent).join('/'));
}

async function installGame(id) {
  if (process.platform !== 'win32') throw new Error('Spielinstallationen sind derzeit nur unter Windows unterstützt.');
  const game = gameById(id);
  if (!game?.release) throw new Error('Dieses Spiel ist noch nicht veröffentlicht.');
  if (runningGames.has(id)) throw new Error('Bitte das Spiel vor dem Update schließen.');
  return { queued: true, task: await downloads.enqueue(game) };
}
async function launchGame(id) {
  if (!ALLOWED_GAME_ID.test(id || '') || !installed[id]) throw new Error('Spiel ist nicht installiert.');
  const item = installed[id];
  const base = localGamePath(id);
  const target = safeEntry(base, item.entry);
  const actualBase = await fsp.realpath(base);
  const actualTarget = await fsp.realpath(target);
  if (!actualTarget.startsWith(actualBase + path.sep) || !(await fsp.stat(actualTarget)).isFile()) throw new Error('Spieldatei ist ungültig.');
  if (item.format === 'html') {
    if (!/\.html?$/i.test(actualTarget)) throw new Error('HTML-Startdatei fehlt.');
    openMiniGame(id, item.entry, gameById(id)?.title || id);
    return {ok: true};
  }
  if (!/\.exe$/i.test(actualTarget)) throw new Error('Spiel-EXE fehlt.');
  const started = Date.now();
  const child = spawn(actualTarget, [], { cwd: path.dirname(actualTarget), detached: true, stdio: 'ignore', windowsHide: false });
  runningGames.set(id, child);
  child.once('error', err => { runningGames.delete(id); notify('error', { message: 'Spielstart fehlgeschlagen: ' + err.message }); });
  child.once('exit', () => markPlay(id, started).catch(() => {}));
  child.unref();
  return { ok: true };
}
async function uninstallGame(id) {
  if (!ALLOWED_GAME_ID.test(id || '') || !installed[id]) throw new Error('Spiel nicht installiert.');
  if (runningGames.has(id)) throw new Error('Bitte das Spiel zuerst schließen.');
  if (downloads?.active === id) throw new Error('Bitte den Download erst abbrechen.');
  const root = path.resolve(installed[id].installRoot || path.join(app.getPath('userData'), 'installed-games'));
  const destination = path.join(root, id);
  if (path.dirname(destination) !== root || !fs.existsSync(destination) || (await fsp.lstat(destination)).isSymbolicLink()) {
    throw new Error('Ungültiges Installationsverzeichnis.');
  }
  if (installed[id].installRoot) {
    const marker = readJson(path.join(destination, '.novalab-install.json'), null);
    if (marker?.id !== id) throw new Error('Installationsmarkierung fehlt. Dateien bleiben unberührt.');
  }
  await fsp.rm(destination, { recursive: true, force: true });
  delete installed[id]; await writeJsonAtomic(statePath(), installed);
  notify('installed', { id, installed });
  return { ok: true };
}
async function verifyGame(id) {
  if (!ALLOWED_GAME_ID.test(id || '') || !installed[id]) throw new Error('Spiel nicht installiert.');
  const rec = installed[id];
  const root = await fsp.realpath(localGamePath(id));
  const target = safeEntry(root, rec.entry);
  const resolved = await fsp.realpath(target);
  if (!resolved.startsWith(root + path.sep) || !(await fsp.stat(resolved)).isFile()) throw new Error('Startdatei beschädigt oder gelöscht.');
  const marker = readJson(path.join(root, '.novalab-install.json'), null);
  if (rec.installRoot && (marker?.id !== id || marker?.version !== rec.version)) throw new Error('Installationsmarkierung ungültig.');
  return { ok: true, message: 'Startdatei und Installationsstruktur sind vorhanden. Vollständige Reparatur benötigt ein Dateimanifest.' };
}
function setupUpdater() {
  updateController = createUpdateController({
    updater: autoUpdater,
    app,
    notify: update => { updaterState = update; notify('updater', { update }); }
  });
}
async function checkUpdates() {
  return updateController.check();
}
function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1360, height: 850, minWidth: 900, minHeight: 620,
    backgroundColor: '#080a14', frame: false, title: 'NovaLab Launcher',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('maximize', () => notify('window', { maximized: true }));
  win.on('unmaximize', () => notify('window', { maximized: false }));
}

app.setAppUserModelId(APP_ID);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(async () => {
  if (!singleInstance) return;
  installed = readJson(statePath(), {});
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) installed = {};
  settings = { ...settings, ...readJson(settingsPath(), {}) };
  gameStats = readJson(statsPath(), {});
  if (!gameStats || Array.isArray(gameStats) || typeof gameStats !== 'object') gameStats = {};
  downloads = new DownloadManager({ directory: path.join(app.getPath('userData'), 'download-cache'),
    onChange: tasks => notify('download-list', { tasks }), onReady: installVerifiedGame, autoStart: false });
  await downloads.init();
  setupUpdater();
  createWindow();
  // A resumed download must not validate a release before the catalog is ready.
  await Promise.allSettled([loadCatalog(), restoreAccount()]);
  downloads.autoStart = true;
  downloads._kick();
  setInterval(() => loadCatalog().catch(() => {}), 10 * 60 * 1000);
  if (settings.checkUpdatesAutomatically) setTimeout(() => checkUpdates().catch(() => {}), 12000);
  setInterval(() => { if (settings.checkUpdatesAutomatically) checkUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function register(channel, handler) { ipcMain.handle('launcher:' + channel, async (event, ...args) => { verifySender(event); return handler(...args); }); }
register('get-state', () => snapshot());
register('refresh-catalog', () => loadCatalog());
register('install', id => installGame(id));
register('launch', id => launchGame(id));
register('uninstall', id => uninstallGame(id));
register('verify-game', id => verifyGame(id));
register('pause-download', id => downloads.pause(id));
register('resume-download', id => downloads.resume(id));
register('cancel-download', id => downloads.cancel(id));
register('open-game-folder', async id => { if (!installed[id]) throw new Error('Spiel nicht installiert.'); const err=await shell.openPath(localGamePath(id)); if(err) throw new Error(err); return {ok:true}; });
register('choose-install-folder', async () => {
  const selected = await dialog.showOpenDialog(win, { properties:['openDirectory','createDirectory'], title:'Spiele-Installationsverzeichnis auswählen' });
  if (selected.canceled || !selected.filePaths.length) return {canceled:true};
  const root = await fsp.realpath(selected.filePaths[0]);
  settings.installRoot = root; await writeJsonAtomic(settingsPath(), settings);
  return { root };
});
register('check-update', () => checkUpdates());
register('download-update', () => updateController.download());
register('restart-update', () => updateController.restart());
register('set-settings', async patch => {
  if (!patch || typeof patch.checkUpdatesAutomatically !== 'boolean') throw new Error('Ungültige Einstellung');
  settings.checkUpdatesAutomatically = patch.checkUpdatesAutomatically;
  await writeJsonAtomic(settingsPath(), settings);
  return settings;
});
register('register-account', async data => { validateAccountData(data); return communityRequest('register', { method: 'POST', json: data, auth: false }); });
register('login-account', async data => {
  validateAccountData(data);
  const result = await communityRequest('login', { method: 'POST', json: data, auth: false });
  await saveToken(result.token);
  account = result.account;
  notify('auth', { account });
  return { account };
});
register('logout-account', async () => {
  try { if (token) await communityRequest('logout', { method: 'POST' }); } catch { /* Offline logout clears local token anyway */ }
  await saveToken(''); account = null; uploadFile = null; notify('auth', { account }); return { ok: true };
});
register('change-account-password', async data => {
  if (!account || typeof data?.oldPassword !== 'string' || typeof data?.newPassword !== 'string') throw new Error('Ungültige Passwortänderung.');
  const result = await communityRequest('change-password', { method: 'POST', json: data });
  await saveToken(''); account = null; uploadFile = null; notify('auth', { account }); return result;
});
register('open-academy', () => { openAcademy(); return { ok: true }; });
register('open-publisher', () => openPublisher());
register('choose-game-file', () => chooseGameFile());
register('publish-game', form => publishGame(form));
register('admin-games', () => {
  if (!account || account.role !== 'admin' || account.mustChangePassword) throw new Error('Admin-Berechtigung fehlt.');
  return communityRequest('admin-games');
});
register('game-visibility', data => {
  if (!account || account.role !== 'admin' || account.mustChangePassword) throw new Error('Admin-Berechtigung fehlt.');
  return communityRequest('visibility', { method: 'POST', json: data });
});
register('open-link', async url => {
  if (!isSafeExternal(url)) throw new Error('Dieser Link ist nicht freigegeben.');
  await shell.openExternal(url); return { ok: true };
});
register('window', action => {
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
  else throw new Error('Unbekannte Fensteraktion');
  return { ok: true };
});

registerPublisher('list',()=>studioRequest('list'));
registerPublisher('detail',id=>{
  if(typeof id!=='string'||!/^community-[a-z0-9][a-z0-9-]{2,49}$/.test(id))throw new Error('Ungültige Spiel-ID.');
  return studioRequest('detail?id='+encodeURIComponent(id));
});
registerPublisher('save',data=>studioRequest('save',{method:'POST',json:data}));
registerPublisher('upload-media',data=>uploadPublisherMedia(data));
registerPublisher('media-remove',data=>studioRequest('media-remove',{method:'POST',json:data}));
registerPublisher('choose-build',()=>choosePublisherBuild());
registerPublisher('upload-build',data=>uploadPublisherBuild(data));
registerPublisher('publish',async data=>{
  const result=await studioRequest('publish',{method:'POST',json:data});
  await loadCatalog();
  return result;
});
registerPublisher('refresh-catalog',()=>loadCatalog());
