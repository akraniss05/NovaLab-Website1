'use strict';

const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const extractZip = require('extract-zip');

const WEBSITE = 'https://akraniss05.github.io/NovaLab-Website1/';
const DISCORD = 'https://discord.gg/SZhYa6Nnmy';
const REMOTE_CATALOG = 'https://raw.githubusercontent.com/akraniss05/NovaLab-Website1/main/launcher/catalog.json';
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024;
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
  if (typeof release.entry !== 'string' || !/^[a-zA-Z0-9_ .()/-]+\.exe$/i.test(release.entry) || release.entry.startsWith('/') || release.entry.split('/').includes('..')) return false;
  try {
    const url = new URL(release.url);
    return url.protocol === 'https:' && url.hostname === 'github.com' && /^\/akraniss05\/[a-zA-Z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+\.zip$/i.test(decodeURI(url.pathname)) && !url.username && !url.password && !url.search && !url.hash;
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
      entry: item.release.entry
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
async function downloadArchive(url, dest, expectedHash, id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  let total = 0;
  const hash = crypto.createHash('sha256');
  let lastProgress = 0;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'NovaLab-Launcher' } });
    if (!response.ok || !response.body) throw new Error('Download fehlgeschlagen (HTTP ' + response.status + ')');
    const contentTypeLength = Number(response.headers.get('content-length')) || 0;
    if (contentTypeLength > MAX_ARCHIVE_BYTES) throw new Error('Datei überschreitet die Größenbegrenzung');
    const progress = new Transform({
      transform(chunk, enc, cb) {
        total += chunk.length;
        if (total > MAX_ARCHIVE_BYTES) return cb(new Error('Download ist zu groß'));
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
async function installGame(id) {
  const game = gameById(id);
  if (!game || !game.release) throw new Error('Für dieses Projekt wurde noch kein Download veröffentlicht.');
  if (process.platform !== 'win32') throw new Error('Der Spiele-Installer unterstützt derzeit Windows.');
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
    await downloadArchive(release.url, zipPath, release.sha256, id);
    notify('download', { id, phase: 'extracting', percent: 100 });
    await fsp.mkdir(unpacked, { recursive: true });
    await extractZip(zipPath, { dir: unpacked });
    const entry = safeEntry(unpacked, release.entry);
    const realRoot = await fsp.realpath(unpacked);
    const realEntry = await fsp.realpath(entry);
    if (!realEntry.startsWith(realRoot + path.sep) || !(await fsp.stat(realEntry)).isFile()) throw new Error('Ungültige EXE im Spielarchiv');
    if (fs.existsSync(finalPath)) { await fsp.rename(finalPath, backupPath); backedUp = true; }
    await fsp.rename(unpacked, finalPath);
    swapped = true;
    installed[id] = { version: release.version, entry: release.entry, installedAt: new Date().toISOString() };
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
  if (!actualTarget.startsWith(actualBase + path.sep) || !(await fsp.stat(actualTarget)).isFile() || !/\.exe$/i.test(actualTarget)) throw new Error('Spieldatei ist ungültig.');
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
