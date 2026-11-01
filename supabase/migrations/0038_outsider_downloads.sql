-- The document's History promised "every view and download", but only the workspace's own were in it: a
-- passport visitor's view or download went to app.share_access alone (the link's own page), and a signer's
-- download of the file to sign, or of the signed copy, was recorded nowhere (wave 8, #3). Both now also
-- write the document's audit_log row, as the team's own views and downloads do, with no actor (an outsider).
--
-- passport_file: same function as 0003, plus the audit row after the share_access row.
create or replace function app.passport_file(link uuid, secret_hash text, doc uuid, visitor_hash text, access text)
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
    perform app.audit_write(l.org_id, null, case access when 'downloaded' then 'document.link_downloaded' else 'document.link_viewed' end, doc);
  end if;
end
$$;

-- A signer's download: the same request check as esign_open (valid token, not expired, pending or signed), then
-- one audit row naming which file: the one sent to sign, or the signed copy. True when the request was found.
create function app.esign_file_opened(req uuid, secret_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r app.signature_requests;
begin
  select * into r from app.signature_requests s where s.id = req and s.token_hash = secret_hash and s.expires_at > now()
    and s.status in ('pending', 'signed');
  if not found then
    return false;
  end if;
  perform app.audit_write(r.org_id, null, case r.status when 'signed' then 'esign.signed_copy_downloaded' else 'esign.file_downloaded' end, r.document_id);
  return true;
end
$$;
revoke execute on function app.esign_file_opened(uuid, text) from public;
grant execute on function app.esign_file_opened(uuid, text) to anon, authenticated;
