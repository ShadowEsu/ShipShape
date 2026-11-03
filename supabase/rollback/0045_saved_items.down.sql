-- Undoes 0045_saved_items.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0045's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Every save goes with the table; the documents and links they pointed at stay.
-- The table's policies, indexes and foreign keys go with it; 0045 made nothing else.
drop table app.saved_items;
