-- NovaLab Studio 0.6.0 (2026-11-10)
-- Non-destructive additive migration: preserves launcher accounts and existing game records.
create table if not exists public.novalab_studio_games (
 id text primary key check (id ~ '^community-[a-z0-9][a-z0-9-]{2,49}$'),
 title text not null check(char_length(title) between 3 and 80),
 summary text not null default '',
 description text not null default '',
 developer text not null default 'NovaLab Studios',
 publisher text not null default 'NovaLab Studios',
 genre text not null default 'Indie',
 tags text[] not null default '{}',
 status text not null default 'In Entwicklung',
 visibility text not null default 'draft' check(visibility in('draft','published','unlisted','archived')),
 featured boolean not null default false,
 requirements jsonb not null default '{}'::jsonb,
 features jsonb not null default '{}'::jsonb,
 created_by uuid references public.novalab_launcher_accounts(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.novalab_studio_media (
 id uuid primary key default gen_random_uuid(),
 game_id text not null references public.novalab_studio_games(id) on delete cascade,
 kind text not null check(kind in('cover','banner','screenshot','video')),
 file_path text not null unique,
 mime_type text not null,
 alt_text text not null default '',
 sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists novalab_studio_media_order on public.novalab_studio_media(game_id,kind,sort_order);
create table if not exists public.novalab_studio_versions (
 id uuid primary key default gen_random_uuid(),
 game_id text not null references public.novalab_studio_games(id) on delete cascade,
 version text not null check(version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
 channel text not null default 'stable' check(channel in('stable','beta')),
 format text not null check(format in('html','windows')),
 entry text not null,
 file_path text not null unique,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 file_size bigint not null check(file_size>0),
 changelog text not null default '',
 created_at timestamptz not null default now(),
 unique(game_id,version,channel)
);
create index if not exists novalab_studio_versions_by_game on public.novalab_studio_versions(game_id,created_at desc);
create table if not exists public.novalab_studio_audit (
 id bigint generated always as identity primary key,
 account_id uuid references public.novalab_launcher_accounts(id) on delete set null,
 game_id text,
 action text not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists novalab_studio_audit_recent on public.novalab_studio_audit(created_at desc);
alter table public.novalab_studio_games enable row level security;
alter table public.novalab_studio_media enable row level security;
alter table public.novalab_studio_versions enable row level security;
alter table public.novalab_studio_audit enable row level security;
revoke all on public.novalab_studio_games,public.novalab_studio_media,public.novalab_studio_versions,public.novalab_studio_audit from anon,authenticated;
-- Admin writes and public catalog reads are mediated exclusively through the Edge Function
-- which verifies novalab_launcher_sessions against server-side account.role.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('novalab-studio-media','novalab-studio-media',true,8388608,array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
