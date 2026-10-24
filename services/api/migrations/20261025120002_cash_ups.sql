-- End-of-day cash-up. At closing, staff count what's in the drawer (and
-- check the mobile money and card totals); the app compares that with
-- what the till recorded and shows any shortage or surplus. One per shop
-- day; doing it again replaces it (the old figures go to the audit log --
-- see app/routers/cash_ups.py).
--
-- The expected figures are copied in when the count is saved, so a
-- cash-up keeps saying what it said at the time even if a sale is voided
-- or deleted afterwards (the cash-up page points out when the day's
-- figures have changed since).
create table public.cash_ups (
  id uuid primary key default gen_random_uuid(),
  -- The shop's calendar day being closed (in the shop's timezone).
  business_date date not null unique,
  -- Change the drawer started the day with, and cash taken out of it
  -- during the day for shop costs (transport, water, ...) -- both affect
  -- what should be in it at the end.
  opening_float numeric(10, 2) not null default 0 check (opening_float >= 0),
  paid_out numeric(10, 2) not null default 0 check (paid_out >= 0),
  paid_out_note text,
  -- What was counted. Mobile money and card are optional: a shop that
  -- doesn't check them leaves them blank, and no difference is shown.
  counted_cash numeric(10, 2) not null check (counted_cash >= 0),
  counted_mobile_money numeric(10, 2) check (counted_mobile_money >= 0),
  counted_card numeric(10, 2) check (counted_card >= 0),
  -- What the till says should be there. expected_cash already includes
  -- the opening float and takes off what was paid out.
  expected_cash numeric(10, 2) not null,
  expected_mobile_money numeric(10, 2) not null,
  expected_card numeric(10, 2) not null,
  -- Cash left in the drawer as tomorrow's float (the rest taken away or
  -- banked). Tomorrow's cash-up starts from it.
  left_in_drawer numeric(10, 2) check (left_in_drawer >= 0),
  note text,
  counted_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- How a credit repayment was paid, so cash repayments are expected in the
-- drawer at cash-up. Only set on 'payment' entries; older rows stay blank.
alter table public.customer_credit_ledger add column method public.payment_method;
