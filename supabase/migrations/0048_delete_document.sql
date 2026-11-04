-- Delete for good (C17; Security 2026-11-04 0715, answer 1, D1-D6): an owner or admin deletes one archived document,
-- with everything made from it.
--
-- app.delete_document is the only way a document's rows go while its workspace stays. It refuses (each with its own
-- code, which lib/server/documents.ts turns into a sentence):
--   42501  the caller isn't an owner or admin of `org`;
--   SS003  no document with this id in `org`: another workspace's id reads exactly like an unknown one (D3);
--   SS004  the document isn't archived;
--   SS005  someone has signed it (a signed request, or a signed copy among its versions): a partly signed document is a
--          record the other signer relies on (D4).
-- It locks the document's signature requests, then the document: esign_complete's order (Security W8a), so a signer
-- finishing at that moment finishes first and the delete then sees the signature and refuses. Otherwise it withdraws
-- the open requests (their esign.revoked rows go into History first), queues every stored file the rows point at (each
-- version, and each request's file to sign, which lives under the request's id) in app.storage_cleanup (0028), and
-- deletes the document. Its foreign keys take the rest: versions, signature requests (through their version), passport
-- link membership, reminders sent, saves, and the outbox messages about it (below). Acknowledgments and passport
-- visits keep their rows with the document's id set to null; they hold no title.
--
-- History (D1): the documents audit trigger writes one document.deleted row, with the actor, the time and the
-- document's id. The audit chain never held a title (0001, 0010, 0038 hash ids, actions and file fingerprints only);
-- History pages read titles from the document row, so once the row is gone they read "a deleted document".
--
-- The files go after the commit: the server removes the returned paths and then their queue rows; a removal that
-- fails stays queued and the daily run retries it (account.ts retryStorageCleanup). No row ever points at a removed
-- file, and the bucket's noncurrent versions expire 7 days later (infra/storage.yaml), which is what the confirm
-- sentence says (D5). Free's file total (plans.ts) sums the version rows, so it drops with the commit (D6).
--
-- Outbox: a reminder and a signing-code message name the document's title in their text, so each now records the
-- document it is about (document_id, on delete cascade). The reminder run and esign_issue_code fill it; rows written
-- before this migration are matched by their own wording, and only where exactly one document fits. Reminders are
-- deleted after 90 days and signing codes after 1 day anyway (0039).
--
-- Signed-in users lose their direct delete right on app.documents (0001's grant and documents_delete policy): a
-- delete that skipped this function would leave stored files with nothing pointing at them, and no D4 check.
--
-- Undo: supabase/rollback/0048_delete_document.down.sql (see infra/README.md, "Undoing a migration").

alter table app.outbox add column document_id uuid references app.documents(id) on delete cascade;
create index outbox_document_idx on app.outbox (document_id) where document_id is not null;

-- Rows from before: a reminder's body begins "<title> expires …", "<title> is due for renewal …", "<title> expired …"
-- or "<title> passed its renewal date …" (lib/server/deadlines.ts reminderText); a signing code's begins
-- 'Your code to sign "<title>" for ' and goes to the request's signer (lib/server/esign.ts sendSigningCode).
with fits as (
  select m.id, d.id as doc
  from app.outbox m
  join app.documents d on d.org_id = m.org_id
  where m.kind = 'reminder' and starts_with(m.body, d.title || ' ')
    and substr(m.body, length(d.title) + 2) ~ '^(expires|is due for renewal|expired|passed its renewal date)\M'
  union
  select m.id, d.id
  from app.outbox m
  join app.signature_requests r on r.org_id = m.org_id and r.signer_email = m.to_email
  join app.documents d on d.id = r.document_id
  where m.kind = 'esign_code' and starts_with(m.body, 'Your code to sign "' || d.title || '" for ')
), one as (
  select f.id, min(f.doc::text)::uuid as doc from fits f group by f.id having count(*) = 1
)
update app.outbox m set document_id = one.doc from one where one.id = m.id;

-- Same function as 0039, except the outbox row records the document it is about.
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
  insert into app.outbox (org_id, to_email, subject, body, kind, document_id) values (r.org_id, r.signer_email, mail_subject, mail_body, 'esign_code', r.document_id);
  perform app.audit_write(r.org_id, null, 'esign.code_sent', r.document_id);
  return 'ok';
end
$$;

create function app.delete_document(org uuid, doc uuid) returns table (storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  st text;
  paths text[];
begin
  if (select auth.uid()) is null or not app.has_role(org, array['owner', 'admin']) then
    raise exception 'owners and admins only' using errcode = '42501';
  end if;
  perform 1 from app.signature_requests s where s.document_id = doc and s.org_id = org order by s.id for update;
  select d.status into st from app.documents d where d.id = doc and d.org_id = org for update;
  if not found then
    raise exception 'no such document in this workspace' using errcode = 'SS003';
  end if;
  if st <> 'archived' then
    raise exception 'only an archived document can be deleted' using errcode = 'SS004';
  end if;
  if exists (select 1 from app.signature_requests s where s.document_id = doc and s.org_id = org and s.status = 'signed')
     or exists (select 1 from app.document_versions v where v.document_id = doc and v.origin = 'signed') then
    raise exception 'someone has signed this document' using errcode = 'SS005';
  end if;
  -- Open requests are withdrawn first, as archiving and a new version do, so History says so before it says Deleted.
  update app.signature_requests s set status = 'revoked'
  where s.document_id = doc and s.org_id = org and s.status = 'pending' and s.expires_at > now();
  select coalesce(array_agg(p), '{}') into paths from (
    select v.storage_path from app.document_versions v where v.document_id = doc
    union all
    select s.to_sign_path from app.signature_requests s where s.document_id = doc and s.org_id = org and s.to_sign_path is not null
  ) x (p);
  insert into app.storage_cleanup (path) select unnest(paths) on conflict (path) do nothing;
  delete from app.documents d where d.id = doc;
  return query select unnest(paths);
end
$$;
revoke execute on function app.delete_document(uuid, uuid) from public, anon;
grant execute on function app.delete_document(uuid, uuid) to authenticated;

drop policy documents_delete on app.documents;
revoke delete on app.documents from authenticated;
