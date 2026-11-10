'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['get-state', 'refresh-catalog', 'install', 'launch', 'uninstall', 'check-update', 'download-update', 'restart-update', 'set-settings', 'open-link', 'window', 'register-account', 'login-account', 'logout-account', 'change-account-password', 'open-academy', 'choose-game-file', 'publish-game', 'admin-games', 'game-visibility']);
contextBridge.exposeInMainWorld('novalab', {
  invoke: (name, ...args) => {
    if (!allowed.has(name)) return Promise.reject(new Error('Unbekannte Aktion'));
    return ipcRenderer.invoke('launcher:' + name, ...args);
  },
  onEvent(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('launcher:event', listener);
    return () => ipcRenderer.removeListener('launcher:event', listener);
  }
});
