-- M3: passport links, deadline reminders and e-signatures.
--
-- People outside the workspace (someone opening a passport link, a signer) never touch these
-- tables directly. They reach them only through the security-definer functions below, which check
-- the link's secret (sha-256 of the token in the URL fragment; the token itself is never stored),
-- its expiry and revocation, and record every access.

-- Passport links ---------------------------------------------------------------------------------

create table app.share_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  label text not null check (length(label) between 1 and 120),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Every link expires, at most 90 days out (Security R6).
  check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);
create index share_links_org_idx on app.share_links (org_id, created_at desc);
create trigger share_links_org_fixed before update on app.share_links for each row execute function app.forbid_org_change();

-- Revoking is one-way and the database stamps the time.
create function app.lock_revocation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null then
    raise exception 'link already revoked' using errcode = '42501';
  end if;
  if new.revoked_at is not null then
    new.revoked_at := now();
  end if;
  return new;
end
$$;
create trigger share_links_revocation before update on app.share_links for each row execute function app.lock_revocation();

create table app.share_link_documents (
  link_id uuid not null references app.share_links(id) on delete cascade,
  document_id uuid not null references app.documents(id) on delete cascade,
  org_id uuid not null references app.organizations(id) on delete cascade,
  primary key (link_id, document_id)
);
create trigger share_link_documents_org before insert on app.share_link_documents for each row execute function app.document_in_org();

create function app.link_in_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.share_links l where l.id = new.link_id and l.org_id = new.org_id) then
    raise exception 'link not in this workspace' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger share_link_documents_link before insert on app.share_link_documents for each row execute function app.link_in_org();

-- Who opened what through a link. `visitor` is a keyed hash prefix of the IP, never the IP.
create table app.share_access (
  link_id uuid not null references app.share_links(id) on delete cascade,
  org_id uuid not null references app.organizations(id) on delete cascade,
  at timestamptz not null default now(),
  action text not null check (action in ('opened', 'viewed', 'downloaded')),
  document_id uuid references app.documents(id) on delete set null,
  visitor text not null check (visitor ~ '^[0-9a-f]{16}$')
);
create index share_access_link_idx on app.share_access (link_id, at desc);

-- The documents a valid link shows (latest version of each active document). Returns no rows for
-- an unknown, wrong, expired or revoked link, so a caller can't tell those cases apart.
create function app.passport_open(link uuid, secret_hash text, visitor_hash text)
returns table (org_name text, label text, expires_at timestamptz, document_id uuid, title text, kind text, issuer text,
  issued_on date, expires_on date, version int, mime text)
language plpgsql security definer set search_path = '' as $$
declare
  l app.share_links;
begin
  select * into l from app.share_links s
  where s.id = link and s.token_hash = secret_hash and s.revoked_at is null and s.expires_at > now();
  if not found then
    return;
  end if;
  insert into app.share_access (link_id, org_id, action, visitor) values (l.id, l.org_id, 'opened', visitor_hash);
  return query
    select o.name, l.label, l.expires_at, d.id, d.title, d.kind, d.issuer, d.issued_on, d.expires_on, v.version, v.mime
    from app.share_link_documents sd
    join app.documents d on d.id = sd.document_id and d.status = 'active'
    join app.organizations o on o.id = l.org_id
    join lateral (select dv.version, dv.mime from app.document_versions dv where dv.document_id = d.id order by dv.version desc limit 1) v on true
    where sd.link_id = l.id
    order by d.kind, d.title;
end
$$;

-- The storage path of one document's latest version through a valid link; logs the view or download.
create function app.passport_file(link uuid, secret_hash text, doc uuid, visitor_hash text, access text)
returns table (storage_path text, mime text, title text, version int)
language plpgsql security definer set search_path = '' as $$
declare
  l app.share_links;
