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
  page = name;
  for (const id of PAGE_IDS) $('page-' + id).classList.toggle('hidden', id !== name);
  document.querySelectorAll('[data-page].nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.page === name));
  $('scrollArea').scrollTo({ top: 0, behavior: 'instant' });
  if (name === 'admin' && (state.account?.role !== 'admin' || state.account?.mustChangePassword)) { toast('Admin-Zugriff erst nach Passwortänderung möglich.', true); return selectPage('account'); }
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
    if (game.release && entry.version !== game.release.version) return `<button class="card-button update" data-action="install" data-id="${escapeHTML(game.id)}">Update ↓</button>`;
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
  return `<article class="project-card"><div class="project-art" style="--accent:${color}"><span class="card-art-symbol">${escapeHTML(iconFor(game))}</span><span class="status-pill">${escapeHTML(game.status)}</span><span class="art-corner">NOVALAB / ${game.type === 'game' ? 'GAMES' : 'STUDIOS'}</span></div><div class="project-card-body"><div class="project-kind">${game.type === 'game' ? 'GAME / NOVALAB' : 'CREATIVE / NOVALAB'}</div><h3>${escapeHTML(game.title)}</h3><p>${escapeHTML(subtitle)}</p><div class="card-footer"><div class="tag-list">${tags}</div><div class="card-card-actions">${options.uninstall ? `<button class="card-more" data-action="uninstall" data-id="${escapeHTML(game.id)}" title="Deinstallieren" aria-label="${escapeHTML(game.title)} deinstallieren">✕</button>` : ''}${cardAction(game)}</div></div></div></article>`;
}
function renderHome() {
  $('featuredGrid').innerHTML = state.games.slice(0, 3).map(g => gameCard(g)).join('') || '<div class="empty">Noch keine Projekte vorhanden.</div>';
  $('libraryCount').textContent = Object.keys(state.installed).length;
}
function renderDiscover() {
  const found = state.games.filter(g => (filter === 'all' || g.type === filter || (filter === 'mini' && g.release?.format === 'html')) && [g.title, g.subtitle, g.description, ...(g.tags || [])].join(' ').toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')));
  $('discoverGrid').innerHTML = found.map(g => gameCard(g)).join('');
  $('noResults').classList.toggle('hidden', found.length > 0);
}
function renderLibrary() {
  const found = state.games.filter(g => state.installed[g.id]);
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
function renderSettings() {
  $('appVersion').textContent = 'v' + state.version;
  $('bottomVersion').textContent = 'v' + state.version;
  $('autoUpdateCheck').checked = !!state.settings.checkUpdatesAutomatically;
  $('updateDescription').textContent = state.update.message || (state.packaged ? 'Noch nicht geprüft.' : 'Entwicklungsmodus: Updateprüfung im Installer verfügbar.');
  $('downloadUpdateBtn').classList.toggle('hidden', state.update.status !== 'available');
  $('restartUpdateBtn').classList.toggle('hidden', state.update.status !== 'downloaded');
}
function renderAccount() {
  const a = state.account;
  $('accountLoggedOut').classList.toggle('hidden', !!a);
  $('accountLoggedIn').classList.toggle('hidden', !a);
  $('adminNav').classList.toggle('hidden', !(a && a.role === 'admin' && !a.mustChangePassword));
  $('sidebarUsername').textContent = a?.username || 'Gast';
  $('sidebarAvatar').textContent = (a?.username || 'NL').slice(0, 2).toUpperCase();
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
  const online = state.source === 'online';
  $('connectionDot').classList.toggle('online', online);
  $('connectionText').textContent = online ? 'Online verbunden' : 'Lokaler Projektkatalog';
}
async function act(action, id) {
  const game = state.games.find(g => g.id === id);
  if (['install', 'launch', 'uninstall', 'visit'].includes(action) && !game) return toast('Projekt nicht gefunden.', true);
  if (action === 'visit') return invoke('open-link', game.website);
  if (action === 'install') {
    selectPage('downloads');
    const result = await invoke('install', id);
    if (result) { toast(game.title + ' wurde installiert.'); state.installed = (await api.invoke('get-state')).installed; renderAll(); }
  }
  if (action === 'launch') await invoke('launch', id);
  if (action === 'uninstall') {
    confirmId = id;
    $('confirmText').textContent = 'Alle lokal installierten Dateien von „' + game.title + '“ werden gelöscht. Deine anderen Spiele bleiben erhalten.';
    $('confirmOverlay').classList.remove('hidden');
  }
  if (action === 'open-academy') return invoke('open-academy');
  if (action === 'open-website') await invoke('open-link', 'https://akraniss05.github.io/NovaLab-Website1/');
  if (action === 'open-discord') await invoke('open-link', 'https://discord.gg/SZhYa6Nnmy');
  if (action === 'logout-account') { const x = await invoke('logout-account'); if (x) { state.account = null; selectPage('account'); renderAll(); toast('Du bist abgemeldet.'); } }
  if (action === 'choose-game-file') { const f = await invoke('choose-game-file'); if (f && !f.canceled) $('uploadFileName').textContent = f.name + ' · ' + (f.size / 1024).toFixed(0) + ' KB'; }
  if (action === 'load-admin-games') await loadAdminGames();
  if (action === 'game-visibility') { const btn = document.querySelector('[data-action=game-visibility][data-id= + CSS.escape(id) + ]'); const x = await invoke('game-visibility', { id, published: btn?.dataset.published !== 'true' }); if (x) { await invoke('refresh-catalog'); await loadAdminGames(); toast('Sichtbarkeit aktualisiert.'); } }
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
    renderSettings();
    if (state.update.status === 'available' || state.update.status === 'downloaded') toast(state.update.message);
  }
  if (event.type === 'download') {
    download = event;
    renderDownload();
    if (event.phase === 'error') toast(event.error || 'Download fehlgeschlagen.', true);
    $('bottomStatus').textContent = phaseLabel(event.phase);
  }
  if (event.type === 'download-idle') {
    download = null; renderDownload(); $('bottomStatus').textContent = 'Bereit für neue Abenteuer';
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
  if (actionButton) return act(actionButton.dataset.action, actionButton.dataset.id);
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
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { confirmId = null; $('confirmOverlay').classList.add('hidden'); } });
$('todayDate').textContent = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
api.onEvent(handleEvent);
(async () => {
  const initial = await invoke('get-state');
  if (initial) { state = initial; renderAll(); }
})();
