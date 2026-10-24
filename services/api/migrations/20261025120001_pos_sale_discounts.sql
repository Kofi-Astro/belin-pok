-- Discounts at the till. Customers haggle; staff can knock an amount off a
-- whole sale, and must say why ("regular customer", "small stain") -- the
-- owner sees every discount, who gave it and the reason.
--
-- The discount is stored on the lines, not just on the sale: the API
-- shares it out across the sale's lines in proportion to their value (see
-- _share_discount in app/routers/pos_sales.py), and line_total becomes the
-- amount actually charged for the line. Every report already adds up
-- line_total, so takings, best sellers and category figures all show the
-- money really taken without each of them having to subtract discounts.
-- unit_price stays the till price, so "sold at ₵150, ₵10 off" is still
-- visible.
alter table public.pos_sale_items
  add column discount numeric(10, 2) not null default 0 check (discount >= 0);

-- A generated column's formula can't be altered in place on every Postgres
-- version, so it's dropped and added back with the discount taken off.
alter table public.pos_sale_items drop column line_total;
alter table public.pos_sale_items
  add column line_total numeric(10, 2) generated always as (quantity * unit_price - discount) stored;

alter table public.pos_sale_items
  add constraint pos_sale_items_discount_within_line check (discount <= quantity * unit_price);

-- Why the sale was discounted. Required by the API whenever any line
-- carries a discount.
alter table public.pos_sales add column discount_reason text;
