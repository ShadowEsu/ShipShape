-- History can say who a signature request went to (Design #25 S2): "Signature requested from Sam Ortiz".
--
-- The audit trigger wrote a request's rows (esign.requested, .signed, .declined, .revoked) about the document only.
-- They now also carry the request's id in `about`, as 0038's outsider rows do. The name is never stored in the audit
-- log: History reads it from the request through `about` (lib/server/activity.ts, lib/server/documents.ts), so it
-- shows only while the request exists and only to someone whose row level security lets them read the request.
-- `about` is covered by the row's hash when present (0038), so these rows verify as before; older rows have no
-- `about`, keep their hashes and read with the plain label. supabase/rollback/0047_audit_request_about.down.sql
-- puts back 0015's function.

-- The audit trigger as in 0015, with `about` set to the request on a signature request's rows.
create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  org uuid;
  object uuid;
  act text;
  detail text;
  about uuid;
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
    about := (r ->> 'id')::uuid;
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
  perform app.audit_write(org, (select auth.uid()), act, object, detail, about);
  return null;
end
$$;
