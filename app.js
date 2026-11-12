"use strict";
(function(){
const API="https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/novalab-site-api";
const DISCORD="https://discord.gg/SZhYa6Nnmy";
const ROUTES=["home","projects","learning","code","music","games","launcher","team","support","admin"];
const CAT={coding:"Coding",music:"Musik",games:"Games",tools:"Tools"};
const ARTWORK={coding:"./assets/site-code.svg",music:"./assets/site-beat.svg",games:"./assets/site-games.svg",tools:"./assets/site-launcher.svg"};
const ICONS={
coding:'<path d="m8 4-7 8 7 8M16 4l7 8-7 8M14 2l-4 20"/>',
music:'<path d="M9 19V5l12-2v13M9 9l12-2"/><ellipse cx="6" cy="19" rx="3" ry="2"/><ellipse cx="18" cy="17" rx="3" ry="2"/>',
games:'<path d="M6 8h12a4 4 0 0 1 4 3l1 5a3 3 0 0 1-5 3l-3-3H9l-3 3a3 3 0 0 1-5-3l1-5a4 4 0 0 1 4-3zM8 10v5M5.5 12.5h5"/><circle cx="17" cy="11" r=".8"/><circle cx="19" cy="14" r=".8"/>',
tools:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
external:'<path d="M14 3h7v7M10 14 21 3M19 14v6H4V5h6"/>',
download:'<path d="M12 3v13m-5-5 5 5 5-5M4 19v2h16v-2"/>',
play:'<path d="M8 5v14l11-7z"/>',
lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
check:'<path d="m4 12 5 5L20 6"/>'
};
function $(id){return document.getElementById(id)}
function el(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e}
function icon(kind,cls){const s=document.createElementNS("http://www.w3.org/2000/svg","svg");if(cls)s.setAttribute("class",cls);s.setAttribute("viewBox","0 0 24 24");s.innerHTML=ICONS[kind]||ICONS.tools;return s}
function text(v,n){return String(v==null?"":v).trim().slice(0,n||10000)}
const LOCAL_PAGE=/^\.\/(?:[a-z0-9_-]+\/){0,4}[a-z0-9_-]+\.html(?:#[a-z0-9/-]+)?$/i;
const LOCAL_MEDIA=/^\.\/assets\/(?:[a-z0-9_-]+\/){0,4}[a-z0-9._-]+\.(?:svg|png|jpe?g|webp|gif|mp4|webm)$/i;
function safeLink(input,internal){const val=text(input,800);if(internal&&(/^#[a-z][a-z0-9/-]*$/i.test(val)||LOCAL_PAGE.test(val)))return val;try{const u=new URL(val);if(u.protocol==="https:"&&!u.username&&!u.password)return u.href}catch(e){}return ""}
function safeMedia(input){const val=text(input,1000);return LOCAL_MEDIA.test(val)?val:safeLink(val,false)}
function category(c){return CAT[c]?c:"tools"}
function normalize(p,index){p=p||{};let tags=Array.isArray(p.tags)?p.tags:String(p.tags||"").split(",");let gallery=Array.isArray(p.gallery)?p.gallery:String(p.gallery||"").split("\n");return {id:text(p.id,70).replace(/[^a-z0-9-]/gi,"-").toLowerCase()||"project-"+index,title:text(p.title,90)||"Ohne Titel",summary:text(p.summary||p.description,250),description:text(p.details||p.longDescription||p.description,6000),category:category(p.category),status:text(p.status,50)||"In Planung",link:safeLink(p.link||p.url,true),tags:tags.map(t=>text(t,35)).filter(Boolean).slice(0,15),cover:safeMedia(p.cover),gallery:gallery.map(safeMedia).filter(Boolean).slice(0,15),video:safeMedia(p.video||p.videoUrl),featured:p.featured!==false,updated:text(p.updated,30)||""}}
function verifyOfficialProject(p){
 // Names, summaries and statuses are controlled by the website administrators.
 // Never rewrite persisted project data silently on the visitor's browser.
 return p;
}
const DEFAULTS=[
{id:"novalab-code",title:"NovaLab Code",summary:"Programmieren und Blender lernen – mit Lernpfaden, Quiz, Prüfungen und deinem eigenen Fortschritt.",description:"NovaLab Code ist unsere Coding- und Blender-Lernplattform. Du kannst verschiedene Programmiersprachen kennenlernen, Praxisaufgaben lösen, dein Wissen in Quizzen überprüfen und deinen Fortschritt verfolgen.\n\nDie Plattform befindet sich in der Beta. Der Zugang wird aktuell über das Team auf Discord vergeben.",category:"coding",status:"Beta",link:"https://liverylab-academy.dev/",tags:["Python","JavaScript","Lua","Blender"],featured:true},
{id:"novalab-beatmaker",title:"NovaLab Beat Maker",summary:"Beats verstehen, Rhythmus lernen und eigene Sounds gestalten – unsere Musik-Lernplattform.",description:"Geplant ist eine kreative Lernumgebung für Rhythmus, Drums, Bass, Mixing und verschiedene Musikstile. Die Plattform ist noch in Entwicklung; es gibt derzeit keinen bestätigten öffentlichen App-Link.",category:"music",status:"In Entwicklung",link:"#music",tags:["Beats","Mixing","Musik"],featured:true},
{id:"novalab-game1",title:"NovaLab Game 01",summary:"Ein eigenes Spiel ist in Planung. Hier entsteht unser nächstes großes Gaming-Projekt.",description:"Das erste eigene Spiel von NovaLab Studios befindet sich in der Konzeptphase. Wir arbeiten an Ideen, Technik und einem ersten Prototyp. Genre, Umfang und Release-Datum sind noch nicht festgelegt; eine spielbare Version gibt es aktuell nicht.",category:"games",status:"Konzeptphase",link:"#games",tags:["Eigenentwicklung","Geplant"],featured:true},
{id:"novalab-launcher",title:"NovaLab Launcher",summary:"Windows-Launcher zum Entdecken, Installieren und Aktualisieren von NovaLab-Spielen und -Apps.",description:"Der NovaLab Windows-Launcher ist als Early-Access-Version erhältlich. Hier findest du Downloads und Updates für Spiele und Apps.",category:"games",status:"Windows Early Access",link:"#launcher",tags:["Desktop","Launcher"],featured:false}
];
let projects=DEFAULTS.map((p,i)=>verifyOfficialProject(normalize(p,i))),filter="all",query="",selectedId="",pendingFiles=new Map(),sessionToken=sessionStorage.getItem("novalab_site_session")||"",dirty=false,formDirty=false,catalogRevision=null,publishing=false,temporaryUrls=[];
let publishedSnapshot=projects.map(p=>({...p,tags:[...p.tags],gallery:[...p.gallery]}));
function snapshot(){return projects.map(p=>({...p,tags:[...p.tags],gallery:[...p.gallery]}))}
function validRevision(value){return /^[a-f0-9]{64}$/i.test(value||"")||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||"")}
function state(msg,error){const e=$("adminStatus");if(!e)return;e.textContent=msg;e.style.color=error?"#ff98ad":"#b8decf"}
function authState(msg,error){const e=$("loginStatus");if(!e)return;e.textContent=msg;e.style.color=error?"#ff98ad":"#b8decf"}
function setPublishing(active){
 publishing=active;
 for(const field of $("projectForm").querySelectorAll("input,textarea,select,button"))field.disabled=active;
 for(const field of $("passwordForm").querySelectorAll("input,button"))field.disabled=active;
 for(const id of ["newProject","reload","signOut"])$(id).disabled=active;
 for(const button of $("adminRows").querySelectorAll("button"))button.disabled=active;
}
function showQueuedUploads(){const info=$("queuedUploadsInfo"),button=$("clearQueuedUploads");if(!info||!button)return;const entry=pendingFiles.get(selectedId);const count=entry?(Number(Boolean(entry.cover))+entry.gallery.length+Number(Boolean(entry.video))):0;info.textContent=count?count+" Datei(en) für dieses Projekt vorgemerkt. Vor dem Veröffentlichen werden sie hochgeladen.":"Keine Dateien zum Hochladen vorgemerkt.";button.hidden=count===0}
function makeLink(label,href,cls){let a=el("a",cls,label),safe=safeLink(href,true);a.href=safe||"#projects";if(safe.startsWith("https://")){a.target="_blank";a.rel="noopener noreferrer"}return a}
function poster(p,cls){const wrap=el("div","poster "+p.category+(cls?" "+cls:""));const img=el("img");img.loading="lazy";img.decoding="async";img.alt=(p.cover?"Projektbild: ":"NovaLab Konzept-Artwork: ")+p.title;img.src=p.cover||(p.id==="novalab-launcher"?ARTWORK.tools:ARTWORK[p.category]||ARTWORK.tools);img.onerror=()=>{img.remove();wrap.prepend(icon(p.category,"poster-icon"))};wrap.append(img);wrap.append(el("span","poster-status",p.status));return wrap}
function projectCard(p){const card=el("article","project-card");const link=makeLink("","#project/"+p.id,"poster-link");link.append(poster(p));card.append(link);const body=el("div","card-body");body.append(el("span","card-meta",CAT[p.category]+" / NOVALAB"),el("h3","",p.title),el("p","",p.summary));const bottom=el("div","card-bottom");bottom.append(el("span","card-tags",(p.tags||[]).slice(0,2).join(" · ")));const go=makeLink("","#project/"+p.id,"icon-circle");go.setAttribute("aria-label","Details zu "+p.title);go.append(icon("arrow"));bottom.append(go);body.append(bottom);card.append(body);return card}
function renderFeatured(){const section=$("featuredSection"),grid=$("featuredGrid");if(!section||!grid)return;const featured=projects.filter(p=>p.featured);grid.replaceChildren();featured.forEach(p=>grid.append(projectCard(p)));section.hidden=featured.length===0}
function renderProjects(){const grid=$("projectGrid");grid.replaceChildren();
const found=projects.filter(p=>(filter==="all"||p.category===filter)&&(p.title+" "+p.summary+" "+p.description+" "+p.tags.join(" ")).toLowerCase().includes(query));found.forEach(p=>grid.append(projectCard(p)));$("emptyResults").hidden=found.length>0;renderFeatured();renderAdminList()}
function setVisualImage(container,src,p){container.replaceChildren();let img=el("img");img.src=src||ARTWORK[p.category]||ARTWORK.tools;img.alt=(src?"Bild von ":"Dekoratives NovaLab Artwork zu ")+p.title;img.onerror=()=>{container.replaceChildren(icon(p.category))};container.append(img)}
function renderDetail(id){const p=projects.find(x=>x.id===id),content=$("projectDetail");content.replaceChildren();if(!p){$("detailTitle").textContent="Projekt nicht gefunden";content.append(el("p","empty","Dieses Projekt wurde nicht gefunden."),makeLink("Zur Projektübersicht","#projects","btn btn-ghost"));return}
const nav=el("div","page-actions");nav.append(makeLink("← Zurück zur Übersicht","#projects","btn btn-ghost"));content.append(nav);
const head=el("div","section-head");const inner=el("div");inner.append(el("span","eyebrow",CAT[p.category]+" · "+p.status),el("h1","",p.title),el("p","muted",p.summary));head.append(inner);content.append(head);
const cover=el("div","detail-cover"),media=[p.cover,...p.gallery].filter(Boolean);setVisualImage(cover,media[0]||"",p);content.append(cover);
if(media.length>1){const thumbs=el("div","thumbs");media.forEach((url,index)=>{const b=el("button",index===0?"selected":"");b.type="button";b.setAttribute("aria-label","Projektbild "+(index+1)+" anzeigen");b.setAttribute("aria-pressed",String(index===0));const img=el("img");img.src=url;img.alt="Projektbild "+(index+1);b.append(img);b.onclick=()=>{setVisualImage(cover,url,p);for(const child of thumbs.children){child.classList.remove("selected");child.setAttribute("aria-pressed","false")}b.classList.add("selected");b.setAttribute("aria-pressed","true")};thumbs.append(b)});content.append(thumbs)}
const layout=el("div","detail-main"),body=el("div","detail-panel"),side=el("aside","detail-panel");body.append(el("h3","","Über das Projekt"),el("p","detail-text",p.description||p.summary));if(p.video){const video=createVideo(p.video);if(video)body.append(video)}
side.append(el("h3","","Projekt-Infos"));for(const [label,val] of [["Status",p.status],["Bereich",CAT[p.category]],["Letztes Update",p.updated||"Nicht angegeben"]]){const row=el("div","meta-line");row.append(el("span","",label),el("b","",val));side.append(row)}const tags=el("div","tags");p.tags.forEach(t=>tags.append(el("span","tag",t)));side.append(tags);
if(p.link){const a=makeLink("Projekt besuchen ↗",p.link,"btn btn-primary");a.style.width="100%";side.append(a)}else side.append(el("p","muted tiny","Weitere Infos folgen."));
layout.append(body,side);content.append(layout);$("detailTitle").textContent=p.title}
function createVideo(input){const s=safeMedia(input);if(!s)return null;const panel=el("div","video-box");let url;try{url=new URL(s,location.href)}catch{return null}
const host=url.hostname.toLowerCase();let embed="";
if(["youtube.com","www.youtube.com","m.youtube.com","youtu.be","www.youtu.be","youtube-nocookie.com","www.youtube-nocookie.com"].includes(host)){
let id=(host.includes("youtu.be")?url.pathname.split("/")[1]:url.searchParams.get("v"))||url.pathname.split("/").filter(Boolean).pop();if(/^[a-zA-Z0-9_-]{11}$/.test(id))embed="https://www.youtube-nocookie.com/embed/"+id}
else if(["vimeo.com","www.vimeo.com","player.vimeo.com"].includes(host)){let id=url.pathname.split("/").filter(Boolean).pop();if(/^\d{5,12}$/.test(id))embed="https://player.vimeo.com/video/"+id}
if(embed){const iframe=el("iframe");iframe.src=embed;iframe.title="Projektvideo";iframe.loading="lazy";iframe.allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture";iframe.referrerPolicy="strict-origin-when-cross-origin";iframe.allowFullscreen=true;panel.append(iframe)}
else if(/\.(mp4|webm)(?:$|\?)/i.test(s)){const video=el("video");video.src=s;video.controls=true;video.preload="metadata";video.playsInline=true;panel.append(video)}
else{panel.append(makeLink("Projektvideo öffnen ↗",s,"btn btn-ghost"))}
panel.append(el("p","","Projektvideo"));return panel}
function route(){let hash;try{hash=decodeURIComponent(location.hash.slice(1)||"home")}catch{hash="home"}hash=hash.replace(/[^a-z0-9/-]/gi,"").toLowerCase();let page=hash.startsWith("project/")?"project":ROUTES.includes(hash)?hash:"home";document.querySelectorAll(".page").forEach(e=>{e.hidden=e.dataset.page!==page});document.querySelectorAll(".nav-link").forEach(e=>{let is=(e.dataset.go===page)||(page==="code"||page==="music"?e.dataset.go==="learning":page==="project"&&e.dataset.go==="projects");e.classList.toggle("active",is);if(is)e.setAttribute("aria-current","page");else e.removeAttribute("aria-current")});
if(page==="project")renderDetail(hash.slice(8));$("mainNav").classList.remove("open");$("mobileMenu").setAttribute("aria-expanded","false");$("mobileMenu").setAttribute("aria-label","Menü öffnen");window.scrollTo(0,0);document.title=(page==="home"?"NovaLab Studios":page==="project"?($("detailTitle").textContent+" | NovaLab Studios"):(page.charAt(0).toUpperCase()+page.slice(1))+" | NovaLab Studios")}
async function loadData(strict=false){let loaded=false;try{const result=await apiRequest("/projects");if(!Array.isArray(result.projects))throw Error("Invalid projects");projects=result.projects.map((p,i)=>verifyOfficialProject(normalize(p,i)));catalogRevision=validRevision(result.revision)?result.revision:null;loaded=true}catch(e){console.info("NovaLab backend unavailable, using fallback",e)}
if(!loaded&&strict)return "error";
if(!loaded){catalogRevision=null;try{const r=await fetch("./data/projects.json?v=10",{cache:"no-store",signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error("HTTP "+r.status);const data=await r.json();if(!Array.isArray(data))throw Error("Invalid JSON");projects=data.map((p,i)=>verifyOfficialProject(normalize(p,i)))}catch(e){console.info("Using default projects",e)}}
publishedSnapshot=snapshot();const notice=$("catalogNotice");if(notice){notice.hidden=loaded;notice.textContent=loaded?"":"Der aktuelle Projektkatalog ist momentan nicht erreichbar. Hier werden möglicherweise ältere Informationen angezeigt."}renderProjects();if(location.hash.startsWith("#project/"))route();return loaded?"backend":"fallback"}
function renderAdminList(){const root=$("adminRows");root.replaceChildren();$("dashboardProjects").textContent=String(projects.length);projects.forEach(p=>{const row=el("div","admin-row");const label=el("div");label.append(el("b","",p.title),el("small","",CAT[p.category]+" · "+p.status));const acts=el("div","admin-row-actions");let edit=el("button","","Bearbeiten");edit.type="button";edit.disabled=publishing;edit.onclick=()=>editProject(p.id);let del=el("button","","Löschen");del.type="button";del.disabled=publishing;del.onclick=()=>{if(publishing)return;if(confirm("Projekt „"+p.title+"“ wirklich aus der Liste entfernen?")){projects=projects.filter(x=>x.id!==p.id);pendingFiles.delete(p.id);if(selectedId===p.id){selectedId="";formDirty=false;$("projectForm").reset();$("fId").value="";$("formTitle").textContent="Projekt hinzufügen";clearMediaPreviews()}dirty=true;renderProjects();showQueuedUploads();state("Löschung vorgemerkt – noch nicht veröffentlicht.")}};acts.append(edit,del);row.append(label,acts);root.append(row)})}
function confirmEditorSwitch(){return !formDirty||confirm("Ungespeicherte Änderungen im Projektformular verwerfen?")}
function editProject(id){if(publishing)return;const p=projects.find(x=>x.id===id);if(!p||!confirmEditorSwitch())return;selectedId=id;formDirty=false;$("fId").value=id;$("fTitle").value=p.title;$("fSummary").value=p.summary;$("fDescription").value=p.description;$("fCategory").value=p.category;$("fStatus").value=p.status;$("fLink").value=p.link;$("fTags").value=p.tags.join(", ");$("fCoverUrl").value=p.cover;$("fGallery").value=p.gallery.join("\n");$("fVideoUrl").value=p.video;$("fFeatured").checked=p.featured;
for(const id of ["fCoverFile","fGalleryFiles","fVideoFile"])$(id).value="";clearMediaPreviews();$("formTitle").textContent="Projekt bearbeiten";state("Du bearbeitest „"+p.title+"“. Änderungen werden erst nach dem Veröffentlichen öffentlich.");$("editorCard").scrollIntoView({behavior:"smooth",block:"start"})}
function newProject(){if(publishing||!confirmEditorSwitch())return;selectedId="";formDirty=false;$("projectForm").reset();clearMediaPreviews();$("fId").value="";$("fFeatured").checked=true;$("formTitle").textContent="Projekt hinzufügen";state("Neues Projekt erstellen und anschließend veröffentlichen.");$("editorCard").scrollIntoView({behavior:"smooth",block:"start"})}
function formError(msg){state(msg,true);return false}
function saveDraft(e){e.preventDefault();if(publishing)return false;const title=text($("fTitle").value,90),summary=text($("fSummary").value,250);if(!title||!summary)return formError("Titel und Kurzbeschreibung fehlen.");
let link=text($("fLink").value);if(link&&!safeLink(link,true))return formError("Projekt-Link: bitte eine HTTPS-URL oder #code, #music etc. eintragen.");
const coverInput=text($("fCoverUrl").value);if(coverInput&&!safeMedia(coverInput))return formError("Bildlink muss mit https:// beginnen.");
const videoInput=text($("fVideoUrl").value);if(videoInput&&!safeMedia(videoInput))return formError("Video-Link muss mit https:// beginnen.");
const galleryText=$("fGallery").value.split("\n").map(x=>x.trim()).filter(Boolean);if(galleryText.some(x=>!safeMedia(x)))return formError("Galerie: bitte nur gültige HTTPS-Bildlinks oder bereits hochgeladene Bilder eintragen.");
const id=selectedId||"project-"+crypto.randomUUID().replace(/-/g,"").slice(0,16),old=projects.find(p=>p.id===id);
const item=normalize({id,title,summary,details:$("fDescription").value||summary,category:$("fCategory").value,status:$("fStatus").value,link,tags:$("fTags").value,cover:coverInput,gallery:galleryText,video:videoInput,featured:$("fFeatured").checked,updated:new Date().toISOString().slice(0,10)});
const files={cover:$("fCoverFile").files[0]||null,gallery:[...$("fGalleryFiles").files],video:$("fVideoFile").files[0]||null};
const existing=pendingFiles.get(id);
if(item.gallery.length+(existing?.gallery.length||0)+files.gallery.length>15)return formError("Maximal 15 Galeriebilder pro Projekt erlaubt. Bitte zuerst Bilder entfernen.");
if(files.cover||files.gallery.length||files.video){
 const images=["image/png","image/jpeg","image/webp"],videos=["video/mp4","video/webm"];
 if((files.cover&&!images.includes(files.cover.type))||files.gallery.some(file=>!images.includes(file.type))||(files.video&&!videos.includes(files.video.type)))return formError("Nur PNG/JPG/WebP für Bilder und MP4/WebM für Videos erlaubt.");
 for(const file of [files.cover,...files.gallery,files.video].filter(Boolean)){
  if(file.size>(images.includes(file.type)?4:12)*1024*1024)return formError("Datei zu groß: Bilder max. 4 MB, Videos max. 12 MB. Größere Videos bitte auf YouTube bereitstellen.");
 }
 const queued=existing||{cover:null,gallery:[],video:null,uploaded:{cover:"",gallery:[],video:""}};
 if(files.cover){queued.cover=files.cover;queued.uploaded.cover=""}
 if(files.gallery.length)queued.gallery.push(...files.gallery);
 if(files.video){queued.video=files.video;queued.uploaded.video=""}
 pendingFiles.set(id,queued);
}
if(old)projects=projects.map(x=>x.id===id?item:x);else projects.push(item);dirty=true;renderProjects();selectedId=id;$("fId").value=id;$("formTitle").textContent="Projekt bearbeiten";for(const field of ["fCoverFile","fGalleryFiles","fVideoFile"])$(field).value="";clearMediaPreviews();formDirty=false;state("Projekt vorgemerkt. Zum Übernehmen auf „Auf Website veröffentlichen“ klicken.");return true}

async function apiRequest(path,opts={}){
 const method=opts.method||"GET",body=opts.body;
 const headers={};if(body!==undefined)headers["Content-Type"]="application/json";
 if(opts.authenticated){if(!sessionToken)throw Error("Nicht angemeldet.");headers["Authorization"]="Bearer "+sessionToken}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path==="/media"?90000:25000);
 let response,result;
 try{
  response=await fetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal:controller.signal});
  result=await response.json().catch(()=>null);
 }catch(e){throw Error(e&&e.name==="AbortError"?"Zeitüberschreitung: Der Server antwortet nicht. Bitte erneut versuchen.":"Backend nicht erreichbar. Bitte später erneut versuchen.")}
 finally{clearTimeout(timer)}
 if(!result)throw Error("Ungültige Serverantwort.");
 if(!response.ok){if(response.status===401&&opts.authenticated&&(path!=="/change-password"||result.error==="Nicht angemeldet oder Sitzung abgelaufen."))clearSession();throw Error(result.error||("HTTP "+response.status))}
 return result;
}
function clearSession(){
 sessionToken="";sessionStorage.removeItem("novalab_site_session");
 $("adminLogin").hidden=false;$("adminDashboard").hidden=true;$("activeAdmin").textContent="Admin";
}
function showDashboard(username){
 $("adminLogin").hidden=true;$("adminDashboard").hidden=false;$("activeAdmin").textContent=username;
 $("dashboardProjects").textContent=String(projects.length);
}
async function checkSession(){
 if(!sessionToken){clearSession();return}
 try{const r=await apiRequest("/me",{authenticated:true});showDashboard(r.username)}catch{clearSession()}
}
async function handleLogin(event){
 event.preventDefault();const username=$("loginUsername").value.trim(),password=$("loginPassword").value;
 $("loginPassword").value="";const button=$("loginButton");button.disabled=true;authState("Anmeldung wird geprüft …");
 try{const result=await apiRequest("/login",{method:"POST",body:{username,password}});sessionToken=result.token;sessionStorage.setItem("novalab_site_session",sessionToken);showDashboard(result.username);authState("");state("Anmeldung erfolgreich. Du kannst Projekte verwalten.")}
 catch(e){authState(e.message,true)}finally{button.disabled=false}
}
async function logout(){
 if(publishing)return;
 if((dirty||formDirty)&&!confirm("Nicht veröffentlichte Projektänderungen verwerfen und abmelden?"))return;
 const request=sessionToken?apiRequest("/logout",{method:"POST",body:{},authenticated:true}):null;
 clearSession();pendingFiles.clear();dirty=false;formDirty=false;selectedId="";projects=publishedSnapshot.map(p=>({...p,tags:[...p.tags],gallery:[...p.gallery]}));$("projectForm").reset();clearMediaPreviews();renderProjects();authState("Du wurdest abgemeldet.");
 if(request)try{await request}catch{}
}
function readBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(Error("Datei konnte nicht gelesen werden."));reader.readAsDataURL(file)})}
async function upload(file){
 state("Lade "+file.name+" hoch …");
 const result=await apiRequest("/media",{method:"POST",authenticated:true,body:{base64:await readBase64(file),mime:file.type}});
 const url=safeMedia(result.url);if(!url)throw Error("Der Server hat keinen gültigen Medienlink zurückgegeben.");return url;
}
async function publish(){
 if(publishing)return;
 if(!sessionToken){state("Bitte zuerst als Administrator anmelden.",true);return}
 if(!catalogRevision){state("Der aktuelle Projektkatalog konnte nicht sicher geladen werden. Bitte zuerst „Projekte neu laden“ verwenden.",true);return}
 if(formDirty&&!saveDraft({preventDefault(){}}))return;
 if(!dirty){state("Keine Änderungen zum Veröffentlichen vorhanden.");return}
  if(projects.length>100){state("Maximal 100 Projekte erlaubt. Bitte vor dem Veröffentlichen Projekte entfernen.",true);return}
 setPublishing(true);
 try{
  for(const [id,files] of pendingFiles){
   const item=projects.find(x=>x.id===id);if(!item)continue;
   if(files.cover&&!files.uploaded.cover)files.uploaded.cover=await upload(files.cover);
   for(let index=0;index<files.gallery.length;index++){
    if(!files.uploaded.gallery[index])files.uploaded.gallery[index]=await upload(files.gallery[index]);
   }
   if(files.video&&!files.uploaded.video)files.uploaded.video=await upload(files.video);
   if(files.uploaded.cover)item.cover=files.uploaded.cover;
   for(const url of files.uploaded.gallery){if(url&&!item.gallery.includes(url))item.gallery.push(url)}
   if(files.uploaded.video)item.video=files.uploaded.video;
   pendingFiles.delete(id);
  }
  showQueuedUploads();
  state("Projektinformationen werden veröffentlicht …");
  const result=await apiRequest("/projects",{method:"PUT",authenticated:true,body:{projects,revision:catalogRevision}});
  if(validRevision(result.revision))catalogRevision=result.revision;
  dirty=false;publishedSnapshot=snapshot();const source=await loadData(true);showDashboard($("activeAdmin").textContent);
  if(source==="backend")state("Erfolgreich veröffentlicht: "+result.count+" Projekte.");
  else state("Veröffentlicht: "+result.count+" Projekte. Eine Rückprüfung ist gerade nicht möglich.",true);
 }catch(e){state("Veröffentlichung fehlgeschlagen: "+e.message,true)}finally{setPublishing(false)}
}
async function reload(){
 if(publishing)return;
 if((dirty||formDirty)&&!confirm("Nicht gespeicherte Änderungen verwerfen?"))return;
 const source=await loadData(true);if(source!=="backend"){state("Backend nicht erreichbar – lokale Ersatzdaten angezeigt. Keine Live-Daten überschreiben.",true);return}
 dirty=false;formDirty=false;pendingFiles.clear();selectedId="";$("projectForm").reset();clearMediaPreviews();$("formTitle").textContent="Projekt hinzufügen";state("Öffentliche Projekte aus dem Backend neu geladen.");
}
function clearMediaPreviews(){temporaryUrls.forEach(url=>URL.revokeObjectURL(url));temporaryUrls=[];$("coverPreview").replaceChildren();$("galleryPreview").replaceChildren();$("videoPreview").textContent="";showQueuedUploads()}
function showMediaPreviews(){clearMediaPreviews();let cover=$("fCoverFile").files[0];if(cover){const img=el("img");const src=URL.createObjectURL(cover);temporaryUrls.push(src);img.src=src;img.alt="Vorschau des Titelbildes";$("coverPreview").append(img)}
for(const file of [...$("fGalleryFiles").files]){const img=el("img"),src=URL.createObjectURL(file);temporaryUrls.push(src);img.src=src;img.alt="Galeriebild-Vorschau";$("galleryPreview").append(img)}
let video=$("fVideoFile").files[0];if(video)$("videoPreview").textContent="Video zum Hochladen ausgewählt: "+video.name+" ("+(video.size/1024/1024).toFixed(2)+" MB)"}
for(const name of ["fCoverFile","fGalleryFiles","fVideoFile"])$(name).addEventListener("change",showMediaPreviews);
$("clearQueuedUploads").onclick=()=>{pendingFiles.delete(selectedId);for(const id of ["fCoverFile","fGalleryFiles","fVideoFile"])$(id).value="";clearMediaPreviews();state("Vorgemerkte Uploads entfernt. Bereits gespeicherte Projektbilder bleiben erhalten.")};
function closeMobileNav(){const menu=$("mainNav");menu.classList.remove("open");const button=$("mobileMenu");button.setAttribute("aria-expanded","false");button.setAttribute("aria-label","Menü öffnen")}
$("mobileMenu").onclick=()=>{const menu=$("mainNav");const button=$("mobileMenu");const open=menu.classList.toggle("open");button.setAttribute("aria-expanded",String(open));button.setAttribute("aria-label",open?"Menü schließen":"Menü öffnen")};
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMobileNav()});
document.addEventListener("click",event=>{const menu=$("mainNav"),button=$("mobileMenu");if(menu.classList.contains("open")&&!menu.contains(event.target)&&!button.contains(event.target))closeMobileNav()});
window.addEventListener("resize",()=>{if(window.innerWidth>1090)closeMobileNav()});
$("projectSearch").oninput=e=>{query=e.target.value.trim().toLowerCase();renderProjects()};
$("filters").onclick=e=>{const b=e.target.closest("[data-category]");if(!b)return;filter=b.dataset.category;document.querySelectorAll("[data-category]").forEach(x=>x.classList.toggle("active",x===b));renderProjects()};
$("projectForm").addEventListener("input",()=>{formDirty=true});$("projectForm").addEventListener("change",()=>{formDirty=true});$("projectForm").addEventListener("submit",saveDraft);$("newProject").onclick=newProject;$("publish").onclick=publish;$("reload").onclick=reload;$("loginForm").addEventListener("submit",handleLogin);$("signOut").onclick=logout;$("passwordForm").addEventListener("submit",handlePasswordChange);
$("discoverNovaLab").addEventListener("click",()=>document.getElementById("introNovaLab").scrollIntoView({behavior:"smooth",block:"start"}));

async function handlePasswordChange(event){
 event.preventDefault();
 const currentPassword=$("currentAdminPassword").value;
 const newPassword=$("newAdminPassword").value;
 const repeatPassword=$("repeatAdminPassword").value;
 const feedback=$("passwordStatus"),button=$("changePasswordButton");
 if(newPassword!==repeatPassword){feedback.textContent="Die neuen Passwörter stimmen nicht überein.";return}
 if(newPassword.length<12){feedback.textContent="Bitte mindestens 12 Zeichen verwenden.";return}
 button.disabled=true;feedback.textContent="Passwort wird aktualisiert …";
 try{
  await apiRequest("/change-password",{method:"POST",authenticated:true,body:{currentPassword,newPassword}});
  $("passwordForm").reset();clearSession();authState("Passwort geändert. Bitte mit dem neuen Passwort erneut anmelden.");
  window.scrollTo(0,0);
 }catch(e){feedback.textContent=e.message}finally{button.disabled=false}
}
window.addEventListener("beforeunload",event=>{if(dirty||formDirty){event.preventDefault();event.returnValue=""}});
window.addEventListener("hashchange",route);$("year").textContent=new Date().getFullYear();renderProjects();route();loadData().then(checkSession);
})();
