-- Email sending (B12; Security 2026-11-04 0715, answer 5): reminders in the outbox can go out through
-- Amazon SES (lib/server/mail.ts), only where SHIPSHAPE_EMAIL=1 and its settings are valid. Off, nothing
-- reads these columns or the new table, and the outbox works exactly as before.
--
-- Each outbox row records its sending, so a row goes out at most once:
-- - claimed_at: set, with attempts + 1, in the same statement that checks the row is unsent and unclaimed,
--   before SES is called. A second run at the same time finds it claimed and leaves it.
-- - sent_at and ses_message_id: set once SES accepted the message. A run that dies between SES and this
--   update leaves the row claimed and unsent; it's never tried again (at most once, not at least once).
-- - last_error: an error's name only (never its message, which may hold the address), with claimed_at
--   cleared, so the next daily run tries again while attempts is under the app's limit.
-- The daily caps count rows claimed in the last 24 hours; the partial index keeps that count small.
--
-- app.email_suppressions: addresses SES reported as a permanent bounce or a complaint (the SNS
-- notification the app verifies, lib/server/mail.ts). Each is stored as a keyed hash of the lowercased
-- address (SHIPSHAPE_HASH_KEY), never the address itself: the list outlives the account the address
-- belonged to, and a hash is enough to say "don't send here". SES's own suppression (the configuration
-- set, infra/mail.yaml) stays the backstop if the key ever changes. Only the server reads or writes it.
--
-- Undo: supabase/rollback/0049_email_sending.down.sql (see infra/README.md, "Undoing a migration").

alter table app.outbox
  add column claimed_at timestamptz,
  add column sent_at timestamptz,
  add column attempts integer not null default 0 constraint outbox_attempts_check check (attempts between 0 and 10),
  add column last_error text constraint outbox_last_error_check check (last_error is null or length(last_error) <= 100),
  add column ses_message_id text constraint outbox_ses_message_id_check check (ses_message_id is null or length(ses_message_id) <= 200),
  add constraint outbox_sent_claimed_check check (sent_at is null or claimed_at is not null);

-- The sender's queue: reminders not sent yet, oldest first.
create index outbox_unsent_idx on app.outbox (created_at) where sent_at is null and kind = 'reminder';
-- The daily caps.
create index outbox_claimed_idx on app.outbox (claimed_at) where claimed_at is not null;

create table app.email_suppressions (
  address_hash text primary key constraint email_suppressions_hash_check check (address_hash ~ '^[0-9a-f]{32}$'),
  reason text not null constraint email_suppressions_reason_check check (reason in ('bounce', 'complaint')),
  created_at timestamptz not null default now()
);

alter table app.email_suppressions enable row level security;
create policy service_role_all on app.email_suppressions for all to service_role using (true) with check (true);
revoke all on app.email_suppressions from public, anon, authenticated;
grant select, insert on app.email_suppressions to service_role;
