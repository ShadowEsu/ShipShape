-- ShipShape core schema: workspaces, members, business profile (Memory), documents and versions,
-- templates, acknowledgments, the hash-chained audit log, waitlist and rate limits.
--
-- Everything lives in the private schema `app`, which is never exposed through Supabase's Data API.
-- The server talks to Postgres directly and runs every user request as role `authenticated` with
-- the user's id in `request.jwt.claims`, so the row level security below applies to every query.
-- Privileged steps are narrow `security definer` functions.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public;

-- Workspaces ---------------------------------------------------------------------------------

create table app.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table app.members (
  org_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user_idx on app.members (user_id);

create function app.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.members m where m.org_id = org and m.user_id = (select auth.uid()))
$$;

create function app.has_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.members m where m.org_id = org and m.user_id = (select auth.uid()) and m.role = any (roles))
$$;

-- Rows never move between workspaces.
create function app.forbid_org_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id cannot change' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Business profile (Memory) ------------------------------------------------------------------
-- Tax identifiers are encrypted by the app (AES-256-GCM, key outside the database) and only the
-- last four digits are stored in clear, for the masked display.

create table app.profiles (
  org_id uuid primary key references app.organizations(id) on delete cascade,
  legal_name text check (length(legal_name) <= 200),
  dba text check (length(dba) <= 200),
  entity_type text check (entity_type in ('individual', 'sole_prop', 'llc_single', 'llc_partnership', 'llc_c', 'llc_s', 'c_corp', 's_corp', 'partnership', 'trust', 'other')),
  address_line1 text check (length(address_line1) <= 200),
  address_line2 text check (length(address_line2) <= 200),
  city text check (length(city) <= 100),
  state text check (length(state) <= 50),
  postal_code text check (length(postal_code) <= 20),
  country text not null default 'US' check (length(country) <= 2),
  phone text check (length(phone) <= 40),
  email text check (length(email) <= 200),
  website text check (length(website) <= 200),
  state_of_formation text check (length(state_of_formation) <= 50),
  signer_name text check (length(signer_name) <= 200),
  signer_title text check (length(signer_title) <= 100),
  ein_cipher text,
  ein_last4 text check (ein_last4 ~ '^[0-9]{4}$'),
  ssn_cipher text,
  ssn_last4 text check (ssn_last4 ~ '^[0-9]{4}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check ((ein_cipher is null) = (ein_last4 is null)),
  check ((ssn_cipher is null) = (ssn_last4 is null))
);

-- Templates: official or openly licensed sources only, each with its licence and source URL.
create table app.templates (
  id text primary key,
  title text not null,
  kind text not null,
  source_name text not null,
  source_url text not null check (source_url like 'https://%'),
  license text not null,
  version text not null,
  hosted boolean not null, -- false = link-out only (for example the YC SAFE)
  summary text not null
);

-- Documents ----------------------------------------------------------------------------------

create table app.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  kind text not null check (kind in ('w9', 'coi', 'license', 'permit', 'nda', 'agreement', 'registration', 'tax', 'other')),
  status text not null default 'active' check (status in ('active', 'archived')),
  issuer text check (length(issuer) <= 200),
  counterparty text check (length(counterparty) <= 200),
  issued_on date,
  expires_on date,
  renews_on date,
  template_id text references app.templates(id),
  notes text check (length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple', title || ' ' || coalesce(issuer, '') || ' ' || coalesce(counterparty, '') || ' ' || coalesce(notes, ''))
  ) stored
);
create index documents_org_idx on app.documents (org_id, created_at desc);
create index documents_expiry_idx on app.documents (org_id, expires_on) where expires_on is not null;
create index documents_search_idx on app.documents using gin (search);
create trigger documents_org_fixed before update on app.documents for each row execute function app.forbid_org_change();

-- Versions are insert only. A file never changes; a change is a new version.
create table app.document_versions (
  document_id uuid not null references app.documents(id) on delete cascade,
  version int not null check (version >= 1),
  org_id uuid not null references app.organizations(id) on delete cascade,
  storage_path text not null,
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  origin text not null check (origin in ('upload', 'filled', 'signed', 'sample')),
  fill_record jsonb, -- for filled documents: field -> source (never the values of tax identifiers)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (document_id, version),
  check (storage_path like org_id::text || '/%')
);
create index document_versions_org_idx on app.document_versions (org_id);

