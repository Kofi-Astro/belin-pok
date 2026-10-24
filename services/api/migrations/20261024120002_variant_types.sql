-- A "type / quality" for each size and colour of a product, so one broad
-- product -- "Joggers", "T-Shirts", "Jeans" -- can hold several kinds at
-- different prices without inventing a name for each: Standard at 130,
-- Premium at 150, Branded at 180; or Unbranded / Nike / Adidas. Each
-- type x size x colour is its own variant, with its own SKU, stock and
-- prices. Null means the product has no types (most products).
alter table public.product_variants
  add column style text check (style is null or length(btrim(style)) > 0);

-- A variant is now identified by type, size and colour together.
alter table public.product_variants drop constraint product_variants_product_id_size_color_key;
drop index public.product_variants_product_size_null_color_key;
create unique index product_variants_option_key
  on public.product_variants (product_id, coalesce(style, ''), size, coalesce(color, ''));
