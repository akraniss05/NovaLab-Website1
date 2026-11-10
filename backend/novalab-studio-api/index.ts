import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } });
const MEDIA_BUCKET = 'novalab-studio-media';
const BUILD_BUCKET = 'novalab-launcher-games';
const CORS = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'authorization,content-type', 'access-control-allow-methods':'GET,POST,OPTIONS', 'cache-control':'no-store' };
const VALID_ID = /^community-[a-z0-9][a-z0-9-]{2,49}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const LEGACY_CATALOG = 'https://raw.githubusercontent.com/akraniss05/NovaLab-Website1/main/launcher/catalog.json';
const LEGACY_ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
const MIME: Record<string,string> = { 'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp', 'video/mp4':'.mp4', 'video/webm':'.webm' };
const formats = new Set(['html','windows']);
const kinds = new Set(['cover','banner','screenshot','video']);
const allowedExt = new Set(['.html','.htm','.css','.js','.mjs','.json','.txt','.svg','.png','.jpg','.jpeg','.gif','.webp','.ico','.woff','.woff2','.ttf','.mp3','.ogg','.wav','.mp4','.webm','.wasm','.glb','.gltf','.exe','.dll','.dat','.pak','.pck','.bin','.assets','.bundle','.config','.xml','.manifest','.resource','.res','.data','.unity3d','.so','.db','.sav']);
function reply(data: unknown,status=200) { return new Response(JSON.stringify(data),{status,headers:{...CORS,'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'}}); }
function bad(message:string,status=400){return reply({error:message},status);}
function has(obj:any,key:string){return Object.prototype.hasOwnProperty.call(obj,key);}
function text(value:any,max:number){return String(value ?? '').trim().slice(0,max);}
function requireGood(ok:any,msg:string):asserts ok{if(!ok)throw new Error(msg);}
function publicUrl(bucket:string,path:string){ return db.storage.from(bucket).getPublicUrl(path).data.publicUrl; }
function cleanGame(g:any){
 const tags=Array.isArray(g.tags)?g.tags.filter((v:any)=>typeof v==='string').slice(0,12).map((v:string)=>text(v,28)):[];
 return {
  title:text(g.title,80),summary:text(g.summary,200),description:text(g.description,12000),
  developer:text(g.developer,80)||'NovaLab Studios',publisher:text(g.publisher,80)||'NovaLab Studios',
  genre:text(g.genre,40)||'Indie',tags,status:text(g.status,35)||'In Entwicklung',
  featured:!!g.featured, features: typeof g.features==='object' && g.features && !Array.isArray(g.features) ? {
   multiplayer:!!g.features.multiplayer,controller:!!g.features.controller,languages:text(g.features.languages,100)
  }:{}, requirements:typeof g.requirements==='object'&&g.requirements&&!Array.isArray(g.requirements)?{
   minimum:text(g.requirements.minimum,1000),recommended:text(g.requirements.recommended,1000)
  }:{}
 };
}
async function authAdmin(req:Request){
 const match=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization')||'');
 if(!match)return null;
 const buf=new TextEncoder().encode(match[1]);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)),b=>b.toString(16).padStart(2,'0')).join('');
 const {data:s}=await db.from('novalab_launcher_sessions').select('account_id').eq('token_hash',hash).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(!s)return null;
 const {data:a}=await db.from('novalab_launcher_accounts').select('id,username,role,must_change_password').eq('id',s.account_id).maybeSingle();
 if(!a || a.role!=='admin' || a.must_change_password)return null;
 return a;
}
async function audit(account:any,id:string,action:string,details:any={}) { const {error}=await db.from('novalab_studio_audit').insert({account_id:account.id,game_id:id,action,details});if(error)console.error('audit',error.message); }
async function jsonBody(req:Request,max=20000) {
 if(Number(req.headers.get('content-length')||0)>max)throw new Error('Anfrage zu groß.');
 const raw=await req.text();requireGood(raw.length<=max,'Anfrage zu groß.');
 return JSON.parse(raw);
}
async function getGame(id:string) {
 const {data,error}=await db.from('novalab_studio_games').select('*').eq('id',id).maybeSingle();
 if(error)throw error; return data;
}
async function getMedia(id:string) {
 const {data,error}=await db.from('novalab_studio_media').select('id,kind,file_path,mime_type,alt_text,sort_order').eq('game_id',id).order('sort_order',{ascending:true}).limit(80);
 if(error)throw error;
 return (data||[]).map(m=>({id:m.id,kind:m.kind,alt:m.alt_text,url:publicUrl(MEDIA_BUCKET,m.file_path),order:m.sort_order}));
}
async function getVersions(id:string) {
 const {data,error}=await db.from('novalab_studio_versions').select('id,version,channel,format,entry,file_path,sha256,file_size,changelog,created_at').eq('game_id',id).order('created_at',{ascending:false}).limit(40);
 if(error)throw error;return data||[];
}
function versionNum(v:string){return v.split('.').map(Number);}
function newest(list:any[]){return [...list].filter(v=>v.channel==='stable').sort((a,b)=>{const x=versionNum(a.version),y=versionNum(b.version);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];})[0]||null;}
function buildPublic(game:any,media:any[],build:any){
 const pick=(kind:string)=>media.filter(m=>m.kind===kind);
 const cover=pick('cover')[0]?.url||'';
 const banner=pick('banner')[0]?.url||'';
 return { id:game.id,title:game.title,subtitle:game.summary,description:game.description,
   type:'game',status:game.status,tags:[game.genre,...game.tags].filter(Boolean),genre:game.genre,
   developer:game.developer,publisher:game.publisher,featured:game.featured,features:game.features,requirements:game.requirements,
   cover,banner,screenshots:pick('screenshot').map(m=>m.url),videos:pick('video').map(m=>m.url),
   release:build?{version:build.version,url:publicUrl(BUILD_BUCKET,build.file_path),sha256:build.sha256,entry:build.entry,format:build.format,size:build.file_size,changelog:build.changelog,updated_at:build.created_at}:null };
}
function imageMatches(bytes:Uint8Array,mime:string){
 if(mime==='image/png')return bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/webp')return new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
 if(mime==='video/mp4')return new TextDecoder().decode(bytes.slice(4,8))==='ftyp';
 if(mime==='video/webm')return bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163;
 return false;
}
function zipEntries(data:Uint8Array){
 requireGood(data.length>=22,'ZIP ist unvollständig.');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 let eocd=-1;
 for(let p=data.length-22;p>=Math.max(0,data.length-65557);p--){if(view.getUint32(p,true)===0x06054b50){eocd=p;break;}}
 requireGood(eocd>=0,'Ungültiges ZIP-Verzeichnis.');
 const count=view.getUint16(eocd+10,true),off=view.getUint32(eocd+16,true);
 requireGood(count>0 && count<=1200 && off<data.length,'ZIP-Dateianzahl unzulässig.');
 let pos=off,total=0;
 const entries=new Set<string>();
 const decoder=new TextDecoder('utf-8',{fatal:true});
 for(let i=0;i<count;i++){
  requireGood(pos+46<=data.length&&view.getUint32(pos,true)===0x02014b50,'ZIP-Eintrag beschädigt.');
  const flags=view.getUint16(pos+8,true),comp=view.getUint16(pos+10,true),unpacked=view.getUint32(pos+24,true);
  const nameLen=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true);
  const type=(view.getUint32(pos+38,true)>>>16)&0o170000;
  requireGood(!(flags&1)&&[0,8].includes(comp)&&unpacked!==0xffffffff,'ZIP-Verschlüsselung/Komprimierung nicht unterstützt.');
  requireGood(pos+46+nameLen+extra+comment<=data.length,'ZIP-Dateiname ungültig.');
  const name=decoder.decode(data.slice(pos+46,pos+46+nameLen));
  const parts=name.split('/');
  requireGood(!name.includes('\\')&&!name.startsWith('/')&&!name.includes(':')&&!parts.some(p=>p==='..'||p==='.')&&type!==0o120000,'Ungültiger ZIP-Pfad.');
  requireGood(!entries.has(name),'ZIP enthält doppelte Dateinamen.');
  if(!name.endsWith('/')) {
   const extension='.'+name.split('.').pop()!.toLowerCase();
   requireGood(allowedExt.has(extension),'Dateityp im ZIP nicht erlaubt: '+name);
  }
  entries.add(name);total+=unpacked;requireGood(total<=300*1024*1024,'ZIP entpackt zu viele Daten.');
  pos+=46+nameLen+extra+comment;
 }
 return entries;
}

