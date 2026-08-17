-- Wholesale + pack pricing per variant, alongside the retail price that
-- already exists as price_override (falls back to products.base_price).
-- Both null on most variants until staff opt a SKU into wholesale/pack
-- selling -- checkout falls back to the retail price for a variant with no
-- wholesale_price set, rather than blocking the sale, since "not every
-- item is sold wholesale" is the common case, not an error.
alter table public.product_variants
  add column wholesale_price numeric(10, 2) check (wholesale_price >= 0),
  add column pack_price numeric(10, 2) check (pack_price >= 0),
  add column pack_size int check (pack_size > 0);

-- pack_price and pack_size are a pair: a price with no unit count (or vice
-- versa) can't be sold, so both or neither.
alter table public.product_variants
  add constraint product_variants_pack_price_size_pair
  check ((pack_price is null) = (pack_size is null));
