-- Account deletion (Security R10).
--
-- Deletes every workspace where the caller is the only owner, with everything in it: documents,
-- versions, facts, the audit log, passport links and signature requests (so open links stop
-- working). In workspaces with another owner, only the caller's membership ends. Then the user
-- itself goes, with their consents and acknowledgments.
--
-- Returns the storage paths of the deleted workspaces' files: the app removes those objects right
-- after this transaction commits.
create function app.delete_my_account() returns table (storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  doomed uuid[];
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select coalesce(array_agg(m.org_id), '{}') into doomed
  from app.members m
  where m.user_id = me and m.role = 'owner'
    and not exists (select 1 from app.members o where o.org_id = m.org_id and o.role = 'owner' and o.user_id <> me);

  return query select v.storage_path from app.document_versions v where v.org_id = any(doomed);
  delete from app.organizations o where o.id = any(doomed);
  delete from auth.users u where u.id = me;
end
$$;

revoke execute on function app.delete_my_account() from public;
grant execute on function app.delete_my_account() to authenticated;
