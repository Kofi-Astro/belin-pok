-- Push-notification device tokens for signed-in storefront customers.
-- A separate table rather than a column on customers, since one customer
-- can have several devices (phone + a reinstall, phone + tablet, etc.)
-- registered at once.
create type public.device_platform as enum ('ios', 'android');

create table public.customer_device_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  platform public.device_platform not null,
  -- A token identifies one device installation, so it can only ever be
  -- registered to one customer at a time -- re-registering it (a second
  -- account signing in on the same device, a reinstall under a different
  -- account) should move it to the new owner via upsert, not accumulate
  -- stale duplicates pointing at whoever registered it first.
  token text not null unique,
  created_at timestamptz not null default now()
);

create index idx_customer_device_tokens_customer_id on public.customer_device_tokens(customer_id);

alter table public.customer_device_tokens enable row level security;
-- No policies (default-deny, per the header note in
-- 20260816120014_rls_policies.sql): this table is only ever touched
-- through the storefront's own device-token endpoints, which the
-- backend's trusted service connection reaches directly, bypassing RLS --
-- it's never exposed via PostgREST, so there's no anon/authenticated
-- caller this needs a policy for.
