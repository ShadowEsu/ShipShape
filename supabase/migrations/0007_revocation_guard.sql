-- Security F1: deleting an account sets created_by to null on the links that person made in
-- workspaces that live on (on delete set null). On a link already turned off, that update tripped
-- the one-way revocation guard and rolled the whole deletion back. On a revoked link the guard now
-- allows exactly that change, created_by and nothing else, so a revoked link stays as it was.
create or replace function app.lock_revocation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null then
    if (to_jsonb(new) - 'created_by') is distinct from (to_jsonb(old) - 'created_by') then
      raise exception 'link already revoked' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.revoked_at is not null then
    new.revoked_at := now();
  end if;
  return new;
end
$$;
