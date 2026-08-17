-- Guest checkout previously required a shipping address unconditionally,
-- even though orders.shipping_address_id was already nullable -- there
-- was no way to say "this order is for in-person pickup, not delivery".
-- A NULL shipping_address_id alone can't carry that meaning (it's
-- ambiguous with "address never got recorded"), so this adds an explicit,
-- durable column instead of inferring it.
create type public.fulfillment_method as enum ('delivery', 'pickup');

alter table public.orders
  add column fulfillment_method public.fulfillment_method not null default 'delivery';
