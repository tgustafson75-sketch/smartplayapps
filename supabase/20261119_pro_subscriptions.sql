-- SmartPlay Pro: one table for every app's Pro subscriptions (lib/pro.js). SmartPlay Academy Supabase project.
-- Written only by the Stripe webhook (api/pro/webhook.js) through the two functions below, read only by
-- api/pro/status.js, both with the server key. RLS on, no grants to anon or authenticated.
-- No email, name or card is stored: Stripe holds those. key_hash is sha256 of the app's Pro key, never the key.
-- Stripe events can arrive in any order, so the link (from checkout) and the status (from subscription events)
-- are written separately, and an older subscription event never overwrites a newer one.
create table if not exists public.pro_subscriptions (
  subscription_id text primary key,
  app text not null,
  key_hash text,
  customer_id text,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  status_event_at timestamptz,
  livemode boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pro_subscriptions_key on public.pro_subscriptions (app, key_hash);
alter table public.pro_subscriptions enable row level security;
revoke all on public.pro_subscriptions from anon, authenticated;

-- From checkout.session.completed: which app and which Pro key this subscription belongs to.
create or replace function public.pro_link(p_subscription text, p_app text, p_key_hash text, p_customer text, p_livemode boolean, p_paid boolean)
returns void
language sql
set search_path = public
as $$
  insert into public.pro_subscriptions (subscription_id, app, key_hash, customer_id, livemode, status)
  values (p_subscription, p_app, p_key_hash, p_customer, p_livemode, case when p_paid then 'active' end)
  on conflict (subscription_id) do update set
    app = excluded.app,
    key_hash = excluded.key_hash,
    customer_id = coalesce(excluded.customer_id, pro_subscriptions.customer_id),
    status = coalesce(pro_subscriptions.status, excluded.status),
    updated_at = now();
$$;

-- From customer.subscription.created/updated/deleted: the state, unless a newer event already landed.
create or replace function public.pro_set_status(p_subscription text, p_app text, p_customer text, p_status text,
  p_period_end timestamptz, p_cancel_at_period_end boolean, p_event_at timestamptz, p_livemode boolean)
returns void
language sql
set search_path = public
as $$
  insert into public.pro_subscriptions (subscription_id, app, customer_id, status, current_period_end, cancel_at_period_end, status_event_at, livemode)
  values (p_subscription, p_app, p_customer, p_status, p_period_end, p_cancel_at_period_end, p_event_at, p_livemode)
  on conflict (subscription_id) do update set
    customer_id = coalesce(excluded.customer_id, pro_subscriptions.customer_id),
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    status_event_at = excluded.status_event_at,
    updated_at = now()
  where pro_subscriptions.status_event_at is null or pro_subscriptions.status_event_at <= excluded.status_event_at;
$$;

revoke all on function public.pro_link(text, text, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.pro_set_status(text, text, text, text, timestamptz, boolean, timestamptz, boolean) from public, anon, authenticated;
