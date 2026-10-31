-- Security B2: Stripe moves a subscription's period forward at renewal, before it tries the charge,
-- so "7 days past the period end" kept Pro for the whole unpaid period. The grace now runs from the
-- first sync that saw the subscription past due.
alter table app.billing add column past_due_since timestamptz;
-- org_plan runs as the caller, and members already see the billing status.
grant select (past_due_since) on app.billing to authenticated;

create or replace function app.org_plan(org uuid) returns text
language sql stable set search_path = '' as $$
  select case
    when o.is_demo then 'pro'
    when b.plan = 'pro' and b.status in ('active', 'trialing') then 'pro'
    when b.plan = 'pro' and b.status = 'past_due' and b.past_due_since > now() - interval '7 days' then 'pro'
    else 'free'
  end
  from app.organizations o
  left join app.billing b on b.org_id = o.id
  where o.id = org
$$;
