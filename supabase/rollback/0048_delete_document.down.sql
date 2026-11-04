-- Undoes 0048_delete_document.sql. Not a migration: the runner reads supabase/migrations only, never this folder.
-- Run it as shipshape_owner, then delete 0048's row from meta.migrations, in one transaction (infra/README.md,
-- "Undoing a migration"). Documents already deleted stay deleted, with their document.deleted History rows; files
-- still queued in app.storage_cleanup stay queued for the daily run. It puts back 0039's esign_issue_code, the
-- outbox without document_id (its index goes with the column), and 0001's delete right and policy on documents.
drop function app.delete_document(uuid, uuid);

create or replace function app.esign_issue_code(req uuid, secret_hash text, code_hash text, mail_subject text, mail_body text) returns text
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
  insert into app.outbox (org_id, to_email, subject, body, kind) values (r.org_id, r.signer_email, mail_subject, mail_body, 'esign_code');
  perform app.audit_write(r.org_id, null, 'esign.code_sent', r.document_id);
  return 'ok';
end
$$;

alter table app.outbox drop column document_id;

grant delete on app.documents to authenticated;
create policy documents_delete on app.documents for delete to authenticated using (app.has_role(org_id, array['owner', 'admin']));
