-- The signer's done page shows the name they typed on its signature rule (Design spec 2026-11-02 §6.4): the same
-- name the certificate records. esign_open as 0025 made it, plus one column at the end, signed_name: null until the
-- request is signed, then what app.esign_complete stored (1-120 characters). Only the token holder reaches it, as
-- every other column here; the open check, the audit row and the frozen sender name are unchanged.
-- Dropped and created again because the result columns change (create or replace can't); the same grants as 0018.
drop function app.esign_open(uuid, text, boolean);
create function app.esign_open(req uuid, secret_hash text, record_open boolean)
returns table (org_id uuid, org_name text, is_demo boolean, document_id uuid, title text, signer_name text, signer_email text,
  status text, expires_at timestamptz, requested_at timestamptz, version int, next_version int, storage_path text, mime text,
  sha256 text, signed_at timestamptz, to_sign_path text, to_sign_sha256 text, signed_name text)
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
      v.storage_path, v.mime, v.sha256, r.signed_at, r.to_sign_path, r.to_sign_sha256, r.signed_name
    from app.documents d
    join app.organizations o on o.id = d.org_id
    join app.document_versions v on v.document_id = r.document_id and v.version = coalesce(r.signed_version, r.version)
    where d.id = r.document_id;
end
$$;
revoke execute on function app.esign_open(uuid, text, boolean) from public;
grant execute on function app.esign_open(uuid, text, boolean) to anon, authenticated;
