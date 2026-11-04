-- Undoes 0049_email_sending.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0049's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Turn email off first (SHIPSHAPE_EMAIL unset, redeployed): the sender reads these
-- columns. The suppression list goes with its table (SES keeps its own); the outbox rows stay, without the
-- record of which were emailed. The indexes and constraints go with their columns.
drop table app.email_suppressions;
alter table app.outbox
  drop column claimed_at,
  drop column sent_at,
  drop column attempts,
  drop column last_error,
  drop column ses_message_id;
