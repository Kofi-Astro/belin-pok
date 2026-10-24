-- The storefront's editable content -- announcement strip, home page banner,
-- selling points, featured products, wholesale section, footer, contact
-- details and social links -- edited from the admin's Website page instead
-- of being written into the website's code.
--
-- One row (id = 1) holding a JSON document. Its shape is defined and
-- validated by StorefrontContent in app/schemas.py, which also supplies a
-- default for every field: an empty document (as inserted here) reads back
-- as the site's original wording, and fields added later get their default
-- without a migration.
create table public.storefront_content (
  id smallint primary key default 1 check (id = 1),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id) on delete set null
);

insert into public.storefront_content default values;
