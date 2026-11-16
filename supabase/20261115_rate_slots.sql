-- smartplayapps.com shared rate limit (lib/rate-slot.js). Apply in the SmartPlay Academy Supabase project
-- (the one holding site_requests, try_codes, pilot_requests) BEFORE merging the PR that adds this file.
-- One function call = one atomic reserve: the per-bucket advisory lock serializes concurrent callers, so
-- parallel requests from any number of Vercel instances can never all see the same old count.
-- Each call touches ONLY its own bucket through rate_slots_bucket_time; the table-wide cleanup is a
-- separate, batched daily pg_cron job (prune_rate_slots), never part of a request.
create table if not exists public.rate_slots (
  bucket text not null,
  taken_at timestamptz not null default clock_timestamp()
);
create index if not exists rate_slots_bucket_time on public.rate_slots (bucket, taken_at desc);
create index if not exists rate_slots_time on public.rate_slots (taken_at);
alter table public.rate_slots enable row level security;
revoke all on public.rate_slots from anon, authenticated;

create or replace function public.take_rate_slot(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  n int;
  cutoff timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket, 0));
  cutoff := clock_timestamp() - make_interval(secs => p_window_seconds);
  -- This bucket's expired slots only: at most p_max live rows, so the delete and count stay small.
  delete from public.rate_slots where bucket = p_bucket and taken_at <= cutoff;
  select count(*) into n from public.rate_slots where bucket = p_bucket and taken_at > cutoff;
  if n >= p_max then
    return false;
  end if;
  insert into public.rate_slots (bucket) values (p_bucket);
  return true;
end;
$$;
revoke execute on function public.take_rate_slot(text, int, int) from public, anon, authenticated;
grant execute on function public.take_rate_slot(text, int, int) to service_role;

-- Daily cleanup of buckets nobody revisits. Longest window in use is one day, so anything older than two
-- days is dead. Batched by ctid on the taken_at index with a cutoff fixed at the start of the run.
create or replace function public.prune_rate_slots(p_batch int default 5000, p_max_batches int default 200)
returns int
language plpgsql
set search_path = public
as $$
declare
  cutoff timestamptz;
  n int;
  total int := 0;
  i int := 0;
begin
  cutoff := now() - interval '2 days';
  loop
    delete from public.rate_slots
      where ctid in (select ctid from public.rate_slots where taken_at < cutoff limit p_batch);
    get diagnostics n = row_count;
    total := total + n;
    i := i + 1;
    exit when n < p_batch or i >= p_max_batches;
  end loop;
  return total;
end;
$$;
revoke execute on function public.prune_rate_slots(int, int) from public, anon, authenticated;

-- pg_cron (Supabase: Database > Extensions > pg_cron; this line enables it if it is off).
create extension if not exists pg_cron;
select cron.schedule('prune-rate-slots', '17 4 * * *', $$select public.prune_rate_slots()$$);
