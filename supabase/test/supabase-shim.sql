-- Local and test only: the parts of Supabase's own schema that ShipShape's migrations rely on.
-- Hosted Supabase already has all of this; never run this file there.
-- auth.uid() matches Supabase's definition: the `sub` claim of request.jwt.claims.
-- One deliberate difference: service_role has no BYPASSRLS here (Supabase's has it). RDS and Aurora
-- can't grant it, so the tests run under the stricter rule, and 0017's policies must cover every
-- table service_role uses. Whatever passes here works on both.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit nobypassrls;

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

-- Supabase Storage's two tables, as far as ShipShape's lockdown migration (0013) touches them.
-- Hosted Supabase ships them with row level security on and no policies.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
