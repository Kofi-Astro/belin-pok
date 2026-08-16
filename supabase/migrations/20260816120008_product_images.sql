-- variant_id is optional: most images are product-level, but a variant
-- (e.g. a specific colorway) can have its own photo.
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  display_order int not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_product_images_product_id on public.product_images(product_id);
create index idx_product_images_variant_id on public.product_images(variant_id);

-- At most one primary image per product.
create unique index uq_product_images_one_primary
  on public.product_images(product_id)
  where is_primary;
