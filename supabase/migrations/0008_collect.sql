-- Collect: a workspace asks its own vendors and subcontractors for documents (W-9, insurance
-- certificate, license...) through an upload link, and sees who is current.
--
-- The upload link works like a passport link in reverse (Security E1/R6): the token travels in the
-- URL fragment, the database keeps its SHA-256, links expire within 90 days and can be turned off.
-- Uploads land in app.vendor_files only through app.collect_receive, which checks the link, the
-- requested kind and that the storage path belongs to the link's workspace.

create table app.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  -- Shown only to the workspace; ShipShape sends no email to vendors while email is off.
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  requested text[] not null check (
    cardinality(requested) between 1 and 9
    and requested <@ array['w9', 'coi', 'license', 'permit', 'nda', 'agreement', 'registration', 'tax', 'other']
  ),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index vendors_org_idx on app.vendors (org_id, name);
create trigger vendors_org_fixed before update on app.vendors for each row execute function app.forbid_org_change();

create table app.vendor_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  vendor_id uuid not null references app.vendors(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);
create index vendor_links_vendor_idx on app.vendor_links (vendor_id, created_at desc);
create trigger vendor_links_org_fixed before update on app.vendor_links for each row execute function app.forbid_org_change();
create trigger vendor_links_revocation before update on app.vendor_links for each row execute function app.lock_revocation();

create function app.vendor_in_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.vendors v where v.id = new.vendor_id and v.org_id = new.org_id) then
    raise exception 'vendor not in this workspace' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger vendor_links_vendor before insert on app.vendor_links for each row execute function app.vendor_in_org();

