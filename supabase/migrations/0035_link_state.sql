-- Why a link someone already holds no longer opens (Design row 18; Security's terms, 2026-11-01): only
-- for the link's own token (a guessed id or a wrong token learns nothing), only "expired" (with the
-- end time) or "revoked" (no time), nothing else about the link, and no writes. The open functions
-- stay as they are: the page asks this only after an open returned nothing, under the same rate limit.

create function app.passport_state(link uuid, secret_hash text)
returns table (state text, ended_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select case when s.revoked_at is not null then 'revoked' else 'expired' end,
         case when s.revoked_at is null then s.expires_at end
  from app.share_links s
  where s.id = link and s.token_hash = secret_hash and (s.revoked_at is not null or s.expires_at <= now());
$$;

-- A signing request: withdrawn by the sender, or past its end (still waiting, or signed: the signer's
-- copy was there until then). A declined one says nothing here and stays generic.
create function app.esign_state(req uuid, secret_hash text)
returns table (state text, ended_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select case when r.status = 'revoked' then 'revoked' else 'expired' end,
         case when r.status <> 'revoked' then r.expires_at end
  from app.signature_requests r
  where r.id = req and r.token_hash = secret_hash
    and (r.status = 'revoked' or (r.status in ('pending', 'signed') and r.expires_at <= now()));
$$;

create function app.collect_state(link uuid, secret_hash text)
returns table (state text, ended_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select case when l.revoked_at is not null then 'revoked' else 'expired' end,
         case when l.revoked_at is null then l.expires_at end
  from app.vendor_links l
  where l.id = link and l.token_hash = secret_hash and (l.revoked_at is not null or l.expires_at <= now());
$$;

revoke execute on function app.passport_state(uuid, text), app.esign_state(uuid, text), app.collect_state(uuid, text) from public;
grant execute on function app.passport_state(uuid, text), app.esign_state(uuid, text), app.collect_state(uuid, text) to anon, authenticated;
