-- Online prices are higher than in-store prices, to cover the cost of
-- selling online (service charges, packing, delivery arrangements).
--
-- Prices staff enter (products.base_price, product_variants.price_override)
-- stay the in-store prices the till charges. The online price is derived:
-- the in-store price plus shop_settings.online_markup_percent, optionally
-- rounded up to a tidy amount -- unless a variant has its own fixed
-- online_price. See app/pricing.py.

-- One row of shop-wide settings (id is always 1).
create table public.shop_settings (
  id smallint primary key default 1 check (id = 1),
  -- 0 until the owner sets it, so nothing changes price on its own.
  online_markup_percent numeric(5, 2) not null default 0 check (online_markup_percent between 0 and 200),
  -- Round online prices up to a multiple of this (e.g. 1.00 -> GH₵ 94.00
  -- rather than GH₵ 93.50); 0 means no rounding.
  online_price_rounding numeric(10, 2) not null default 0 check (online_price_rounding >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id) on delete set null
);
insert into public.shop_settings default values;

-- A fixed online price for one size/colour, overriding the markup.
alter table public.product_variants
  add column online_price numeric(10, 2) check (online_price >= 0);

-- What the same item cost in store when an online order was placed, next
-- to what the customer paid online (unit_price) -- so an order shows the
-- difference, and reports can total what the online markup brought in.
-- Null for orders placed before online pricing existed.
alter table public.order_items
  add column in_store_unit_price numeric(10, 2);
