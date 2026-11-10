'use strict';

const api = window.novalab;
const PAGE_IDS = ['home', 'discover', 'library', 'downloads', 'settings', 'account', 'admin'];
let state = { games: [], installed: {}, settings: {}, update: {}, source: 'local', activeDownload: null };
let page = 'home';
let search = '';
let filter = 'all';
let confirmId = null;
let toastTimeout;
let download = null;
let detailId = null;
let favorites = [];
try { favorites = JSON.parse(localStorage.getItem('novalab:favorites') || '[]').filter(x => typeof x === 'string').slice(0, 100); } catch { favorites = []; }
const versionNumber = v => String(v || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
function isNewerVersion(latest, current) {
  const a=versionNumber(latest), b=versionNumber(current);
  for (let i=0;i<3;i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
const RELEASE_URL = 'https://github.com/akraniss05/NovaLab-Website1/releases/latest';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
const phaseLabel = value => ({ starting: 'Download wird vorbereitet …', downloading: 'Spieldateien werden heruntergeladen …', extracting: 'Dateien werden entpackt …', error: 'Installation fehlgeschlagen' }[value] || 'Bereit');
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = String(message || 'Unbekannter Fehler');
  el.classList.toggle('error', !!isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), 5300);
}
async function invoke(action, ...args) {
  try { return await api.invoke(action, ...args); }
  catch (e) { toast(e.message || 'Die Aktion ist fehlgeschlagen.', true); return null; }
}
function selectPage(name) {
  if (!PAGE_IDS.includes(name)) return;
  if (name === 'admin' && (state.account?.role !== 'admin' || state.account?.mustChangePassword)) { toast('Admin-Zugriff erst nach Passwortänderung möglich.', true); return selectPage('account'); }
  page = name;
  for (const id of PAGE_IDS) $('page-' + id).classList.toggle('hidden', id !== name);
  document.querySelectorAll('.nav-item[data-page],.top-nav [data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === name));
  $('scrollArea').scrollTo({ top: 0, behavior: 'instant' });
  if (name === 'admin') loadAdminGames();
  if (name === 'library') renderLibrary();
  if (name === 'discover') renderDiscover();
  if (name === 'downloads') renderDownload();
  if (name === 'settings') renderSettings();
  if (name === 'account') renderAccount();
}
function iconFor(game) {
  if (game.id.includes('beat')) return '♫';
  if (game.id.includes('academy')) return '</>';
  if (game.release?.format === 'html') return '✧';
  return game.type === 'tool' ? '✧' : '✦';
}
function cardAction(game) {
  const entry = state.installed[game.id];
  if (entry) {
    if (game.release && isNewerVersion(game.release.version, entry.version)) return `<button class="card-button update" data-action="install" data-id="${escapeHTML(game.id)}">Update ↓</button>`;
    return `<button class="card-button installed" data-action="launch" data-id="${escapeHTML(game.id)}">▶ Spielen</button>`;
  }
  if (game.release && state.platform === 'win32') return `<button class="card-button" data-action="install" data-id="${escapeHTML(game.id)}">${game.release.format === 'html' ? 'Mini-Spiel laden' : 'Installieren'} ↓</button>`;
  if (game.website) return `<button class="card-button" data-action="visit" data-id="${escapeHTML(game.id)}">Entdecken ↗</button>`;
  return '<button class="card-button" type="button" disabled>Demnächst</button>';
}
function gameCard(game, options = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(game.accent) ? game.accent : '#8f73ff';
  const subtitle = game.subtitle || game.description;
  const tags = (game.tags || []).slice(0, 2).map(t => `<span class="tag">${escapeHTML(t)}</span>`).join('');
  return `<article class="project-card"><button type="button" data-action="details" data-id="${escapeHTML(game.id)}" class="project-art" style="--accent:${color}" aria-label="${escapeHTML(game.title)} – Details öffnen"><span class="card-art-symbol">${escapeHTML(iconFor(game))}</span><span class="status-pill">${escapeHTML(game.status)}</span><span class="art-corner">NOVALAB / ${game.type === 'game' ? 'GAMES' : 'STUDIOS'}</span></button><div class="project-card-body"><div class="project-kind">${game.type === 'game' ? 'GAME / NOVALAB' : 'CREATIVE / NOVALAB'}</div><button class="card-title-button" data-action="details" data-id="${escapeHTML(game.id)}" type="button"><h3>${escapeHTML(game.title)}</h3></button><p>${escapeHTML(subtitle)}</p><div class="card-footer"><div class="tag-list">${tags}</div><div class="card-card-actions">${options.uninstall ? `<button class="card-more" data-action="uninstall" data-id="${escapeHTML(game.id)}" title="Deinstallieren" aria-label="${escapeHTML(game.title)} deinstallieren">✕</button>` : ''}${cardAction(game)}</div></div></div></article>`;
}
function libraryItems() {
  return Object.entries(state.installed || {}).map(([id, install]) => {
    const current=state.games.find(g=>g.id===id);
    return current || { id, title: id.replace(/-/g,' ').replace(/\b\w/g,m=>m.toUpperCase()), subtitle:'Nicht mehr im Store – lokal installiert', description:'Dieses Spiel ist weiterhin auf deinem PC vorhanden.', type:'game', status:'Lokal installiert', tags:[], accent:'#7182ae', release:null };
  });
}
function renderQuickLibrary() {
  const found = libraryItems();
  $('sidebarGameCount').textContent = String(found.length);
  $('quickLibrary').innerHTML = found.length ? found.slice(0,15).map(g => `<button type="button" class="quick-game" data-action="details" data-id="${escapeHTML(g.id)}"><span class="quick-dot"></span><span>${escapeHTML(g.title)}</span><small>${isNewerVersion(g.release?.version,state.installed[g.id]?.version) ? '↻' : '▶'}</small></button>`).join('') : '<span class="quick-empty">Installierte Spiele erscheinen hier.</span>';
}
function openDetails(id) {
  const game = state.games.find(g=>g.id===id) || libraryItems().find(g=>g.id===id);
  if (!game) return toast('Spiel nicht gefunden.',true);
  detailId = id;
  const installed = state.installed[id];
  const accent = /^#[0-9a-f]{6}$/i.test(game.accent||'') ? game.accent : '#8771ed';
  const tags = (game.tags || []).map(t=>`<span class="tag">${escapeHTML(t)}</span>`).join('');
  const version = game.release?.version || (installed?.version || 'Noch kein Release');
  $('detailsContent').innerHTML = `<div class="details-hero" style="--accent:${accent}"><div class="details-art-symbol">${escapeHTML(iconFor(game))}</div><div class="details-hero-shade"><span class="eyebrow">NOVALAB STUDIOS / ${escapeHTML(game.type.toUpperCase())}</span><h2>${escapeHTML(game.title)}</h2><div class="details-tags">${tags}</div></div></div><div class="details-body"><div class="details-info"><span class="eyebrow">DAS SPIEL</span><p>${escapeHTML(game.description || game.subtitle || 'Ein Projekt von NovaLab Studios.')}</p><div class="details-meta"><span>STATUS <strong>${escapeHTML(game.status)}</strong></span><span>VERSION <strong>${escapeHTML(version)}</strong></span><span>PLATTFORM <strong>${game.release?.format === 'html' ? 'HTML5 / Windows' : 'Windows / Web'}</strong></span></div></div><div class="details-side"><h3>Deine Bibliothek</h3><p>${installed ? 'Dieses Spiel ist lokal installiert.' : game.release ? 'Kostenlos und auf Wunsch installierbar.' : 'Eine Veröffentlichung ist in Planung.'}</p>${cardAction(game)}${installed ? `<button class="secondary-button" data-action="uninstall" data-id="${escapeHTML(id)}" type="button">Deinstallieren</button>` : ''}<button class="secondary-button" data-action="close-details" type="button">Schließen</button></div></div>`;
  $('detailsOverlay').classList.remove('hidden');
}
function closeDetails() { detailId=null; $('detailsOverlay').classList.add('hidden'); }
function renderHome() {
  $('featuredGrid').innerHTML = [...state.games].sort((a,b)=>Number(!!b.release)-Number(!!a.release)).slice(0, 3).map(g => gameCard(g)).join('') || '<div class="empty">Noch keine Projekte vorhanden.</div>';
  $('libraryCount').textContent = Object.keys(state.installed).length;
  $('homeLibraryMessage').textContent = Object.keys(state.installed).length ? `${Object.keys(state.installed).length} installierte Spiele · Deine Sammlung ist bereit.` : 'Dein nächstes Lieblingsspiel wartet schon im Store.';
  renderQuickLibrary();
}
function renderDiscover() {
  const found = state.games.filter(g => (filter === 'all' || g.type === filter || (filter === 'mini' && g.release?.format === 'html')) && [g.title, g.subtitle, g.description, ...(g.tags || [])].join(' ').toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')));
  $('discoverGrid').innerHTML = found.map(g => gameCard(g)).join('');
  $('noResults').classList.toggle('hidden', found.length > 0);
}
function renderLibrary() {
  const found = libraryItems();
  $('librarySummary').textContent = `${found.length} installiert${found.length === 1 ? 'es Spiel' : 'e Spiele'}`;
  $('libraryGrid').innerHTML = found.map(g => gameCard(g, { uninstall: true })).join('');
  $('emptyLibrary').classList.toggle('hidden', found.length > 0);
}
function renderDownload() {
  const data = download;
  const isActive = data && ['starting', 'downloading', 'extracting'].includes(data.phase);
  $('downloadProgressBox').classList.toggle('hidden', !isActive);
  $('downloadDescription').textContent = isActive ? 'Eine Installation wird gerade verarbeitet.' : 'Derzeit werden keine Spieldateien heruntergeladen.';
  if (isActive) {
    $('downloadGame').textContent = state.games.find(g => g.id === data.id)?.title || data.id;
    $('downloadPercent').textContent = data.phase === 'extracting' ? 'Entpacken' : data.percent + '%';
    $('downloadBar').style.width = data.percent + '%';
    $('downloadPhase').textContent = phaseLabel(data.phase) + (data.total ? ' · ' + (data.bytes / 1048576).toFixed(1) + ' / ' + (data.total / 1048576).toFixed(1) + ' MB' : '');
  }
}
function renderUpdateWidgets() {
  const update=state.update||{};
  const busy=['checking','downloading','installing'].includes(update.status);
  const available=update.status==='available', ready=update.status==='downloaded';
  const progress=update.status==='downloading';
  const statusName={idle:'BEREIT',checking:'SUCHE',available:'UPDATE VERFÜGBAR',downloading:'DOWNLOAD',downloaded:'BEREIT ZUM INSTALLIEREN',installing:'INSTALLATION',current:'AKTUELL',error:'FEHLER',development:'DEV',unsupported:'NICHT VERFÜGBAR'};
  $('appVersion').textContent='v'+(state.version||'0.4.0');
  $('bottomVersion').textContent='v'+(state.version||'0.4.0');
  $('autoUpdateCheck').checked=!!state.settings?.checkUpdatesAutomatically;
  $('updateDescription').textContent=update.message||'Noch nicht geprüft.';
  $('downloadsUpdateStatus').textContent=update.message||'Noch nicht geprüft.';
  $('updateChecked').textContent=update.checkedAt ? 'Zuletzt geprüft: '+new Intl.DateTimeFormat('de-DE',{dateStyle:'short',timeStyle:'short'}).format(new Date(update.checkedAt)) : 'Noch keine Prüfung durchgeführt.';
  $('updateStateBadge').textContent=statusName[update.status]||'BEREIT';
  $('updateStateBadge').className='update-badge '+(update.status||'idle');
  $('downloadUpdateBtn').classList.toggle('hidden',!available);
  $('downloadPanelUpdateBtn').classList.toggle('hidden',!available);
  $('restartUpdateBtn').classList.toggle('hidden',!ready);
  $('downloadPanelRestartBtn').classList.toggle('hidden',!ready);
  $('updateProgressBox').classList.toggle('hidden',!progress);
  $('launcherDownloadProgress').classList.toggle('hidden',!progress);
  const pct=Math.min(100,Math.max(0,Number(update.progress)||0));
  $('updateProgressBar').style.width=pct+'%';
  $('launcherDownloadBar').style.width=pct+'%';
  document.querySelectorAll('[data-action="check-update"]').forEach(btn=>{ btn.disabled=busy||ready; btn.textContent=update.status==='checking'?'Prüfung läuft …':'Jetzt nach Updates suchen ↻'; });
  $('topUpdateButton').classList.toggle('hidden',!available&&!ready&&!progress);
  $('topUpdateLabel').textContent=ready?'INSTALLIEREN':progress?`${pct}%`:'UPDATE';
  $('bottomStatus').textContent=progress?`Launcher-Update: ${pct}%`:ready?'Neuer Launcher bereit – Neustart erforderlich':download?.phase && download.phase!=='error'?phaseLabel(download.phase):'Bereit für neue Abenteuer';
}
function renderSettings() { renderUpdateWidgets(); }
function renderAccount() {
  const a = state.account;
  $('accountLoggedOut').classList.toggle('hidden', !!a);
  $('accountLoggedIn').classList.toggle('hidden', !a);
  $('adminNav').classList.toggle('hidden', !(a && a.role === 'admin' && !a.mustChangePassword));
  $('sidebarUsername').textContent = a?.username || 'Gast';
  $('sidebarAvatar').textContent = (a?.username || 'NL').slice(0, 2).toUpperCase();
  $('topUsername').textContent = a?.username || 'GAST';
  $('topAvatar').textContent = (a?.username || 'NL').slice(0,2).toUpperCase();
  $('sidebarRole').textContent = a ? a.role === 'admin' ? 'Administrator' : 'Community-Mitglied' : 'Anmelden oder registrieren';
  if (a) {
    $('profileUsername').textContent = a.username;
    $('profileRole').textContent = a.role === 'admin' ? 'NovaLab Studios Administrator' : 'NovaLab Community';
    $('passwordWarning').classList.toggle('hidden', !a.mustChangePassword);
  }
}
async function loadAdminGames() {
  if (!state.account || state.account.role !== 'admin' || state.account.mustChangePassword) return;
  const data = await invoke('admin-games');
  if (!data) return;
  const entries = data.games || [];
  $('adminGamesList').innerHTML = entries.length ? entries.map(g => `<article class="admin-game-row"><div><strong>${escapeHTML(g.title)}</strong><small>${escapeHTML(g.id)} · ${escapeHTML(g.version)}</small></div><button type="button" class="secondary-button" data-action="game-visibility" data-id="${escapeHTML(g.id)}" data-published="${g.published ? 'true' : 'false'}">${g.published ? 'Ausblenden' : 'Veröffentlichen'}</button></article>`).join('') : '<p class="hint">Noch keine hochgeladenen Spiele.</p>';
}
function renderAll() {
  renderHome(); renderDiscover(); renderLibrary(); renderDownload(); renderSettings(); renderAccount();
  renderQuickLibrary();
  const online = state.source === 'online';
  $('connectionDot').classList.toggle('online', online);
  $('connectionText').textContent = online ? 'Online verbunden' : 'Lokaler Projektkatalog';
}
async function act(action, id, element) {
  if (action === 'details') return openDetails(id);
  if (action === 'close-details') return closeDetails();
  if (action === 'open-releases') return invoke('open-link', RELEASE_URL);
  const game = state.games.find(g => g.id === id);
  if (['install', 'launch', 'uninstall', 'visit'].includes(action) && !game && !state.installed[id]) return toast('Projekt nicht gefunden.', true);
  if (action === 'visit') return invoke('open-link', game.website);
  if (action === 'install') {
    closeDetails();
    selectPage('downloads');
    const result = await invoke('install', id);
    if (result) { toast(game.title + ' wurde installiert.'); state.installed = (await api.invoke('get-state')).installed; renderAll(); }
  }
  if (action === 'launch') await invoke('launch', id);
  if (action === 'uninstall') {
    closeDetails();
    confirmId = id;
    $('confirmText').textContent = 'Alle lokal installierten Dateien von „' + (game?.title || id) + '“ werden gelöscht. Deine anderen Spiele bleiben erhalten.';
    $('confirmOverlay').classList.remove('hidden');
  }
  if (action === 'open-academy') return invoke('open-academy');
  if (action === 'open-website') await invoke('open-link', 'https://akraniss05.github.io/NovaLab-Website1/');
  if (action === 'open-discord') await invoke('open-link', 'https://discord.gg/SZhYa6Nnmy');
  if (action === 'logout-account') { const x = await invoke('logout-account'); if (x) { state.account = null; selectPage('account'); renderAll(); toast('Du bist abgemeldet.'); } }
  if (action === 'choose-game-file') { const f = await invoke('choose-game-file'); if (f && !f.canceled) $('uploadFileName').textContent = f.name + ' · ' + (f.size / 1024).toFixed(0) + ' KB'; }
  if (action === 'load-admin-games') await loadAdminGames();
  if (action === 'game-visibility') { const btn = element; const x = await invoke('game-visibility', { id, published: btn?.dataset.published !== 'true' }); if (x) { await invoke('refresh-catalog'); await loadAdminGames(); toast('Sichtbarkeit aktualisiert.'); } }
  if (action === 'refresh') { const data = await invoke('refresh-catalog'); if (data) { state.games = data.games; state.source = data.source; renderAll(); toast('Projektkatalog wurde aktualisiert.'); } }
  if (action === 'check-update') await invoke('check-update');
  if (action === 'download-update') await invoke('download-update');
  if (action === 'restart-update') await invoke('restart-update');
}
async function confirmUninstall() {
  if (!confirmId) return;
  const id = confirmId;
  confirmId = null;
  $('confirmOverlay').classList.add('hidden');
  const result = await invoke('uninstall', id);
  if (result) { state.installed = (await api.invoke('get-state')).installed; renderAll(); toast('Spiel wurde deinstalliert.'); }
}
function handleEvent(event) {
  if (!event || !event.type) return;
  if (event.type === 'auth') { state.account = event.account; renderAccount(); if (page === 'admin' && (!state.account || state.account.mustChangePassword)) selectPage('account'); }
  if (event.type === 'catalog') { state.games = event.games; state.source = event.source; renderAll(); }
  if (event.type === 'installed') { state.installed = event.installed; renderAll(); }
  if (event.type === 'updater') {
    state.update = event.update;
    renderUpdateWidgets();
    if (state.update.status === 'available' || state.update.status === 'downloaded') toast(state.update.message);
  }
  if (event.type === 'download') {
    download = event;
    renderDownload();
    if (event.phase === 'error') toast(event.error || 'Download fehlgeschlagen.', true);
    $('bottomStatus').textContent = phaseLabel(event.phase);
  }
  if (event.type === 'download-idle') {
    download = null; renderDownload(); renderUpdateWidgets();
  }
  if (event.type === 'error') toast(event.message, true);
}

document.addEventListener('click', async ev => {
  const windowButton = ev.target.closest('[data-window]');
  if (windowButton) return invoke('window', windowButton.dataset.window);
  const pageButton = ev.target.closest('[data-page]');
  if (pageButton) return selectPage(pageButton.dataset.page);
  const filterButton = ev.target.closest('[data-filter]');
  if (filterButton) { filter = filterButton.dataset.filter; document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('selected', btn === filterButton)); return renderDiscover(); }
  const actionButton = ev.target.closest('[data-action]');
  if (actionButton) return act(actionButton.dataset.action, actionButton.dataset.id, actionButton);
});
$('loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = new FormData(ev.currentTarget);
  const result = await invoke('login-account', { username: String(form.get('username')), password: String(form.get('password')) });
  if (result) { state.account = result.account; ev.currentTarget.reset(); renderAccount(); toast('Willkommen, ' + result.account.username + '!'); if (result.account.mustChangePassword) toast('Bitte zuerst dein Startpasswort ändern.'); }
});
$('registerForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = new FormData(ev.currentTarget);
  if (form.get('password') !== form.get('repeat')) return toast('Die Passwörter stimmen nicht überein.', true);
  const data = { username: String(form.get('username')), password: String(form.get('password')) };
  const result = await invoke('register-account', data);
  if (result) { ev.currentTarget.reset(); toast('Account erstellt! Melde dich jetzt links an.'); }
});
$('changePasswordForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = new FormData(ev.currentTarget);
  if (form.get('newPassword') !== form.get('repeat')) return toast('Die neuen Passwörter stimmen nicht überein.', true);
  const data = { oldPassword: String(form.get('oldPassword')), newPassword: String(form.get('newPassword')) };
  const result = await invoke('change-account-password', data);
  if (result) { state.account = null; ev.currentTarget.reset(); renderAccount(); toast('Passwort geändert. Bitte erneut anmelden.'); }
});
$('gameUploadForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const values = new FormData(ev.currentTarget);
  const btn = $('publishGameBtn');
  btn.disabled = true; btn.textContent = 'Spiel wird hochgeladen …';
  try {
    const result = await invoke('publish-game', Object.fromEntries(['title', 'slug', 'version', 'description'].map(k => [k, String(values.get(k) || '')])));
    if (result) { toast('Spiel veröffentlicht: ' + result.game.title); await loadAdminGames(); $('uploadFileName').textContent = 'Keine Datei ausgewählt'; ev.currentTarget.reset(); }
  } finally { btn.disabled = false; btn.textContent = 'Spiel für alle veröffentlichen ↓'; }
});
$('searchInput').addEventListener('input', ev => { search = ev.target.value; renderDiscover(); });
$('autoUpdateCheck').addEventListener('change', async ev => {
  const result = await invoke('set-settings', { checkUpdatesAutomatically: ev.target.checked });
  if (result) state.settings = result;
  renderSettings();
});
$('confirmUninstall').addEventListener('click', confirmUninstall);
$('cancelUninstall').addEventListener('click', () => { confirmId = null; $('confirmOverlay').classList.add('hidden'); });
$('confirmOverlay').addEventListener('click', ev => { if (ev.target.id === 'confirmOverlay') { confirmId = null; $('confirmOverlay').classList.add('hidden'); } });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeDetails(); confirmId = null; $('confirmOverlay').classList.add('hidden'); } });
$('detailsOverlay').addEventListener('click',ev => { if (ev.target === $('detailsOverlay')) closeDetails(); });
$('todayDate').textContent = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
api.onEvent(handleEvent);
(async () => {
  const initial = await invoke('get-state');
  if (initial) { state = initial; renderAll(); }
})();
