-- Undoes 0053_sample_files.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0053's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Deploy with SHIPSHAPE_SAMPLE_FILES unset first: that store reads and writes this table.
-- The sample workspaces' files go with it; their rows then point at nothing, so delete those sample workspaces too.
drop table app.sample_files;
