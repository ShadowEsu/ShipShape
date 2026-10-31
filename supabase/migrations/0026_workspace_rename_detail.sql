-- Security (review of 0024): a rename's history row carries a fingerprint of the old and the new name,
-- SHA-256 of the JSON array [old, new] (unambiguous whatever the names hold). Like every detail it is
-- part of the hash chain; the names themselves aren't stored in the history (a signature request keeps
-- the name it was sent under, 0025).
create or replace function app.audit_workspace_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    perform app.audit_write(new.id, (select auth.uid()), 'workspace.renamed', new.id,
      encode(sha256(convert_to(json_build_array(old.name, new.name)::text, 'UTF8')), 'hex'));
  end if;
  return null;
end
$$;
