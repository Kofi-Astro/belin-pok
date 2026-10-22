create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  category_id uuid not null references public.categories(id) on delete restrict,
  brand text,
  base_price numeric(10,2) not null check (base_price >= 0),
  status public.product_status not null default 'draft',
  primary_supplier_id uuid references public.suppliers(id) on delete set null,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create index idx_products_category_id on public.products(category_id);
create index idx_products_status on public.products(status);
create index idx_products_name on public.products(name);
