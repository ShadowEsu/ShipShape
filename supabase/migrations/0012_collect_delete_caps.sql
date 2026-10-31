-- Security C-1: owners and admins can delete a file a vendor sent (the app removes the stored object
-- in the same transaction); the deletion is recorded in the hash-chained history with the file's SHA-256.
-- Security C-2: an upload link takes at most 25 files and a workspace holds at most 250 MiB of vendor
-- files, enforced here, where every upload has to pass.

create policy vendor_files_delete on app.vendor_files for delete to authenticated
  using (app.has_role(org_id, array['owner', 'admin']));
grant delete on app.vendor_files to authenticated;

drop trigger vendor_files_audit on app.vendor_files;
create trigger vendor_files_audit after insert or delete on app.vendor_files for each row execute function app.audit_row_change();

-- The audit trigger as in 0010, with vendor file deletions mapped.
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
    act := case tg_op when 'DELETE' then 'collect.file_deleted' else 'collect.received' end;
    detail := r ->> 'sha256';
  else
    raise exception 'no audit mapping for %', tg_table_name;
  end if;
  perform app.audit_write(org, (select auth.uid()), act, object, detail);
  return null;
end
$$;

-- collect_receive now says why it refused: 'ok', 'closed' (link, kind, vendor or sample flag),
-- 'link_full' or 'workspace_full'.
drop function app.collect_receive(uuid, text, uuid, text, text, text, text, int, text, date, boolean);
create function app.collect_receive(link uuid, secret_hash text, file_id uuid, file_kind text, file_name text, path text,
  file_mime text, file_size int, file_sha256 text, file_expires date, is_sample boolean)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  l app.vendor_links;
  v app.vendors;
  demo boolean;
begin
  select * into l from app.vendor_links s
  where s.id = link and s.token_hash = secret_hash and s.revoked_at is null and s.expires_at > now();
  if not found then
    return 'closed';
  end if;
  select * into v from app.vendors x where x.id = l.vendor_id and x.status = 'active';
  if not found or not (file_kind = any(v.requested)) then
    return 'closed';
  end if;
  -- Sample workspaces only ever get generated sample files; real workspaces never do.
  select o.is_demo into demo from app.organizations o where o.id = l.org_id;
  if is_sample is distinct from demo then
    return 'closed';
  end if;
  -- One upload at a time per workspace, so two at once can't both slip under the caps.
  perform pg_advisory_xact_lock(hashtextextended('collect:' || l.org_id::text, 0));
  if (select count(*) from app.vendor_files f where f.received_via = l.id) >= 25 then
    return 'link_full';
  end if;
  if (select coalesce(sum(f.size_bytes), 0) from app.vendor_files f where f.org_id = l.org_id) + file_size > 262144000 then
    return 'workspace_full';
  end if;
  insert into app.vendor_files (id, org_id, vendor_id, kind, filename, storage_path, mime, size_bytes, sha256, expires_on, sample, received_via)
  values (file_id, l.org_id, v.id, file_kind, file_name, path, file_mime, file_size, file_sha256, file_expires, is_sample, l.id);
  return 'ok';
end
$$;

revoke execute on function app.collect_receive(uuid, text, uuid, text, text, text, text, int, text, date, boolean) from public;
grant execute on function app.collect_receive(uuid, text, uuid, text, text, text, text, int, text, date, boolean) to anon, authenticated;
