-- Security CG-3: an account deletion finishes even if the person never comes back. The server
-- writes this row (after billing is handled, before the Cognito user is deleted) in its own
-- transaction; the daily run finishes every request older than 15 minutes (billing, the Cognito
-- user, the rows, then the files). Deleting the user removes the row. Only the server reads or
-- writes it; no signed-in user or visitor can see it.
create table app.deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);

alter table app.deletion_requests enable row level security;
create policy service_role_all on app.deletion_requests for all to service_role using (true) with check (true);
grant select, insert, update on app.deletion_requests to service_role;
