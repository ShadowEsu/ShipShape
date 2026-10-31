-- AI spend meter (Security G4 §2). Every model call first reserves its worst-case cost; the caps
-- are checked and the reservation written under one lock, so concurrent calls can't overspend.
-- A reservation that is never settled (a crash mid-call) keeps counting at its worst case: the
-- meter fails closed. Server only: no policies, and only service_role may touch it. Amounts are
-- micro-dollars. Rows hold token counts and cost, never prompt or reply text.
create table app.ai_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references app.organizations(id) on delete set null, -- the spend stays counted after a deletion
  feature text not null check (feature in ('request_match')),
  model text not null,
  reserved_micros bigint not null check (reserved_micros > 0),
  cost_micros bigint check (cost_micros >= 0),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  created_at timestamptz not null default now()
);

create index ai_calls_created on app.ai_calls (created_at);

alter table app.ai_calls enable row level security; -- no policies: server only
grant all on app.ai_calls to service_role;

-- Returns the reservation id, or null when it would pass the daily (UTC day) or lifetime cap.
create function app.ai_reserve(p_org uuid, p_feature text, p_model text, p_micros bigint, p_day_cap bigint, p_total_cap bigint)
returns uuid
language plpgsql set search_path = '' as $$
declare
  spent_total bigint;
  spent_today bigint;
  new_id uuid;
begin
  if p_micros is null or p_micros <= 0 then
    raise exception 'reservation must be positive';
  end if;
  perform pg_advisory_xact_lock(hashtext('app.ai_calls'));
  select coalesce(sum(coalesce(cost_micros, reserved_micros)), 0),
         coalesce(sum(coalesce(cost_micros, reserved_micros)) filter (where created_at >= date_trunc('day', now(), 'UTC')), 0)
    into spent_total, spent_today
    from app.ai_calls;
  if spent_total + p_micros > p_total_cap or spent_today + p_micros > p_day_cap then
    return null;
  end if;
  insert into app.ai_calls (org_id, feature, model, reserved_micros)
  values (p_org, p_feature, p_model, p_micros)
  returning id into new_id;
  return new_id;
end
$$;

-- Records what the call really cost: at most the reservation by construction, and recorded as is
-- if not, so the meter never under-counts. Only a pending reservation can be settled.
create function app.ai_settle(p_id uuid, p_status text, p_input integer, p_output integer, p_cost bigint)
returns void
language sql set search_path = '' as $$
  update app.ai_calls
     set status = p_status, input_tokens = p_input, output_tokens = p_output, cost_micros = p_cost
   where id = p_id and status = 'reserved' and p_status in ('done', 'failed');
$$;

revoke all on function app.ai_reserve(uuid, text, text, bigint, bigint, bigint) from public;
revoke all on function app.ai_settle(uuid, text, integer, integer, bigint) from public;
grant execute on function app.ai_reserve(uuid, text, text, bigint, bigint, bigint) to service_role;
grant execute on function app.ai_settle(uuid, text, integer, integer, bigint) to service_role;

-- Reading a request with AI records its own agreement (unticked box, per action).
alter table app.consents drop constraint consents_item_check;
alter table app.consents add constraint consents_item_check check (item in ('terms_privacy', 'esign', 'ai_document', 'ai_request', 'billing'));

-- That a request was read with AI lands in the workspace history (the event only, never the text).
create or replace function app.audit_append(org uuid, action text, object_id uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not app.is_member(org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if action not in ('document.viewed', 'document.downloaded', 'profile.tax_id_revealed', 'workspace.exported', 'ai.request_read') then
    raise exception 'action % is not a user event', action using errcode = '42501';
  end if;
  return app.audit_write(org, (select auth.uid()), action, object_id);
end
$$;
