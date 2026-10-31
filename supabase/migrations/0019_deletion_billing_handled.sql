-- Security F5-r2: the server cancels Stripe subscriptions for the workspaces it expects the
-- deletion to remove, before the deletion takes its locks. If another owner leaves at the same
-- moment, this person can become the sole owner after that check, and their deletion would remove a
-- workspace whose subscription is still running. The server now passes the workspaces whose billing
-- it handled; any other billed workspace in the deletion raises SS001, nothing is deleted, and the
-- server re-runs the cancel step once.
-- Also returns the signers' review files (0018) so their objects are removed with everything else.

drop function app.delete_my_account();
create function app.delete_my_account(handled uuid[]) returns table (storage_path text)
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

  if exists (
    select 1 from app.billing b
    where b.org_id = any(doomed) and b.stripe_customer_id is not null and not (b.org_id = any(coalesce(handled, '{}')))
  ) then
    raise exception 'billing not handled for a workspace being deleted' using errcode = 'SS001';
  end if;

  return query
    select v.storage_path from app.document_versions v where v.org_id = any(doomed)
    union all
    select f.storage_path from app.vendor_files f where f.org_id = any(doomed)
    union all
    select s.to_sign_path from app.signature_requests s where s.org_id = any(doomed) and s.to_sign_path is not null;
  delete from app.organizations o where o.id = any(doomed);
  delete from auth.users u where u.id = me;
end
$$;
revoke execute on function app.delete_my_account(uuid[]) from public;
grant execute on function app.delete_my_account(uuid[]) to authenticated;
