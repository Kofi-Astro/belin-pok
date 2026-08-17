-- Line items for a POS sale, snapshotting what was actually charged.
-- Previously a sale's items were inferred by joining its stock_movements
-- rows back to the variant's *current* price -- which meant a historical
-- sale's displayed total silently drifted if the price was edited later
-- (order_items, the storefront equivalent, has always snapshotted
-- unit_price and never had this problem). Adding wholesale/pack pricing
-- makes this worse (a variant now has three prices, any of which can
-- change independently), so this table is the fix: one row per distinct
-- (variant, price_tier) line, with the price actually charged frozen in
-- at sale time. stock_movements is still written for every item (see
-- app/routers/pos_sales.py) and stays the source of truth for physical
-- stock in/out; this table is the source of truth for what was billed.
create type public.price_tier as enum ('retail', 'wholesale', 'pack');

create table public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  price_tier public.price_tier not null default 'retail',
  -- Stock units removed by this line (for a pack line, quantity is already
  -- packs * pack_size -- see the API layer -- so summing quantity across
  -- every line for a variant always equals that variant's stock movement).
  quantity int not null check (quantity > 0),
  -- Price per stock unit, snapshotted at sale time: for a pack line this is
  -- pack_price / pack_size, not pack_price itself, so line_total stays
  -- quantity * unit_price regardless of tier.
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  line_total numeric(10, 2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create index idx_pos_sale_items_sale_id on public.pos_sale_items(sale_id);
create index idx_pos_sale_items_variant_id on public.pos_sale_items(variant_id);

alter table public.pos_sale_items enable row level security;

create policy "pos_sale_items_select_staff" on public.pos_sale_items
for select using (public.is_staff());

create policy "pos_sale_items_write_privileged" on public.pos_sale_items
for all using (public.current_staff_role() in ('owner', 'inventory_manager', 'order_fulfillment'))
with check (public.current_staff_role() in ('owner', 'inventory_manager', 'order_fulfillment'));
