-- Security E9: signing out only removed the cookie from the browser it ran in; a copied session
-- kept working for up to 12 hours. A person can now end every session they have: sessions issued
-- before their valid_after are refused on the next request (the app checks it in the query that
-- loads the workspace, so no extra round trip). Each person may read only their own row, and may
-- move it only forward to now, through app.end_my_sessions(); nobody can set it for anyone else.
create table app.session_revocations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  valid_after timestamptz not null
);

alter table app.session_revocations enable row level security;
create policy session_revocations_read on app.session_revocations for select to authenticated using (user_id = (select auth.uid()));
create policy service_role_all on app.session_revocations for all to service_role using (true) with check (true);
grant select on app.session_revocations to authenticated;

create function app.end_my_sessions() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  insert into app.session_revocations (user_id, valid_after) values (me, now())
  on conflict (user_id) do update set valid_after = greatest(app.session_revocations.valid_after, excluded.valid_after);
end
$$;
revoke execute on function app.end_my_sessions() from public;
grant execute on function app.end_my_sessions() to authenticated;
