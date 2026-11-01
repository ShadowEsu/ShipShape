-- Outbox privacy (review W10-4, W10-5; Security 2026-11-01 0749): the outbox holds the messages
-- ShipShape would email, and until now every member of a workspace could read all of them.
--
-- - Only owners and admins read the outbox: reminders go to them, so plain members see none.
-- - Signing-code messages are read by nobody in a real workspace. Whoever sends a signing request
--   has its link; with the code in the outbox too they could sign as the signer, and the code would
--   prove nothing about the signer's mailbox. The sample workspace keeps showing its codes: the
--   visitor plays both sides there. Each row now says which kind it is (`esign_issue_code` writes
--   'esign_code'; everything else is a reminder).
-- - The daily run deletes reminders over 90 days old and signing-code messages over 1 day old (a
--   code is dead after 10 minutes, but the row still holds the signer's email and the code).
--
-- The outbox is not part of the audit chain: `esign.code_sent` is written by `audit_write` to
-- app.audit_log, a separate table, and no audit_* function (audit_verify included) reads
-- app.outbox, so deleting outbox rows leaves every chain intact.

alter table app.outbox add column kind text not null default 'reminder' check (kind in ('reminder', 'esign_code'));
-- Rows written before this migration: every signing-code message has the one subject
-- lib/server/esign.ts gives it, so those rows are marked now rather than labelled reminders by the
-- default, which would show them to real owners and admins and keep them 90 days (Security SHOULD-B1).
update app.outbox set kind = 'esign_code' where subject = 'Your ShipShape signing code';

-- Same function as 0003, except the outbox row is marked as a signing code. Its grants are kept.
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

drop policy outbox_read on app.outbox;
create policy outbox_read on app.outbox for select to authenticated using (
  app.has_role(org_id, array['owner', 'admin'])
  and (kind <> 'esign_code' or exists (select 1 from app.organizations o where o.id = outbox.org_id and o.is_demo))
);

-- The daily run: reminders over 90 days old and signing-code messages over 1 day old are deleted.
-- Returns how many.
create function app.purge_outbox() returns integer
language sql security definer set search_path = '' as $$
  with gone as (
    delete from app.outbox m
    where (m.kind = 'reminder' and m.created_at < now() - interval '90 days')
       or (m.kind = 'esign_code' and m.created_at < now() - interval '1 day')
    returning 1
  )
  select count(*)::integer from gone
$$;
revoke execute on function app.purge_outbox() from public, anon, authenticated;
grant execute on function app.purge_outbox() to service_role;
