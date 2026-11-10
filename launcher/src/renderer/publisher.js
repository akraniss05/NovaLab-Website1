'use strict';
const api=window.studio;
const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeMedia=url=>typeof url==='string'&&/^https:\/\/ekgxotvvhkmeuxvuwbei\.supabase\.co\/storage\/v1\/object\/public\/novalab-studio-media\/community-[a-z0-9-]+\/[a-f0-9-]+\.(?:png|jpg|webp|mp4|webm)$/.test(url)?url:'';
const fmtDate=value=>value?new Date(value).toLocaleDateString('de-DE',{day:'2-digit',month:'short',year:'numeric'}):'–';
const size=bytes=>Number.isFinite(Number(bytes))?(Number(bytes)/1048576).toFixed(2)+' MB':'–';
const blank=()=>({id:'',title:'',summary:'',description:'',developer:'NovaLab Studios',publisher:'NovaLab Studios',genre:'Indie',kind:'game',tags:[],status:'In Entwicklung',featured:false,features:{},requirements:{},visibility:'draft'});
let games=[], legacyGames=[], detail=null, draft=blank(), currentView='dashboard', savedId='', dirty=false, busy=false;
const selected=new Set();
let pendingDelete=null;
const mediaKinds=[['cover','Hochkant-Cover','Vertikales Spielbild'],['banner','Hauptbanner','Breites Hintergrundbild'],['screenshot','Screenshots','Gameplay-Bilder (mehrere)'],['video','Trailer & Videos','MP4 / WEBM, bis 8 MB']];
function message(text,error=false){
 const el=$('globalMessage');el.className='message'+(error?' error':'');el.textContent=text;
 $('footerStatus').textContent=error?'Fehler: '+text:text;
 el.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function hideMessage(){$('globalMessage').classList.add('hidden');}
async function call(action,...args){if(busy)return null;busy=true;document.querySelectorAll('.primary').forEach(b=>b.disabled=true);
 try{return await api.invoke(action,...args);}catch(e){message(e?.message||'Die Aktion ist fehlgeschlagen.',true);return null;}
 finally{busy=false;document.querySelectorAll('.primary').forEach(b=>b.disabled=false);}
}
function renderCounts(){
 $('countGames').textContent=games.length;
 $('countPublished').textContent=games.filter(g=>g.visibility==='published').length;
 $('countDrafts').textContent=games.filter(g=>g.visibility==='draft').length;
 $('countFeatured').textContent=games.filter(g=>g.featured&&g.visibility==='published').length;
}

function row(game){
 const legacy=game.source==='github', archived=game.visibility==='archived';
 const badge=archived?'ARCHIVIERT':game.visibility==='published'?'ÖFFENTLICH':game.visibility==='unlisted'?'NICHT GELISTET':'ENTWURF';
 const buttons=legacy?'<button class="outline" data-act="legacy-toggle" data-id="'+escapeHTML(game.id)+'" data-hide="'+(!archived)+'">'+(archived?'Wiederherstellen':'Archivieren')+'</button>':
 '<button class="outline" data-act="edit" data-id="'+escapeHTML(game.id)+'">Bearbeiten</button><button class="outline" data-act="preview" data-id="'+escapeHTML(game.id)+'">Vorschau</button>'+
 '<button class="outline" data-act="toggle-archive" data-id="'+escapeHTML(game.id)+'">'+(archived?'Wiederherstellen':'Archivieren')+'</button>'+
 '<button class="danger" data-act="delete" data-id="'+escapeHTML(game.id)+'">Löschen</button>';
 return '<div class="game-row manage-row">'+
 '<input type="checkbox" class="game-select" data-id="'+escapeHTML(game.id)+'" aria-label="'+escapeHTML(game.title)+' auswählen" '+(selected.has(game.id)?'checked':'')+'>'+
 '<div class="game-thumb">✦</div><div><strong>'+escapeHTML(game.title)+'</strong>'+
 '<small>'+escapeHTML(game.id)+' · '+escapeHTML(game.genre||'NovaLab')+' · '+(legacy?'GitHub-Katalog':fmtDate(game.updated_at))+
 ' &nbsp; <span class="status-tag '+(game.visibility==='published'?'published':'')+'">'+badge+'</span>'+
 (legacy&&!game.hasRelease?' <span class="status-tag">KEIN DOWNLOAD</span>':'')+'</small></div>'+
 '<div class="row-actions">'+buttons+'</div></div>';
}
function renderLists(){
 renderCounts();
 const recent=games.length?games.slice(0,8):legacyGames.slice(0,8);
 $('dashboardGames').innerHTML=recent.length?'<div class="games-list">'+recent.map(row).join('')+'</div>':'<p class="subtle">Noch keine Spiele. Lege einen Entwurf an.</p>';
 const q=$('gameSearch').value.toLocaleLowerCase('de');
 const items=[...games,...legacyGames].filter(g=>(g.title+' '+g.id+' '+(g.genre||'')).toLocaleLowerCase('de').includes(q));
 $('gamesTable').innerHTML=items.length?'<div class="games-list">'+items.map(row).join('')+'</div>':'<p class="subtle">Keine passenden Spiele gefunden.</p>';
 $('selectedCount').textContent=selected.size+' ausgewählt';
 $('selectAllGames').checked=items.length>0&&items.every(g=>selected.has(g.id));
}
async function loadList(){
 const result=await call('list');if(!result)return;
 games=result.games||[];
 const old=await call('legacy-list');
 if(old)legacyGames=old.games||[];
 const ids=new Set([...games,...legacyGames].map(g=>g.id));
 for(const id of selected){if(!ids.has(id))selected.delete(id);}
 renderLists();
}
function setView(view){
 if(!['dashboard','games','edit','media','builds','preview','publish'].includes(view))return;
 if(['media','builds','preview','publish'].includes(view)&&!savedId){message('Bitte zuerst den Entwurf mit Spiel-ID speichern.',true);view='edit';}
 if(dirty&&currentView==='edit'&&view!=='edit'&&!confirm('Du hast ungespeicherte Änderungen. Wirklich wechseln?'))return;
 currentView=view;
 document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!=='view-'+view));
 document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 const titles={dashboard:['Administration','Dashboard','Spiele, Versionen und Veröffentlichungen verwalten.'],games:['Spiele','verwalten','Veröffentlichte Spiele und Entwürfe bearbeiten.'],edit:['Neues Spiel','bearbeiten','Titel, Beschreibung, Kategorien und Systemanforderungen.'],media:['Medien','hochladen','Cover, Banner, Screenshots und Trailer verwalten.'],builds:['Versionen','& Dateien','Validierte Spielpakete und Release-Notes.'],preview:['Store-Seite','ansehen','Vorschau ohne öffentliche Freigabe.'],publish:['Spiel','veröffentlichen','Validierung und Sichtbarkeit steuern.']};
 const h=titles[view];$('headline').innerHTML=escapeHTML(h[0])+' <em>'+escapeHTML(h[1])+'</em>';$('subtitle').textContent=h[2];
 $('newGame').classList.toggle('hidden',view==='edit');
 if(view==='edit')fillForm();
 if(view==='media')renderMedia();
 if(view==='builds')renderBuilds();
 if(view==='preview')renderPreview();
 if(view==='publish')renderPublish();
 document.querySelector('.scroller').scrollTo({top:0,behavior:'smooth'});
}
function collect(){
 const form=$('editorForm'),v=name=>form.elements.namedItem(name)?.value||'';
 const next={id:v('id').trim().toLowerCase(),title:v('title').trim(),summary:v('summary').trim(),description:v('description'),
 developer:v('developer'),publisher:v('publisher'),genre:v('genre'),kind:v('kind'),
 tags:v('tags').split(',').map(x=>x.trim()).filter(Boolean).slice(0,12),status:v('status'),
 featured:form.elements.namedItem('featured').checked,
 features:{multiplayer:form.elements.namedItem('multiplayer').checked,controller:form.elements.namedItem('controller').checked,languages:v('languages')},
 requirements:{minimum:v('minimum'),recommended:v('recommended')}
 };
 draft={...draft,...next};
 return draft;
}
function fillForm(){
 const form=$('editorForm');for(const [k,v] of Object.entries(draft)){
  const el=form.elements.namedItem(k);
  if(el&&typeof v!=='object'){if(el.type==='checkbox')el.checked=!!v;else el.value=v??'';}
 }
 for(const [k,v] of Object.entries({...draft.features,...draft.requirements})){
  const el=form.elements.namedItem(k);if(el){if(el.type==='checkbox')el.checked=!!v;else el.value=v??'';}
 }
 form.elements.namedItem('tags').value=(draft.tags||[]).join(', ');
 form.elements.namedItem('id').readOnly=!!savedId;
 $('editStatus').textContent=(draft.visibility||'draft').toUpperCase();
 $('dirtyLabel').textContent=dirty?'Änderungen noch nicht gespeichert':'Alle Änderungen gespeichert';
 renderChecklists();
}
function checklist(){
 return [
  ['Titel und Kurzbeschreibung',!!draft.title&&draft.summary?.length>=10],
  ['Ausführliche Beschreibung',draft.description?.length>=20],
  ['Cover hochgeladen',!!detail?.media?.some(m=>m.kind==='cover')],
  ['Hauptbanner hochgeladen',!!detail?.media?.some(m=>m.kind==='banner')],
  ['Gültiges Stable-Spielpaket',!!detail?.versions?.some(v=>v.channel==='stable')]
 ];
}
function renderChecklists(){
 const items=checklist().map(([name,ok])=>'<div class="check-item '+(ok?'good':'')+'"><span class="check-symbol">'+(ok?'✓':'○')+'</span><span>'+escapeHTML(name)+'</span></div>').join('');
 $('editChecklist').innerHTML=items;
 $('publishChecklist').innerHTML=items;
}
function resetNew(){
 draft=blank();detail={game:draft,media:[],versions:[]};savedId='';dirty=false;
 $('editorForm').reset();setView('edit');
}
async function saveDraft(){
 collect();
 if(!/^community-[a-z0-9][a-z0-9-]{2,49}$/.test(draft.id)){message('Die ID muss wie „community-mein-spiel“ aussehen.',true);return false;}
 if(draft.title.length<3||draft.summary.length<10){message('Spielname und Kurzbeschreibung fehlen.',true);return false;}
 const result=await call('save',draft);
 if(!result)return false;
 savedId=draft.id;draft=result.game;dirty=false;
 if(!detail)detail={game:draft,media:[],versions:[]};else detail.game=draft;
 fillForm();message('Entwurf wurde in der NovaLab-Datenbank gespeichert.');
 await loadList();return true;
}

