'use strict';

const { app, BrowserWindow, ipcMain, shell, nativeTheme, session, protocol } = require('electron');
const { autoUpdater } = require('electron-updater');
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
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_MINI_ARCHIVE_BYTES = 120 * 1024 * 1024;
const MAX_MINI_UNPACKED_BYTES = 300 * 1024 * 1024;
const GAME_PARTITION = 'persist:novalab-mini-games';
const MINI_EXTENSIONS = new Set(['.html','.htm','.css','.js','.mjs','.json','.txt','.svg','.png','.jpg','.jpeg','.gif','.webp','.ico','.woff','.woff2','.ttf','.mp3','.ogg','.wav','.mp4','.webm','.wasm','.glb','.gltf']);
protocol.registerSchemesAsPrivileged([{ scheme: 'novalab-game', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const ALLOWED_GAME_ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
const APP_ID = 'com.novalabstudios.launcher';
const gameRoot = () => path.join(app.getPath('userData'), 'installed-games');
const statePath = () => path.join(app.getPath('userData'), 'games.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let win;
let installed = {};
let settings = { checkUpdatesAutomatically: true };
let catalog = [];
let catalogSource = 'local';
let activeDownload = null;
let updaterState = { status: 'idle', message: '', progress: 0 };
let gameProtocolReady = false;

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
    return url.protocol === 'https:' && (legacyRelease || (format === 'html' && miniDownload)) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
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
    release: isValidRelease(item.release) ? {
      version: item.release.version,
      url: item.release.url,
      sha256: item.release.sha256.toLowerCase(),
      entry: item.release.entry,
      format: item.release.format === 'html' ? 'html' : 'windows'
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
  notify('catalog', { games: catalog, source: catalogSource });
  return { games: catalog, source: catalogSource };
}
function snapshot() {
  return { games: catalog, installed, source: catalogSource, settings, update: updaterState, version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, activeDownload };
}
function localGamePath(id) { return path.join(gameRoot(), id); }
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
async function downloadArchive(url, dest, expectedHash, id, maxBytes = MAX_ARCHIVE_BYTES) {
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
      let count = 0, uncompressed = 0, done = false;
      const fail = err => { if (!done) { done = true; zip.close(); reject(err); } };
      zip.on('error', fail);
      zip.on('entry', entry => {
        count++;
        uncompressed += entry.uncompressedSize;
        const name = entry.fileName;
        const parts = name.split('/');
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (count > 500 || uncompressed > MAX_MINI_UNPACKED_BYTES || name.includes('\\') || name.startsWith('/') || parts.some(p => p === '..' || p === '.') || /:/.test(name) || type === 0o120000) return fail(new Error('Ungültige oder zu große Mini-Game-ZIP'));
        if (!name.endsWith('/') && !MINI_EXTENSIONS.has(path.extname(name).toLowerCase())) return fail(new Error('Nicht erlaubter Dateityp: ' + name));
        zip.readEntry();
      });
      zip.on('end', () => { if (!done) { done = true; resolve(); } });
      zip.readEntry();
    });
  });
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
  window.loadURL('novalab-game://' + id + '/' + entry.split('/').map(encodeURIComponent).join('/'));
}

