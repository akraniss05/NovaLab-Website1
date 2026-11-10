'use strict';

/** Deterministic, single-flight state machine around electron-updater. */
function createUpdateController({ updater, app, notify, clock = () => new Date(), platform = process.platform }) {
  let state = { status: 'idle', message: 'Bereit zur Updateprüfung.', progress: 0, version: null, checkedAt: null };
  let checkPromise = null;
  let downloadPromise = null;
  let restartRequested = false;
  const snapshot = () => ({ ...state });
  const set = patch => { state = { ...state, ...patch }; notify(snapshot()); return snapshot(); };
  const niceError = error => {
    const detail = String(error?.message || error || 'Unbekannter Fehler');
    if (/404|not found|latest\.yml/i.test(detail)) return 'Keine Update-Metadaten erreichbar. Du kannst den Installer unter GitHub Releases laden.';
    if (/timeout|ENOTFOUND|ECONN|network|internet|fetch failed|certificate|TLS/i.test(detail)) return 'Keine Verbindung zum Update-Server. Bitte Internetverbindung prüfen und erneut versuchen.';
    if (/sha512|checksum|signature|verify|hash/i.test(detail)) return 'Die Update-Datei konnte nicht sicher überprüft werden. Bitte den offiziellen Installer verwenden.';
    return `Update fehlgeschlagen: ${detail.slice(0, 160)}`;
  };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.on('checking-for-update', () => {
    if (downloadPromise || state.status === 'downloaded') return;
    set({ status: 'checking', message: 'Prüfe GitHub Releases auf neue Versionen …', progress: 0 });
  });
  updater.on('update-available', info => {
    if (state.status === 'downloaded' || downloadPromise) return;
    set({ status: 'available', message: `NovaLab Launcher v${info.version} ist verfügbar.`, version: info.version, progress: 0, checkedAt: clock().toISOString() });
  });
  updater.on('update-not-available', () => {
    if (state.status === 'downloaded' || downloadPromise) return;
    set({ status: 'current', message: 'Du nutzt bereits die neueste Version.', progress: 0, checkedAt: clock().toISOString() });
  });
  updater.on('download-progress', info => {
    set({ status: 'downloading', message: 'Launcher-Update wird heruntergeladen …', progress: Math.min(100, Math.max(0, Math.round(info.percent || 0))), transferred: info.transferred || 0, total: info.total || 0 });
  });
  updater.on('update-downloaded', info => {
    set({ status: 'downloaded', message: 'Download abgeschlossen. Neustarten, um das Update zu installieren.', version: info.version || state.version, progress: 100 });
  });
  updater.on('error', error => {
    if (restartRequested) return;
    set({ status: 'error', message: niceError(error), progress: 0 });
  });
  async function check() {
    if (!app.isPackaged) return set({ status: 'development', message: 'Im Entwicklungsmodus nicht verfügbar. Bitte einen Windows-Installer verwenden.' });
    if (platform !== 'win32') return set({ status: 'unsupported', message: 'Automatische Installation wird derzeit nur unter Windows unterstützt.' });
    if (downloadPromise || state.status === 'downloaded') return snapshot();
    if (checkPromise) return checkPromise;
    set({ status: 'checking', message: 'Prüfe GitHub Releases auf neue Versionen …', progress: 0 });
    checkPromise = (async () => {
      try {
        const result = await updater.checkForUpdates();
        if (state.status === 'checking') {
          const found = result?.updateInfo?.version;
          set({ status: found && found !== app.getVersion() ? 'available' : 'current', version: found || null, message: found && found !== app.getVersion() ? `NovaLab Launcher v${found} ist verfügbar.` : 'Du nutzt bereits die neueste Version.', checkedAt: clock().toISOString() });
        }
        return snapshot();
      } catch (error) { return set({ status: 'error', message: niceError(error), progress: 0, checkedAt: clock().toISOString() }); }
      finally { checkPromise = null; }
    })();
    return checkPromise;
  }
  async function download() {
    if (!app.isPackaged || state.status === 'development') throw new Error('Nur in der installierten Launcher-Version verfügbar.');
    if (state.status === 'downloaded') return snapshot();
    if (downloadPromise) return downloadPromise;
    if (checkPromise) await checkPromise;
    if (state.status !== 'available') throw new Error('Kein neues Launcher-Update gefunden. Bitte zuerst prüfen.');
    set({ status: 'downloading', message: 'Update-Download startet …', progress: 0 });
    downloadPromise = (async () => {
      try {
        await updater.downloadUpdate();
        return snapshot();
      } catch (error) { return set({ status: 'error', message: niceError(error), progress: 0 }); }
      finally { downloadPromise = null; }
    })();
    return downloadPromise;
  }
  function restart() {
    if (state.status !== 'downloaded') throw new Error('Bitte erst das Update vollständig herunterladen.');
    if (restartRequested) return { ok: true };
    restartRequested = true;
    set({ status: 'installing', message: 'Launcher wird zur Installation neu gestartet …' });
    setImmediate(() => updater.quitAndInstall(false, true));
    return { ok: true };
  }
  return { check, download, restart, snapshot };
}

module.exports = { createUpdateController };
