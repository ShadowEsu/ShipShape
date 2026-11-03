-- Saved (v2, PR 3): a member bookmarks a document or a passport link and finds it again on /app/saved.
--
-- Saves are personal. Each row is one person's, in one workspace: they see, add and remove only their own,
-- and only while they're a member; another member of the same workspace never sees them. No updates: a save
-- is there or it isn't.
--
-- One table, with the object's id once (object_id) and two generated foreign-key columns derived from it:
-- document_id is object_id when kind = 'document', link_id when kind = 'link', otherwise null. The app writes
-- only (org_id, user_id, kind, object_id); the database fills the other two, so they can't disagree with
-- kind, and each gets a real foreign key with on delete cascade (a deleted document or link takes its saves
-- with it). Chosen over two tables because the Saved list is one newest-first list across both kinds (one
-- index, one query), and over two hand-written nullable columns with a check because there is nothing to
-- keep in step.
--
-- A deleted workspace or person removes their rows (on delete cascade from organizations, auth.users), and
-- so does leaving a workspace (the (org_id, user_id) key into members).
--
-- The object must be in the same workspace as the save: the insert policy looks it up under the caller's own
-- row level security (a document or link of another workspace isn't visible, so the check fails the same way
-- for "someone else's" and "doesn't exist"). Objects never move between workspaces (forbid_org_change on
-- documents and share_links), so a save stays consistent after it's made. Archived documents keep their
-- saves; the app doesn't list them (Security S5) and they show again if the document is restored.
--
-- Grants: authenticated only (select, insert, delete; no update), nothing for anon or public. The
-- service_role policy is the repo-wide rule (0017: every table with row level security has one, for RDS); no
-- server step needs this table, so service_role has no grant on it.
--
-- Undo: supabase/rollback/0045_saved_items.down.sql (see infra/README.md, "Undoing a migration").

create table app.saved_items (
  org_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('document', 'link')),
  object_id uuid not null,
  created_at timestamptz not null default now(),
  document_id uuid generated always as (case when kind = 'document' then object_id end) stored
    references app.documents(id) on delete cascade,
  link_id uuid generated always as (case when kind = 'link' then object_id end) stored
    references app.share_links(id) on delete cascade,
  primary key (org_id, user_id, kind, object_id),
  foreign key (org_id, user_id) references app.members(org_id, user_id) on delete cascade
);
-- "My saved items, newest first".
create index saved_items_mine_idx on app.saved_items (org_id, user_id, created_at desc);
-- For the cascades from documents and share_links.
create index saved_items_document_idx on app.saved_items (document_id) where document_id is not null;
create index saved_items_link_idx on app.saved_items (link_id) where link_id is not null;

alter table app.saved_items enable row level security;

create policy saved_read on app.saved_items for select to authenticated
  using (app.is_member(org_id) and user_id = (select auth.uid()));
create policy saved_add on app.saved_items for insert to authenticated
  with check (
    app.is_member(org_id) and user_id = (select auth.uid())
    and case kind
      when 'document' then exists (select 1 from app.documents d where d.id = saved_items.object_id and d.org_id = saved_items.org_id)
      when 'link' then exists (select 1 from app.share_links l where l.id = saved_items.object_id and l.org_id = saved_items.org_id)
      else false
    end
  );
create policy saved_remove on app.saved_items for delete to authenticated
  using (app.is_member(org_id) and user_id = (select auth.uid()));
create policy service_role_all on app.saved_items for all to service_role using (true) with check (true);

revoke all on app.saved_items from public, anon;
grant select (org_id, user_id, kind, object_id, created_at) on app.saved_items to authenticated;
grant insert (org_id, user_id, kind, object_id) on app.saved_items to authenticated;
grant delete on app.saved_items to authenticated;
