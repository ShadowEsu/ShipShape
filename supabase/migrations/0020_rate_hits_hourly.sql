-- Security C-3 timing: the purge cleared windows older than a day, and the cron runs once a day, so
-- a fingerprint written just after a run could live about 48 hours while /privacy says "cleared
-- within a day". `window_start` is the start of a fixed window, and no window is longer than an hour
-- (rateLimited in lib/server/http.ts refuses more), so any window that started over an hour ago has
-- ended and no limit still reads it. Clearing those keeps every fingerprint to about a day.
create or replace function app.purge_rate_hits() returns integer
language sql security definer set search_path = '' as $$
  with gone as (delete from app.rate_hits r where r.window_start < clock_timestamp() - interval '1 hour' returning 1)
  select count(*)::integer from gone
$$;

grant execute on function app.purge_rate_hits() to service_role;
