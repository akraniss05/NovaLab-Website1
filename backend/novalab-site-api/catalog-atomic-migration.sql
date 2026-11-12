-- NovaLab Website1 only. Run once on the Website Supabase project.
-- Atomic, service-role-only project-catalog read/write to prevent simultaneous admin updates.
create table if not exists public.novalab_site_catalog_meta (
 singleton boolean primary key default true check(singleton),
 revision uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now()
);
alter table public.novalab_site_catalog_meta enable row level security;
revoke all on public.novalab_site_catalog_meta from public, anon, authenticated;
grant select, update on public.novalab_site_catalog_meta to service_role;
insert into public.novalab_site_catalog_meta (singleton) values (true) on conflict (singleton) do nothing;

create or replace function public.novalab_site_catalog_read() returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $fn$
declare v_revision uuid; v_projects jsonb;
begin
 select revision into v_revision from public.novalab_site_catalog_meta where singleton=true for share;
 if v_revision is null then raise exception 'Catalog version row missing'; end if;
 select coalesce(jsonb_agg(p.data order by p.sort_order,p.id),'[]'::jsonb)
 into v_projects from public.novalab_site_projects p;
 return jsonb_build_object('projects',v_projects,'revision',v_revision::text);
end;
$fn$;

create or replace function public.novalab_site_catalog_apply(p_expected_revision text,p_projects jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $fn$
declare v_revision uuid; v_new_revision uuid; v_count integer;
begin
 if jsonb_typeof(p_projects) is distinct from 'array' or jsonb_array_length(p_projects)>100 then
   raise exception 'Invalid catalog payload';
 end if;
 select revision into v_revision from public.novalab_site_catalog_meta where singleton=true for update;
 if v_revision is null then raise exception 'Catalog version row missing'; end if;
 if p_expected_revision is distinct from v_revision::text then
   return jsonb_build_object('conflict',true,'revision',v_revision::text);
 end if;
 v_count=jsonb_array_length(p_projects);
 delete from public.novalab_site_projects p
 where not exists(select 1 from jsonb_array_elements(p_projects) value where value->>'id'=p.id);
 insert into public.novalab_site_projects(id,data,sort_order,updated_at)
 select value->>'id',value,ordinality::integer-1,clock_timestamp()
 from jsonb_array_elements(p_projects) with ordinality as source(value,ordinality)
 on conflict(id) do update set data=excluded.data,sort_order=excluded.sort_order,updated_at=excluded.updated_at;
 update public.novalab_site_catalog_meta set revision=gen_random_uuid(),updated_at=clock_timestamp()
 where singleton=true returning revision into v_new_revision;
 return jsonb_build_object('ok',true,'count',v_count,'revision',v_new_revision::text);
end;
$fn$;

-- SECURITY INVOKER + strict permissions. Browser/anon users cannot call catalog RPCs.
revoke all on function public.novalab_site_catalog_read() from public, anon, authenticated;
revoke all on function public.novalab_site_catalog_apply(text,jsonb) from public, anon, authenticated;
grant execute on function public.novalab_site_catalog_read() to service_role;
grant execute on function public.novalab_site_catalog_apply(text,jsonb) to service_role;