async function installGame(id) {
  const game = gameById(id);
  if (!game || !game.release) throw new Error('Für dieses Projekt wurde noch kein Download veröffentlicht.');
  if (process.platform !== 'win32') throw new Error('Der Launcher unterstützt Spieleinstallationen derzeit unter Windows.');
  if (activeDownload) throw new Error('Ein anderer Download läuft bereits.');
  const release = game.release;
  await fsp.mkdir(gameRoot(), { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(gameRoot(), '.download-'));
  activeDownload = { id, title: game.title };
  notify('download', { id, phase: 'starting', percent: 0 });
  const zipPath = path.join(workDir, 'game.zip');
  const unpacked = path.join(workDir, 'unpacked');
  const finalPath = localGamePath(id);
  const backupPath = path.join(workDir, 'backup');
  let backedUp = false;
  let swapped = false;
  const previousRecord = installed[id];
  try {
    await downloadArchive(release.url, zipPath, release.sha256, id, release.format === 'html' ? MAX_MINI_ARCHIVE_BYTES : MAX_ARCHIVE_BYTES);
    if (release.format === 'html') await checkMiniArchive(zipPath);
    notify('download', { id, phase: 'extracting', percent: 100 });
    await fsp.mkdir(unpacked, { recursive: true });
    await extractZip(zipPath, { dir: unpacked });
    const entry = safeEntry(unpacked, release.entry);
    const realRoot = await fsp.realpath(unpacked);
    const realEntry = await fsp.realpath(entry);
    if (!realEntry.startsWith(realRoot + path.sep) || !(await fsp.stat(realEntry)).isFile()) throw new Error('Ungültige EXE im Spielarchiv');
    if (release.format === 'html' && path.extname(entry).toLowerCase() !== '.html') throw new Error('Das Mini-Spiel muss eine HTML-Startdatei haben.');
    if (fs.existsSync(finalPath)) { await fsp.rename(finalPath, backupPath); backedUp = true; }
    await fsp.rename(unpacked, finalPath);
    swapped = true;
    installed[id] = { version: release.version, entry: release.entry, format: release.format, installedAt: new Date().toISOString() };
    await writeJsonAtomic(statePath(), installed);
    notify('installed', { id, installed });
  } catch (error) {
    if (swapped && fs.existsSync(finalPath)) await fsp.rm(finalPath, { recursive: true, force: true });
    if (backedUp && fs.existsSync(backupPath)) await fsp.rename(backupPath, finalPath);
    if (previousRecord) installed[id] = previousRecord; else delete installed[id];
    notify('download', { id, phase: 'error', error: error.message });
    throw error;
  } finally {
    activeDownload = null;
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    notify('download-idle', { id });
  }
  return { ok: true };
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
  const child = spawn(actualTarget, [], { cwd: path.dirname(actualTarget), detached: true, stdio: 'ignore', windowsHide: false });
  child.once('error', err => notify('error', { message: 'Spielstart fehlgeschlagen: ' + err.message }));
  child.unref();
  return { ok: true };
}
async function uninstallGame(id) {
  if (!ALLOWED_GAME_ID.test(id || '') || !installed[id]) throw new Error('Spiel nicht installiert.');
  if (activeDownload) throw new Error('Während eines Downloads ist Deinstallieren nicht möglich.');
  const base = gameRoot();
  const destination = localGamePath(id);
  if (path.dirname(destination) !== base || (fs.existsSync(destination) && (await fsp.lstat(destination)).isSymbolicLink())) throw new Error('Ungültiges Installationsverzeichnis.');
  await fsp.rm(destination, { recursive: true, force: true });
  delete installed[id];
  await writeJsonAtomic(statePath(), installed);
  notify('installed', { id, installed });
  return { ok: true };
}
function setUpdater(patch) {
  updaterState = { ...updaterState, ...patch };
  notify('updater', { update: updaterState });
}
function setupUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdater({ status: 'checking', message: 'Suche nach Launcher-Updates …' }));
  autoUpdater.on('update-available', info => setUpdater({ status: 'available', message: 'Neue Version ' + info.version + ' verfügbar', version: info.version }));
  autoUpdater.on('update-not-available', () => setUpdater({ status: 'current', message: 'Du verwendest die neueste Version.' }));
  autoUpdater.on('download-progress', progress => setUpdater({ status: 'downloading', message: 'Update wird heruntergeladen …', progress: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', () => setUpdater({ status: 'downloaded', message: 'Update bereit. Neustart zur Installation.', progress: 100 }));
  autoUpdater.on('error', error => setUpdater({ status: 'error', message: 'Updateprüfung fehlgeschlagen: ' + error.message }));
}
async function checkUpdates() {
  if (!app.isPackaged) { setUpdater({ status: 'development', message: 'Updates funktionieren nach der Installation einer Release-Version.' }); return updaterState; }
  try { await autoUpdater.checkForUpdates(); } catch (e) { setUpdater({ status: 'error', message: 'Updateprüfung fehlgeschlagen: ' + e.message }); }
  return updaterState;
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
app.whenReady().then(async () => {
  installed = readJson(statePath(), {});
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) installed = {};
  settings = { ...settings, ...readJson(settingsPath(), {}) };
  setupUpdater();
  createWindow();
  await loadCatalog();
  if (settings.checkUpdatesAutomatically) setTimeout(checkUpdates, 12000);
  setInterval(() => { if (settings.checkUpdatesAutomatically) checkUpdates(); }, 6 * 60 * 60 * 1000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function register(channel, handler) { ipcMain.handle('launcher:' + channel, async (event, ...args) => { verifySender(event); return handler(...args); }); }
register('get-state', () => snapshot());
register('refresh-catalog', () => loadCatalog());
register('install', id => installGame(id));
register('launch', id => launchGame(id));
register('uninstall', id => uninstallGame(id));
register('check-update', () => checkUpdates());
register('download-update', async () => {
  if (!app.isPackaged || updaterState.status !== 'available') throw new Error('Es ist kein Launcher-Update verfügbar.');
  await autoUpdater.downloadUpdate(); return { ok: true };
});
register('restart-update', () => {
  if (updaterState.status !== 'downloaded') throw new Error('Noch kein Update heruntergeladen.');
  setImmediate(() => autoUpdater.quitAndInstall(false, true)); return { ok: true };
});
register('set-settings', async patch => {
  if (!patch || typeof patch.checkUpdatesAutomatically !== 'boolean') throw new Error('Ungültige Einstellung');
  settings.checkUpdatesAutomatically = patch.checkUpdatesAutomatically;
  await writeJsonAtomic(settingsPath(), settings);
  return settings;
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
