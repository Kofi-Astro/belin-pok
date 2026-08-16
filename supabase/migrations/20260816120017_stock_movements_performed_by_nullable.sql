-- stock_movements.performed_by was `not null references staff` because
-- every Phase 1 movement (restock, manual sale, adjustment) was staff-
-- initiated. Phase 2's storefront checkout writes a 'sale' movement per
-- order line with no staff member involved, so that assumption no longer
-- holds. Made nullable with `on delete set null`, the same pattern
-- already used for orders.created_by, order_status_history.changed_by,
-- and customers.approved_by -- a null performed_by means "system/
-- customer-initiated", traceable instead via reference_type='order' /
-- reference_id=<order id> (columns this table already had for exactly
-- this purpose).
alter table public.stock_movements
  drop constraint stock_movements_performed_by_fkey,
  alter column performed_by drop not null,
  add constraint stock_movements_performed_by_fkey
    foreign key (performed_by) references public.staff(id) on delete set null;
