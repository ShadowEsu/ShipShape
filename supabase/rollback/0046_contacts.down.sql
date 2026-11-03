-- Undoes 0046_contacts.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0046's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Every contact goes with the table: export the workspace first to keep them
-- (contacts.csv). Signature requests and documents stay; their history rows (contact.added and so on) stay too.
-- The table's policies, indexes, triggers and foreign keys go with it; then the two trigger functions 0046 made.
-- forbid_org_change and stamp_update are older (0001) and stay.
drop table app.contacts;
drop function app.contacts_cap();
drop function app.audit_contact_change();
