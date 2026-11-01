-- Where you're signed in (Design row 34; Security's conditions 1-5): Settings lists the browsers a
-- person is signed in on, and each can be signed out on its own. Every session cookie now carries
-- the id of a row here; a missing, revoked or expired row sends the browser to sign-in (the app
-- checks it in the query that loads the workspace, so no extra round trip, and that same query moves
-- last_seen_at at most every 10 minutes). A row names the browser and system only ("Safari on a
-- Mac"): never the User-Agent string, no IP address, no place.
--
-- Each person reads only their own rows and may move only last_seen_at, only on their own live rows.
-- Rows are made and ended through the functions below, never written directly: a row made by hand
-- could outlive the cookie's 12 hours, and ending someone else's would sign them out. Rows go 30 days
-- after the session ended (the daily run), and at once with the account (on delete cascade).
create table app.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ua_family text not null check (char_length(ua_family) between 1 and 40),
  revoked_at timestamptz
);
create index sessions_user on app.sessions (user_id);

alter table app.sessions enable row level security;
create policy sessions_read on app.sessions for select to authenticated using (user_id = (select auth.uid()));
create policy sessions_seen on app.sessions for update to authenticated
  using (user_id = (select auth.uid()) and revoked_at is null) with check (user_id = (select auth.uid()) and revoked_at is null);
create policy service_role_all on app.sessions for all to service_role using (true) with check (true);
grant select on app.sessions to authenticated;
grant update (last_seen_at) on app.sessions to authenticated;
grant select, insert, update, delete on app.sessions to service_role;

-- The id comes from the app (128 random bits, in the signed cookie). The row lasts as long as the
-- cookie: 12 hours, as TTL_SECONDS in lib/server/session.ts.
create function app.start_session(session_id uuid, family text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  insert into app.sessions (id, user_id, expires_at, ua_family) values (session_id, me, now() + interval '12 hours', family);
end
$$;
revoke execute on function app.start_session(uuid, text) from public;
grant execute on function app.start_session(uuid, text) to authenticated;

-- Signs one browser out. Only the person's own: any other id (someone else's, or none) is refused
-- the same way, so it tells nobody whether a session exists.
create function app.end_session(session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update app.sessions set revoked_at = coalesce(revoked_at, now())
  where id = session_id and user_id = (select auth.uid());
  if not found then
    raise exception 'not your session' using errcode = '42501';
  end if;
end
$$;
revoke execute on function app.end_session(uuid) from public;
grant execute on function app.end_session(uuid) to authenticated;

-- "Sign out on every device" still moves the watermark (0029), which refuses every older cookie;
-- it now also marks each live row signed out, so the list shows none of them.
create or replace function app.end_my_sessions() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  insert into app.session_revocations (user_id, valid_after) values (me, now())
  on conflict (user_id) do update set valid_after = greatest(app.session_revocations.valid_after, excluded.valid_after);
  update app.sessions set revoked_at = now() where user_id = me and revoked_at is null;
end
$$;

-- The daily run: a session ended (signed out, or past its 12 hours, whichever came first) over 30
-- days ago is deleted. Returns how many.
create function app.purge_sessions() returns integer
language sql security definer set search_path = '' as $$
  with gone as (delete from app.sessions s where least(s.revoked_at, s.expires_at) < now() - interval '30 days' returning 1)
  select count(*)::integer from gone
$$;
revoke execute on function app.purge_sessions() from public;
grant execute on function app.purge_sessions() to service_role;
