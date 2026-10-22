-- Bridges POS payments to the credit ledger: a pos_sale_payments row with
-- method = 'credit' is how a cashier records "put this on the customer's
-- account" at checkout, but customers.outstanding_balance must only ever
-- move through customer_credit_ledger (see previous migration) -- so
-- inserting the payment itself writes the matching ledger charge, in the
-- same transaction, rather than trusting the API layer to do both. This is
-- what makes "block a wholesale credit sale that has no customer, or one
-- who isn't wholesale/approved, or one who's already at their limit" a
-- database-level guarantee instead of an application-level one.
create or replace function public.charge_credit_ledger_for_pos_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_customer_id uuid;
  customer_type_val public.customer_type;
  customer_status_val public.customer_status;
begin
  if new.method <> 'credit' then
    return new;
  end if;

  select customer_id into sale_customer_id from public.pos_sales where id = new.sale_id;
  if sale_customer_id is null then
    raise exception 'A credit payment requires the sale to have a customer';
  end if;

  select customer_type, status into customer_type_val, customer_status_val
  from public.customers where id = sale_customer_id;

  if customer_type_val <> 'wholesale' or customer_status_val <> 'approved' then
    raise exception 'Customer % is not an approved wholesale account and cannot buy on credit', sale_customer_id;
  end if;

  insert into public.customer_credit_ledger (customer_id, entry_type, amount, reference_type, reference_id, performed_by)
  values (sale_customer_id, 'charge', new.amount, 'pos_sale', new.sale_id,
    (select staff_id from public.pos_sales where id = new.sale_id));

  return new;
end;
$$;

create trigger trg_charge_credit_ledger_for_pos_payment
after insert on public.pos_sale_payments
for each row execute function public.charge_credit_ledger_for_pos_payment();