create function app.version_matches_document() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.documents d where d.id = new.document_id and d.org_id = new.org_id) then
    raise exception 'version org does not match document org' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger document_versions_org before insert on app.document_versions for each row execute function app.version_matches_document();

-- "ShipShape is software, not a law firm" acknowledgments, logged before a filled document is
-- finalized or downloaded.
create table app.acknowledgments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references app.documents(id) on delete set null,
  text_version text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now()
);
create index acknowledgments_org_idx on app.acknowledgments (org_id);

-- Audit log ----------------------------------------------------------------------------------
-- Append only. Each row hashes the one before it, so editing or deleting a row breaks the chain.
-- It records who did what to which object and when; never document contents or identifiers.

create table app.audit_log (
  org_id uuid not null references app.organizations(id) on delete cascade,
  seq bigint not null check (seq >= 1),
  at timestamptz not null,
  actor uuid,
  action text not null check (action ~ '^[a-z]+(\.[a-z_]+)+$' and length(action) <= 60),
  object_id uuid,
  prev_hash text not null,
  hash text not null,
  primary key (org_id, seq)
);

create function app.audit_hash(org uuid, seq bigint, at timestamptz, actor uuid, action text, object_id uuid, prev_hash text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|',
    org::text, seq::text, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(actor::text, '-'), action, coalesce(object_id::text, '-'), prev_hash), 'UTF8')), 'hex')
$$;

