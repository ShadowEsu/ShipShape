-- Security R4-5: a sender downloading the exact file a signature request sent lands in the
-- document's history, like any other download. Same function as 0006 with one more user event;
-- create or replace keeps its owner and grants.
create or replace function app.audit_append(org uuid, action text, object_id uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app.is_member(org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if action not in ('document.viewed', 'document.downloaded', 'esign.review_downloaded', 'profile.tax_id_revealed', 'workspace.exported', 'ai.request_read') then
    raise exception 'action % is not a user event', action using errcode = '42501';
  end if;
  return app.audit_write(org, (select auth.uid()), action, object_id);
end
$$;
