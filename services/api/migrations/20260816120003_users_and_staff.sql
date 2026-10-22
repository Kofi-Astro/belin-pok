-- Everyone who can sign in -- staff in the admin app, customers on the
-- storefront. Holds only what signing in needs; who someone *is* (role,
-- name, credit, ...) lives on staff / customers, which point back here.
-- Login is by username or email: the bootstrap owner account is
-- username-only (see app/cli.py), invited staff and storefront customers
-- sign in with their email.
-- password_hash is null for an invited staff member who hasn't followed
-- their invite link yet -- they can't sign in until they set one.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  username citext unique,
  email citext unique,
  password_hash text,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (username is not null or email is not null)
);

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- Staff/admin users. id is the user's id 1:1 -- a staff row is created
-- alongside its users row (by invitation, or app/cli.py for the first
-- owner). email is null only for a username-only account.
create table public.staff (
  id uuid primary key references public.users(id) on delete cascade,
  email citext unique,
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
