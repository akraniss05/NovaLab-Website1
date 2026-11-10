'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed=new Set(['list','detail','save','upload-media','media-remove','choose-build','upload-build','publish','refresh-catalog']);
contextBridge.exposeInMainWorld('studio',{
 invoke(name,...args){
  if(!allowed.has(name))return Promise.reject(new Error('Unbekannte Studio-Aktion.'));
  return ipcRenderer.invoke('studio:'+name,...args);
 }
});