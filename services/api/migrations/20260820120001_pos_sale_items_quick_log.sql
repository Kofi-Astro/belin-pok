-- "Quick log" sales: staff without a barcode scanner, entering everything
-- by hand, often know a wholesale sale's product *types* and prices
-- immediately but don't have time to hunt down the exact SKU for each one
-- mid-sale. This lets a pos_sale_item be logged against a category
-- ("Caps", "T-Shirts") instead of a specific variant, with the exact
-- variant attached later (see the identify step wired up in the API) --
-- optional, at whatever pace the owner wants, since the category + price
-- captured now is already enough to audit revenue and product mix.
alter table public.pos_sale_items
  alter column variant_id drop not null,
  add column category_id uuid references public.categories(id) on delete restrict,
  add column note text;

-- A line must be identifiable by at least one of the two -- otherwise
-- there is nothing to audit against at all.
alter table public.pos_sale_items
  add constraint pos_sale_items_variant_or_category
  check (variant_id is not null or category_id is not null);

create index idx_pos_sale_items_category_id on public.pos_sale_items(category_id)
  where category_id is not null;

-- Unidentified lines (variant_id null) are exactly what still needs
-- follow-up -- this index is what makes "how many sales still need
-- product details filled in" a fast dashboard query rather than a table
-- scan as the ledger grows.
create index idx_pos_sale_items_unidentified on public.pos_sale_items(sale_id)
  where variant_id is null;
