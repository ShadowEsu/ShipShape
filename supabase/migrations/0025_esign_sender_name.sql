-- Security RN-1: a signature request keeps the workspace's name as it was when the request was sent.
-- The signing page, the code message and the certificate's "Sent by" all show this name, so renaming
-- the workspace later can't make the certificate differ from what the signer saw. The database sets it
-- when the request is made; nobody can write it (no insert or update grant on the column).
alter table app.signature_requests add column sender_name text;
update app.signature_requests r set sender_name = o.name from app.organizations o where o.id = r.org_id;
alter table app.signature_requests alter column sender_name set not null;

create function app.freeze_sender_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select o.name into strict new.sender_name from app.organizations o where o.id = new.org_id;
  return new;
end
$$;

create trigger signature_requests_sender_name before insert on app.signature_requests
  for each row execute function app.freeze_sender_name();

-- As in 0018, with the frozen name in place of the workspace's current one.
create or replace function app.esign_open(req uuid, secret_hash text, record_open boolean)
returns table (org_id uuid, org_name text, is_demo boolean, document_id uuid, title text, signer_name text, signer_email text,
  status text, expires_at timestamptz, requested_at timestamptz, version int, next_version int, storage_path text, mime text,
  sha256 text, signed_at timestamptz, to_sign_path text, to_sign_sha256 text)
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
    select r.org_id, r.sender_name, o.is_demo, r.document_id, d.title, r.signer_name, r.signer_email, r.status, r.expires_at, r.created_at,
      coalesce(r.signed_version, r.version), (select coalesce(max(x.version), 0) + 1 from app.document_versions x where x.document_id = r.document_id),
      v.storage_path, v.mime, v.sha256, r.signed_at, r.to_sign_path, r.to_sign_sha256
    from app.documents d
    join app.organizations o on o.id = d.org_id
    join app.document_versions v on v.document_id = r.document_id and v.version = coalesce(r.signed_version, r.version)
    where d.id = r.document_id;
end
$$;
