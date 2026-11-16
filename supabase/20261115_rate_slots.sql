-- smartplayapps.com shared rate limit (lib/rate-slot.js). Apply in the SmartPlay Academy Supabase project
-- (the one holding site_requests, try_codes, pilot_requests) BEFORE merging the PR that adds this file.
-- One function call = one atomic reserve: the per-bucket advisory lock serializes concurrent callers, so
-- parallel requests from any number of Vercel instances can never all see the same old count.
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
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket, 0));
  -- Longest window in use is one day; anything older than two days is dead for every bucket.
  delete from public.rate_slots where taken_at < clock_timestamp() - interval '2 days';
  select count(*) into n from public.rate_slots
    where bucket = p_bucket and taken_at > clock_timestamp() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into public.rate_slots (bucket) values (p_bucket);
  return true;
end;
$$;
revoke execute on function public.take_rate_slot(text, int, int) from public, anon, authenticated;
grant execute on function public.take_rate_slot(text, int, int) to service_role;
