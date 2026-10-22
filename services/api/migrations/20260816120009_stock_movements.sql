-- Append-only ledger of every stock in/out event. Nothing here is ever
-- updated or deleted -- corrections are made by inserting an offsetting
-- 'adjustment' row, so the full history stays auditable.
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  movement_type public.stock_movement_type not null,
  quantity_change int not null check (quantity_change <> 0),
  reason text,
  reference_type text,   -- e.g. 'order', 'purchase_order', 'manual'
  reference_id uuid,     -- points at the order/PO/etc. that caused this, if any
  performed_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_stock_movements_variant_id on public.stock_movements(variant_id);
create index idx_stock_movements_created_at on public.stock_movements(created_at desc);
create index idx_stock_movements_reference on public.stock_movements(reference_type, reference_id);

-- Keep product_variants.stock_quantity as a fast-to-read cache of the sum
-- of all movements. The UPDATE ... RETURNING makes the check-then-raise
-- atomic per row (protected by the row lock the UPDATE itself takes), so
-- concurrent movements on the same variant can't race past zero.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_qty int;
begin
  update public.product_variants
  set stock_quantity = stock_quantity + new.quantity_change
  where id = new.variant_id
  returning stock_quantity into new_qty;

  if new_qty is null then
    raise exception 'Unknown variant % for stock movement', new.variant_id;
  end if;

  if new_qty < 0 then
    raise exception 'Stock movement would take variant % negative', new.variant_id;
  end if;

  return new;
end;
$$;

create trigger trg_apply_stock_movement
after insert on public.stock_movements
for each row execute function public.apply_stock_movement();
