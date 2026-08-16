-- unique (product_id, size, color) on product_variants (see
-- 20260816120007_product_variants.sql) never catches two variants for the
-- same product/size that both leave color blank -- e.g. a one-size cap or
-- a pair of socks that's genuinely colorless -- because Postgres never
-- treats NULL as equal to NULL for uniqueness purposes. A partial unique
-- index scoped to `where color is null` closes exactly that gap, without
-- touching the pre-existing constraint (which already works correctly for
-- the non-null-color case) or duplicating its enforcement. This follows
-- the same partial-index pattern already used for
-- idx_product_variants_low_stock in that same earlier migration.
create unique index product_variants_product_size_null_color_key
  on public.product_variants (product_id, size)
  where color is null;
