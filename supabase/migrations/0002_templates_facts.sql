-- Template catalogue (reference data, the same in every environment) and fact provenance for the
-- business profile: when each fact was last confirmed and by whom.

insert into app.templates (id, title, kind, source_name, source_url, license, version, hosted, summary) values
  ('irs-w9', 'Form W-9: Request for Taxpayer Identification Number and Certification', 'w9',
   'Internal Revenue Service', 'https://www.irs.gov/pub/irs-pdf/fw9.pdf',
   'U.S. federal government work (public domain)', 'Rev. March 2024', true,
   'The form clients and payers ask for before they pay you. ShipShape fills the official IRS PDF from your business facts.'),
  ('common-paper-mnda', 'Mutual NDA (Common Paper Standard Terms)', 'nda',
   'Common Paper', 'https://commonpaper.com/standards/mutual-nda/1.0',
   'CC BY 4.0', '1.0', true,
   'A mutual non-disclosure agreement written by a committee of attorneys. You fill in the Cover Page; the Standard Terms are attached unchanged.'),
  ('yc-safe', 'SAFE (Y Combinator)', 'agreement',
   'Y Combinator', 'https://www.ycombinator.com/documents',
   'No redistribution licence: link-out only', 'Post-money', false,
   'Y Combinator publishes the SAFE and its own free tool for sending it. ShipShape links to the original and stores the signed copy you upload.');

create table app.profile_facts (
  org_id uuid not null references app.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z_0-9]+$' and length(key) <= 40),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  primary key (org_id, key)
);

alter table app.profile_facts enable row level security;
create policy facts_read on app.profile_facts for select to authenticated using (app.is_member(org_id));
grant select on app.profile_facts to authenticated;
grant select, insert, update, delete on app.profile_facts to service_role;

-- Owners and admins confirm facts; the time and person come from the database.
create function app.confirm_facts(org uuid, keys text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(org, array['owner', 'admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into app.profile_facts as f (org_id, key, confirmed_at, confirmed_by)
  select org, k, now(), (select auth.uid()) from unnest(keys) as k
  on conflict (org_id, key) do update set confirmed_at = excluded.confirmed_at, confirmed_by = excluded.confirmed_by;
end
$$;
revoke execute on function app.confirm_facts(uuid, text[]) from public;
grant execute on function app.confirm_facts(uuid, text[]) to authenticated;
