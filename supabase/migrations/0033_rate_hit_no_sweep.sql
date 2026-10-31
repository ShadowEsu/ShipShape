-- Every rate-limited request (each public page view and sign-in) also swept old rows out of
-- app.rate_hits. The only index starts with (bucket, key), so that delete read the whole table every
-- time, and the daily purge (0016, 0020) has covered the clearing since. Same function as 0001
-- without the sweep (review #22).
create or replace function app.rate_hit(hit_bucket text, hit_key text, window_seconds int, max_hits int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds);
  count_now int;
begin
  insert into app.rate_hits as r (bucket, key, window_start, n) values (hit_bucket, hit_key, w, 1)
  on conflict on constraint rate_hits_pkey do update set n = r.n + 1
  returning r.n into count_now;
  return count_now <= max_hits;
end
$$;