create table app.vendor_files (
  id uuid primary key,
  org_id uuid not null references app.organizations(id) on delete cascade,
  vendor_id uuid not null references app.vendors(id) on delete cascade,
  kind text not null check (kind in ('w9', 'coi', 'license', 'permit', 'nda', 'agreement', 'registration', 'tax', 'other')),
  filename text not null check (length(filename) between 1 and 200),
  storage_path text not null unique,
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  expires_on date,
  -- A made-up file generated for a sample workspace, never something a person uploaded.
  sample boolean not null default false,
  received_via uuid references app.vendor_links(id) on delete set null,
  received_at timestamptz not null default now(),
  check (storage_path = org_id::text || '/' || id::text || '/v1.' || case mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' else 'jpg' end)
);
create index vendor_files_vendor_idx on app.vendor_files (vendor_id, kind, received_at desc);
create trigger vendor_files_vendor before insert on app.vendor_files for each row execute function app.vendor_in_org();

-- What a valid upload link shows: one row per requested kind, with the latest file received for it.
-- No rows for an unknown, wrong, expired or revoked link, or an archived vendor.
create function app.collect_open(link uuid, secret_hash text)
returns table (org_id uuid, is_demo boolean, org_name text, vendor_name text, expires_at timestamptz, kind text,
  received_at timestamptz, file_expires_on date)
language plpgsql security definer set search_path = '' as $$
declare
  l app.vendor_links;
begin
  select * into l from app.vendor_links s
  where s.id = link and s.token_hash = secret_hash and s.revoked_at is null and s.expires_at > now();
  if not found then
    return;
  end if;
  return query
    select o.id, o.is_demo, o.name, v.name, l.expires_at, k.kind, f.received_at, f.expires_on
    from app.vendors v
    join app.organizations o on o.id = v.org_id
    cross join lateral unnest(v.requested) with ordinality as k(kind, n)
    left join lateral (
      select vf.received_at, vf.expires_on from app.vendor_files vf
      where vf.vendor_id = v.id and vf.kind = k.kind order by vf.received_at desc limit 1
    ) f on true
    where v.id = l.vendor_id and v.status = 'active'
    order by k.n;
end
$$;

-- Records a file a vendor sent through a valid link. The app stores the object first (at the path
-- given) and removes it again if this returns false.
create function app.collect_receive(link uuid, secret_hash text, file_id uuid, file_kind text, file_name text, path text,
  file_mime text, file_size int, file_sha256 text, file_expires date, is_sample boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  l app.vendor_links;
  v app.vendors;
  demo boolean;
begin
  select * into l from app.vendor_links s
  where s.id = link and s.token_hash = secret_hash and s.revoked_at is null and s.expires_at > now();
  if not found then
    return false;
  end if;
  select * into v from app.vendors x where x.id = l.vendor_id and x.status = 'active';
  if not found or not (file_kind = any(v.requested)) then
    return false;
  end if;
  -- Sample workspaces only ever get generated sample files; real workspaces never do.
  select o.is_demo into demo from app.organizations o where o.id = l.org_id;
  if is_sample is distinct from demo then
    return false;
  end if;
  insert into app.vendor_files (id, org_id, vendor_id, kind, filename, storage_path, mime, size_bytes, sha256, expires_on, sample, received_via)
  values (file_id, l.org_id, v.id, file_kind, file_name, path, file_mime, file_size, file_sha256, file_expires, is_sample, l.id);
  return true;
end
$$;

-- Audit: the same trigger as every other table, with the new tables mapped -----------------------

create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  org uuid;
  object uuid;
  act text;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  org := (r ->> 'org_id')::uuid;
  if not exists (select 1 from app.organizations o where o.id = org) then
    return null;
  end if;
  if tg_table_name = 'documents' then
    object := (r ->> 'id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'document.created'
      when tg_op = 'DELETE' then 'document.deleted'
      when new.status is distinct from old.status then 'document.' || case new.status when 'archived' then 'archived' else 'restored' end
      else 'document.updated' end;
  elsif tg_table_name = 'document_versions' then
    object := (r ->> 'document_id')::uuid;
    act := case r ->> 'origin' when 'signed' then 'document.signed_version_added' else 'document.version_added' end;
  elsif tg_table_name = 'acknowledgments' then
    object := (r ->> 'document_id')::uuid;
    act := 'document.acknowledged';
  elsif tg_table_name = 'profiles' then
    object := org;
    act := 'profile.updated';
  elsif tg_table_name = 'share_links' then
    object := (r ->> 'id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'passport.created'
      when tg_op = 'DELETE' then 'passport.deleted'
      when new.revoked_at is not null and old.revoked_at is null then 'passport.revoked'
      else 'passport.updated' end;
  elsif tg_table_name = 'signature_requests' then
    object := (r ->> 'document_id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'esign.requested'
      when new.status is distinct from old.status then 'esign.' || new.status
      else null end;
    if act is null then
      return null; -- code issued or a wrong code counted: logged by the functions themselves or not at all
    end if;
  elsif tg_table_name = 'vendors' then
    object := (r ->> 'id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'vendor.added'
      when new.status is distinct from old.status then 'vendor.' || case new.status when 'archived' then 'archived' else 'restored' end
      else 'vendor.updated' end;
  elsif tg_table_name = 'vendor_links' then
    object := (r ->> 'vendor_id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'collect.link_created'
      when new.revoked_at is not null and old.revoked_at is null then 'collect.link_revoked'
      else 'collect.link_updated' end;
  elsif tg_table_name = 'vendor_files' then
    object := (r ->> 'vendor_id')::uuid;
    act := 'collect.received';
  else
    raise exception 'no audit mapping for %', tg_table_name;
  end if;
  perform app.audit_write(org, (select auth.uid()), act, object);
  return null;
end
$$;

create trigger vendors_audit after insert or update on app.vendors for each row execute function app.audit_row_change();
create trigger vendor_links_audit after insert or update on app.vendor_links for each row execute function app.audit_row_change();
create trigger vendor_files_audit after insert on app.vendor_files for each row execute function app.audit_row_change();

-- Row level security ------------------------------------------------------------------------------

alter table app.vendors enable row level security;
alter table app.vendor_links enable row level security;
alter table app.vendor_files enable row level security;

create policy vendors_read on app.vendors for select to authenticated using (app.is_member(org_id));
create policy vendors_add on app.vendors for insert to authenticated
  with check (app.is_member(org_id) and created_by = (select auth.uid()));
create policy vendors_change on app.vendors for update to authenticated
  using (app.is_member(org_id)) with check (app.is_member(org_id));

create policy vendor_links_read on app.vendor_links for select to authenticated using (app.is_member(org_id));
create policy vendor_links_add on app.vendor_links for insert to authenticated
  with check (app.is_member(org_id) and created_by = (select auth.uid()));
create policy vendor_links_revoke on app.vendor_links for update to authenticated
  using (app.is_member(org_id)) with check (app.is_member(org_id) and revoked_at is not null);

create policy vendor_files_read on app.vendor_files for select to authenticated using (app.is_member(org_id));

grant select, insert on app.vendors to authenticated;
grant update (name, email, requested, status) on app.vendors to authenticated;
grant select (id, org_id, vendor_id, expires_at, revoked_at, created_by, created_at) on app.vendor_links to authenticated;
grant insert (org_id, vendor_id, token_hash, expires_at, created_by) on app.vendor_links to authenticated;
grant update (revoked_at) on app.vendor_links to authenticated;
grant select on app.vendor_files to authenticated;
grant select, insert, update, delete on app.vendors, app.vendor_links, app.vendor_files to service_role;

revoke execute on function app.vendor_in_org(), app.collect_open(uuid, text),
  app.collect_receive(uuid, text, uuid, text, text, text, text, int, text, date, boolean) from public;
grant execute on function app.collect_open(uuid, text),
  app.collect_receive(uuid, text, uuid, text, text, text, text, int, text, date, boolean) to anon, authenticated;

-- Account deletion also returns vendor files, so their objects are removed with the workspace's.
create or replace function app.delete_my_account() returns table (storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  doomed uuid[];
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select coalesce(array_agg(m.org_id), '{}') into doomed
  from app.members m
  where m.user_id = me and m.role = 'owner'
    and not exists (select 1 from app.members o where o.org_id = m.org_id and o.role = 'owner' and o.user_id <> me);

  return query
    select v.storage_path from app.document_versions v where v.org_id = any(doomed)
    union all
    select f.storage_path from app.vendor_files f where f.org_id = any(doomed);
  delete from app.organizations o where o.id = any(doomed);
  delete from auth.users u where u.id = me;
end
$$;
