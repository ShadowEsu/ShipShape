-- Security R2-1: the signer reviews exactly the bytes that get signed. When a signature is
-- requested, the server builds the inert "to sign" PDF once and stores it with its SHA-256; the
-- signer downloads that file, and the signed copy is that file with the certificate appended.
-- The object lives at <org>/<request id>/v1.pdf (the request id stands where a document id would).

alter table app.signature_requests
  add column to_sign_path text,
  add column to_sign_sha256 text check (to_sign_sha256 ~ '^[0-9a-f]{64}$');

-- Requests made before this change have no reviewed file to sign; none exists in production.
update app.signature_requests set status = 'revoked' where status = 'pending' and to_sign_path is null;

alter table app.signature_requests
  add constraint signature_requests_to_sign_path check (to_sign_path is null or to_sign_path = org_id::text || '/' || id::text || '/v1.pdf'),
  add constraint signature_requests_to_sign_pair check ((to_sign_path is null) = (to_sign_sha256 is null)),
  add constraint signature_requests_pending_to_sign check (status <> 'pending' or to_sign_path is not null);

grant insert (id, to_sign_path, to_sign_sha256) on app.signature_requests to authenticated;
grant select (to_sign_sha256) on app.signature_requests to authenticated;

-- As in 0003, plus the file the signer reviews and its fingerprint.
drop function app.esign_open(uuid, text, boolean);
create function app.esign_open(req uuid, secret_hash text, record_open boolean)
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
    select r.org_id, o.name, o.is_demo, r.document_id, d.title, r.signer_name, r.signer_email, r.status, r.expires_at, r.created_at,
      coalesce(r.signed_version, r.version), (select coalesce(max(x.version), 0) + 1 from app.document_versions x where x.document_id = r.document_id),
      v.storage_path, v.mime, v.sha256, r.signed_at, r.to_sign_path, r.to_sign_sha256
    from app.documents d
    join app.organizations o on o.id = d.org_id
    join app.document_versions v on v.document_id = r.document_id and v.version = coalesce(r.signed_version, r.version)
    where d.id = r.document_id;
end
$$;
revoke execute on function app.esign_open(uuid, text, boolean) from public;
grant execute on function app.esign_open(uuid, text, boolean) to anon, authenticated;
