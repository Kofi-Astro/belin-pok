create sequence public.order_number_seq;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique
    default ('ORD-' || to_char(now(), 'YYYYMMDD') || '-' ||
              lpad(nextval('public.order_number_seq')::text, 5, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_type public.order_type not null default 'retail',
  status public.order_status not null default 'pending',
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(10,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(10,2) not null default 0 check (tax_total >= 0),
  shipping_total numeric(10,2) not null default 0 check (shipping_total >= 0),
  total numeric(10,2) not null check (total >= 0),
  shipping_address_id uuid references public.addresses(id) on delete set null,
  billing_address_id uuid references public.addresses(id) on delete set null,
  notes text,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create index idx_orders_customer_id on public.orders(customer_id);
create index idx_orders_status on public.orders(status);
create index idx_orders_created_at on public.orders(created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),  -- snapshot at order time
  line_total numeric(10,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create index idx_order_items_order_id on public.order_items(order_id);
create index idx_order_items_variant_id on public.order_items(variant_id);

-- One row per status transition. The API writes to this table explicitly
-- (in the same transaction as the orders.status update) rather than via a
-- trigger, because only the API layer knows which staff member is actually
-- performing the change.
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  changed_by uuid references public.staff(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index idx_order_status_history_order_id on public.order_status_history(order_id);
