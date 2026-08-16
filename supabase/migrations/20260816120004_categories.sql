-- Self-referential so "Jackets" can later have a "Bomber Jackets" child, etc.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories(id) on delete set null,
  description text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_id, name)
);

create trigger set_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create index idx_categories_parent_id on public.categories(parent_id);
