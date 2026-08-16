-- Staff/admin users. id mirrors auth.users(id) 1:1 -- a row is created here
-- (via the API, on invite) once someone exists in Supabase Auth.
create table public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text not null,
  role public.staff_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_staff_updated_at
before update on public.staff
for each row execute function public.set_updated_at();

create index idx_staff_role on public.staff(role);

-- Helper functions used throughout RLS policies. SECURITY DEFINER + a pinned
-- search_path lets these read public.staff even though the same RLS policies
-- protect that table (avoids recursive-policy lockout), while stable pins
-- the result within one query/statement.
create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid() and is_active = true);
$$;
