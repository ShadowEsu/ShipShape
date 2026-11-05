-- Undoes 0052_slack.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0052's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Deploy the app without Slack first: the daily run, Settings and account deletion read these
-- tables. Disconnect each workspace's Slack before this (Settings, Disconnect), so its token is revoked: dropping the
-- table only forgets the token and the webhook address, and Slack keeps the install until a workspace admin removes
-- the app. Waiting posts and used states go with their tables; they hold nothing that isn't elsewhere.
drop table app.slack_states_used;
drop table app.slack_posts;
drop table app.slack_connections;
