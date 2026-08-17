-- Wholesale credit accounts: how much a customer is allowed to owe, and
-- how much they currently do. outstanding_balance is a cached counter kept
-- in sync by the customer_credit_ledger trigger added in a later
-- migration -- same pattern as product_variants.stock_quantity vs.
-- stock_movements -- so it is never written directly by the API.
alter table public.customers
  add column credit_limit numeric(10, 2) not null default 0 check (credit_limit >= 0),
  add column outstanding_balance numeric(10, 2) not null default 0 check (outstanding_balance >= 0);

-- No separate is_wholesale_verified column: "verified for wholesale credit"
-- is customer_type = 'wholesale' and status = 'approved', both of which
-- already exist -- a third column duplicating that would just be another
-- place for the two to drift out of sync.
