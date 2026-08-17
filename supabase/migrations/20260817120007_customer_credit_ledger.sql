-- Append-only ledger of every change to a wholesale customer's balance --
-- same "nothing is ever updated or deleted, corrections are offsetting
-- rows" design as stock_movements, for the same reason: outstanding_balance
-- must always be explainable by a full history, not just trusted as a bare
-- number. amount is signed: positive increases what the customer owes
-- (a credit charge), negative decreases it (a payment, or a correction).
create type public.credit_ledger_entry_type as enum ('charge', 'payment', 'adjustment');

create table public.customer_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  entry_type public.credit_ledger_entry_type not null,
  amount numeric(10, 2) not null check (amount <> 0),
  reason text,
  reference_type text,   -- e.g. 'pos_sale', 'pos_sale_void'
  reference_id uuid,
  performed_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_customer_credit_ledger_customer_id on public.customer_credit_ledger(customer_id);
create index idx_customer_credit_ledger_created_at on public.customer_credit_ledger(created_at desc);

-- Atomic hard safeguard: applies the entry to customers.outstanding_balance
-- and, for a charge that pushes the balance past their credit_limit, rolls
-- the whole transaction back -- so a wholesale credit sale that would blow
-- through a customer's limit never commits, no matter what the API layer
-- already checked. The UPDATE ... RETURNING makes the check-then-raise
-- atomic per row (protected by the row lock the UPDATE itself takes), same
-- race-safety pattern as apply_stock_movement().
create or replace function public.apply_credit_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(10, 2);
  limit_amount numeric(10, 2);
begin
  update public.customers
  set outstanding_balance = outstanding_balance + new.amount
  where id = new.customer_id
  returning outstanding_balance, credit_limit into new_balance, limit_amount;

  if new_balance is null then
    raise exception 'Unknown customer % for credit ledger entry', new.customer_id;
  end if;

  if new_balance > limit_amount then
    raise exception 'Credit ledger entry would take customer % balance (%) past their credit limit (%)',
      new.customer_id, new_balance, limit_amount;
  end if;

  return new;
end;
$$;

create trigger trg_apply_credit_ledger_entry
after insert on public.customer_credit_ledger
for each row execute function public.apply_credit_ledger_entry();

alter table public.customer_credit_ledger enable row level security;

create policy "customer_credit_ledger_select_staff" on public.customer_credit_ledger
for select using (public.is_staff());

create policy "customer_credit_ledger_write_privileged" on public.customer_credit_ledger
for all using (public.current_staff_role() in ('owner', 'order_fulfillment'))
with check (public.current_staff_role() in ('owner', 'order_fulfillment'));