async function legacyEntries() {
  const res=await fetch(LEGACY_CATALOG,{signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw new Error('GitHub-Katalog ist momentan nicht erreichbar.');
  const raw=await res.text();
  requireGood(raw.length<120000,'Katalog zu groß.');
  const items=JSON.parse(raw);
  requireGood(Array.isArray(items),'Katalog fehlerhaft.');
  return items.filter(g=>LEGACY_ID.test(g?.id||'')).map(g=>({
    id:g.id,title:text(g.title,80),format:g.release?.format||'',
    hasRelease:!!(g.release?.url&&g.release?.sha256),
    source:'github',visibility:'published'
  }));
}
async function suppressed() {
  const {data,error}=await db.from('novalab_catalog_suppressions').select('id');
  if(error)throw error;
  return new Set((data||[]).map(x=>x.id));
}
async function ensureKnownLegacy(id:string) {
  requireGood(LEGACY_ID.test(id),'Katalog-ID ungültig.');
  return (await legacyEntries()).find(x=>x.id===id)||null;
}
async function removeOrphanFiles(bucket:string,paths:string[]) {
 const failed:string[]=[];
 for(let i=0;i<paths.length;i+=100){
  const chunk=paths.slice(i,i+100);
  const {error}=await db.storage.from(bucket).remove(chunk);
  if(error){failed.push(...chunk);continue;}
 }
 return failed;
}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 const endpoint=new URL(req.url).pathname.split('/').filter(Boolean).pop()||'';
 try {
  if(endpoint==='catalog'&&req.method==='GET'){
   const {data,error}=await db.from('novalab_studio_games').select('*').eq('visibility','published').order('featured',{ascending:false}).order('updated_at',{ascending:false}).limit(40);
   if(error)throw error;
   const games=await Promise.all((data||[]).map(async g=>buildPublic(g,await getMedia(g.id),newest(await getVersions(g.id)))));
   const hidden=await suppressed();
   return reply({games,excludedIds:[...hidden]});
  }
  const account=await authAdmin(req);
  if(!account)return bad('Administrator-Anmeldung erforderlich.',403);

  if(endpoint==='legacy-list'&&req.method==='GET'){
   const [items,hidden]=await Promise.all([legacyEntries(),suppressed()]);
   return reply({games:items.map(g=>({...g,visibility:hidden.has(g.id)?'archived':'published'}))});
  }
  if(endpoint==='legacy-visibility'&&req.method==='POST'){
   const body=await jsonBody(req),id=text(body.id,65),hide=body.hide;
   if(typeof hide!=='boolean'||!await ensureKnownLegacy(id))return bad('Unbekannter Katalogeintrag oder ungültige Aktion.');
   if(hide){
    const {error}=await db.from('novalab_catalog_suppressions').upsert({
      id,archived_by:account.id,archived_at:new Date().toISOString(),reason:text(body.reason,200)
    },{onConflict:'id'});
    if(error)throw error;
   }else{
    const {error}=await db.from('novalab_catalog_suppressions').delete().eq('id',id);
    if(error)throw error;
   }
   await audit(account,id,hide?'archive-github-catalog':'restore-github-catalog',{hide});
   return reply({success:true,id,hidden:hide});
  }
  if(endpoint==='bulk-archive'&&req.method==='POST'){
   const body=await jsonBody(req);
   if(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>30||body.ids.some((id:any)=>typeof id!=='string'||!LEGACY_ID.test(id)))
    return bad('Maximal 30 gültige Spiel-IDs pro Aktion.');
   const archive=body.archive===true;
   const legacy=await legacyEntries(),legacyIDs=new Set(legacy.map(x=>x.id));
   let changed=0;const errors:string[]=[];
   for(const id of new Set<string>(body.ids)){
    try{
     if(legacyIDs.has(id)){
      if(archive){
       const {error}=await db.from('novalab_catalog_suppressions').upsert({id,archived_by:account.id,archived_at:new Date().toISOString()},{onConflict:'id'});
       if(error)throw error;
      }else{
       const {error}=await db.from('novalab_catalog_suppressions').delete().eq('id',id);
       if(error)throw error;
      }
     }else{
      const game=await getGame(id);if(!game)throw Error('Spiel existiert nicht.');
      const {error}=await db.from('novalab_studio_games').update({visibility:archive?'archived':'draft',updated_at:new Date().toISOString()}).eq('id',id);
      if(error)throw error;
     }
     await audit(account,id,archive?'bulk-archive':'bulk-restore');
     changed++;
    }catch(e){errors.push(id+': '+(e instanceof Error?e.message:'Fehler'));}
   }
   return reply({success:true,changed,errors});
  }
  if(endpoint==='delete'&&req.method==='POST'){
   const body=await jsonBody(req),id=text(body.id,65),confirmation=text(body.confirmTitle,80);
   if(!VALID_ID.test(id)||!confirmation)return bad('Spiel-ID und eingegebener Spielname erforderlich.');
   const game=await getGame(id);
   if(!game)return bad('Kein Datenbankspiel unter dieser ID. GitHub-Katalogspiele können nur archiviert werden.',404);
   if(confirmation!==game.title)return bad('Bestätigung fehlgeschlagen: Spielname stimmt nicht.');
   if(game.visibility!=='archived')return bad('Das Spiel muss zuerst archiviert werden.');
   const {data:media,error:em}=await db.from('novalab_studio_media').select('file_path').eq('game_id',id);
   const {data:versions,error:ev}=await db.from('novalab_studio_versions').select('file_path').eq('game_id',id);
   if(em||ev)throw em||ev;
   const {error:ed}=await db.from('novalab_studio_games').delete().eq('id',id);
   if(ed)throw ed;
   // Keep audit rows: game_id is intentionally a text field without FK.
   await audit(account,id,'permanent-delete',{title:game.title,medias:media?.length||0,versions:versions?.length||0});
   const orphanMedia:string[]=[],orphanBuilds:string[]=[];
   for(const m of media||[]){
    const {count,error}=await db.from('novalab_studio_media').select('id',{count:'exact',head:true}).eq('file_path',m.file_path);
    if(!error&&count===0)orphanMedia.push(m.file_path);
   }
   for(const b of versions||[]){
    const {count,error}=await db.from('novalab_studio_versions').select('id',{count:'exact',head:true}).eq('file_path',b.file_path);
    const {count:legacyCount,error:legacyError}=await db.from('novalab_launcher_games').select('id',{count:'exact',head:true}).eq('file_path',b.file_path);
    if(!error&&!legacyError&&count===0&&legacyCount===0)orphanBuilds.push(b.file_path);
   }
   const failedMedia=await removeOrphanFiles(MEDIA_BUCKET,orphanMedia);
   const failedBuilds=await removeOrphanFiles(BUILD_BUCKET,orphanBuilds);
   return reply({success:true,deleted:true,id,storageCleanupPending:failedMedia.length+failedBuilds.length,
     localFilesAffected:false,remainingOrphans:[...failedMedia,...failedBuilds]});
  }
  if(endpoint==='list'&&req.method==='GET'){
   const {data,error}=await db.from('novalab_studio_games').select('id,title,genre,status,visibility,featured,updated_at,created_at').order('updated_at',{ascending:false}).limit(100);
   if(error)throw error;return reply({games:data||[]});
  }
  if(endpoint==='detail'&&req.method==='GET'){
   const id=new URL(req.url).searchParams.get('id')||'';
   if(!VALID_ID.test(id))return bad('Spiel-ID ungültig.');
   const game=await getGame(id);if(!game)return bad('Spiel nicht gefunden.',404);
   return reply({game,media:await getMedia(id),versions:await getVersions(id)});
  }
  if(endpoint==='save'&&req.method==='POST'){
   const body=await jsonBody(req);
   const id=text(body.id,65);if(!VALID_ID.test(id))return bad('ID muss mit community- beginnen.');
   const clean=cleanGame(body);
   if(clean.title.length<3||clean.summary.length<10)return bad('Titel und Kurzbeschreibung sind erforderlich.');
   const prev=await getGame(id);
   const input={...clean,visibility:prev?.visibility||'draft',updated_at:new Date().toISOString(),...(!prev?{created_by:account.id}:{})};
   const {error}=await db.from('novalab_studio_games').upsert({id,...input},{onConflict:'id'});
   if(error)throw error;await audit(account,id,prev?'edit':'create');
   return reply({success:true,game:await getGame(id)});
  }
  if(endpoint==='media'&&req.method==='POST'){
   if(Number(req.headers.get('content-length')||0)>8_600_000)return bad('Datei zu groß.',413);
   const form=await req.formData();
   const id=text(form.get('id'),65),kind=text(form.get('kind'),15);
   if(!VALID_ID.test(id)||!kinds.has(kind)||!await getGame(id))return bad('Spiel oder Medientyp ungültig.');
   const file=form.get('file');
   if(!(file instanceof File))return bad('Datei fehlt.');
   const max=kind==='video'?8*1024*1024:5*1024*1024;
   if(file.size<100||file.size>max||!has(MIME,file.type)||((kind==='video')!==file.type.startsWith('video/')))return bad('Medienformat oder Größe nicht zulässig.',413);
   const raw=new Uint8Array(await file.arrayBuffer());
   if(!imageMatches(raw,file.type))return bad('Dateisignatur stimmt nicht zum Medienformat.');
   const path=id+'/'+crypto.randomUUID()+MIME[file.type];
   const {error:uploadError}=await db.storage.from(MEDIA_BUCKET).upload(path,raw,{contentType:file.type,upsert:false,cacheControl:'86400'});
   if(uploadError)throw uploadError;
   const {data,error}=await db.from('novalab_studio_media').insert({game_id:id,kind,file_path:path,mime_type:file.type,alt_text:text(form.get('alt'),160)}).select('id').single();
   if(error){await db.storage.from(MEDIA_BUCKET).remove([path]);throw error;}
   await audit(account,id,'media-upload',{kind,bytes:raw.byteLength});
   return reply({id:data.id,url:publicUrl(MEDIA_BUCKET,path),kind},201);
  }
  if(endpoint==='media-remove'&&req.method==='POST'){
   const body=await jsonBody(req),id=text(body.id,65),mediaId=text(body.mediaId,50);
   if(!VALID_ID.test(id)||!await getGame(id))return bad('Spiel ungültig.');
   const {data:m}=await db.from('novalab_studio_media').select('id,file_path').eq('id',mediaId).eq('game_id',id).maybeSingle();
   if(!m)return bad('Medium nicht gefunden.',404);
   const {error}=await db.from('novalab_studio_media').delete().eq('id',m.id);
   if(error)throw error;await db.storage.from(MEDIA_BUCKET).remove([m.file_path]);
   await audit(account,id,'media-remove');return reply({success:true});
  }
  if(endpoint==='upload-build'&&req.method==='POST'){
   if(Number(req.headers.get('content-length')||0)>12_700_000)return bad('ZIP maximal 12 MB.',413);
   const form=await req.formData();
   const id=text(form.get('id'),65),version=text(form.get('version'),30),format=text(form.get('format'),12),entry=text(form.get('entry'),140).replaceAll('\\','/');
   const channel=text(form.get('channel'),12)||'stable',changelog=text(form.get('changelog'),5000);
   if(!VALID_ID.test(id)||!VERSION.test(version)||!formats.has(format)||!['stable','beta'].includes(channel))return bad('Build-Felder ungültig.');
   if(!await getGame(id))return bad('Zuerst den Entwurf speichern.');
   const file=form.get('file');if(!(file instanceof File)||file.size<50||file.size>12*1024*1024)return bad('ZIP benötigt (maximal 12 MB).',413);
   const raw=new Uint8Array(await file.arrayBuffer()), entries=zipEntries(raw);
   if(!entries.has(entry)||entry.includes('..')||entry.startsWith('/')||entry.includes(':')||!/^[a-zA-Z0-9_ .()/-]{1,140}$/.test(entry))return bad('Startdatei ist nicht im ZIP.');
   if(format==='html'&&!/\.html?$/i.test(entry))return bad('HTML-Spiel benötigt eine HTML-Startdatei.');
   if(format==='windows'&&!/\.exe$/i.test(entry))return bad('Windows-Spiel benötigt eine EXE-Startdatei.');
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
   const path=id+'/'+version+'/'+crypto.randomUUID()+'.zip';
   const {error:uploadError}=await db.storage.from(BUILD_BUCKET).upload(path,raw,{contentType:'application/zip',upsert:false});
   if(uploadError)throw uploadError;
   const {error}=await db.from('novalab_studio_versions').insert({game_id:id,version,format,entry,channel,changelog,file_path:path,sha256:hash,file_size:raw.byteLength});
   if(error){await db.storage.from(BUILD_BUCKET).remove([path]);return bad(error.code==='23505'?'Diese Version wurde bereits hochgeladen.':'Build konnte nicht gespeichert werden.',409);}
   await audit(account,id,'build-upload',{version,channel,format,bytes:raw.byteLength});
   return reply({success:true,version,size:raw.byteLength,sha256:hash},201);
  }
  if(endpoint==='publish'&&req.method==='POST'){
   const body=await jsonBody(req),id=text(body.id,65),visibility=text(body.visibility,15);
   if(!VALID_ID.test(id)||!['published','draft','archived','unlisted'].includes(visibility))return bad('Ungültige Veröffentlichung.');
   const game=await getGame(id);if(!game)return bad('Spiel nicht gefunden.',404);
   if(visibility==='published'){
    const media=await getMedia(id);
    if(!media.some(m=>m.kind==='cover')||!media.some(m=>m.kind==='banner'))return bad('Cover und Hauptbanner sind Pflicht.');
    if(game.description.length<20)return bad('Ausführliche Beschreibung fehlt (mindestens 20 Zeichen).');
    // Coming-soon projects are permitted without build, but cannot have an install button.
    if(['Veröffentlicht','Early Access','Beta','Alpha'].includes(game.status)&&!newest(await getVersions(id)))return bad('Spielbarer Release benötigt ein gültiges Spielpaket.');
   }
   const {error}=await db.from('novalab_studio_games').update({visibility,updated_at:new Date().toISOString()}).eq('id',id);
   if(error)throw error;
   if(visibility!=='published'){await db.from('novalab_launcher_games').update({published:false}).eq('id',id);}
   await audit(account,id,'visibility',{visibility});
   return reply({success:true,visibility});
  }
  return bad('Route nicht gefunden.',404);
 } catch(e){
  const message=e instanceof Error?e.message:'Unbekannter Fehler';
  console.error('studio api:',message);
  return bad(/ungültig|fehlt|muss|ZIP|Bild|Datei|Startdatei|Limit|zu groß|erforderlich/i.test(message)?message:'Studio-Serverfehler. Bitte später erneut versuchen.',400);
 }
});