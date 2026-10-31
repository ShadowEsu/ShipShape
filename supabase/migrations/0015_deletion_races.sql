-- Security F5 and F7, both about deleting an account.
--
-- F5: two co-owners deleting their accounts at the same moment could each see the other as the
-- remaining owner and leave the workspace with none. delete_my_account now locks the person's
-- workspaces first, so the second deletion waits and then sees the first one's result.
--
-- F7: deleting a user nulls their created_by/updated_by references through UPDATEs. The stamp
-- trigger then wrote the departing user back into profiles.updated_by, and the audit trigger
-- recorded "document.updated" / "profile.updated" for a change nobody made. Both now ignore an
-- update that changes nothing but who-made-it columns.

create or replace function app.stamp_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - array['created_by', 'updated_by', 'updated_at']) = (to_jsonb(old) - array['created_by', 'updated_by', 'updated_at']) then
    return new; -- a deleted user's references being cleared, or a save that changes nothing
  end if;
  new.updated_at := now();
  if tg_table_name = 'profiles' then
    new.updated_by := (select auth.uid());
  end if;
  return new;
end
$$;

-- The audit trigger as in 0012, skipping updates that change only who-made-it columns.
create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  org uuid;
  object uuid;
  act text;
  detail text;
begin
  if tg_op = 'UPDATE'
    and (to_jsonb(new) - array['created_by', 'updated_by', 'updated_at']) = (to_jsonb(old) - array['created_by', 'updated_by', 'updated_at']) then
    return null;
  end if;
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
    act := case tg_op when 'DELETE' then 'collect.file_deleted' else 'collect.received' end;
    detail := r ->> 'sha256';
  else
    raise exception 'no audit mapping for %', tg_table_name;
  end if;
  perform app.audit_write(org, (select auth.uid()), act, object, detail);
  return null;
end
$$;

-- As in 0008, after locking the person's workspaces.
create or replace function app.delete_my_account() returns table (storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  doomed uuid[];
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  -- Another owner deleting at the same time waits here, then sees who is left.
  perform 1 from app.organizations o
  where o.id in (select m.org_id from app.members m where m.user_id = me)
  order by o.id
  for update;
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
