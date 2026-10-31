-- ShipShape on plain Postgres (Amazon RDS, or local PGlite): the roles and the `auth` schema that
-- Supabase would otherwise provide. Run once per database, by the master user, before the first
-- migration (scripts/migrate.ts and the local driver do this). Safe to re-run.
--
-- Roles (aws-plan.md, BOSS rule 2, Security R-2):
--   shipshape_owner  NOLOGIN; owns every schema, table and function. Migrations run as this role
--                    (`set local role shipshape_owner`), so they never need a superuser.
--   shipshape_app    the only login the app uses: owns nothing, no superuser, no BYPASSRLS; a member
--                    of the three request roles so each transaction can `set local role`. Its login
--                    (password or IAM auth) is set during setup, outside this file.
--   anon, authenticated, service_role
--                    the request roles, as on Supabase, except service_role has no BYPASSRLS
--                    (RDS can't grant it); migration 0017 gives it explicit policies instead.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'shipshape_owner') then create role shipshape_owner nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'shipshape_app') then create role shipshape_app nologin noinherit; end if;
end
$$;

-- The owner hands the request roles to shipshape_app (migration 0001), which needs ADMIN on them,
-- but never acts as them itself.
grant anon, authenticated, service_role to shipshape_owner with admin option, inherit false, set false;
-- The master user (whoever runs this file) may become the owner to run migrations.
do $$
begin
  execute format('grant shipshape_owner to %I with inherit false, set true', current_user);
  execute format('grant create on database %I to shipshape_owner', current_database());
end
$$;

set role shipshape_owner;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Who can sign in. On RDS the id is ShipShape's own; Cognito's `sub` maps to it at sign-in.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, delete on auth.users to service_role;

-- The signed-in user's id, exactly as Supabase defines it: the `sub` claim of request.jwt.claims,
-- which the app sets per transaction (lib/server/db.ts asUser).
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Which migrations have run (scripts/migrate.ts and the local driver).
create schema if not exists meta;
create table if not exists meta.migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

reset role;
