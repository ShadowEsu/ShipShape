-- Sign-in identities (AWS step 4): which Cognito user, by the `sub` of its verified ID token, is
-- which ShipShape user. Only the server reads or writes it (lib/server/cognito.ts), after it has
-- verified the token; no signed-in user or visitor can see it. Deleting the user removes the row.
create table app.identities (
  provider text not null check (provider = 'cognito'),
  subject text not null check (subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);

alter table app.identities enable row level security;
create policy service_role_all on app.identities for all to service_role using (true) with check (true);
grant select, insert on app.identities to service_role;
