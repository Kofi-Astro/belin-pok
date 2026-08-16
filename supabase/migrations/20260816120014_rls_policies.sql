-- RLS is enabled on every table below with a default-deny posture: no
-- policy means no access. This matters even though the FastAPI backend
-- talks to Postgres directly (see README/services/api docs for why that
-- path does its own authorization) -- Supabase auto-exposes every table
-- over PostgREST unless RLS blocks it, so this is what stops that
-- auto-generated API from leaking data to anon/authenticated callers.

-- ---------- staff ----------
alter table public.staff enable row level security;

create policy "staff_select_self_or_owner" on public.staff
for select using (id = auth.uid() or public.current_staff_role() = 'owner');

create policy "staff_write_owner_only" on public.staff
for all using (public.current_staff_role() = 'owner')
with check (public.current_staff_role() = 'owner');

-- ---------- categories ----------
alter table public.categories enable row level security;

create policy "categories_select_staff" on public.categories
for select using (public.is_staff());

create policy "categories_write_privileged" on public.categories
for all using (public.current_staff_role() in ('owner', 'inventory_manager'))
with check (public.current_staff_role() in ('owner', 'inventory_manager'));

-- ---------- suppliers ----------
alter table public.suppliers enable row level security;

create policy "suppliers_select_staff" on public.suppliers
for select using (public.is_staff());

create policy "suppliers_write_privileged" on public.suppliers
for all using (public.current_staff_role() in ('owner', 'inventory_manager'))
with check (public.current_staff_role() in ('owner', 'inventory_manager'));

-- ---------- products / variants / images ----------
alter table public.products enable row level security;

create policy "products_select_staff" on public.products
for select using (public.is_staff());

create policy "products_write_privileged" on public.products
for all using (public.current_staff_role() in ('owner', 'inventory_manager'))
with check (public.current_staff_role() in ('owner', 'inventory_manager'));

alter table public.product_variants enable row level security;

create policy "variants_select_staff" on public.product_variants
for select using (public.is_staff());

create policy "variants_write_privileged" on public.product_variants
for all using (public.current_staff_role() in ('owner', 'inventory_manager'))
with check (public.current_staff_role() in ('owner', 'inventory_manager'));

alter table public.product_images enable row level security;

create policy "product_images_select_staff" on public.product_images
for select using (public.is_staff());

create policy "product_images_write_privileged" on public.product_images
for all using (public.current_staff_role() in ('owner', 'inventory_manager'))
with check (public.current_staff_role() in ('owner', 'inventory_manager'));

-- ---------- stock movements ----------
-- Append-only ledger: insert only, no update/delete policies for anyone
-- (corrections are new offsetting rows, not edits -- see migration 0009).
alter table public.stock_movements enable row level security;

create policy "stock_movements_select_staff" on public.stock_movements
for select using (public.is_staff());

create policy "stock_movements_insert_privileged" on public.stock_movements
for insert with check (public.current_staff_role() in ('owner', 'inventory_manager'));

-- ---------- customers / addresses ----------
alter table public.customers enable row level security;

create policy "customers_select_staff" on public.customers
for select using (public.is_staff());

create policy "customers_write_privileged" on public.customers
for all using (public.current_staff_role() in ('owner', 'order_fulfillment'))
with check (public.current_staff_role() in ('owner', 'order_fulfillment'));

alter table public.addresses enable row level security;

create policy "addresses_select_staff" on public.addresses
for select using (public.is_staff());

create policy "addresses_write_privileged" on public.addresses
for all using (public.current_staff_role() in ('owner', 'order_fulfillment'))
with check (public.current_staff_role() in ('owner', 'order_fulfillment'));

-- ---------- orders / order_items / order_status_history ----------
alter table public.orders enable row level security;

create policy "orders_select_staff" on public.orders
for select using (public.is_staff());

create policy "orders_write_privileged" on public.orders
for all using (public.current_staff_role() in ('owner', 'order_fulfillment'))
with check (public.current_staff_role() in ('owner', 'order_fulfillment'));

alter table public.order_items enable row level security;

create policy "order_items_select_staff" on public.order_items
for select using (public.is_staff());

create policy "order_items_write_privileged" on public.order_items
for all using (public.current_staff_role() in ('owner', 'order_fulfillment'))
with check (public.current_staff_role() in ('owner', 'order_fulfillment'));

alter table public.order_status_history enable row level security;

create policy "order_status_history_select_staff" on public.order_status_history
for select using (public.is_staff());

create policy "order_status_history_insert_privileged" on public.order_status_history
for insert with check (public.current_staff_role() in ('owner', 'order_fulfillment'));

-- ---------- audit_log ----------
-- Readable by owner only; no insert/update/delete policy for any staff
-- role -- rows are written exclusively by the API's trusted backend
-- connection, which bypasses RLS (see services/api docs).
alter table public.audit_log enable row level security;

create policy "audit_log_select_owner" on public.audit_log
for select using (public.current_staff_role() = 'owner');
