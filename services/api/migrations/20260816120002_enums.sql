create type public.staff_role as enum (
  'owner',              -- super-admin, full access
  'inventory_manager',  -- products, variants, categories, suppliers, stock
  'order_fulfillment',  -- orders, customers, packing/shipping
  'viewer'              -- read-only everywhere
);

create type public.product_status as enum ('draft', 'active', 'archived');

create type public.customer_type as enum ('retail', 'wholesale');

create type public.customer_status as enum ('pending', 'approved', 'rejected');

create type public.order_type as enum ('retail', 'wholesale');

create type public.order_status as enum (
  'pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'
);

create type public.stock_movement_type as enum (
  'restock', 'sale', 'adjustment', 'return', 'initial'
);
