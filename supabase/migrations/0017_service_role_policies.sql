-- Portability (AWS plan): on Supabase, service_role has BYPASSRLS. On RDS/Aurora no customer role
-- can be given BYPASSRLS (the master user isn't a superuser), so the server's service_role steps
-- (billing webhooks, reminders, deletion, AI metering, the waitlist) would see no rows at all.
-- An explicit policy gives service_role the same access BYPASSRLS gives it today; on Supabase it
-- changes nothing. Table grants and triggers remain the real limits, exactly as now.
-- A test fails if a later table with row level security misses this policy.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('create policy service_role_all on app.%I for all to service_role using (true) with check (true)', t.relname);
  end loop;
end $$;
