-- NovaLab Launcher v0.7.0: safe catalog archiving and first-party desktop product publishing.
-- Additive migration. No legacy games, accounts, or user save files are deleted.
create table if not exists public.novalab_catalog_suppressions(
 id text primary key check(id ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
 archived_at timestamptz not null default now(),
 archived_by uuid references public.novalab_launcher_accounts(id) on delete set null,
 reason text not null default ''
);
alter table public.novalab_catalog_suppressions enable row level security;
revoke all on public.novalab_catalog_suppressions from anon,authenticated;
alter table public.novalab_studio_games add column if not exists kind text not null default 'game' check(kind in ('game','app','tool'));
alter table public.novalab_studio_media add column if not exists external_url text;
alter table public.novalab_studio_versions add column if not exists external_url text;
create index if not exists novalab_studio_media_game_path on public.novalab_studio_media(game_id,file_path);
create index if not exists novalab_studio_versions_game_path on public.novalab_studio_versions(game_id,file_path);
-- First-party external_url is not client-writable. Server allowlists the exact official domains.
-- The following seed is non-destructive and idempotent: existing user edits are never overwritten.
insert into public.novalab_studio_games
(id,title,summary,description,developer,publisher,genre,tags,status,visibility,featured,requirements,features,kind)
values(
'community-novalab-code',
'NovaLab Code',
'Lerne Programmieren. Entwickle eigene Projekte. Erweitere deine Fähigkeiten.',
'## Über NovaLab Code
Die Windows-Desktop-Ausgabe unserer bestehenden Coding-Lernplattform. Strukturierte Kurse, praktische Aufgaben, Quizze und Lernfortschritt.
## Online-Dienste
Anmeldung und Lerninhalte greifen auf den vorhandenen Supabase-Server zu. Eine Internetverbindung ist erforderlich.',
'NovaLab Studios','NovaLab Studios','Lernsoftware',
array['Coding','Programmieren','Bildung','Apps & Tools','Kostenlos'],
'Early Access','published',true,
'{"minimum":"Windows 10 64-bit, Internetverbindung","recommended":"Windows 11 64-bit, Internetverbindung"}'::jsonb,
'{"multiplayer":false,"controller":false,"languages":"Deutsch, Englisch (je nach Kurs)"}'::jsonb,
'app')
on conflict(id) do nothing;
insert into public.novalab_studio_media(game_id,kind,file_path,mime_type,alt_text,external_url,sort_order)
values
('community-novalab-code','cover','external/novalab-code/cover.svg','image/svg+xml','NovaLab Code Store-Cover','https://akraniss05.github.io/NovaLab-Website1/launcher/assets/novalab-code-cover.svg',0),
('community-novalab-code','banner','external/novalab-code/banner.svg','image/svg+xml','NovaLab Code Banner','https://akraniss05.github.io/NovaLab-Website1/launcher/assets/novalab-code-banner.svg',0)
on conflict(file_path) do nothing;
insert into public.novalab_studio_versions
(game_id,version,channel,format,entry,file_path,sha256,file_size,changelog,external_url)
values(
'community-novalab-code','1.0.0','stable','windows','NovaLab Code.exe',
'external/novalab-code/1.0.0/novalab-code.zip',
'a5f9247d7db0a8066273177583ae25d9e0caf213db637356906b1b8a75b09593',
158870468,
'Erste Windows-Desktop-Ausgabe mit bestehender Lernplattform, Online-Anmeldung und vorhandenen Kursfunktionen.',
'https://github.com/akraniss05/NovaLab-Code/releases/download/code-v1.0.0/NovaLab-Code-win-x64-v1.0.0.zip')
on conflict(game_id,version,channel) do nothing;
