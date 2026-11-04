-- Undoes 0050_email_kinds.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0050's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Turn the welcome and waitlist kinds off first (SHIPSHAPE_EMAIL_WELCOME and
-- SHIPSHAPE_EMAIL_WAITLIST unset, redeployed). The welcome and waitlist rows go (0049's outbox takes neither).
-- Every 'stop' suppression stays, and so does the reason check that allows it (Security S-R1): a stop is a
-- person's request, reminders keep going after a rollback, and 0049's code only reads the list.
drop function app.queue_welcome(uuid, text, text);
delete from app.outbox where kind in ('welcome', 'waitlist_open');
revoke select (email) on app.contacts from service_role;

drop policy outbox_read on app.outbox;
create policy outbox_read on app.outbox for select to authenticated using (
  app.has_role(org_id, array['owner', 'admin'])
  and (kind <> 'esign_code' or exists (select 1 from app.organizations o where o.id = outbox.org_id and o.is_demo))
);

drop index app.outbox_unsent_idx;
create index outbox_unsent_idx on app.outbox (created_at) where sent_at is null and kind = 'reminder';

alter table app.outbox drop constraint outbox_kind_shape_check, drop constraint outbox_kind_check;
alter table app.outbox add constraint outbox_kind_check check (kind in ('reminder', 'esign_code'));
alter table app.outbox
  drop column user_id,
  drop column waitlist_email,
  drop column address_sha256,
  alter column org_id set not null;
