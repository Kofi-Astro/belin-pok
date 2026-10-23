-- Who voided a counter sale, when, and why. Before this, a void only
-- flipped status to 'voided' -- the reversing stock movements recorded who
-- did it, but nothing on the sale itself said when or for what reason.
-- For an owner reviewing the shop remotely, voids are exactly the entries
-- worth scrutinising (a void is how a recorded sale's money can vanish),
-- so the API now requires a reason and stamps these on every new void.
--
-- Older voided rows (if any) simply have these as null.
alter table public.pos_sales
  add column voided_at timestamptz,
  add column voided_by uuid references public.staff(id) on delete restrict,
  add column void_reason text;

-- Sales reports and the sales journal filter by date range, and the
-- journal by staff member.
create index if not exists idx_pos_sales_created_at on public.pos_sales(created_at desc);
create index if not exists idx_pos_sales_staff_id on public.pos_sales(staff_id);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
