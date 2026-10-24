-- Returns against a till sale: a customer brings something back, staff
-- find the sale, pick what came back, and record what was refunded (or
-- nothing, for an exchange) and why. Returned items go back into stock
-- unless they're damaged; the refund is counted out of the drawer at
-- cash-up (app/routers/cash_ups.py).
--
-- A return is its own record rather than an edit of the sale: the sale
-- still says what was sold and for how much, and the return says what
-- came back later. Its stock movements and any credit refund carry
-- reference_type 'pos_sale_return' and the *sale's* id, so deleting a
-- test sale (app/erase.py) undoes its returns along with it.
create table public.pos_sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  -- How the money went back: cash, mobile_money or card -- or 'credit',
  -- taken off a wholesale customer's balance. Null when nothing was
  -- refunded (an exchange, or store policy).
  refund_method public.payment_method,
  refund_amount numeric(10, 2) not null default 0 check (refund_amount >= 0),
  reason text not null,
  -- False when the items were damaged and didn't go back on the shelf.
  back_to_stock boolean not null default true,
  staff_id uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (refund_amount = 0 or refund_method is not null)
);

create index idx_pos_sale_returns_sale_id on public.pos_sale_returns(sale_id);
create index idx_pos_sale_returns_created_at on public.pos_sale_returns(created_at desc);

create table public.pos_sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.pos_sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.pos_sale_items(id) on delete cascade,
  quantity integer not null check (quantity > 0)
);

create index idx_pos_sale_return_items_sale_item_id on public.pos_sale_return_items(sale_item_id);
