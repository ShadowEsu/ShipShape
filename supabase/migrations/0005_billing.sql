-- Billing (M4): Stripe, test mode only until an attorney names the seller (fleet rule).
--
-- One row per workspace that has a Stripe customer. Members can read their workspace's plan;
-- only the server writes it, from verified Stripe webhooks after re-reading the subscription from
-- Stripe (never from the success redirect or anything the browser sends).
create table app.billing (
  org_id uuid primary key references app.organizations(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  status text not null default 'none'
    check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  -- 'pro' only when the subscription's price is the configured Pro price.
  plan text not null default 'free' check (plan in ('free', 'pro')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table app.billing enable row level security;
create policy billing_read on app.billing for select to authenticated using (app.is_member(org_id));
grant select (org_id, status, plan, current_period_end, cancel_at_period_end, updated_at) on app.billing to authenticated;
grant all on app.billing to service_role;

-- Webhook deliveries, claimed as leases: a duplicate of a finished event is acknowledged without
-- reprocessing; a claim left unfinished for 5 minutes (a crashed handler) can be taken again.
create table app.stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null,
  claimed_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table app.stripe_events enable row level security; -- no policies: server only
grant all on app.stripe_events to service_role;

-- The plan a workspace has now. Sample workspaces show every feature. A failed payment keeps Pro
-- for 7 days past the paid period (Stripe retries meanwhile); later events can't extend that,
-- because the period end only moves when a payment succeeds.
create function app.org_plan(org uuid) returns text
language sql stable set search_path = '' as $$
  select case
    when o.is_demo then 'pro'
    when b.plan = 'pro' and b.status in ('active', 'trialing') then 'pro'
    when b.plan = 'pro' and b.status = 'past_due' and b.current_period_end > now() - interval '7 days' then 'pro'
    else 'free'
  end
  from app.organizations o
  left join app.billing b on b.org_id = o.id
  where o.id = org
$$;

grant execute on function app.org_plan(uuid) to authenticated, service_role;

-- Starting a paid plan records its own agreement (unticked box at checkout, Terms version).
alter table app.consents drop constraint consents_item_check;
alter table app.consents add constraint consents_item_check check (item in ('terms_privacy', 'esign', 'ai_document', 'billing'));
