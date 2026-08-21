-- Guest checkout no longer requires an email -- some shoppers should be
-- able to place an order with just their name (see
-- app/routers/orders.py's checkout()). The unique constraint on email is
-- untouched: Postgres treats multiple NULLs as distinct, so any number of
-- guests with no email can coexist without conflict.
alter table public.customers alter column email drop not null;
