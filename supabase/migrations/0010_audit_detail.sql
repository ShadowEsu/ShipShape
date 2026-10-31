-- Security F2 (R6): a document version's SHA-256, a signed copy's included, goes into the
-- hash-chained history itself, not only into document_versions, so a swapped file shows up as a
-- break in the chain. The hash covers the fingerprint only when a row has one, so every row
-- written before this migration still verifies.

alter table app.audit_log add column detail_sha256 text check (detail_sha256 ~ '^[0-9a-f]{64}$');

create function app.audit_hash(org uuid, seq bigint, at timestamptz, actor uuid, action text, object_id uuid, prev_hash text, detail text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|',
    org::text, seq::text, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(actor::text, '-'), action, coalesce(object_id::text, '-'), prev_hash) || coalesce('|sha256:' || detail, ''), 'UTF8')), 'hex')
$$;

-- Internal: callable only by other functions in this schema (no grants).
drop function app.audit_write(uuid, uuid, text, uuid);
create function app.audit_write(org uuid, actor uuid, action text, object_id uuid, detail text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  prev record;
  next_seq bigint;
  ts timestamptz := clock_timestamp();
  prev_h text;
begin
  perform 1 from app.organizations o where o.id = org for update;
  if not found then
    raise exception 'unknown organization' using errcode = '42501';
  end if;
  select a.seq, a.hash into prev from app.audit_log a where a.org_id = org order by a.seq desc limit 1;
  next_seq := coalesce(prev.seq, 0) + 1;
  prev_h := coalesce(prev.hash, 'genesis');
  insert into app.audit_log (org_id, seq, at, actor, action, object_id, prev_hash, hash, detail_sha256)
  values (org, next_seq, ts, actor, action, object_id, prev_h, app.audit_hash(org, next_seq, ts, actor, action, object_id, prev_h, detail), detail);
  return next_seq;
end
$$;

-- Returns the first broken sequence number, or null when the whole chain checks out.
create or replace function app.audit_verify(org uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  expected_prev text := 'genesis';
  expected_seq bigint := 1;
begin
  if (select auth.uid()) is null or not app.is_member(org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  for r in select * from app.audit_log a where a.org_id = org order by a.seq loop
    if r.seq <> expected_seq or r.prev_hash <> expected_prev
       or r.hash <> app.audit_hash(r.org_id, r.seq, r.at, r.actor, r.action, r.object_id, r.prev_hash, r.detail_sha256) then
      return expected_seq;
    end if;
    expected_prev := r.hash;
    expected_seq := expected_seq + 1;
  end loop;
  return null;
end
$$;

drop function app.audit_hash(uuid, bigint, timestamptz, uuid, text, uuid, text);

-- The audit trigger, now passing each new document version's SHA-256 as the row's fingerprint.
create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  org uuid;
  object uuid;
  act text;
  detail text;
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
    detail := r ->> 'sha256';
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
    detail := r ->> 'sha256';
  else
    raise exception 'no audit mapping for %', tg_table_name;
  end if;
  perform app.audit_write(org, (select auth.uid()), act, object, detail);
  return null;
end
$$;
