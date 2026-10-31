-- Two people adding to the same workspace at once could deadlock, and one of them got an error.
-- Every insert of a row that references a workspace (a document, a version, a passport's document,
-- ...) has its foreign key take a key-share lock on the workspace's row until commit. audit_write
-- serialized the history by taking FOR UPDATE on that row, and FOR UPDATE conflicts with key-share:
-- two transactions that had each inserted such a row and then wrote history waited for each other.
-- FOR NO KEY UPDATE still lets one history writer in at a time per workspace (it conflicts with
-- itself, with updates of the workspace and with deleting it), but not with key-share locks.
-- Same function as 0010 otherwise; create or replace keeps its owner and (no) grants.
create or replace function app.audit_write(org uuid, actor uuid, action text, object_id uuid, detail text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  prev record;
  next_seq bigint;
  ts timestamptz := clock_timestamp();
  prev_h text;
begin
  perform 1 from app.organizations o where o.id = org for no key update;
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
