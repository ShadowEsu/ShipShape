-- Signing and adding a version at the same moment could give both the same version number: each
-- read max(version) + 1 without a lock, and the second insert failed (23505), a 500 for the signer or
-- the uploader. uploadVersion now locks the document row (for no key update) before it reads; this
-- does the same here, so the two take turns. Same function as 0003 otherwise.
create or replace function app.esign_complete(req uuid, secret_hash text, code_hash text, consent_ver text, consent_hash text,
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
  perform 1 from app.documents d where d.id = r.document_id for no key update;
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
