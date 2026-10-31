-- Local and test only: the parts of Supabase's own schema that ShipShape's migrations rely on.
-- Hosted Supabase already has all of this; never run this file there.
-- auth.uid() matches Supabase's definition: the `sub` claim of request.jwt.claims.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, delete on auth.users to service_role;

create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
