-- security_invoker makes the view respect the querying user's RLS grants
-- (Postgres 15+, which Supabase runs) instead of the view owner's.
create view public.low_stock_variants
with (security_invoker = true)
as
select
  pv.id as variant_id,
  pv.sku,
  pv.size,
  pv.color,
  pv.stock_quantity,
  pv.low_stock_threshold,
  p.id as product_id,
  p.name as product_name,
  p.category_id
from public.product_variants pv
join public.products p on p.id = pv.product_id
where pv.is_active and pv.stock_quantity <= pv.low_stock_threshold;
