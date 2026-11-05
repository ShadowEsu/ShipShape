-- Slack (lib/server/slack.ts): deadline reminders posted to one Slack channel that a workspace's owner or admin connects
-- through Slack's "Add to Slack" (OAuth v2, the single scope incoming-webhook). ShipShape can post to that channel and
-- nothing else; it never reads Slack.
--
-- app.slack_connections: one row per workspace, at most.
-- - The webhook address and the access token are stored encrypted only (encryptField, bound to the workspace and the
--   field). Signed-in people can't read either column at all: the select grant leaves them out. Only the server reads
--   them, to post, to send a test message and to revoke the token.
-- - Every member reads the rest (channel, team, who connected it and when, whether Slack said it broke): Settings
--   shows members the row read-only. Owners and admins of a real (not sample) workspace add the row as themselves and
--   delete it; nobody signed in updates it. broken_at is the server's to set (a 404 or no_service/channel_not_found
--   answer to a post), and a new connection replaces the row.
-- - The workspace's deletion takes the row with it (on delete cascade); account deletion revokes the token first
--   (lib/server/account.ts). connected_by is set null when that person's account goes: the connection is the
--   workspace's.
--
-- app.slack_posts: reminders waiting to be posted, server only. The daily run writes one per reminder it writes for a
-- connected workspace (the reminder's own claim in app.reminders_sent keeps it to one), posts it, and deletes it once
-- Slack took it. A failed post is retried by the next run, up to 3 tries; rows over 3 days old, or out of tries, are
-- deleted by the sender. The text names the document's title, so deleting the document for good takes it too.
--
-- app.slack_states_used: the nonce of every "Add to Slack" state the callback has accepted (its SHA-256), so a state
-- works once. Server only; rows go 15 minutes after use (a state is valid for 10).
--
-- Undo: supabase/rollback/0052_slack.down.sql (see infra/README.md, "Undoing a migration").

create table app.slack_connections (
  org_id uuid primary key references app.organizations(id) on delete cascade,
  webhook_url_enc text not null check (length(webhook_url_enc) between 1 and 2000 and starts_with(webhook_url_enc, 'v1.')),
  access_token_enc text not null check (length(access_token_enc) between 1 and 2000 and starts_with(access_token_enc, 'v1.')),
  channel text not null check (length(channel) between 1 and 200 and channel !~ '[[:cntrl:]]'),
  team_id text not null check (team_id ~ '^[TE][A-Z0-9]{2,30}$'),
  team_name text not null check (length(team_name) between 1 and 200 and team_name !~ '[[:cntrl:]]'),
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  broken_at timestamptz
);

alter table app.slack_connections enable row level security;

create policy slack_connections_read on app.slack_connections for select to authenticated
  using (app.is_member(org_id));
create policy slack_connections_add on app.slack_connections for insert to authenticated
  with check (
    app.has_role(org_id, array['owner', 'admin'])
    and connected_by = (select auth.uid())
    and not exists (select 1 from app.organizations o where o.id = org_id and o.is_demo)
  );
create policy slack_connections_remove on app.slack_connections for delete to authenticated
  using (app.has_role(org_id, array['owner', 'admin']));
create policy service_role_all on app.slack_connections for all to service_role using (true) with check (true);

revoke all on app.slack_connections from public, anon, authenticated;
grant select (org_id, channel, team_id, team_name, connected_by, connected_at, broken_at) on app.slack_connections to authenticated;
grant insert (org_id, webhook_url_enc, access_token_enc, channel, team_id, team_name, connected_by) on app.slack_connections to authenticated;
grant delete on app.slack_connections to authenticated;
grant select, insert, update, delete on app.slack_connections to service_role;

create table app.slack_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  document_id uuid not null references app.documents(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  attempts int not null default 0 check (attempts between 0 and 3),
  claimed_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 100)
);
create index slack_posts_queue_idx on app.slack_posts (created_at, id) where claimed_at is null;
create index slack_posts_org_idx on app.slack_posts (org_id);
create index slack_posts_document_idx on app.slack_posts (document_id);

alter table app.slack_posts enable row level security;
create policy service_role_all on app.slack_posts for all to service_role using (true) with check (true);
revoke all on app.slack_posts from public, anon, authenticated;
grant select, insert, update, delete on app.slack_posts to service_role;

create table app.slack_states_used (
  nonce_sha256 text primary key check (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

alter table app.slack_states_used enable row level security;
create policy service_role_all on app.slack_states_used for all to service_role using (true) with check (true);
revoke all on app.slack_states_used from public, anon, authenticated;
grant select, insert, delete on app.slack_states_used to service_role;
