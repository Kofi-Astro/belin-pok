-- auth_user_id is nullable: most customers (walk-ins rung up at the POS,
-- guest checkouts, wholesale accounts onboarded by staff) never sign in.
-- Set only for someone with a storefront login (see public.users).
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references public.users(id) on delete set null,
  full_name text not null,
  email citext not null unique,
  phone text,
  customer_type public.customer_type not null default 'retail',
  status public.customer_status not null default 'approved',
  business_name text,
  tax_id text,
  notes text,
  approved_by uuid references public.staff(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create index idx_customers_status on public.customers(status);
create index idx_customers_type on public.customers(customer_type);

-- Application layer is responsible for defaulting new wholesale signups to
-- status = 'pending' (retail accounts default to 'approved' above).

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default 'Shipping',
  line1 text not null,
  line2 text,
  city text not null,
  state text,
  postal_code text,
  country text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_addresses_updated_at
before update on public.addresses
for each row execute function public.set_updated_at();

create index idx_addresses_customer_id on public.addresses(customer_id);