-- Internal: callable only by other functions in this schema and the service role.
create function app.audit_write(org uuid, actor uuid, action text, object_id uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  prev record;
  next_seq bigint;
  ts timestamptz := clock_timestamp();
  prev_h text;
begin
  perform 1 from app.organizations o where o.id = org for update;
  if not found then
    raise exception 'unknown organization' using errcode = '42501';
  end if;
  select a.seq, a.hash into prev from app.audit_log a where a.org_id = org order by a.seq desc limit 1;
  next_seq := coalesce(prev.seq, 0) + 1;
  prev_h := coalesce(prev.hash, 'genesis');
  insert into app.audit_log (org_id, seq, at, actor, action, object_id, prev_hash, hash)
  values (org, next_seq, ts, actor, action, object_id, prev_h, app.audit_hash(org, next_seq, ts, actor, action, object_id, prev_h));
  return next_seq;
end
$$;

-- For signed-in members: the actor is always the caller.
create function app.audit_append(org uuid, action text, object_id uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app.is_member(org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return app.audit_write(org, (select auth.uid()), action, object_id);
end
$$;

-- Returns the first broken sequence number, or null when the whole chain checks out.
create function app.audit_verify(org uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  expected_prev text := 'genesis';
  expected_seq bigint := 1;
begin
  if (select auth.uid()) is not null and not app.is_member(org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  for r in select * from app.audit_log a where a.org_id = org order by a.seq loop
    if r.seq <> expected_seq or r.prev_hash <> expected_prev
       or r.hash <> app.audit_hash(r.org_id, r.seq, r.at, r.actor, r.action, r.object_id, r.prev_hash) then
      return expected_seq;
    end if;
    expected_prev := r.hash;
    expected_seq := expected_seq + 1;
  end loop;
  return null;
end
$$;

-- Creating a workspace makes the caller its owner, with an empty profile.
create function app.create_workspace(workspace_name text, demo boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  org uuid;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  insert into app.organizations (name, is_demo) values (workspace_name, demo) returning id into org;
  insert into app.members (org_id, user_id, role) values (org, uid, 'owner');
  insert into app.profiles (org_id, updated_by) values (org, uid);
  perform app.audit_write(org, uid, 'workspace.created', org);
  return org;
end
$$;

-- Consents: what each person agreed to, which policy version, when (one row per agreement).
create table app.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null check (item in ('terms_privacy', 'esign', 'ai_document')),
  policy_version text not null check (length(policy_version) <= 40),
  object_id uuid,
  at timestamptz not null default now()
);
create index consents_user_idx on app.consents (user_id);

-- Waitlist and rate limits: service role only --------------------------------------------------

create table app.waitlist (
  email text primary key check (length(email) <= 200),
  created_at timestamptz not null default now()
);

create table app.rate_hits (
  bucket text not null,
  key text not null, -- a hash, never a raw IP or token
  window_start timestamptz not null,
  n int not null default 0,
  primary key (bucket, key, window_start)
);

-- Counts one call and says whether it is within `max_hits` for the current window.
create function app.rate_hit(hit_bucket text, hit_key text, window_seconds int, max_hits int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds);
  count_now int;
begin
  insert into app.rate_hits as r (bucket, key, window_start, n) values (hit_bucket, hit_key, w, 1)
  on conflict on constraint rate_hits_pkey do update set n = r.n + 1
  returning r.n into count_now;
  delete from app.rate_hits r where r.window_start < clock_timestamp() - interval '1 day';
  return count_now <= max_hits;
end
$$;

-- Row level security ---------------------------------------------------------------------------

alter table app.organizations enable row level security;
alter table app.members enable row level security;
alter table app.profiles enable row level security;
alter table app.templates enable row level security;
alter table app.documents enable row level security;
alter table app.document_versions enable row level security;
alter table app.acknowledgments enable row level security;
alter table app.audit_log enable row level security;
alter table app.waitlist enable row level security;
alter table app.rate_hits enable row level security;
alter table app.consents enable row level security;

create policy org_read on app.organizations for select to authenticated using (app.is_member(id));
create policy org_rename on app.organizations for update to authenticated
  using (app.has_role(id, array['owner', 'admin'])) with check (app.has_role(id, array['owner', 'admin']));

create policy members_read on app.members for select to authenticated using (app.is_member(org_id));

create policy profile_read on app.profiles for select to authenticated using (app.is_member(org_id));
create policy profile_edit on app.profiles for update to authenticated
  using (app.has_role(org_id, array['owner', 'admin'])) with check (app.has_role(org_id, array['owner', 'admin']));

create policy templates_read on app.templates for select to anon, authenticated using (true);

create policy documents_read on app.documents for select to authenticated using (app.is_member(org_id));
create policy documents_add on app.documents for insert to authenticated
  with check (app.is_member(org_id) and created_by = (select auth.uid()));
create policy documents_edit on app.documents for update to authenticated
  using (app.is_member(org_id)) with check (app.is_member(org_id));
create policy documents_delete on app.documents for delete to authenticated using (app.has_role(org_id, array['owner', 'admin']));

create policy versions_read on app.document_versions for select to authenticated using (app.is_member(org_id));
create policy versions_add on app.document_versions for insert to authenticated
  with check (app.is_member(org_id) and created_by = (select auth.uid()));

create policy acks_read on app.acknowledgments for select to authenticated using (app.is_member(org_id));
create policy acks_add on app.acknowledgments for insert to authenticated
  with check (app.is_member(org_id) and user_id = (select auth.uid()));

create policy audit_read on app.audit_log for select to authenticated using (app.is_member(org_id));
-- No insert, update or delete policy on audit_log, ever: writes go through app.audit_write.

create policy consents_read on app.consents for select to authenticated using (user_id = (select auth.uid()));
create policy consents_add on app.consents for insert to authenticated with check (user_id = (select auth.uid()));

-- Grants ----------------------------------------------------------------------------------------

grant select on app.templates to anon, authenticated;
grant select on app.organizations to authenticated;
grant update (name) on app.organizations to authenticated;
grant select on app.members to authenticated;
grant select on app.profiles to authenticated;
grant update (legal_name, dba, entity_type, address_line1, address_line2, city, state, postal_code, country, phone, email,
  website, state_of_formation, signer_name, signer_title, ein_cipher, ein_last4, ssn_cipher, ssn_last4, updated_at, updated_by)
  on app.profiles to authenticated;
grant select, insert, delete on app.documents to authenticated;
grant update (title, kind, status, issuer, counterparty, issued_on, expires_on, renews_on, notes, updated_at) on app.documents to authenticated;
grant select, insert on app.document_versions to authenticated;
grant select, insert on app.acknowledgments to authenticated;
grant select on app.audit_log to authenticated;
grant select, insert on app.consents to authenticated;
grant all on all tables in schema app to service_role;

revoke execute on all functions in schema app from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, text[]) to authenticated, service_role;
grant execute on function app.audit_append(uuid, text, uuid), app.audit_verify(uuid), app.create_workspace(text, boolean) to authenticated;
grant execute on all functions in schema app to service_role;
