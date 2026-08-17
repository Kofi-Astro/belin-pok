-- "Notify me when back in stock" subscriptions for signed-in customers.
-- notified_at stays null while the subscription is still pending; the API
-- sets it once a push has gone out (see app/routers/stock_movements.py),
-- so a fulfilled subscription doesn't fire again for the same restock.
create table public.stock_notification_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  requested_at timestamptz not null default now(),
  notified_at timestamptz
);

create index idx_stock_notification_requests_variant_pending
  on public.stock_notification_requests(variant_id)
  where notified_at is null;

-- One pending subscription per customer/variant at a time -- re-tapping
-- "notify me" while already subscribed should be a no-op, not a second
-- row. Once notified_at is set, that constraint no longer applies, so
-- they're free to subscribe again the next time it sells out.
create unique index idx_stock_notification_requests_one_pending_per_customer
  on public.stock_notification_requests(customer_id, variant_id)
  where notified_at is null;

alter table public.stock_notification_requests enable row level security;
-- No policies -- same reasoning as customer_device_tokens above: reached
-- only through the backend's trusted connection, never via PostgREST.
