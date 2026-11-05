-- How many new waitlist sign-ups came from inside a sample workspace, and how many from anywhere else, per day
-- (ledger 461, weak spot 2b): whether the sample's "Hear when real accounts open" works, without keeping anything
-- about who joined. A row is a UTC day, a source and a count: no address, no person, no workspace, no network.
--
-- - source 'sample': the sign-up came with a valid sample-workspace session cookie; 'site': every other one.
-- - Only a new address counts. Signing up again with an address already on the list (to add an interest) doesn't.
-- - Written only by the waitlist route, as the server, in the same transaction as the waitlist row.
-- - Nobody signed in can read or write it. It's never exported or deleted with an account: it holds nothing of
--   anyone's.
--
-- Undo: supabase/rollback/0051_waitlist_tally.down.sql (see infra/README.md, "Undoing a migration").

create table app.waitlist_tally (
  day date not null,
  source text not null check (source in ('site', 'sample')),
  joined int not null check (joined > 0),
  primary key (day, source)
);

alter table app.waitlist_tally enable row level security;
-- As every server-only table since 0017: the server's role reaches it on RDS too (no BYPASSRLS there).
create policy service_role_all on app.waitlist_tally for all to service_role using (true) with check (true);
revoke all on app.waitlist_tally from public, anon, authenticated;
grant select, insert, update on app.waitlist_tally to service_role;
