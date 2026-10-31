-- Security C-4 (and R2): every file (document versions and files vendors send) lives in one private
-- Supabase Storage bucket, `documents`, that only the server reaches, with the service role, through
-- 5-minute signed URLs. Nothing in storage may let anonymous or signed-in users read, list or write.
--
-- The app schema must also never be exposed through Supabase's Data API: anon may execute
-- app.collect_open/collect_receive, which is safe only because the app alone calls them. That is a
-- project setting SQL can't see, so `node scripts/probe-supabase.mjs` checks it over HTTP before launch.
--
-- Runs only where Supabase Storage exists; the local PGlite database has no storage schema.

-- What's wrong with the storage setup, one line per problem; nothing means locked down.
create function app.storage_lockdown_problems() returns setof text
language plpgsql stable set search_path = '' as $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
    return next 'row level security is off on storage.objects';
  end if;
  return query
    select format('storage policy %I on %I.%I applies to %s', p.policyname, p.schemaname, p.tablename, array_to_string(p.roles, ', '))
    from pg_policies p
    where p.schemaname = 'storage' and p.roles && array['public', 'anon', 'authenticated']::name[];
  return query
    select format('bucket %I is public', b.id) from storage.buckets b where b.public;
end
$$;

do $$
declare
  problems text;
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  select string_agg(p, '; ') into problems from app.storage_lockdown_problems() p;
  if problems is not null then
    raise exception 'storage is not locked down: %', problems;
  end if;
end
$$;