async function setArchived(id,archive){
 const legacy=legacyGames.find(g=>g.id===id);
 const item=legacy||games.find(g=>g.id===id);
 if(!item)return message('Spiel nicht gefunden.',true);
 if(archive&&!confirm('„'+item.title+'“ wirklich aus dem öffentlichen Store entfernen? Bereits installierte Versionen auf Nutzergeräten bleiben erhalten.'))return;
 const result=legacy?
   await call('legacy-visibility',{id,hide:archive}):
   await call('publish',{id,visibility:archive?'archived':'draft'});
 if(!result)return;
 await loadList();
 await call('refresh-catalog');
 message(archive?'„'+item.title+'“ aus dem Store archiviert.':'„'+item.title+'“ wiederhergestellt (Datenbankspiele zunächst als Entwurf).');
}
function openDeleteModal(id){
 const item=games.find(g=>g.id===id)||legacyGames.find(g=>g.id===id);
 if(!item)return;
 pendingDelete={id,title:item.title,isLegacy:item.source==='github',archived:item.visibility==='archived'};
 $('deleteTitle').textContent='„'+item.title+'“ löschen?';
 $('deleteNotice').textContent=pendingDelete.isLegacy?
  'Dieser Eintrag ist im GitHub-Katalog hinterlegt. Du kannst ihn aus dem öffentlichen Store archivieren und später wiederherstellen. Die Originaldateien werden dabei nicht gelöscht.':
  'Archivieren entfernt das Spiel sofort aus dem Store. Endgültige Löschung ist erst nach Archivieren und Eingabe des genauen Spielnamens möglich. Installationen der Nutzer bleiben unangetastet.';
 $('deleteConfirmation').value='';
 $('deleteConfirmLabel').classList.toggle('hidden',pendingDelete.isLegacy);
 $('deleteFinal').disabled=pendingDelete.isLegacy;
 $('deleteFinal').textContent=pendingDelete.isLegacy?'Nur GitHub-Archivierung möglich':'Endgültig löschen';
 $('deleteDialog').classList.remove('hidden');
}
function closeDeleteModal(){$('deleteDialog').classList.add('hidden');pendingDelete=null;}
async function deleteFinal(){
 if(!pendingDelete||pendingDelete.isLegacy)return;
 const {id,title,archived}=pendingDelete;
 if(!archived){message('Bitte das Spiel vor endgültiger Löschung zuerst archivieren.',true);return;}
 const confirmTitle=$('deleteConfirmation').value;
 if(confirmTitle!==title){message('Bitte den exakten Spieltitel eingeben: '+title,true);return;}
 if(!confirm('LETZTE BESTÄTIGUNG: „'+title+'“ einschließlich der zugehörigen Datenbankversionen und nicht mehr referenzierten Serverdateien endgültig löschen?'))return;
 const result=await call('delete',{id,confirmTitle});
 if(!result)return;
 closeDeleteModal();selected.delete(id);
 if(savedId===id){savedId='';draft=blank();detail=null;dirty=false;}
 await loadList();await call('refresh-catalog');
 message('Spiel endgültig entfernt. Lokale Dateien anderer Nutzer wurden nicht gelöscht.'+(result.storageCleanupPending?' Achtung: '+result.storageCleanupPending+' Speicherdateien müssen später manuell bereinigt werden.':''));
}
async function bulkArchive(archive){
 const ids=[...selected];
 if(!ids.length)return message('Bitte Spiele auswählen.',true);
 if(!confirm(ids.length+' ausgewählte Spiele '+(archive?'archivieren':'wiederherstellen')+'?'))return;
 const result=await call('bulk-archive',{ids,archive});
 if(!result)return;
 selected.clear();await loadList();await call('refresh-catalog');
 message(result.changed+' Spiele verarbeitet.'+(result.errors?.length?' Fehler: '+result.errors.join('; '):''));
}
async function openGame(id,view='edit'){
 if(dirty&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;
 const result=await call('detail',id);if(!result)return;
 detail=result;draft=result.game;savedId=id;dirty=false;setView(view);
}
async function refreshDetail(){
 if(!savedId)return;
 const result=await call('detail',savedId);
 if(result){detail=result;draft=result.game;dirty=false;fillForm();}
}
function renderMedia(){
 const blocks=mediaKinds.map(([kind,label,desc])=>
 '<div class="upload-tile"><div class="big">'+({cover:'▧',banner:'▥',screenshot:'▣',video:'▷'}[kind])+'</div><strong>'+label+'</strong><small>'+desc+'</small><button class="outline" data-act="upload-media" data-kind="'+kind+'">Datei wählen &amp; hochladen</button></div>').join('');
 $('mediaUploadBlocks').innerHTML=blocks;
 const m=detail?.media||[];
 $('mediaGallery').innerHTML=m.length?m.map(item=>{
  const url=safeMedia(item.url);
  const preview=item.kind==='video'?'<video controls preload="metadata" src="'+url+'"></video>':'<img loading="lazy" src="'+url+'" data-lightbox="'+url+'" alt="'+escapeHTML(item.alt||item.kind)+'">';
  return '<div class="media-item">'+preview+'<small>'+escapeHTML(item.kind)+(item.alt?' · '+escapeHTML(item.alt):'')+'</small><button class="danger" data-act="remove-media" data-id="'+escapeHTML(item.id)+'">Entfernen</button></div>';
 }).join(''):'<p class="subtle">Noch keine Medien hochgeladen.</p>';
 renderChecklists();
}
async function uploadMedia(kind){
 if(!savedId)return message('Bitte zuerst Entwurf speichern.',true);
 const result=await call('upload-media',{id:savedId,kind,alt:kind==='cover'?'Spielcover '+draft.title:kind==='banner'?'Hauptbanner '+draft.title:''});
 if(result){message('Medium erfolgreich hochgeladen.');await refreshDetail();renderMedia();}
}
async function removeMedia(mediaId){
 if(!confirm('Dieses Medium wirklich entfernen?'))return;
 const result=await call('media-remove',{id:savedId,mediaId});
 if(result){await refreshDetail();renderMedia();message('Medium entfernt.');}
}
function renderBuilds(){
 $('buildList').innerHTML=(detail?.versions||[]).length?(detail.versions.map(b=>'<div class="build-entry"><div><strong>v'+escapeHTML(b.version)+' <span class="status-tag">'+escapeHTML(b.channel)+'</span></strong><small>'+escapeHTML(b.format.toUpperCase())+' · '+size(b.file_size)+' · '+fmtDate(b.created_at)+'</small><small>'+escapeHTML(b.changelog?.slice(0,130)||'Kein Changelog')+'</small></div><span>✓</span></div>').join('')):'<p class="subtle">Noch keine Spielversion hochgeladen.</p>';
 renderChecklists();
}
async function chooseBuild(){
 const file=await call('choose-build');if(file&&!file.canceled)$('buildFile').textContent=file.name+' · '+size(file.size);
}
async function uploadBuild(){
 const f=$('buildForm'),v=n=>f.elements.namedItem(n).value;
 if(!savedId)return message('Bitte zuerst den Entwurf speichern.',true);
 const result=await call('upload-build',{id:savedId,version:v('version'),format:v('format'),entry:v('entry'),channel:v('channel'),changelog:v('changelog')});
 if(result){message('Spielpaket verifiziert und hochgeladen (SHA-256: '+result.sha256.slice(0,12)+'…).');$('buildFile').textContent='Keine Datei ausgewählt';await refreshDetail();renderBuilds();}
}
function safeMarkdown(str){
 const lines=escapeHTML(str||'').split('\n');
 const formatted=lines.map(line=>{
  const bold=s=>s.replace(/\*\*([^*]{1,160})\*\*/g,'<strong>$1</strong>');
  if(/^### /.test(line))return '<h4>'+bold(line.slice(4))+'</h4>';
  if(/^## /.test(line))return '<h3>'+bold(line.slice(3))+'</h3>';
  if(/^# /.test(line))return '<h3>'+bold(line.slice(2))+'</h3>';
  if(/^- /.test(line))return '<p>• '+bold(line.slice(2))+'</p>';
  return line.trim()?'<p>'+bold(line)+'</p>':'';
 });
 return formatted.join('');
}
function renderPreview(){
 const g=draft,media=detail?.media||[],cover=safeMedia(media.find(m=>m.kind==='cover')?.url),banner=safeMedia(media.find(m=>m.kind==='banner')?.url);
 const screenshots=media.filter(m=>m.kind==='screenshot'||m.kind==='video').map(m=>m.kind==='video'
  ? '<video controls preload="metadata" src="'+safeMedia(m.url)+'"></video>'
  : '<img data-lightbox="'+safeMedia(m.url)+'" src="'+safeMedia(m.url)+'" loading="lazy" alt="'+escapeHTML(m.alt||'Screenshot')+'">').join('');
 $('storePreview').innerHTML=
  '<div class="preview-hero" '+(banner?'style="background-image:url(\''+banner+'\')"':'')+'><h2>'+escapeHTML(g.title||'Neues NovaLab Spiel')+'</h2></div>'+
  '<div class="preview-columns">'+(cover?'<img class="preview-cover" alt="Cover" src="'+cover+'">':'<div class="preview-cover"></div>')+
  '<div><div class="eyebrow">NOVALAB / GAME DETAIL</div><h2>'+escapeHTML(g.title||'–')+'</h2><p>'+escapeHTML(g.summary||'Keine Kurzbeschreibung')+'</p><div class="preview-meta"><span>'+escapeHTML(g.genre||'Indie')+'</span><span>'+escapeHTML(g.status||'In Entwicklung')+'</span><span>'+escapeHTML(g.developer||'NovaLab Studios')+'</span></div><h3>Über dieses Spiel</h3><div class="preview-description">'+safeMarkdown(g.description||'Noch keine Beschreibung hinterlegt.')+'</div></div></div>'+
  '<h3>Gameplay &amp; Screenshots</h3><div class="preview-screens">'+(screenshots||'<p class="subtle">Keine Medien vorhanden.</p>')+'</div>'+
  '<h3>Systemanforderungen</h3><div class="fields two"><div><h4>Minimum</h4><p class="subtle">'+escapeHTML(g.requirements?.minimum||'Nicht angegeben')+'</p></div><div><h4>Empfohlen</h4><p class="subtle">'+escapeHTML(g.requirements?.recommended||'Nicht angegeben')+'</p></div></div>'+
  '<h3>Aktuelle Version</h3><p class="subtle">'+escapeHTML(detail?.versions?.[0]?.version||'Noch nicht verfügbar')+'</p>';
}
function renderPublish(){
 renderChecklists();
 $('publishState').innerHTML='<p>Spiel: <strong>'+escapeHTML(draft.title||'–')+'</strong></p><p>Store-Sichtbarkeit: <span class="status-tag '+(draft.visibility==='published'?'published':'')+'">'+escapeHTML(draft.visibility||'draft').toUpperCase()+'</span></p><p>Builds: <strong>'+(detail?.versions?.length||0)+'</strong></p><p>Medien: <strong>'+(detail?.media?.length||0)+'</strong></p>';
}
async function publish(visibility){
 if(!savedId)return message('Speichere zuerst das Spiel.',true);
 if(dirty&&!await saveDraft())return;
 if(visibility==='published' && !confirm('Das Spiel für alle NovaLab-Nutzer sichtbar machen?'))return;
 const result=await call('publish',{id:savedId,visibility});
 if(!result)return;
 await refreshDetail();await loadList();renderPublish();
 message(visibility==='published'?'Spiel veröffentlicht! Es erscheint nach Katalogaktualisierung im Launcher.':'Sichtbarkeit auf „'+visibility+'“ geändert.');
 await call('refresh-catalog');
}
document.addEventListener('click',async event=>{
 const light=event.target.closest('[data-lightbox]');
 if(light){const url=safeMedia(light.dataset.lightbox);if(url){$('lightboxImg').src=url;$('mediaLightbox').classList.remove('hidden');}return;}
 const btn=event.target.closest('button');if(!btn)return;
 if(btn.dataset.view){setView(btn.dataset.view);return;}
 const action=btn.dataset.act; if(!action)return;
 if(action==='refresh'){await loadList();if(savedId)await refreshDetail();return;}
 if(action==='new')return resetNew();
 if(action==='legacy-toggle')return setArchived(btn.dataset.id,btn.dataset.hide==='true');
 if(action==='toggle-archive')return setArchived(btn.dataset.id,(games.find(g=>g.id===btn.dataset.id)?.visibility!=='archived'));
 if(action==='delete')return openDeleteModal(btn.dataset.id);
 if(action==='delete-cancel'){closeDeleteModal();return;}
 if(action==='delete-archive'){const id=pendingDelete?.id;closeDeleteModal();if(id)return setArchived(id,true);return;}
 if(action==='delete-confirm')return deleteFinal();
 if(action==='bulk-archive')return bulkArchive(true);
 if(action==='bulk-restore')return bulkArchive(false);
 if(action==='edit')return openGame(btn.dataset.id);
 if(action==='preview')return openGame(btn.dataset.id,'preview');
 if(action==='upload-media')return uploadMedia(btn.dataset.kind);
 if(action==='remove-media')return removeMedia(btn.dataset.id);
 if(action==='choose-build')return chooseBuild();
 if(action==='refresh-detail'){await refreshDetail();renderPreview();return;}
 if(action==='publish')return publish(btn.dataset.status);
 if(action==='close-lightbox'){$('mediaLightbox').classList.add('hidden');$('lightboxImg').src='';return;}
});
$('editorForm').addEventListener('input',()=>{dirty=true;$('dirtyLabel').textContent='Ungespeicherte Änderungen';});
$('editorForm').addEventListener('change',()=>{dirty=true;});
$('editorForm').addEventListener('submit',async e=>{e.preventDefault();await saveDraft();});
$('buildForm').addEventListener('submit',async e=>{e.preventDefault();await uploadBuild();});
$('gameSearch').addEventListener('input',renderLists);
$('selectAllGames').addEventListener('change',ev=>{
 const q=$('gameSearch').value.toLocaleLowerCase('de');
 const visible=[...games,...legacyGames].filter(g=>(g.title+' '+g.id+' '+(g.genre||'')).toLocaleLowerCase('de').includes(q));
 for(const g of visible){if(ev.target.checked)selected.add(g.id);else selected.delete(g.id);}
 renderLists();
});
document.addEventListener('change',ev=>{
 if(!ev.target.matches('.game-select'))return;
 if(ev.target.checked)selected.add(ev.target.dataset.id);else selected.delete(ev.target.dataset.id);
 $('selectedCount').textContent=selected.size+' ausgewählt';
});
$('deleteDialog').addEventListener('click',ev=>{if(ev.target===$('deleteDialog'))closeDeleteModal();});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&pendingDelete)closeDeleteModal();});
$('mediaLightbox').addEventListener('click',event=>{if(event.target===$('mediaLightbox')){$('mediaLightbox').classList.add('hidden');$('lightboxImg').src='';}});
loadList().catch(e=>message(e.message,true));