-- The AI budget becomes monthly (Preston, 2 Nov 01:1x, via BOSS): one $50 calendar-month ceiling for the whole
-- Anthropic key, of which ShipShape's share is $8, with a day guard of a fifth of that so one bad day can't spend
-- the month. The overall and samples' caps that never reset (0042) now count the current calendar month (UTC) only,
-- and reset on the 1st. Everything else in ai_reserve is as 0042 made it: the same lock, the same order (the caps
-- that don't end tomorrow first), the same fail-closed refusals, invoker rights, service_role only.
-- The refusal reasons become 'month' and 'sample_month', so the app can say when reading is back. Dropped and
-- created again because the two parameters are renamed; there is still one form, and only service_role may call it.

drop function app.ai_reserve(uuid, text, text, bigint, bigint, bigint, bigint, bigint, bigint);
create function app.ai_reserve(p_org uuid, p_feature text, p_model text, p_micros bigint,
  p_day_cap bigint, p_month_cap bigint, p_sample_day_cap bigint, p_sample_month_cap bigint, p_workspace_day_cap bigint)
returns table (id uuid, refused text)
language plpgsql set search_path = '' as $$
declare
  in_sample boolean := coalesce((select o.is_demo from app.organizations o where o.id = p_org), false);
  day_start timestamptz := date_trunc('day', now(), 'UTC');
  month_start timestamptz := date_trunc('month', now(), 'UTC');
  spent_month bigint;
  spent_today bigint;
  sample_month bigint;
  sample_today bigint;
  workspace_today bigint;
begin
  if p_micros is null or p_micros <= 0 then
    raise exception 'reservation must be positive';
  end if;
  perform pg_advisory_xact_lock(hashtext('app.ai_calls'));
  select coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.created_at >= month_start), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.created_at >= day_start), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.sample and c.created_at >= month_start), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.sample and c.created_at >= day_start), 0),
         coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)) filter (where c.org_id = p_org and c.created_at >= day_start), 0)
    into spent_month, spent_today, sample_month, sample_today, workspace_today
    from app.ai_calls c
   where c.created_at >= month_start; -- a UTC day never starts before its month (index ai_calls_created)
  -- The month's caps first: they don't end tomorrow, so the message mustn't say they do.
  if spent_month + p_micros > p_month_cap then
    return query select null::uuid, 'month'::text;
    return;
  end if;
  if in_sample and sample_month + p_micros > p_sample_month_cap then
    return query select null::uuid, 'sample_month'::text;
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
