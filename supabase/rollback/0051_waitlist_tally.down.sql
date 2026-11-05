-- Undoes 0051_waitlist_tally.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0051's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Deploy the waitlist route without the tally first: it writes this table. The counts go
-- with it; they hold nothing of anyone's.
drop table app.waitlist_tally;
