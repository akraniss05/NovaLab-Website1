// NovaLab Studios admin backend. No passwords or API secrets in this source.
// Authenticated site-admin sessions are independently signed server-side.
// Data is isolated from the NovaLab Academy tables.
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const root = Deno.env.get("SUPABASE_URL")!;
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
if (!root || !secret) throw new Error("Supabase server environment missing");
const db = createClient(root, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const ALLOWED_ORIGINS = new Set(["https://akraniss05.github.io"]);
const BUCKET = "novalab-site-media";
const enc = new TextEncoder();
const dec = new TextDecoder();
const now = () => Math.floor(Date.now() / 1000);

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const unb64 = (s: string) => {
  const base = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base + "=".repeat((4 - base.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
const fromHex = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], s => parseInt(s, 16));
const signingKeyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("novalab-site-admin-session-v1:" + secret)));
const signingKey = await crypto.subtle.importKey("raw", signingKeyBytes, { name:"HMAC", hash:"SHA-256" }, false, ["sign","verify"]);
const send = (req: Request, data: unknown, status=200) => {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string,string> = {
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store", "vary":"Origin",
    "x-content-type-options":"nosniff"
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"]=origin;
  return new Response(JSON.stringify(data),{status,headers});
};
const preflight = (req:Request) => {
  const origin=req.headers.get("origin")||"";
  if (!ALLOWED_ORIGINS.has(origin)) return new Response(null,{status:403});
  return new Response(null,{status:204,headers:{
    "access-control-allow-origin":origin,
    "access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers":"authorization,content-type,apikey,x-client-info",
    "access-control-max-age":"600","vary":"Origin"
  }});
};
async function readBody(req:Request,max=260000){
  const size=Number(req.headers.get("content-length")||"0");
  if(size>max)throw new Error("Anfrage zu groß.");
  const raw=await req.text();
  if(raw.length>max)throw new Error("Anfrage zu groß.");
  return JSON.parse(raw);
}
async function newSession(username:string, version:number){
  const head=b64url(enc.encode(JSON.stringify({typ:"JWT",alg:"HS256"})));
  const payload=b64url(enc.encode(JSON.stringify({
    sub:username,ver:version,aud:"novalab-site-admin",iat:now(),exp:now()+21600
  })));
  const unsigned=head+"."+payload;
  const signature=new Uint8Array(await crypto.subtle.sign("HMAC",signingKey,enc.encode(unsigned)));
  return unsigned+"."+b64url(signature);
}
async function verifySession(req:Request){
  const raw=req.headers.get("authorization")||"";
  const token=raw.startsWith("Bearer ")?raw.slice(7):"";
  const parts=token.split(".");
  if(parts.length!==3||token.length>3500)return null;
  try{
    const ok=await crypto.subtle.verify("HMAC",signingKey,unb64(parts[2]),enc.encode(parts[0]+"."+parts[1]));
    if(!ok)return null;
    const jwt=JSON.parse(dec.decode(unb64(parts[1])));
    if(jwt.aud!=="novalab-site-admin"||!Number.isSafeInteger(jwt.exp)||jwt.exp<=now()||jwt.exp>now()+21610||!Number.isInteger(jwt.ver)||typeof jwt.sub!=="string")return null;
    const {data,error}=await db.from("novalab_site_admins").select("username,session_version").eq("username",jwt.sub).maybeSingle();
    if(error||!data||data.session_version!==jwt.ver)return null;
    return {username:data.username,version:data.session_version};
  }catch{return null}
}
async function verifyPassword(password:string,salt:string,hash:string,iterations:number){
  const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  const output=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:fromHex(salt),iterations},key,256));
  const expected=fromHex(hash);
  let difference=0;
  for(let i=0;i<32;i++)difference|=output[i]^expected[i];
  return difference===0;
}
function cleanText(x:unknown,n=400){
  return String(x??"").trim().slice(0,n);
}
function safeURL(input:unknown, allowRoute=false){
  const s=cleanText(input,1200);
  if(!s)return "";
  if(allowRoute&&/^#[a-z][a-z0-9/-]{1,75}$/i.test(s))return s;
  try{const u=new URL(s);if(u.protocol==="https:"&&u.username===""&&u.password==="")return u.href}catch{}
  if(/^\.\/assets\/uploads\/[a-zA-Z0-9._-]+$/.test(s))return s;
  return "";
}
function cleanProject(p: Record<string,unknown>,index:number){
  const id=cleanText(p.id,70).toLowerCase();
  if(!/^[a-z0-9-]{3,70}$/.test(id))throw new Error("Ungültige Projekt-ID.");
  const title=cleanText(p.title,90);
  const summary=cleanText(p.summary||p.description,250);
  if(!title||!summary)throw new Error("Projektname und Beschreibung fehlen.");
  const category=["coding","music","games","tools"].includes(String(p.category))?String(p.category):"tools";
  const tags=Array.isArray(p.tags)?p.tags.map(x=>cleanText(x,35)).filter(Boolean).slice(0,15):[];
  const gallery=Array.isArray(p.gallery)?p.gallery.map(x=>safeURL(x)).filter(Boolean).slice(0,15):[];
  return {
    id,title,summary,description:cleanText(p.description,6000),category,
    status:cleanText(p.status,50)||"In Planung",link:safeURL(p.link,true),
    cover:safeURL(p.cover),gallery,video:safeURL(p.video),tags,
    updated:cleanText(p.updated,30)||new Date().toISOString().slice(0,10),
    featured:p.featured!==false,sort_index:index
  };
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return preflight(req);
  const url=new URL(req.url),path=url.pathname.split("/novalab-site-api")[1]||"/";
  const origin=req.headers.get("origin");
  if(origin&&!ALLOWED_ORIGINS.has(origin))return send(req,{error:"Origin nicht erlaubt"},403);
  try{
    if(req.method==="GET"&&path==="/health")return send(req,{status:"ok",project:"NovaLab Studios"});
    if(req.method==="GET"&&path==="/projects"){
      const {data,error}=await db.from("novalab_site_projects").select("data").order("sort_order");
      if(error)throw error;
      return send(req,{projects:(data||[]).map(row=>row.data)});
    }
    if(req.method==="POST"&&path==="/login"){
      const input=await readBody(req,1600);
      const username=cleanText(input.username,32).toLowerCase();
      const password=String(input.password||"");
      if(!/^[a-z0-9_-]{3,32}$/.test(username)||password.length<1||password.length>128){
        return send(req,{error:"Anmeldung fehlgeschlagen."},401);
      }
      const {data:admin,error}=await db.from("novalab_site_admins").select("username,salt_hex,hash_hex,iterations,failed_attempts,locked_until,session_version").eq("username",username).maybeSingle();
      if(error)throw error;
      if(admin?.locked_until&&new Date(admin.locked_until).getTime()>Date.now())
        return send(req,{error:"Zu viele Versuche. Bitte später erneut anmelden."},429);
      const dummySalt="abababababababababababababababababababababababab";
      const dummyHash="abababababababababababababababababababababababababababababababab";
      const pass=await verifyPassword(password,admin?.salt_hex||dummySalt,admin?.hash_hex||dummyHash,admin?.iterations||450000);
      if(!pass||!admin){
        if(admin){
          const attempts=(admin.failed_attempts||0)+1;
          await db.from("novalab_site_admins").update({
            failed_attempts:attempts>=6?0:attempts,
            locked_until:attempts>=6?new Date(Date.now()+15*60*1000).toISOString():null
          }).eq("username",username);
        }
        return send(req,{error:"Anmeldung fehlgeschlagen."},401);
      }
      await db.from("novalab_site_admins").update({failed_attempts:0,locked_until:null,last_login_at:new Date().toISOString()}).eq("username",username);
      const token=await newSession(admin.username,admin.session_version);
      return send(req,{token,username:admin.username,expiresIn:21600});
    }
    const session=await verifySession(req);
    if(!session)return send(req,{error:"Nicht angemeldet oder Sitzung abgelaufen."},401);
    if(req.method==="GET"&&path==="/me")return send(req,{username:session.username,role:"admin"});
    if(req.method==="POST"&&path==="/logout"){
      await db.from("novalab_site_admins").update({session_version:session.version+1}).eq("username",session.username).eq("session_version",session.version);
      return send(req,{ok:true});
    }
    if(req.method==="PUT"&&path==="/projects"){
      const body=await readBody(req,350000);
      if(!Array.isArray(body.projects)||body.projects.length>100)throw new Error("Ungültiger Projektkatalog.");
      const items=body.projects.map((p:Record<string,unknown>,i:number)=>cleanProject(p,i));
      const unique=new Set(items.map(p=>p.id));
      if(unique.size!==items.length)throw new Error("Projekt-IDs müssen eindeutig sein.");
      if(items.length){
        const {error}=await db.from("novalab_site_projects").upsert(items.map(p=>({id:p.id,data:p,sort_order:p.sort_index,updated_at:new Date().toISOString()})),{onConflict:"id"});
        if(error)throw error;
      }
      const {data:current,error:lookupError}=await db.from("novalab_site_projects").select("id");
      if(lookupError)throw lookupError;
      const stale=(current||[]).map(p=>p.id).filter(id=>!unique.has(id));
      if(stale.length){const {error}=await db.from("novalab_site_projects").delete().in("id",stale);if(error)throw error}
      return send(req,{ok:true,count:items.length,updatedBy:session.username});
    }
    if(req.method==="POST"&&path==="/media"){
      const body=await readBody(req,17500000);
      const mime=cleanText(body.mime,80),kind=mime.startsWith("image/")?"image":"video";
      const extensions:Record<string,string>={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","video/mp4":"mp4","video/webm":"webm"};
      const ext=extensions[mime];
      if(!ext)return send(req,{error:"Nur PNG/JPG/WebP und MP4/WebM erlaubt."},400);
      const base64=String(body.base64||"");
      if(!/^[a-zA-Z0-9+/=\s]+$/.test(base64))return send(req,{error:"Ungültige Bild- oder Videodaten."},400);
      const limit=kind==="image"?4*1024*1024:12*1024*1024;
      if(base64.length>limit*1.4) return send(req,{error:"Datei zu groß."},413);
      const raw=atob(base64.replace(/\s/g,""));
      const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
      if(bytes.byteLength>limit)return send(req,{error:"Datei zu groß."},413);
      const id=crypto.randomUUID(),path="nova-"+id+"."+ext;
      const {error}=await db.storage.from(BUCKET).upload(path,bytes,{contentType:mime,upsert:false,cacheControl:"3600"});
      if(error)throw error;
      const {data}=db.storage.from(BUCKET).getPublicUrl(path);
      return send(req,{url:data.publicUrl});
    }
    return send(req,{error:"Route nicht gefunden."},404);
  }catch(error){
    console.error("NovaLab API error",error instanceof Error?error.message:"unexpected");
    const message=error instanceof Error&&["Anfrage zu groß.","Ungültiger Projektkatalog.","Ungültige Projekt-ID.","Projektname und Beschreibung fehlen.","Projekt-IDs müssen eindeutig sein."].includes(error.message)?error.message:"Die Anfrage konnte nicht verarbeitet werden.";
    return send(req,{error:message},message==="Die Anfrage konnte nicht verarbeitet werden."?500:400);
  }
});
