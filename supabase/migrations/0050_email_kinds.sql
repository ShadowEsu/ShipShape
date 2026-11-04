-- Email kinds beyond reminders (Security 2026-11-04 1058: K1-K5, C, B): the welcome after the first sign-in and
-- the waitlist's "accounts are open" note wait in app.outbox for the sender (lib/server/mail.ts), each behind its
-- own flag, off by default. The account deletion record (D-1) is sent directly and stores nothing here.
--
-- - kind: 'welcome' and 'waitlist_open' join 'reminder' and 'esign_code'. Signing codes are still never emailed.
-- - user_id: the person a welcome is for. One welcome per user, ever (outbox_welcome_once), written by
--   app.queue_welcome in the same transaction as their first workspace (finishSignIn, right after create_workspace),
--   and only for the sole owner of a new, real workspace who has no other: never for a member who joins one.
-- - waitlist_email: the waitlist row a 'waitlist_open' row is for. It has no workspace (org_id null) and goes with
--   the waitlist row (on delete cascade), so a person who leaves the list, or deletes their account (0040 deletes
--   their waitlist row), leaves no copy of the address here. address_sha256 is the lowercased address's sha256:
--   one address gets at most one such row, across batches (outbox_waitlist_open_once). The rows are written only
--   by scripts/waitlist-open-batch.sql, one reviewed statement per batch; no export of the list exists.
-- - Workspace members read reminders and (in samples) signing codes as before (0039), never these two kinds.
-- - app.email_suppressions takes a third reason, 'stop': the person asked for no more email (scripts/email-stop.ts).
-- - purge_outbox is unchanged: welcome and waitlist rows stay, as the once-keys, until their user, workspace or
--   waitlist row goes.
--
-- Undo: supabase/rollback/0050_email_kinds.down.sql (see infra/README.md, "Undoing a migration").

alter table app.outbox
  alter column org_id drop not null,
  add column user_id uuid references auth.users(id) on delete cascade,
  add column waitlist_email text references app.waitlist(email) on delete cascade,
  add column address_sha256 text;

alter table app.outbox drop constraint outbox_kind_check;
alter table app.outbox
  add constraint outbox_kind_check check (kind in ('reminder', 'esign_code', 'welcome', 'waitlist_open')),
  add constraint outbox_kind_shape_check check (
    case kind
      when 'welcome' then org_id is not null and user_id is not null and waitlist_email is null and address_sha256 is null
      when 'waitlist_open' then org_id is null and user_id is null and waitlist_email = to_email
        and address_sha256 = encode(sha256(convert_to(lower(to_email), 'UTF8')), 'hex')
      else org_id is not null and user_id is null and waitlist_email is null and address_sha256 is null
    end
  );

create unique index outbox_welcome_once on app.outbox (user_id) where kind = 'welcome';
create unique index outbox_waitlist_open_once on app.outbox (address_sha256) where kind = 'waitlist_open';
create index outbox_waitlist_email_idx on app.outbox (waitlist_email) where waitlist_email is not null;
create index outbox_user_idx on app.outbox (user_id) where user_id is not null;

-- The sender's queue: every kind it may send, not sent yet, oldest first.
drop index app.outbox_unsent_idx;
create index outbox_unsent_idx on app.outbox (created_at) where sent_at is null and kind in ('reminder', 'welcome', 'waitlist_open');

drop policy outbox_read on app.outbox;
create policy outbox_read on app.outbox for select to authenticated using (
  kind in ('reminder', 'esign_code')
  and app.has_role(org_id, array['owner', 'admin'])
  and (kind <> 'esign_code' or exists (select 1 from app.organizations o where o.id = outbox.org_id and o.is_demo))
);

-- The sender refuses a waitlist address that is any workspace's contact (as it does a vendor's or signer's): it
-- reads the address column only.
grant select (email) on app.contacts to service_role;
