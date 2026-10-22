-- Modeled now so products can carry a primary_supplier_id FK; purchase
-- orders themselves are a later phase.
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email citext,
  phone text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();
