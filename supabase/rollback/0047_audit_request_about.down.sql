-- Undoes 0047_audit_request_about.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0047's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). It puts back 0015's audit trigger function, so a signature request's new rows are about the
-- document only again. Rows written meanwhile keep their `about` and their hashes, which cover it (0038), so the chain
-- still verifies; History keeps naming their signer while the request exists. 0047 made nothing else.
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
