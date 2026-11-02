-- Wave 15 (review of every server action and route): three database changes.
--
-- 1. W15-1, the AI spend meter (0006). The $1 a day and $10 lifetime caps were shared by every
--    workspace, so visitors trying the sample (a new sample per sign-in) could spend the day's budget
--    and in time the lifetime one, switching Ask off for every real customer. Now, under the same lock
--    and still failing closed:
--    - sample workspaces share a pool of their own (a day cap and a lifetime cap over every call made
--      in a sample), so they can never reach real customers' share beyond it;
--    - each real workspace has a day cap of its own;
--    - the overall day and lifetime caps stay as the backstop.
--    `ai_calls.sample` records whether a call was made in a sample. It's set from the workspace when
--    the call is reserved and kept: a purged sample's calls lose their org_id (on delete set null)
--    but still count toward the samples' pool. Rows written before this migration are not samples.
--    `ai_reserve` returns the reservation id, or which cap refused it ('total', 'day', 'sample_total',
--    'sample_day', 'workspace_day'), so the person is told the true reason. The 6-argument form is
--    dropped so there is one way in; like the old one it runs as its caller and only service_role may
--    call it.
-- 2. W15-4, a team member downloading a file a vendor sent (it can hold the vendor's tax ID) now
--    lands in the workspace history, like every other download: audit_append accepts
--    'collect.file_downloaded'. Same function as 0021 otherwise; create or replace keeps its owner and
--    grants.
-- 3. W15-6, signing. Every try with a well-formed code read the file and built the signed copy in a
--    build process before esign_complete checked the code, so wrong codes (and a locked request) kept
--    the two build slots busy. esign_check_code is esign_complete's first half exactly: it finds the
--    pending request by its token, answers 'invalid', 'locked' or 'expired_code', counts a wrong code
--    ('bad_code', the same 5-try lockout) and answers 'ok' for the right one without using it up. The
--    app asks it before reading the file; esign_complete still checks everything again when it signs.

alter table app.ai_calls add column sample boolean not null default false;

drop function app.ai_reserve(uuid, text, text, bigint, bigint, bigint);
create function app.ai_reserve(p_org uuid, p_feature text, p_model text, p_micros bigint,
  p_day_cap bigint, p_total_cap bigint, p_sample_day_cap bigint, p_sample_total_cap bigint, p_workspace_day_cap bigint)
returns table (id uuid, refused text)
language plpgsql set search_path = '' as $$
declare
  in_sample boolean := coalesce((select o.is_demo from app.organizations o where o.id = p_org), false);
  day_start timestamptz := date_trunc('day', now(), 'UTC');
  spent_total bigint;
  spent_today bigint;
  sample_total bigint;
  sample_today bigint;
  workspace_today bigint;
begin
  if p_micros is null or p_micros <= 0 then
    raise exception 'reservation must be positive';
  end if;
  perform pg_advisory_xact_lock(hashtext('app.ai_calls'));
  select coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.created_at >= day_start), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.sample), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.sample and c.created_at >= day_start), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.org_id = p_org and c.created_at >= day_start), 0)
    into spent_total, spent_today, sample_total, sample_today, workspace_today
    from app.ai_calls c;
  -- The lifetime caps first: they don't end tomorrow, so the message mustn't say they do.
  if spent_total + p_micros > p_total_cap then
    return query select null::uuid, 'total'::text;
    return;
  end if;
  if in_sample and sample_total + p_micros > p_sample_total_cap then
    return query select null::uuid, 'sample_total'::text;
    return;
  end if;
  if spent_today + p_micros > p_day_cap then
    return query select null::uuid, 'day'::text;
    return;
  end if;
  if in_sample and sample_today + p_micros > p_sample_day_cap then
    return query select null::uuid, 'sample_day'::text;
    return;
  end if;
  if not in_sample and workspace_today + p_micros > p_workspace_day_cap then
    return query select null::uuid, 'workspace_day'::text;
    return;
  end if;
  return query
    insert into app.ai_calls (org_id, feature, model, reserved_micros, sample)
    values (p_org, p_feature, p_model, p_micros, in_sample)
    returning app.ai_calls.id, null::text;
end
$$;
revoke all on function app.ai_reserve(uuid, text, text, bigint, bigint, bigint, bigint, bigint, bigint) from public;
grant execute on function app.ai_reserve(uuid, text, text, bigint, bigint, bigint, bigint, bigint, bigint) to service_role;

create or replace function app.audit_append(org uuid, action text, object_id uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app.is_member(org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if action not in ('document.viewed', 'document.downloaded', 'esign.review_downloaded', 'profile.tax_id_revealed', 'workspace.exported', 'ai.request_read',
                    'collect.file_downloaded') then
    raise exception 'action % is not a user event', action using errcode = '42501';
  end if;
  return app.audit_write(org, (select auth.uid()), action, object_id);
end
$$;

create function app.esign_check_code(req uuid, secret_hash text, code_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r app.signature_requests;
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
  return 'ok';
end
$$;
revoke execute on function app.esign_check_code(uuid, text, text) from public;
grant execute on function app.esign_check_code(uuid, text, text) to anon, authenticated;