begin
  if access not in ('viewed', 'downloaded') then
    raise exception 'bad access kind' using errcode = '22023';
  end if;
  select * into l from app.share_links s
  where s.id = link and s.token_hash = secret_hash and s.revoked_at is null and s.expires_at > now();
  if not found then
    return;
  end if;
  return query
    select v.storage_path, v.mime, d.title, v.version
    from app.share_link_documents sd
    join app.documents d on d.id = sd.document_id and d.status = 'active'
    join lateral (select dv.storage_path, dv.mime, dv.version from app.document_versions dv where dv.document_id = d.id order by dv.version desc limit 1) v on true
    where sd.link_id = l.id and sd.document_id = doc;
  if found then
    insert into app.share_access (link_id, org_id, action, document_id, visitor) values (l.id, l.org_id, access, doc, visitor_hash);
  end if;
end
$$;

-- Deadline reminders -------------------------------------------------------------------------------

-- One row per reminder already sent, so each one goes out once: 90, 30 and 7 days before a
-- document's expiry or renewal date, and on the day it lapses.
create table app.reminders_sent (
  document_id uuid not null references app.documents(id) on delete cascade,
  org_id uuid not null references app.organizations(id) on delete cascade,
  due_on date not null,
  days_before int not null check (days_before in (90, 30, 7, 0)),
  sent_at timestamptz not null default now(),
  primary key (document_id, due_on, days_before)
);

