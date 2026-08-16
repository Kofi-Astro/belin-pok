-- Size/color kept as plain text rather than lookup tables: it covers caps
-- (one-size), t-shirts/jackets (S-XXL), socks (shoe-size ranges), etc.
-- without a rigid shared enum. price_override falls back to
-- products.base_price when null. stock_quantity is a cached counter kept in
-- sync by the stock_movements trigger (see next migration) -- it is never
-- written directly by the API.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  size text not null,
  color text,
  color_hex text,
  price_override numeric(10,2) check (price_override >= 0),
  stock_quantity int not null default 0 check (stock_quantity >= 0),
  low_stock_threshold int not null default 5 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size, color)
);

create trigger set_product_variants_updated_at
before update on public.product_variants
for each row execute function public.set_updated_at();

create index idx_product_variants_product_id on public.product_variants(product_id);
create index idx_product_variants_low_stock
  on public.product_variants(stock_quantity, low_stock_threshold)
  where is_active;
