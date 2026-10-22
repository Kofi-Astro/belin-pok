-- A POS sale groups the several stock_movements a single in-person
-- checkout produces (one customer buying N different items) under one
-- transaction with its own payment record, instead of leaving every item
-- as an unrelated stock_movements row with no shared receipt. Items
-- themselves stay in stock_movements (reference_type='pos_sale',
-- reference_id=pos_sales.id) rather than being duplicated into a second
-- line-items table -- stock_movements is already the source of truth for
-- "what moved and why".
create type public.payment_method as enum ('cash', 'mobile_money', 'card');

create table public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  staff_id uuid not null references public.staff(id) on delete restrict,
  status text not null default 'completed' check (status in ('completed', 'voided')),
  created_at timestamptz not null default now()
);

create index idx_pos_sales_created_at on public.pos_sales(created_at desc);
create index idx_pos_sales_staff_id on public.pos_sales(staff_id);
create index idx_pos_sales_customer_id on public.pos_sales(customer_id);

-- A sale can be paid with more than one method (e.g. part cash, part
-- mobile money) -- a child table instead of fixed amount_cash/
-- amount_card columns handles any number of methods without schema
-- changes if a new one is added later.
create table public.pos_sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  method public.payment_method not null,
  amount numeric(10, 2) not null check (amount > 0)
);

create index idx_pos_sale_payments_sale_id on public.pos_sale_payments(sale_id);
