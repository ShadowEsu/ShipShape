-- Local and test only: Supabase Storage's two tables, as far as ShipShape's lockdown migration (0013)
-- touches them, so the tests cover the Supabase path too. Runs after supabase/platform/plain-postgres.sql
-- and before the migrations. Hosted Supabase ships these with row level security on and no
-- policies; plain Postgres (RDS) has no `storage` schema at all, and 0013 then does nothing.

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

-- Migrations run as shipshape_owner; 0013 creates the private bucket and reads both tables.
grant usage on schema storage to shipshape_owner;
grant select, insert, update on storage.buckets to shipshape_owner;
grant select on storage.objects to shipshape_owner;
