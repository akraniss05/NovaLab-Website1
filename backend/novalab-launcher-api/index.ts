import { createClient } from 'jsr:@supabase/supabase-js@2';

/** NovaLab Launcher public catalog + server-side accounts and admin-only game uploads. */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const BUCKET = 'novalab-launcher-games';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'cache-control': 'no-store' };
const encoder = new TextEncoder();
const MAX_ARCHIVE = 12 * 1024 * 1024;
const USERNAME = /^[a-zA-Z][a-zA-Z0-9_]{2,23}$/;
const GAME_ID = /^community-[a-z0-9][a-z0-9-]{2,49}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const DUMMY_SALT = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NQ==';
const DUMMY_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' } }); }
function error(message: string, status = 400) { return json({ error: message }, status); }
function b64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function bytesB64(value: string): Uint8Array { const raw = atob(value); return Uint8Array.from(raw, x => x.charCodeAt(0)); }
function hex(bytes: Uint8Array): string { return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join(''); }
async function sha(bytes: Uint8Array) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))); }
async function hashText(value: string) { return sha(encoder.encode(value)); }
async function pbkdf2(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytesB64(salt), iterations: 210_000 }, key, 256);
  return b64(new Uint8Array(derived));
}
function matches(a: string, b: string) { const x = encoder.encode(a), y = encoder.encode(b); if (x.length !== y.length) return false; let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]; return diff === 0; }
async function consume(key: string, max: number, windowSecs: number) {
  const { data, error: dbError } = await db.rpc('novalab_launcher_consume_rate', { p_key: await hashText(key), p_threshold: max, p_window_secs: windowSecs });
  if (dbError) throw dbError;
  return data === true;
}
async function payload(req: Request) { if (Number(req.headers.get('content-length') || 0) > 12000) throw new Error('Anfrage zu groß'); const body = await req.text(); if (body.length > 12000) throw new Error('Anfrage zu groß'); return JSON.parse(body); }
function publicAccount(a: any) { return { username: a.username, role: a.role, mustChangePassword: !!a.must_change_password }; }
async function authenticate(req: Request) {
  const raw = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '');
  if (!raw) return null;
  const tokenHash = await hashText(raw[1]);
  const { data: session, error: sessionError } = await db.from('novalab_launcher_sessions').select('account_id').eq('token_hash', tokenHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (sessionError || !session) return null;
  const { data: account } = await db.from('novalab_launcher_accounts').select('id, username, role, must_change_password').eq('id', session.account_id).maybeSingle();
  return account ? { account, tokenHash } : null;
}
function ipOf(req: Request) { return (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim().slice(0, 80); }
function gameToPublic(g: any) {
  const url = db.storage.from(BUCKET).getPublicUrl(g.file_path).data.publicUrl;
  return { id: g.id, title: g.title, subtitle: 'Ein Mini-Game von NovaLab Studios', description: g.description, type: 'game', status: 'Jetzt spielbar', tags: ['Mini-Game', 'HTML5', 'Free'], accent: '#ad80ff', release: { format: 'html', version: g.version, url, sha256: g.sha256, entry: 'index.html' } };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const endpoint = new URL(req.url).pathname.split('/').filter(Boolean).pop() || '';
  try {
    if (endpoint === 'catalog' && req.method === 'GET') {
      const { data, error: dbError } = await db.from('novalab_launcher_games').select('id,title,description,version,file_path,sha256,published').eq('published', true).order('created_at', { ascending: false }).limit(100);
      if (dbError) throw dbError;
      return json({ games: (data || []).map(gameToPublic) });
    }
    if (endpoint === 'register' && req.method === 'POST') {
      const body = await payload(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!USERNAME.test(username)) return error('Benutzername: 3–24 Zeichen, Buchstaben, Zahlen und Unterstriche.');
      if (password.length < 10 || password.length > 128) return error('Passwort muss 10–128 Zeichen enthalten.');
      if (!(await consume('signup:' + ipOf(req), 5, 3600))) return error('Registrierungs-Limit erreicht. Bitte später erneut versuchen.', 429);
      const salt = b64(crypto.getRandomValues(new Uint8Array(24)));
      const password_hash = await pbkdf2(password, salt);
      const { error: dbError } = await db.from('novalab_launcher_accounts').insert({ username, password_hash, salt, role: 'user', must_change_password: false });
      if (dbError) return dbError.code === '23505' ? error('Dieser Benutzername ist vergeben.', 409) : error('Registrierung gerade nicht möglich.', 503);
      return json({ success: true, message: 'Account erstellt. Du kannst dich anmelden.' }, 201);
    }
    if (endpoint === 'login' && req.method === 'POST') {
      const body = await payload(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!USERNAME.test(username) || !password || password.length > 128) return error('Ungültiger Benutzername oder Passwort.', 401);
      if (!(await consume('login-ip:' + ipOf(req), 30, 900))) return error('Zu viele Versuche. Bitte später erneut versuchen.', 429);
      if (!(await consume('login-user:' + username, 12, 900))) return error('Zu viele Versuche für diesen Account. Bitte später erneut versuchen.', 429);
      const { data: account } = await db.from('novalab_launcher_accounts').select('id,username,password_hash,salt,role,must_change_password,failed_attempts,locked_until').ilike('username', username).maybeSingle();
      const candidate = await pbkdf2(password, account?.salt || DUMMY_SALT);
      const valid = matches(candidate, account?.password_hash || DUMMY_HASH);
      if (!account || !valid || (account.locked_until && new Date(account.locked_until).getTime() > Date.now())) {
        if (account && !valid) await db.from('novalab_launcher_accounts').update({ failed_attempts: Number(account.failed_attempts || 0) + 1, locked_until: Number(account.failed_attempts || 0) >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null }).eq('id', account.id);
        return error('Ungültiger Benutzername oder Passwort.', 401);
      }
      await db.from('novalab_launcher_accounts').update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() }).eq('id', account.id);
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const { error: dbError } = await db.from('novalab_launcher_sessions').insert({ token_hash: await hashText(token), account_id: account.id, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() });
      if (dbError) throw dbError;
      return json({ token, account: publicAccount(account) });
    }
    if (endpoint === 'me' && req.method === 'GET') {
      const auth = await authenticate(req);
      return auth ? json({ account: publicAccount(auth.account) }) : error('Nicht angemeldet.', 401);
    }
    if (endpoint === 'logout' && req.method === 'POST') {
      const auth = await authenticate(req);
      if (auth) await db.from('novalab_launcher_sessions').delete().eq('token_hash', auth.tokenHash);
      return json({ success: true });
    }
    if (endpoint === 'change-password' && req.method === 'POST') {
      const auth = await authenticate(req);
      if (!auth) return error('Bitte zuerst anmelden.', 401);
      const body = await payload(req);
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 12 || newPassword.length > 128 || oldPassword === newPassword) return error('Neues Passwort: mindestens 12 Zeichen, nicht mit dem alten identisch.');
      if (!(await consume('password-change:' + auth.account.id, 10, 3600))) return error('Zu viele Änderungsversuche.', 429);
      const { data: stored } = await db.from('novalab_launcher_accounts').select('salt,password_hash').eq('id', auth.account.id).single();
      if (!stored || !matches(await pbkdf2(oldPassword, stored.salt), stored.password_hash)) return error('Aktuelles Passwort ist falsch.', 401);
      const salt = b64(crypto.getRandomValues(new Uint8Array(24)));
      const { error: dbError } = await db.from('novalab_launcher_accounts').update({ salt, password_hash: await pbkdf2(newPassword, salt), must_change_password: false }).eq('id', auth.account.id);
      if (dbError) throw dbError;
      await db.from('novalab_launcher_sessions').delete().eq('account_id', auth.account.id);
      return json({ success: true, message: 'Passwort geändert. Bitte erneut anmelden.' });
    }
    if (endpoint === 'admin-games' && req.method === 'GET') {
      const auth = await authenticate(req);
      if (!auth || auth.account.role !== 'admin' || auth.account.must_change_password) return error('Keine Admin-Berechtigung.', 403);
      const { data, error: dbError } = await db.from('novalab_launcher_games').select('id,title,description,version,published,created_at').order('created_at', { ascending: false }).limit(100);
      if (dbError) throw dbError;
      return json({ games: data || [] });
    }
    if (endpoint === 'visibility' && req.method === 'POST') {
      const auth = await authenticate(req);
      if (!auth || auth.account.role !== 'admin' || auth.account.must_change_password) return error('Keine Admin-Berechtigung.', 403);
      const body = await payload(req);
      if (!GAME_ID.test(body.id || '') || typeof body.published !== 'boolean') return error('Ungültige Daten.');
      const { error: dbError } = await db.from('novalab_launcher_games').update({ published: body.published, updated_at: new Date().toISOString() }).eq('id', body.id);
      if (dbError) throw dbError;
      return json({ success: true });
    }
    if (endpoint === 'upload' && req.method === 'POST') {
      const auth = await authenticate(req);
      if (!auth || auth.account.role !== 'admin') return error('Keine Admin-Berechtigung.', 403);
      if (auth.account.must_change_password) return error('Bitte zuerst dein Admin-Passwort ändern.', 403);
      if (!(await consume('upload:' + auth.account.id, 20, 3600))) return error('Upload-Limit erreicht.', 429);
      if (Number(req.headers.get('content-length') || 0) > MAX_ARCHIVE + 30_000) return error('Spielpaket zu groß.', 413);
      const form = await req.formData();
      const title = String(form.get('title') || '').trim().slice(0, 80);
      const description = String(form.get('description') || '').trim().slice(0, 900);
      const id = String(form.get('id') || '').trim();
      const version = String(form.get('version') || '').trim();
      const file = form.get('file');
      if (!GAME_ID.test(id) || title.length < 3 || !VERSION.test(version) || !(file instanceof File)) return error('Titel, Slug, Version oder Datei ungültig.');
      if (file.size < 30 || file.size > MAX_ARCHIVE) return error('Spielpaket muss zwischen 30 Bytes und 12 MB groß sein.', 413);
      const raw = new Uint8Array(await file.arrayBuffer());
      if (raw[0] !== 0x50 || raw[1] !== 0x4b || raw[2] !== 0x03 || raw[3] !== 0x04) return error('Nur ZIP-Archive mit index.html werden unterstützt.');
      const digest = await sha(raw);
      const path = `${id}/${version}/${crypto.randomUUID()}.zip`;
      const { error: uploadError } = await db.storage.from(BUCKET).upload(path, raw, { contentType: 'application/zip', cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const { error: dbError } = await db.from('novalab_launcher_games').upsert({ id, title, description, version, file_path: path, sha256: digest, file_size: raw.byteLength, published: true, uploaded_by: auth.account.id, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (dbError) { await db.storage.from(BUCKET).remove([path]); throw dbError; }
      return json({ success: true, game: gameToPublic({ id, title, description, version, file_path: path, sha256: digest }) }, 201);
    }
    return error('Route nicht gefunden.', 404);
  } catch (e) {
    console.error('NovaLab Launcher API:', e instanceof Error ? e.message : 'unknown');
    return error('Serverfehler. Bitte später erneut versuchen.', 500);
  }
});