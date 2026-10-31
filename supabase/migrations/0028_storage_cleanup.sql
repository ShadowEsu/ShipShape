-- Security N-091a: an account deletion removes its stored files after the rows are gone. If that
-- removal failed, nothing pointed at the files any more and they stayed in the bucket for good.
-- Now the deletion queues every path it is about to orphan, in its own transaction, and the server
-- clears each queued path once storage confirms the removal; the daily run retries what is left.
-- Paths are <workspace id>/<object id>/v<n>.<ext>: no names or other personal data. Only the
-- server reads or writes the queue; no signed-in user or visitor can see it.
create table app.storage_cleanup (
  path text primary key,
  queued_at timestamptz not null default now()
);

alter table app.storage_cleanup enable row level security;
create policy service_role_all on app.storage_cleanup for all to service_role using (true) with check (true);
grant select, delete on app.storage_cleanup to service_role;

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
  delete from app.organizations o where o.id = any(doomed);
  delete from auth.users u where u.id = me;
  return query select unnest(paths);
end
$$;
revoke execute on function app.delete_my_account(uuid[]) from public;
grant execute on function app.delete_my_account(uuid[]) to authenticated;
