-- Staff can hold more than one role: e.g. an inventory manager who also
-- serves at the till and handles online orders gets both
-- 'inventory_manager' and 'order_fulfillment', and can do everything
-- either role allows. 'owner' (which already allows everything) and
-- 'viewer' (read-only) only make sense on their own.
--
-- Stored as text[] checked against the role names, rather than an array
-- of the staff_role enum, which is awkward for the async driver.
alter table public.staff add column roles text[];
update public.staff set roles = array[role::text];
alter table public.staff
  alter column roles set not null,
  add constraint staff_roles_valid check (
    cardinality(roles) >= 1
    and roles <@ array['owner', 'inventory_manager', 'order_fulfillment', 'viewer']
    and (not ('owner' = any(roles)) or cardinality(roles) = 1)
    and (not ('viewer' = any(roles)) or cardinality(roles) = 1)
  );

drop index if exists public.idx_staff_role;
alter table public.staff drop column role;
