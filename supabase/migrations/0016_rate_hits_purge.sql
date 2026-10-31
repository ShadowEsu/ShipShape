-- Security C-3 INFO: rate-limit fingerprints were cleared only when someone hit a limit again, so
-- "cleared within a day" held only while there was traffic. The daily cron now clears them too.
create function app.purge_rate_hits() returns integer
language sql security definer set search_path = '' as $$
  with gone as (delete from app.rate_hits r where r.window_start < clock_timestamp() - interval '1 day' returning 1)
  select count(*)::integer from gone
$$;

grant execute on function app.purge_rate_hits() to service_role;
