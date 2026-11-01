-- The document's History promised "every view and download", but only the workspace's own were in it: a
-- passport visitor's view or download went to app.share_access alone (the link's own page), and a signer's
-- download of the file to sign, or of the signed copy, was recorded nowhere (wave 8, #3). Both now also
-- write the document's audit_log row, as the team's own views and downloads do, with no actor (an outsider).
--
-- History is where an owner asks "who?" (Design), so a row can say which link or which signing request it
-- is about: a new nullable `about` column holding that id, covered by the row's hash when present. Rows
-- written before this migration have no `about`, so their hashes are unchanged and old chains still verify.
-- No foreign key: a history row outlives the link or request it names; the page falls back to the plain label.
alter table app.audit_log add column about uuid;

-- The hash covers `about` the way it covers the fingerprint: only when the row has one.
drop function app.audit_hash(uuid, bigint, timestamptz, uuid, text, uuid, text, text);
create function app.audit_hash(org uuid, seq bigint, at timestamptz, actor uuid, action text, object_id uuid, prev_hash text, detail text, about uuid)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|',
    org::text, seq::text, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(actor::text, '-'), action, coalesce(object_id::text, '-'), prev_hash)
    || coalesce('|sha256:' || detail, '') || coalesce('|about:' || about::text, ''), 'UTF8')), 'hex')
$$;

-- Internal: callable only by other functions in this schema (no grants). Same as 0031 plus `about`.
drop function app.audit_write(uuid, uuid, text, uuid, text);
create function app.audit_write(org uuid, actor uuid, action text, object_id uuid, detail text default null, about uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  prev record;
  next_seq bigint;
  ts timestamptz := clock_timestamp();
  prev_h text;
begin
  perform 1 from app.organizations o where o.id = org for no key update;
  if not found then
    raise exception 'unknown organization' using errcode = '42501';
  end if;
  select a.seq, a.hash into prev from app.audit_log a where a.org_id = org order by a.seq desc limit 1;
  next_seq := coalesce(prev.seq, 0) + 1;
  prev_h := coalesce(prev.hash, 'genesis');
  insert into app.audit_log (org_id, seq, at, actor, action, object_id, prev_hash, hash, detail_sha256, about)
  values (org, next_seq, ts, actor, action, object_id, prev_h, app.audit_hash(org, next_seq, ts, actor, action, object_id, prev_h, detail, about), detail, about);
  return next_seq;
end
$$;

-- Same as 0010, verifying `about` with the rest.
create or replace function app.audit_verify(org uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  expected_prev text := 'genesis';
  expected_seq bigint := 1;
begin
  if (select auth.uid()) is null or not app.is_member(org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  for r in select * from app.audit_log a where a.org_id = org order by a.seq loop
    if r.seq <> expected_seq or r.prev_hash <> expected_prev
       or r.hash <> app.audit_hash(r.org_id, r.seq, r.at, r.actor, r.action, r.object_id, r.prev_hash, r.detail_sha256, r.about) then
      return expected_seq;
    end if;
    expected_prev := r.hash;
    expected_seq := expected_seq + 1;
  end loop;
  return null;
end
$$;

-- passport_file: same function as 0003, plus the audit row (about the link) after the share_access row.
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
    perform app.audit_write(l.org_id, null, case access when 'downloaded' then 'document.link_downloaded' else 'document.link_viewed' end, doc, null, l.id);
  end if;
end
$$;

-- A signer's download: the same request check as esign_open (valid token, not expired, pending or signed), then
-- one audit row (about the request) naming which file: the one sent to sign, or the signed copy. True when found.
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
  perform app.audit_write(r.org_id, null, case r.status when 'signed' then 'esign.signed_copy_downloaded' else 'esign.file_downloaded' end, r.document_id, null, r.id);
  return true;
end
$$;
revoke execute on function app.esign_file_opened(uuid, text) from public;
grant execute on function app.esign_file_opened(uuid, text) to anon, authenticated;
