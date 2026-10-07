-- ShipShape production schema. Same shapes as lib/store.ts, one workspace per organization.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  primary key (org_id, user_id)
);

create table scans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  target text not null,
  kind text not null check (kind in ('repo', 'live')),
  rules_as_of date not null,
  score int not null,
  signals jsonb not null,   -- findings evidence only; source code is never stored
  findings jsonb not null,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('privacy-policy', 'terms', 'store-answers', 'agreement'))
);

-- Versions are insert only: no update or delete policy is granted.
create table document_versions (
  document_id uuid not null references documents(id) on delete cascade,
  version int not null,
  content text not null,
  sha256 text not null,
  from_scan uuid references scans(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (document_id, version)
);

create table signature_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null,
  version int not null,
  sha256 text not null,
  signer_name text not null,
  signer_email text not null,
  status text not null default 'pending' check (status in ('pending', 'signed')),
  signed jsonb,             -- typed name, time, ip, user agent, consent text
  created_at timestamptz not null default now(),
  foreign key (document_id, version) references document_versions(document_id, version)
);

-- Append only, each row hashes the previous one (see verifyAuditChain in lib/store.ts).
create table audit_log (
  org_id uuid not null references organizations(id) on delete cascade,
  seq bigint not null,
  at timestamptz not null default now(),
  actor uuid references auth.users(id),
  action text not null,
  detail text not null,
  prev_hash text not null,
  hash text not null,
  primary key (org_id, seq)
);

create table waitlist (
  email text primary key,
  created_at timestamptz not null default now()
);

-- Row level security: members see only their own organization's rows.
alter table organizations enable row level security;
alter table members enable row level security;
alter table scans enable row level security;
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table signature_requests enable row level security;
alter table audit_log enable row level security;
alter table waitlist enable row level security; -- no policies: service role only

create function is_member(org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = org and user_id = auth.uid())
$$;

create policy "members read org" on organizations for select using (is_member(id));
create policy "members read members" on members for select using (is_member(org_id));
create policy "members use scans" on scans for all using (is_member(org_id)) with check (is_member(org_id));
create policy "members use documents" on documents for all using (is_member(org_id)) with check (is_member(org_id));
create policy "members read versions" on document_versions for select using (exists (select 1 from documents d where d.id = document_id and is_member(d.org_id)));
create policy "members add versions" on document_versions for insert with check (exists (select 1 from documents d where d.id = document_id and is_member(d.org_id)));
create policy "members use signatures" on signature_requests for select using (is_member(org_id));
create policy "members add signatures" on signature_requests for insert with check (is_member(org_id));
create policy "members read audit" on audit_log for select using (is_member(org_id));
-- Signing and audit writes go through the server with the service role, never directly from the browser.