-- Messages ShipShape would email. Production email sending is off, so messages land here and the
-- workspace's members read them in the app; nothing leaves the server.
create table app.outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  to_email text not null check (length(to_email) <= 200),
  subject text not null check (length(subject) <= 200),
  body text not null check (length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index outbox_org_idx on app.outbox (org_id, created_at desc);

-- E-signatures -----------------------------------------------------------------------------------

create table app.signature_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id) on delete cascade,
  document_id uuid not null,
  version int not null,
  signer_name text not null check (length(signer_name) between 1 and 120),
  signer_email text not null check (length(signer_email) between 3 and 200),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'signed', 'declined', 'revoked')),
  otp_hash text check (otp_hash ~ '^[0-9a-f]{64}$'),
  otp_expires_at timestamptz,
  otp_attempts int not null default 0,
  otp_sent int not null default 0,
  consent_version text,
  consent_sha256 text check (consent_sha256 ~ '^[0-9a-f]{64}$'),
  consented_at timestamptz,
  signed_name text check (length(signed_name) <= 120),
  signed_at timestamptz,
  signed_version int,
  signer_visitor text check (signer_visitor ~ '^[0-9a-f]{16}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (document_id, version) references app.document_versions(document_id, version) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index signature_requests_org_idx on app.signature_requests (org_id, created_at desc);
create trigger signature_requests_org_fixed before update on app.signature_requests for each row execute function app.forbid_org_change();
create trigger signature_requests_doc before insert on app.signature_requests for each row execute function app.document_in_org();

-- What a signer may see for a valid request (pending, or signed so they can fetch their copy).
-- No rows otherwise. `record_open` logs the visit; the signing step itself reads without logging.
create function app.esign_open(req uuid, secret_hash text, record_open boolean)
returns table (org_id uuid, org_name text, is_demo boolean, document_id uuid, title text, signer_name text, signer_email text,
  status text, expires_at timestamptz, requested_at timestamptz, version int, next_version int, storage_path text, mime text,
  sha256 text, signed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  r app.signature_requests;
begin
  select * into r from app.signature_requests s where s.id = req and s.token_hash = secret_hash and s.expires_at > now()
    and s.status in ('pending', 'signed');
  if not found then
    return;
  end if;
  if record_open and r.status = 'pending' then
    perform app.audit_write(r.org_id, null, 'esign.opened', r.document_id);
  end if;
  return query
    select r.org_id, o.name, o.is_demo, r.document_id, d.title, r.signer_name, r.signer_email, r.status, r.expires_at, r.created_at,
      coalesce(r.signed_version, r.version), (select coalesce(max(x.version), 0) + 1 from app.document_versions x where x.document_id = r.document_id),
      v.storage_path, v.mime, v.sha256, r.signed_at
    from app.documents d
    join app.organizations o on o.id = d.org_id
    join app.document_versions v on v.document_id = r.document_id and v.version = coalesce(r.signed_version, r.version)
    where d.id = r.document_id;
end
$$;

-- Stores a fresh one-time code (its hash) for a pending request: at most 5 codes, each valid 10
-- minutes. Email sending is off, so the message carrying the code goes to the workspace outbox.
create function app.esign_issue_code(req uuid, secret_hash text, code_hash text, mail_subject text, mail_body text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r app.signature_requests;
begin
  select * into r from app.signature_requests s where s.id = req and s.token_hash = secret_hash for update;
  if not found or r.status <> 'pending' or r.expires_at <= now() then
    return 'invalid';
  end if;
  if r.otp_sent >= 5 then
    return 'too_many';
  end if;
  update app.signature_requests set otp_hash = code_hash, otp_expires_at = now() + interval '10 minutes', otp_attempts = 0,
    otp_sent = otp_sent + 1 where id = r.id;
  insert into app.outbox (org_id, to_email, subject, body) values (r.org_id, r.signer_email, mail_subject, mail_body);
  perform app.audit_write(r.org_id, null, 'esign.code_sent', r.document_id);
  return 'ok';
end
$$;

-- Completes a signature: checks the code (5 tries per code), records consent and the typed name,
-- and adds the signed PDF as a new, immutable version. Returns 'ok', 'bad_code', 'locked',
-- 'expired_code' or 'invalid'; a wrong code is counted, never raised, so the count sticks.
create function app.esign_complete(req uuid, secret_hash text, code_hash text, consent_ver text, consent_hash text,
  typed_name text, visitor_hash text, signed_path text, signed_sha256 text, signed_size int) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r app.signature_requests;
  next_version int;
begin
  select * into r from app.signature_requests s where s.id = req and s.token_hash = secret_hash for update;
  if not found or r.status <> 'pending' or r.expires_at <= now() or r.otp_hash is null then
    return 'invalid';
  end if;
  if r.otp_attempts >= 5 then
    return 'locked';
  end if;
  if r.otp_expires_at <= now() then
    return 'expired_code';
  end if;
  if r.otp_hash <> code_hash then
    update app.signature_requests set otp_attempts = otp_attempts + 1 where id = r.id;
    return 'bad_code';
  end if;
  if length(coalesce(typed_name, '')) not between 1 and 120 or consent_ver is null or consent_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'missing consent or name' using errcode = '22023';
  end if;
  select coalesce(max(v.version), 0) + 1 into next_version from app.document_versions v where v.document_id = r.document_id;
  if signed_path <> r.org_id::text || '/' || r.document_id::text || '/v' || next_version::text || '.pdf' then
    raise exception 'signed copy path does not match the next version' using errcode = '22023';
  end if;
  insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, created_by)
  values (r.document_id, next_version, r.org_id, signed_path, 'application/pdf', signed_size, signed_sha256, 'signed', null);
  update app.signature_requests set status = 'signed', otp_hash = null, consent_version = consent_ver, consent_sha256 = consent_hash,
    consented_at = now(), signed_name = typed_name, signed_at = now(), signed_version = next_version, signer_visitor = visitor_hash
  where id = r.id;
  return 'ok';
end
$$;

-- Audit mapping for the new tables -------------------------------------------------------------

create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  org uuid;
  object uuid;
  act text;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  org := (r ->> 'org_id')::uuid;
  if not exists (select 1 from app.organizations o where o.id = org) then
    return null;
  end if;
  if tg_table_name = 'documents' then
    object := (r ->> 'id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'document.created'
      when tg_op = 'DELETE' then 'document.deleted'
      when new.status is distinct from old.status then 'document.' || case new.status when 'archived' then 'archived' else 'restored' end
      else 'document.updated' end;
  elsif tg_table_name = 'document_versions' then
    object := (r ->> 'document_id')::uuid;
    act := case r ->> 'origin' when 'signed' then 'document.signed_version_added' else 'document.version_added' end;
  elsif tg_table_name = 'acknowledgments' then
    object := (r ->> 'document_id')::uuid;
    act := 'document.acknowledged';
  elsif tg_table_name = 'profiles' then
    object := org;
    act := 'profile.updated';
  elsif tg_table_name = 'share_links' then
    object := (r ->> 'id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'passport.created'
      when tg_op = 'DELETE' then 'passport.deleted'
      when new.revoked_at is not null and old.revoked_at is null then 'passport.revoked'
      else 'passport.updated' end;
  elsif tg_table_name = 'signature_requests' then
    object := (r ->> 'document_id')::uuid;
    act := case
      when tg_op = 'INSERT' then 'esign.requested'
      when new.status is distinct from old.status then 'esign.' || new.status
      else null end;
    if act is null then
      return null; -- code issued or a wrong code counted: logged by the functions themselves or not at all
    end if;
  else
    raise exception 'no audit mapping for %', tg_table_name;
  end if;
  perform app.audit_write(org, (select auth.uid()), act, object);
  return null;
end
$$;

create trigger share_links_audit after insert or update or delete on app.share_links for each row execute function app.audit_row_change();
create trigger signature_requests_audit after insert or update on app.signature_requests for each row execute function app.audit_row_change();

-- Row level security -----------------------------------------------------------------------------

alter table app.share_links enable row level security;
alter table app.share_link_documents enable row level security;
alter table app.share_access enable row level security;
alter table app.reminders_sent enable row level security;
alter table app.outbox enable row level security;
alter table app.signature_requests enable row level security;

create policy links_read on app.share_links for select to authenticated using (app.is_member(org_id));
create policy links_add on app.share_links for insert to authenticated
  with check (app.is_member(org_id) and created_by = (select auth.uid()));
create policy links_revoke on app.share_links for update to authenticated
  using (app.is_member(org_id)) with check (app.is_member(org_id) and revoked_at is not null);

create policy link_docs_read on app.share_link_documents for select to authenticated using (app.is_member(org_id));
create policy link_docs_add on app.share_link_documents for insert to authenticated with check (app.is_member(org_id));

create policy access_read on app.share_access for select to authenticated using (app.is_member(org_id));

create policy reminders_read on app.reminders_sent for select to authenticated using (app.is_member(org_id));

create policy outbox_read on app.outbox for select to authenticated using (app.is_member(org_id));

create policy esign_read on app.signature_requests for select to authenticated using (app.is_member(org_id));
create policy esign_add on app.signature_requests for insert to authenticated
  with check (app.is_member(org_id) and created_by = (select auth.uid()) and status = 'pending');
create policy esign_revoke on app.signature_requests for update to authenticated
  using (app.is_member(org_id) and status = 'pending') with check (app.is_member(org_id) and status = 'revoked');

-- Grants: column lists keep secrets and signer evidence out of reach -----------------------------

grant select (id, org_id, label, expires_at, revoked_at, created_by, created_at) on app.share_links to authenticated;
grant insert (org_id, label, token_hash, expires_at, created_by) on app.share_links to authenticated;
grant update (revoked_at) on app.share_links to authenticated;
grant select, insert on app.share_link_documents to authenticated;
grant select on app.share_access to authenticated;
grant select on app.reminders_sent to authenticated;
grant select on app.outbox to authenticated;
grant select (id, org_id, document_id, version, signer_name, signer_email, expires_at, status, consent_version, consented_at,
  signed_name, signed_at, signed_version, created_by, created_at) on app.signature_requests to authenticated;
grant insert (org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, created_by)
  on app.signature_requests to authenticated;
grant update (status) on app.signature_requests to authenticated;

grant select, insert, update, delete on app.share_links, app.share_link_documents, app.share_access, app.reminders_sent,
  app.outbox, app.signature_requests to service_role;

revoke execute on function app.link_in_org(), app.lock_revocation(), app.passport_open(uuid, text, text),
  app.passport_file(uuid, text, uuid, text, text), app.esign_open(uuid, text, boolean), app.esign_issue_code(uuid, text, text, text, text),
  app.esign_complete(uuid, text, text, text, text, text, text, text, text, int) from public;
grant execute on function app.passport_open(uuid, text, text), app.passport_file(uuid, text, uuid, text, text),
  app.esign_open(uuid, text, boolean), app.esign_issue_code(uuid, text, text, text, text),
  app.esign_complete(uuid, text, text, text, text, text, text, text, text, int) to anon, authenticated;
