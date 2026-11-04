-- The waitlist's "accounts are open" note (Draft B), one marked batch (Security 2026-11-04 1058, B). Reviewed SQL:
-- the only way 'waitlist_open' rows reach app.outbox. Nothing leaves the database: no export, no CSV, no file copy
-- of the list; the sender (lib/server/mail.ts, SHIPSHAPE_EMAIL_WAITLIST=1) emails the rows it writes.
--
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -v batch_size=25 -f scripts/waitlist-open-batch.sql
--
-- One statement, so the batch is written whole or not at all. It takes the oldest waitlist addresses, at most
-- batch_size and never more than 50 (Cognito's own sender codes about 50 sign-ups a day), that:
-- - have no Collect interest (those signed up for Collect's note, not this one);
-- - belong to no account, and are no workspace's vendor, contact or signer, nor a sample's made-up address;
-- - have never had this note, in any batch (also the unique key outbox_waitlist_open_once, 0050).
-- Suppressed addresses can't be told apart here (the list is keyed with the app's secret): the sender skips them,
-- and it checks every rule above again when it sends.
--
-- It prints the batch's marker for Security and Preston (infra/README.md, Email, "B"): row_count; list_sha256, the
-- sha256 of the batch's addresses, lowercased, sorted and joined by newlines; body_sha256, the sha256 of the
-- note's text (lib/server/mail.ts WAITLIST_OPEN.body, which the sender requires it to equal).
-- Rows not sent within 3 days are never sent (the sender's window): delete those before the next batch
-- (infra/README.md).
with note as (
  select 'ShipShape accounts are open'::text as subject, $body$You joined the ShipShape waitlist to hear when real accounts open. They're open now.

With an account you can keep your W-9, insurance certificates, licenses and agreements in one place, fill the official IRS W-9 from business facts you confirm once, and share the documents you pick through one link that lasts 7, 30 or 90 days.

Free holds 10 active documents and 1 open link. Pro is $15 a month.

To sign up you need an email address, a password and an authenticator app on your phone for the two-step code.

Create your account: {app_url}/signin

This is the only email the waitlist gets about accounts opening.

The ShipShape team$body$::text as body
),
picked as (
  select w.email
  from app.waitlist w
  where not ('collect' = any(w.interests))
    and split_part(w.email, '@', 2) <> 'sample.example'
    and not exists (select 1 from auth.users u where lower(u.email) = w.email)
    and not exists (select 1 from app.vendors v where lower(v.email) = w.email)
    and not exists (select 1 from app.contacts c where lower(c.email) = w.email)
    and not exists (select 1 from app.signature_requests s where lower(s.signer_email) = w.email)
    and not exists (select 1 from app.outbox m where m.kind = 'waitlist_open' and m.address_sha256 = encode(sha256(convert_to(lower(w.email), 'UTF8')), 'hex'))
  order by w.created_at, w.email
  limit least(greatest(:'batch_size'::int, 0), 50)
),
written as (
  insert into app.outbox (to_email, subject, body, kind, waitlist_email, address_sha256)
  select p.email, n.subject, n.body, 'waitlist_open', p.email, encode(sha256(convert_to(lower(p.email), 'UTF8')), 'hex')
  from picked p cross join note n
  on conflict do nothing
  returning to_email
)
select
  (select count(*)::int from written) as row_count,
  encode(sha256(convert_to(coalesce((select string_agg(lower(to_email), E'\n' order by lower(to_email)) from written), ''), 'UTF8')), 'hex') as list_sha256,
  (select encode(sha256(convert_to(body, 'UTF8')), 'hex') from note) as body_sha256;
