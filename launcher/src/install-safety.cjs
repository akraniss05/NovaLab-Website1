'use strict';
// Pure filesystem safety guards: intentionally independent of Electron.
const fs = require('node:fs/promises');
const path = require('node:path');

const GAME_ID=/^[a-z0-9][a-z0-9-]{1,59}$/;
const VERSION=/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.-]+)?$/;

/**
 * Refuse to touch a game directory unless its dedicated installation marker
 * proves it was created by NovaLab for the exact installed version.
 * Missing markers (including legacy installs) require user-guided recovery.
 * Never guess ownership of an existing directory.
 */
async function assertManagedInstall(root,id,expectedVersion) {
  if(typeof root!=='string'||!root||!GAME_ID.test(id||'')||!VERSION.test(expectedVersion||'')) {
    throw new Error('Ungültige Installationsangaben. Dateien bleiben unverändert.');
  }
  const base=path.resolve(root);
  const destination=path.resolve(base,id);
  if(path.dirname(destination)!==base)throw new Error('Spielverzeichnis liegt außerhalb des Installationsordners.');
  const stats=await fs.lstat(destination).catch(()=>null);
  if(!stats||!stats.isDirectory()||stats.isSymbolicLink())throw new Error('Spielverzeichnis fehlt oder ist ein Link.');
  const resolvedRoot=await fs.realpath(base);
  const resolvedDestination=await fs.realpath(destination);
  if(resolvedDestination!==path.join(resolvedRoot,id))throw new Error('Spielverzeichnis verweist auf fremde Dateien.');
  const markerPath=path.join(destination,'.novalab-install.json');
  const markerStats=await fs.lstat(markerPath).catch(()=>null);
  if(!markerStats?.isFile()||markerStats.isSymbolicLink()) {
    throw new Error('Installationsmarkierung fehlt. Fremde Dateien werden nicht gelöscht oder überschrieben.');
  }
  let marker;
  try {
    const raw=await fs.readFile(markerPath,'utf8');
    if(raw.length>4096)throw new Error('Markierung zu groß');
    marker=JSON.parse(raw);
  } catch {throw new Error('Installationsmarkierung beschädigt. Dateien bleiben unverändert.');}
  if(marker?.id!==id || marker?.version!==expectedVersion) {
    throw new Error('Installationsmarkierung stimmt nicht überein. Dateien bleiben unverändert.');
  }
  return destination;
}

module.exports={assertManagedInstall};
