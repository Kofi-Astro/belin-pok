-- General-purpose admin action log, separate from order_status_history and
-- stock_movements (which are their own domain-specific audit trails).
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff(id) on delete set null,
  action text not null,        -- e.g. 'product.create', 'staff.role_change'
  table_name text not null,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index idx_audit_log_staff_id on public.audit_log(staff_id);
create index idx_audit_log_table_record on public.audit_log(table_name, record_id);
create index idx_audit_log_created_at on public.audit_log(created_at desc);
