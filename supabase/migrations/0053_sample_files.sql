-- The files of sample workspaces, for a deployment that serves only samples before AWS exists (ledger 616):
-- lib/server/storage.ts postgresBlobStore, chosen by SHIPSHAPE_SAMPLE_FILES=database. Every file in it is one
-- ShipShape made (a sample's documents, signature copies and the made-up files its upload links send); the store
-- refuses to run with real documents on.
--
-- - The path is the object path every store uses (`<workspace>/<id>/v<n>.<ext>`), checked here as in the app.
-- - Written, read and deleted only by the server, as service_role. Nobody signed in or anonymous reaches it: downloads
--   go through /api/files, which signs a link only after the database confirmed (under RLS) who may see the file.
-- - A workspace's files go when the workspace does (the daily sample purge removes its `<workspace>/` prefix), as on S3.
--
-- Undo: supabase/rollback/0053_sample_files.down.sql (see infra/README.md, "Undoing a migration").

create table app.sample_files (
  path text primary key check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/v[0-9]+\.(pdf|png|jpg)$'),
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg')),
  bytes bytea not null check (octet_length(bytes) between 1 and 10485760),
  created_at timestamptz not null default now()
);

alter table app.sample_files enable row level security;
-- As every server-only table since 0017: the server's role reaches it on RDS too (no BYPASSRLS there).
create policy service_role_all on app.sample_files for all to service_role using (true) with check (true);
revoke all on app.sample_files from public, anon, authenticated;
grant select, insert, delete on app.sample_files to service_role;
