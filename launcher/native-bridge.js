/* Tauri 2 bridge. Only exposed by the Rust desktop build, never on mobile/browser. */
(() => {
  'use strict';
  const native = window.__TAURI__;
  if (!native || !native.core || !native.core.invoke) return;
  const invoke = native.core.invoke;
  window.novalab = {
    pickGame: () => invoke('pick_game'),
    launchGame: ({path}) => invoke('launch_game', {path}),
    openExternal: (url) => invoke('open_external', {url}),
    downloadGame: ({gameId,url,filename}) => invoke('download_game', {gameId,url,filename}),
    cancelDownload: (id) => invoke('cancel_download', {id}),
    installedGames: () => invoke('installed_games'),
    checkLauncherUpdate: () => invoke('check_launcher_update'),
    installLauncherUpdate: () => invoke('install_launcher_update'),
    installGameVersion: ({gameId,version,url,sha256,entry,gameFormat}) => invoke('install_game_version',{gameId,version,url,sha256,entry,gameFormat}),
    launchInstalledGame: (gameId) => invoke('launch_installed_game',{gameId}),
    onDownloadProgress: (callback) => native.event.listen('novalab:download-progress', (event) => callback(event.payload))
  };
})();
