-- People (v2): the contacts a workspace keeps on purpose (spec-people-2026-11-03, Security's ruling P1-P5).
--
-- A contact is someone a member chose to keep: a name, an optional email and an optional company. A row is
-- made only by a member's action (typed on People, or "Keep in People" beside a signer, which copies the
-- owner-typed signer name and email) or by the sample seeder. ShipShape never fills it from anything else.
-- No other personal fields: no phone, address, notes, tax number or photo.
--
-- Who sees and changes it (row level security on every operation, nothing for anon or public): every member
-- reads the workspace's contacts, emails included (Security's ruling, answer 1: members already see signer
-- emails per document). A member adds a contact as themselves. Owners and admins change or delete any
-- contact; any other member only the ones they added.
--
-- The checks live in the database too (P3): name and company 1 to 120 characters, no control characters;
-- email at most 200 and shaped like an address; source one of typed, signer, sample. One address is one
-- contact per workspace (the unique index on lower(email)). created_by can't change on update: the column
-- isn't in the update grant (name, email and company are; updated_at is stamped by app.stamp_update).
--
-- created_by's foreign key is ON DELETE SET NULL (P3): the list is the workspace's, not the person's, so a
-- member's account deletion leaves the contacts they added with the workspace, unowned; from then on only
-- owners and admins can change or delete those (created_by = auth.uid() never matches null). CASCADE would
-- have silently taken shared rows away from everyone else in the workspace. The set-null runs as the
-- foreign key's own action, outside the column grant, and writes no history row (the audit trigger fires
-- only on updates of name, email or company).
--
-- At most 500 contacts per workspace (P4): the app checks first and says so; the before-insert trigger is the
-- rule, counting under a per-workspace advisory lock so two inserts at once can't both take the 500th place.
-- It runs as the caller (no security definer): an inserting member reads every row of their workspace.
--
-- History: contact.added, contact.updated and contact.deleted, with the actor and the contact's id only. No
-- name or email goes into audit_log, which outlives a deleted contact (spec §7). This trigger function is
-- security definer (audit_write isn't callable by members) with search_path pinned to ''.
--
-- A deleted workspace takes its contacts with it (on delete cascade from organizations). Deleting a contact
-- never touches signature requests: they keep their own frozen signer name and email.
--
-- Grants: authenticated only (select; insert of the columns the app writes; update of name, email, company;
-- delete), nothing for anon or public. The service_role policy is the repo-wide rule (0017); no server step
-- needs this table, so service_role has no grant on it.
--
-- Undo: supabase/rollback/0046_contacts.down.sql (see infra/README.md, "Undoing a migration").

create table app.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  name text not null constraint contacts_name_check check (length(name) between 1 and 120 and name !~ '[[:cntrl:]]'),
  email text constraint contacts_email_check check (email is null or (length(email) between 3 and 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  company text constraint contacts_company_check check (company is null or (length(company) between 1 and 120 and company !~ '[[:cntrl:]]')),
  source text not null constraint contacts_source_check check (source in ('typed', 'signer', 'sample')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One address is one contact per workspace.
create unique index contacts_email_idx on app.contacts (org_id, lower(email)) where email is not null;
-- The People list, A to Z, and ⌘K's name search.
create index contacts_name_idx on app.contacts (org_id, lower(name));

create trigger contacts_org_fixed before update on app.contacts for each row execute function app.forbid_org_change();
create trigger contacts_stamp before update on app.contacts for each row execute function app.stamp_update();

create function app.contacts_cap() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('contacts:' || new.org_id::text, 0));
  if (select count(*) from app.contacts c where c.org_id = new.org_id) >= 500 then
    raise exception 'a workspace keeps at most 500 contacts' using errcode = 'SS002';
  end if;
  return new;
end
$$;
create trigger contacts_cap before insert on app.contacts for each row execute function app.contacts_cap();

create function app.audit_contact_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if tg_op = 'UPDATE' and (new.name, new.email, new.company) is not distinct from (old.name, old.email, old.company) then
    return null;
  end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  -- The workspace itself is being deleted: its history goes with it.
  if not exists (select 1 from app.organizations o where o.id = r.org_id) then
    return null;
  end if;
  perform app.audit_write(r.org_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'contact.added' when 'UPDATE' then 'contact.updated' else 'contact.deleted' end, r.id);
  return null;
end
$$;
create trigger contacts_audit after insert or delete or update of name, email, company on app.contacts
  for each row execute function app.audit_contact_change();

revoke execute on function app.contacts_cap(), app.audit_contact_change() from public;

alter table app.contacts enable row level security;

create policy contacts_read on app.contacts for select to authenticated
  using (app.is_member(org_id));
create policy contacts_add on app.contacts for insert to authenticated
  with check (app.is_member(org_id) and created_by = (select auth.uid()));
create policy contacts_change on app.contacts for update to authenticated
  using (app.has_role(org_id, array['owner', 'admin']) or (app.is_member(org_id) and created_by = (select auth.uid())))
  with check (app.has_role(org_id, array['owner', 'admin']) or (app.is_member(org_id) and created_by = (select auth.uid())));
create policy contacts_remove on app.contacts for delete to authenticated
  using (app.has_role(org_id, array['owner', 'admin']) or (app.is_member(org_id) and created_by = (select auth.uid())));
create policy service_role_all on app.contacts for all to service_role using (true) with check (true);

revoke all on app.contacts from public, anon;
grant select on app.contacts to authenticated;
grant insert (org_id, name, email, company, source, created_by) on app.contacts to authenticated;
grant update (name, email, company) on app.contacts to authenticated;
grant delete on app.contacts to authenticated;
