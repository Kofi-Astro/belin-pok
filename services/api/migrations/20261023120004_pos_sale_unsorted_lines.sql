-- "Unsorted" sale lines: when the shop is packed, staff can ring up a
-- whole basket -- shirts, caps, socks, across several categories -- as a
-- single amount and get the customer paid and out of the door. The line
-- carries no product and no category, just the money (and an optional
-- note such as "2 tees, cap"), and is broken down into its real
-- components later (POST /pos-sales/{id}/items/{item_id}/break-down),
-- when someone has the time. The money is exact from the start; stock
-- comes off when the parts are named.
--
-- The old rule "a line names a variant or a category" therefore loosens
-- to: a line with neither is an unsorted basket, which is always a single
-- line (quantity 1, unit_price = the whole amount) -- the number of items
-- in it isn't known until it's broken down.
alter table public.pos_sale_items
  drop constraint pos_sale_items_variant_or_category;

alter table public.pos_sale_items
  add constraint pos_sale_items_unsorted_is_one_line
  check (variant_id is not null or category_id is not null or (quantity = 1 and price_tier <> 'pack'));
