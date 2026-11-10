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
let libraryMode = "all";
let librarySort = "recent";
let favorites = [];
let savedLibrary = [];
let discoverLimit = 80;
try { favorites = JSON.parse(localStorage.getItem('novalab:favorites') || '[]').filter(x => typeof x === 'string').slice(0, 100); } catch { favorites = []; }
try { savedLibrary = JSON.parse(localStorage.getItem('novalab:library') || '[]').filter(x=>typeof x==='string' && /^[a-z0-9][a-z0-9-]{1,59}$/.test(x)).slice(0,300); } catch { savedLibrary=[]; }
const versionNumber = v => String(v || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
function isNewerVersion(latest, current) {
  const a=versionNumber(latest), b=versionNumber(current);
  for (let i=0;i<3;i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
const RELEASE_URL = 'https://github.com/akraniss05/NovaLab-Website1/releases/latest';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
const phaseLabel = value => ({ queued:'In Warteschlange', downloading:'Lädt herunter', verifying:'Prüfsumme wird überprüft', installing:'Installiert Dateien', complete:'Installiert', paused:'Pausiert', failed:'Fehlgeschlagen' }[value] || 'Bereit');
const readableSize = bytes => Number.isFinite(bytes) ? (bytes < 1048576 ? (bytes / 1024).toFixed(1)+' KB' : (bytes / 1048576).toFixed(1)+' MB') : '–';
const readableTime = sec => Number.isFinite(sec) && sec >= 0 ? Math.floor(sec / 60) + 'm ' + Math.floor(sec % 60) + 's' : '–';
const activeTask = id => (state.downloads||[]).find(x=>x.id===id && !['complete','failed'].includes(x.phase));
function saveLibrary(){try{localStorage.setItem('novalab:library',JSON.stringify(savedLibrary));}catch{}}
function libraryHas(id){return savedLibrary.includes(id)||!!state.installed?.[id];}
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
  const active = activeTask(game.id);
  if (active) return `<button class="card-button update" type="button" data-page="downloads">${active.phase === 'paused' ? 'Pausiert' : active.phase === 'queued' ? 'Warteschlange' : 'Download läuft'} ↓</button>`;
  const entry = state.installed[game.id];
  if (entry) {
    if (game.release && isNewerVersion(game.release.version, entry.version)) return `<button class="card-button update" data-action="install" data-id="${escapeHTML(game.id)}">Update ↓</button>`;
    return `<button class="card-button installed" data-action="launch" data-id="${escapeHTML(game.id)}">▶ ${game.type === 'app' ? 'Öffnen' : 'Spielen'}</button>`;
  }
  if (game.release && state.platform === 'win32') return `<button class="card-button" data-action="install" data-id="${escapeHTML(game.id)}">${game.release.format === 'html' ? 'Mini-Spiel laden' : 'Installieren'} ↓</button>`;
  if (game.website) return `<button class="card-button" data-action="visit" data-id="${escapeHTML(game.id)}">Entdecken ↗</button>`;
  return '<button class="card-button" type="button" disabled>Demnächst</button>';
}
function gameCard(game, options = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(game.accent) ? game.accent : '#8f73ff';
  const subtitle = game.subtitle || game.description;
  const tags = (game.tags || []).slice(0, 2).map(t => `<span class="tag">${escapeHTML(t)}</span>`).join('');
  return `<article class="project-card"><button type="button" data-action="details" data-id="${escapeHTML(game.id)}" class="project-art" style="--accent:${color};${game.cover ? 'background-image:linear-gradient(0deg,#0d11218c,#10172533),url('+game.cover+');background-size:cover;background-position:center' : ''}" aria-label="${escapeHTML(game.title)} – Details öffnen"><span class="card-art-symbol">${escapeHTML(iconFor(game))}</span><span class="status-pill">${escapeHTML(game.status)}</span><span class="art-corner">NOVALAB / ${game.type === 'game' ? 'GAMES' : 'STUDIOS'}</span></button><div class="project-card-body"><div class="project-kind">${game.type === 'game' ? 'GAME / NOVALAB' : 'CREATIVE / NOVALAB'}</div><button class="card-title-button" data-action="details" data-id="${escapeHTML(game.id)}" type="button"><h3>${escapeHTML(game.title)}</h3></button><p>${escapeHTML(subtitle)}</p><div class="card-footer"><div class="tag-list">${tags}</div><div class="card-card-actions">${options.uninstall && state.installed[game.id] ? `<button class="card-more" data-action="uninstall" data-id="${escapeHTML(game.id)}" title="Deinstallieren" aria-label="${escapeHTML(game.title)} deinstallieren">✕</button>` : ''}${cardAction(game)}</div></div></div></article>`;
}
function libraryItems() {
  const ids=new Set([...Object.keys(state.installed||{}),...savedLibrary,...favorites]);
  return [...ids].map(id=>{
    const current=(state.games||[]).find(g=>g.id===id);
    return current || (state.installed?.[id] ? {id,title:id.replace(/-/g,' ').replace(/\b\w/g,m=>m.toUpperCase()),subtitle:'Nicht mehr im Store – lokal installiert',description:'Das Spiel bleibt auf diesem PC vorhanden. Eine Deinstallation ist weiterhin möglich.',type:'game',status:'Lokal installiert',tags:[],accent:'#7182ae',release:null}:null);
  }).filter(Boolean);
}
function renderQuickLibrary() {
  const found = libraryItems();
  $('sidebarGameCount').textContent = String(found.length);
  $('quickLibrary').innerHTML = found.length ? found.slice(0,15).map(g => `<button type="button" class="quick-game" data-action="details" data-id="${escapeHTML(g.id)}"><span class="quick-dot"></span><span>${escapeHTML(g.title)}</span><small>${isNewerVersion(g.release?.version,state.installed[g.id]?.version) ? '↻' : '▶'}</small></button>`).join('') : '<span class="quick-empty">Installierte Spiele erscheinen hier.</span>';
}
function renderSafeMarkdown(value) {
 const escaped=escapeHTML(value||'');
 return escaped.split(/\r?\n/).map(line=>{
  const x=line.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  if(/^### /.test(x))return '<h4>'+x.slice(4)+'</h4>';
  if(/^## /.test(x))return '<h3>'+x.slice(3)+'</h3>';
  if(/^# /.test(x))return '<h3>'+x.slice(2)+'</h3>';
  if(/^- /.test(x))return '<p>• '+x.slice(2)+'</p>';
  return x.trim()?'<p>'+x+'</p>':'';
 }).join('');
}
function openDetails(id) {
 const game=state.games.find(g=>g.id===id)||libraryItems().find(g=>g.id===id);
 if(!game)return toast('Spiel nicht gefunden.',true);
 detailId=id;
 const installed=state.installed[id],stats=state.stats?.[id]||{},favorite=favorites.includes(id);
 const accent=/^#[0-9a-f]{6}$/i.test(game.accent||'')?game.accent:'#8771ed';
 const tags=(game.tags||[]).map(t=>'<span class="tag">'+escapeHTML(t)+'</span>').join('');
 const version=game.release?.version||installed?.version||'Noch kein Release';
 const banner=game.banner?('background-image:linear-gradient(0deg,#080d1fe9,#121a2633 72%),url(\''+game.banner+'\');'):'';
 const cover=game.cover?'<img class="details-cover" src="'+game.cover+'" alt="Cover '+escapeHTML(game.title)+'">':'';
 const screenshots=(game.screenshots||[]).map(url=>'<button type="button" data-action="show-media" data-url="'+url+'"><img src="'+url+'" alt="Gameplay-Screenshot" loading="lazy"></button>').join('');
 const videos=(game.videos||[]).map(url=>'<video controls preload="metadata" src="'+url+'"></video>').join('');
 const requirements=game.requirements?.minimum||game.requirements?.recommended?
 '<section class="details-extended"><h3>Systemanforderungen</h3><div class="details-requirements"><div><h4>Mindestens</h4><p>'+escapeHTML(game.requirements.minimum||'Nicht angegeben')+'</p></div><div><h4>Empfohlen</h4><p>'+escapeHTML(game.requirements.recommended||'Nicht angegeben')+'</p></div></div></section>':'';
 const gallery=(screenshots||videos)?'<section class="details-extended"><h3>Screenshots &amp; Trailer</h3><div class="details-media-gallery">'+screenshots+videos+'</div></section>':'';
 const log=game.release?.changelog?'<section class="details-extended"><h3>Changelog · Version '+escapeHTML(version)+'</h3><div class="details-markdown">'+renderSafeMarkdown(game.release.changelog)+'</div></section>':'';
 $('detailsContent').innerHTML='<div class="details-hero" style="--accent:'+accent+';'+banner+'"><div class="details-hero-shade"><span class="eyebrow">NOVALAB STUDIOS / '+escapeHTML(game.type.toUpperCase())+'</span><h2>'+escapeHTML(game.title)+'</h2><div class="details-tags">'+tags+'</div></div></div>'+
 '<div class="details-body"><div class="details-info"><div class="details-game-head">'+cover+'<div><span class="eyebrow">ÜBER DIESES SPIEL</span><p>'+escapeHTML(game.subtitle||'')+'</p><div class="details-markdown">'+renderSafeMarkdown(game.description||'Ein NovaLab Projekt.')+'</div></div></div><div class="details-meta"><span>STATUS <strong>'+escapeHTML(game.status)+'</strong></span><span>VERSION <strong>'+escapeHTML(version)+'</strong></span><span>ENTWICKLER <strong>'+escapeHTML(game.developer||'NovaLab Studios')+'</strong></span><span>PLATTFORM <strong>'+(game.release?.format==='html'?'HTML5 / Windows':'Windows')+'</strong></span>'+(game.release?.size?'<span>DOWNLOAD <strong>'+readableSize(game.release.size)+'</strong></span>':'')+'</div></div>'+
 '<div class="details-side"><h3>Deine Bibliothek</h3><p>'+(installed?'Lokal installiert.':game.release?'Kostenlos installierbar.':'Noch kein Download veröffentlicht.')+'</p>'+cardAction(game)+'<button class="secondary-button" data-action="library-toggle" data-id="'+escapeHTML(id)+'" type="button">'+(savedLibrary.includes(id)?'✓ Von Merkliste entfernen':installed?'✓ Installiert · In Bibliothek':'＋ Zur Bibliothek hinzufügen')+'</button>'+'<button class="secondary-button" data-action="favorite" data-id="'+escapeHTML(id)+'" type="button">'+(favorite?'★ Aus Favoriten entfernen':'☆ Zu Favoriten hinzufügen')+'</button><p class="hint">Spielzeit: '+readableTime(stats.seconds||0)+'</p>'+(installed?'<button class="secondary-button" data-action="verify-game" data-id="'+escapeHTML(id)+'">Dateien prüfen</button><button class="secondary-button" data-action="open-game-folder" data-id="'+escapeHTML(id)+'">Installationsordner</button><button class="secondary-button" data-action="uninstall" data-id="'+escapeHTML(id)+'">Deinstallieren</button>':'')+'<button class="secondary-button" data-action="close-details">Schließen</button></div></div>'+
 gallery+requirements+log;
 $('detailsOverlay').classList.remove('hidden');
}
function closeDetails() { detailId=null; $('detailsOverlay').classList.add('hidden'); }
function renderHome() {
  const featured=[...state.games].filter(g=>g.type==='game'||g.type==='app').sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)||Number(!!b.release)-Number(!!a.release))[0];
  const hero=document.querySelector('.hero');
  if(featured && hero){
    const art=hero.querySelector('.hero-visual');
    if(art){art.style.backgroundImage=featured.banner?'linear-gradient(0deg,#0b1028c7,#0b153333),url("'+featured.banner+'")':'';art.classList.toggle('has-game-banner',!!featured.banner);}
    const title=hero.querySelector('.hero-title');
    if(title)title.textContent=featured.title.toUpperCase();
    const paragraph=hero.querySelector('.hero-content p');
    if(paragraph)paragraph.textContent=featured.subtitle||featured.description||'Entdecke das neueste NovaLab Spiel.';
    const button=hero.querySelector('.primary-button');
    if(button){button.removeAttribute('data-page');button.dataset.action='details';button.dataset.id=featured.id;button.textContent=featured.release?'Spiel ansehen →':'Mehr erfahren →';}
  }
  $('featuredGrid').innerHTML = [...state.games].sort((a,b)=>Number(!!b.release)-Number(!!a.release)).slice(0, 3).map(g => gameCard(g)).join('') || '<div class="empty">Noch keine Projekte vorhanden.</div>';
  if (!featured && hero) {
    const title=hero.querySelector('.hero-title');
    if(title)title.textContent='NOVALAB · DEINE SPIELE';
    const paragraph=hero.querySelector('.hero-content p');
    if(paragraph)paragraph.textContent='Der Katalog ist momentan leer. Du kannst später neue veröffentlichte Spiele entdecken.';
    const button=hero.querySelector('.primary-button');
    if(button){button.removeAttribute('data-action');button.removeAttribute('data-id');button.dataset.page='discover';button.textContent='Store öffnen →';}
  }
  $('libraryCount').textContent = Object.keys(state.installed).length;
  $('homeLibraryMessage').textContent = Object.keys(state.installed).length ? `${Object.keys(state.installed).length} installierte Spiele · Deine Sammlung ist bereit.` : 'Dein nächstes Lieblingsspiel wartet schon im Store.';
  renderQuickLibrary();
}
function renderDiscover() {
  const found = state.games.filter(g => (filter === 'all' || g.type === filter || (filter === 'mini' && g.release?.format === 'html')) && [g.title, g.subtitle, g.description, ...(g.tags || [])].join(' ').toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')));
  $('discoverGrid').innerHTML = found.slice(0,discoverLimit).map(g => gameCard(g)).join('');
  $('showMoreGames').classList.toggle('hidden',found.length<=discoverLimit);
  $('showMoreGames').textContent='Weitere Spiele laden ('+(found.length-discoverLimit)+') ↓';
  $('noResults').classList.toggle('hidden', found.length > 0);
}
function renderLibrary() {
  let found = libraryItems();
  if (libraryMode === 'installed') found=found.filter(g=>!!state.installed[g.id]);
  if (libraryMode === 'not-installed') found=found.filter(g=>!state.installed[g.id]);
  if (libraryMode === 'favorites') found = found.filter(g => favorites.includes(g.id));
  if (libraryMode === 'updates') found = found.filter(g => isNewerVersion(g.release?.version, state.installed[g.id]?.version));
  if (librarySort === 'name') found.sort((a,b) => a.title.localeCompare(b.title,'de'));
  if (librarySort === 'recent') found.sort((a,b) => (state.stats?.[b.id]?.lastPlayed || '').localeCompare(state.stats?.[a.id]?.lastPlayed || ''));
  if (librarySort === 'time') found.sort((a,b) => (state.stats?.[b.id]?.seconds || 0) - (state.stats?.[a.id]?.seconds || 0));
  $('librarySummary').textContent = `${found.length} ${libraryMode === 'favorites' ? 'Favoriten' : libraryMode === 'updates' ? 'Updates verfügbar' : libraryMode==='installed' ? 'installierte Spiele' : libraryMode==='not-installed' ? 'nicht installierte Spiele' : 'Spiele und Apps'}`;
  document.querySelectorAll('[data-action="library-mode"]').forEach(btn=>btn.classList.toggle('active-choice',btn.dataset.id===libraryMode));
  $('libraryGrid').innerHTML = found.map(g => gameCard(g, { uninstall: true })).join('');
  $('emptyLibrary').classList.toggle('hidden', found.length > 0);
}
function renderDownload() {
  const tasks = state.downloads || [];
  const running = tasks.find(t => ['downloading','verifying','installing'].includes(t.phase));
  $('downloadProgressBox').classList.toggle('hidden', !running);
  const pending=tasks.filter(t=>['queued','downloading','paused','verifying','installing'].includes(t.phase)).length;
  $('topDownloadsCount').classList.toggle('hidden',pending===0);
  $('topDownloadsCount').textContent=pending>99?'99+':String(pending);
  document.querySelector('.top-download').setAttribute('aria-label',pending?pending+' laufende oder ausstehende Downloads':'Downloads anzeigen');
  $('downloadDescription').textContent = running ? `Aktiv: ${running.title}` : `${tasks.filter(t=>t.phase==='queued').length} Downloads in Warteschlange`;
  if (running) {
    $('downloadGame').textContent = running.title;
    $('downloadPercent').textContent = running.phase === 'downloading' ? (running.total ? running.percent + '%' : readableSize(running.bytes)) : phaseLabel(running.phase);
    $('downloadBar').style.width = (running.total ? running.percent : 0) + '%';
    $('downloadPhase').textContent = `${phaseLabel(running.phase)} · ${readableSize(running.bytes)}${running.total ? ' / '+readableSize(running.total):''} · ${readableSize(running.speed)}/s · ETA ${readableTime(running.eta)}`;
  }
  $('downloadQueue').innerHTML = tasks.length ? tasks.map(t => {
    const buttons = ['downloading','queued'].includes(t.phase) ?
      `<button class="secondary-button" data-action="pause-download" data-id="${escapeHTML(t.id)}">Pausieren</button>` :
      ['paused','failed'].includes(t.phase) ? `<button class="secondary-button" data-action="resume-download" data-id="${escapeHTML(t.id)}">${t.phase === 'failed'?'Erneut versuchen':'Fortsetzen'}</button>` : '';
    const cancel = t.phase === 'complete' ? '' : `<button class="secondary-button" data-action="cancel-download" data-id="${escapeHTML(t.id)}">Abbrechen</button>`;
    return `<article class="download-task"><div class="download-task-head"><strong>${escapeHTML(t.title)}</strong><span>${escapeHTML(phaseLabel(t.phase))} · v${escapeHTML(t.version)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.max(0,Math.min(100,t.percent || 0))}%"></div></div><p class="hint">${readableSize(t.bytes)}${t.total ? ' / ' + readableSize(t.total) : ''} · ${readableSize(t.speed)}/s · ${readableTime(t.eta)} verbleibend</p>${t.error ? `<p class="download-error">${escapeHTML(t.error)}</p>` : ''}<div class="download-task-actions">${buttons}${cancel}</div></article>`;
  }).join('') : '<p class="hint">Noch keine Downloads gestartet. Wähle im Store ein verfügbares Spiel aus.</p>';
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
function renderSettings() { renderUpdateWidgets(); $('installPath').textContent = state.settings?.installRoot || 'Standardverzeichnis (App-Daten)'; }
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
    if (result) { toast(game.title + ' steht jetzt in der Downloadliste.'); const snapshot=await api.invoke('get-state'); state.downloads=snapshot.downloads; renderAll(); }
  }
  if (action === 'launch') await invoke('launch', id);
  if (action === 'library-toggle') {
    if (savedLibrary.includes(id)) savedLibrary=savedLibrary.filter(x=>x!==id);
    else if (!state.installed[id]) savedLibrary=[...savedLibrary,id].slice(-300);
    saveLibrary();renderLibrary();if(detailId===id)openDetails(id);
    toast(savedLibrary.includes(id)?'In deiner Bibliothek gespeichert.':'Merkliste aktualisiert.');
    return;
  }
  if (action === 'favorite') { favorites = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites,id]; try {localStorage.setItem('novalab:favorites', JSON.stringify(favorites));}catch {} if (detailId === id) openDetails(id); renderLibrary(); toast(favorites.includes(id)?'Zu Favoriten hinzugefügt.':'Favorit entfernt.'); }
  if (action === 'verify-game') { const x=await invoke('verify-game',id); if(x) toast(x.message); }
  if (action === 'open-game-folder') await invoke('open-game-folder',id);
  if (['pause-download','resume-download','cancel-download'].includes(action)) { const x=await invoke(action,id); if(x) { const snapshot=await api.invoke('get-state'); state.downloads=snapshot.downloads; renderDownload(); } }
  if (action === 'choose-install-folder') { const x=await invoke('choose-install-folder'); if(x && !x.canceled) {state.settings.installRoot=x.root;renderSettings();toast('Speicherort für zukünftige Installationen aktualisiert.');} }
  if (action === 'library-mode') { libraryMode=id; renderLibrary(); }
  if (action === 'library-sort') { librarySort=id; renderLibrary(); }
  if (action === 'uninstall') {
    closeDetails();
    confirmId = id;
    $('confirmText').textContent = 'Alle lokal installierten Dateien von „' + (game?.title || id) + '“ werden gelöscht. Deine anderen Spiele bleiben erhalten.';
    $('confirmOverlay').classList.remove('hidden');
  }
  if (action === 'open-academy') return invoke('open-academy');
  if (action === 'open-publisher') return invoke('open-publisher');
  if (action === 'show-media') { const url=element?.dataset.url||''; if(!/^https:\/\/ekgxotvvhkmeuxvuwbei\.supabase\.co\/storage\/v1\/object\/public\/novalab-studio-media\//.test(url))return; $('mediaLightboxImage').src=url; $('mediaLightbox').classList.remove('hidden'); return; }
  if (action === 'close-media') { $('mediaLightbox').classList.add('hidden');$('mediaLightboxImage').removeAttribute('src');return; }
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
  if (event.type === 'installed') { state.installed = event.installed; renderAll(); toast('Installation erfolgreich abgeschlossen.'); }
  if (event.type === 'stats') { state.stats = event.stats; renderLibrary(); }
  if (event.type === 'download-list') { state.downloads = event.tasks; renderDownload(); renderHome(); }
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
$('searchInput').addEventListener('input', ev => { search = ev.target.value; $('globalSearch').value=search;discoverLimit=80;renderDiscover(); });
$('globalSearch').addEventListener('input',ev=>{
  search=ev.target.value;$('searchInput').value=search;discoverLimit=80;
  if(page!=='discover')selectPage('discover');
  else renderDiscover();
});
$('showMoreGames').addEventListener('click',()=>{discoverLimit+=80;renderDiscover();});
document.addEventListener('keydown',ev=>{
  if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();$('globalSearch').focus();$('globalSearch').select();}
});
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
