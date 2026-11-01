-- Deletion leftovers (review W11-7, W11-9, W11-15; Security 2026-11-01 0826): three things an account
-- deletion could leave behind.
--
-- - W11-15: the waitlist row. app.waitlist is keyed by email with no link to the user, so a person who
--   joined the waitlist, signed up and then deleted their account still had their email on file.
--   delete_my_account now removes the row whose email is the deleting user's own sign-in email,
--   normalised the way the waitlist route stores it (trim, lower-case); a sample account's null email
--   matches nothing. The email is read inside the function from auth.users, never taken as input.
-- - W11-7: stored objects with no row. A version, to-sign or vendor file whose transaction was lost
--   after the object was stored has no row pointing at it, so the per-path queue (0028) never sees it.
--   Every object path starts with the workspace id, so the deletion also queues each doomed
--   workspace's "<org id>/" prefix; the daily run lists what is still under it and removes it.
--   Only workspaces this transaction deletes are queued (the ids come from the rows being deleted,
--   never from input), and a prefix must be exactly a uuid plus "/" (the check constraint below, and
--   the job checks again before listing): an empty or short prefix would list the whole bucket, and
--   the trailing slash keeps one workspace id from prefix-matching another.
-- - W11-9: the daily deletion queue. A request that failed kept its place at the head (ordered by
--   requested_at), so 100 permanent failures could hold up every deletion behind them. attempted_at
--   is set on every failed attempt and the run orders by it, least recently tried first.
--
-- Only the server reads or writes the two queues; no signed-in user or visitor can see them.

create table app.storage_prefix_cleanup (
  prefix text primary key check (prefix ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/$'),
  queued_at timestamptz not null default now()
);
alter table app.storage_prefix_cleanup enable row level security;
create policy service_role_all on app.storage_prefix_cleanup for all to service_role using (true) with check (true);
grant select, update, delete on app.storage_prefix_cleanup to service_role;

alter table app.deletion_requests add column attempted_at timestamptz;

-- Same function as 0028, plus the waitlist row and the prefix queue. Its grants are kept.
create or replace function app.delete_my_account(handled uuid[]) returns table (storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  doomed uuid[];
  paths text[];
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

  if exists (
    select 1 from app.billing b
    where b.org_id = any(doomed) and b.stripe_customer_id is not null and not (b.org_id = any(coalesce(handled, '{}')))
  ) then
    raise exception 'billing not handled for a workspace being deleted' using errcode = 'SS001';
  end if;

  select coalesce(array_agg(p), '{}') into paths from (
    select v.storage_path from app.document_versions v where v.org_id = any(doomed)
    union all
    select f.storage_path from app.vendor_files f where f.org_id = any(doomed)
    union all
    select s.to_sign_path from app.signature_requests s where s.org_id = any(doomed) and s.to_sign_path is not null
  ) x (p);
  insert into app.storage_cleanup (path) select unnest(paths) on conflict (path) do nothing;
  -- Whatever else is still stored under a doomed workspace (objects whose row was never written).
  insert into app.storage_prefix_cleanup (prefix) select d::text || '/' from unnest(doomed) as d on conflict (prefix) do nothing;
  -- The waitlist row with this person's own sign-in email (a sample account's is null and matches nothing).
  delete from app.waitlist w where w.email = (select lower(btrim(u.email)) from auth.users u where u.id = me);
  delete from app.organizations o where o.id = any(doomed);
  delete from auth.users u where u.id = me;
  return query select unnest(paths);
end
$$;
