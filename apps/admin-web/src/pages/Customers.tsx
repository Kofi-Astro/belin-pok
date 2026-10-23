// Customers: everyone the shop sells to and keeps a record of --
//   - retail shoppers who made an account on the website or app,
//   - guests (an online order without an account creates a customer from
//     the name and phone given at checkout),
//   - wholesale businesses, which staff add here, approve, and can let buy
//     "on account" (credit) up to a limit.
// Two screens: the searchable list (CustomersPage) and one customer
// (CustomerDetailPage) with their credit account and online orders.
// Adding/editing customers, approving them and recording payments needs
// the manageOrders permission (owner or order fulfilment).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, Check, Plus, Scale, Search, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { CustomerStatusBadge, OrderStatusBadge } from "@/components/bits";
import { OwnerDeleteButton } from "@/components/DeleteRecord";
import { Modal, useToast } from "@/components/overlay";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  PageHeader,
  PageLoading,
  Pagination,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
  Th,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, dateTime, money, titleCase } from "@/lib/format";
import { useDebounced } from "@/lib/queries";
import type { Customer, CustomerType, LedgerEntry, Order } from "@/lib/types";

// Customers per page in the list.
const PAGE_SIZE = 25;

export function CustomersPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  // Filters: "" means any. Changing any of them goes back to page 1.
  const [type, setType] = useState<CustomerType | "">("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  const customers = useQuery({
    queryKey: ["customers", { type, status, debounced, page }],
    queryFn: () => api.list<Customer>("/customers", { customer_type: type, status, search: debounced, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Shoppers with accounts, guests from online orders, and wholesale businesses buying on account."
        actions={
          can.manageOrders && (
            <Button icon={Plus} onClick={() => setAdding(true)}>
              Add customer
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          {/* Type tabs: All / Retail / Wholesale. */}
          <div className="flex rounded-lg bg-canvas p-0.5">
            {(["", "retail", "wholesale"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => (setType(t), setPage(0))}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${type === t ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {t ? titleCase(t) : "All"}
              </button>
            ))}
          </div>
          <div className="relative min-w-48 flex-[1_1_16rem]">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input className="pl-9" placeholder="Name, business, phone or email…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(0))} />
          </div>
          <Select className="w-44" value={status} onChange={(e) => (setStatus(e.target.value), setPage(0))}>
            <option value="">Any status</option>
            <option value="pending">Awaiting approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
          {customers.isFetching && <Spinner className="h-4 w-4" />}
        </div>
        {customers.isError ? (
          <div className="p-4">
            <ErrorState error={customers.error} />
          </div>
        ) : customers.data?.rows.length === 0 ? (
          <EmptyState icon={Users} title="No customers match" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Contact</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Owes</Th>
                  <Th>Since</Th>
                </tr>
              </thead>
              <tbody>
                {(customers.data?.rows ?? []).map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)} className="cursor-pointer hover:bg-canvas/70">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={c.business_name || c.full_name} />
                        <div>
                          <p className="font-semibold">{c.business_name || c.full_name}</p>
                          {c.business_name && <p className="text-xs text-muted">{c.full_name}</p>}
                        </div>
                      </div>
                    </Td>
                    <Td className="text-muted">{c.phone || c.email || "—"}</Td>
                    <Td>
                      <Badge tone={c.customer_type === "wholesale" ? "brand" : "neutral"}>{titleCase(c.customer_type)}</Badge>
                    </Td>
                    <Td>
                      <CustomerStatusBadge status={c.status} />
                    </Td>
                    {/* What they owe on account -- only ever non-zero for wholesale. */}
                    <Td className={`tabular text-right font-semibold ${c.outstanding_balance > 0 ? "text-amber-700" : "text-muted"}`}>
                      {c.outstanding_balance > 0 ? money(c.outstanding_balance) : "—"}
                    </Td>
                    <Td className="text-muted">{date(c.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={customers.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      <CustomerFormModal open={adding} onClose={() => setAdding(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </>
  );
}

/** Create a customer, or edit one's details. A wholesale account still
 * needs approving (on its page) before it can buy on credit. */
function CustomerFormModal({
  open,
  onClose,
  onSaved,
  customer,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (c: Customer) => void;
  customer?: Customer;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  // Form fields as strings (what inputs hold); converted when saved.
  const blank = { full_name: "", business_name: "", phone: "", email: "", customer_type: "retail" as CustomerType, credit_limit: "", tax_id: "", notes: "" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each time the dialog opens: fill it from the customer being edited, or
  // start blank for a new one.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      customer
        ? {
            full_name: customer.full_name,
            business_name: customer.business_name ?? "",
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            customer_type: customer.customer_type,
            credit_limit: String(customer.credit_limit),
            tax_id: customer.tax_id ?? "",
            notes: customer.notes ?? "",
          }
        : blank,
    );
  }, [open]); // reset whenever the dialog opens

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Fields that can be both set on creation and edited later. Blank
    // optional fields are sent as null rather than "". Email and type are
    // only set when creating (see the API's CustomerUpdate).
    const shared = {
      full_name: form.full_name.trim(),
      business_name: form.business_name.trim() || null,
      phone: form.phone.trim() || null,
      tax_id: form.tax_id.trim() || null,
      notes: form.notes.trim() || null,
      credit_limit: Number(form.credit_limit || 0),
    };
    try {
      const saved = customer
        ? await api.patch<Customer>(`/customers/${customer.id}`, shared)
        : await api.post<Customer>("/customers", { ...shared, email: form.email.trim() || null, customer_type: form.customer_type });
      // Refresh the list and this customer's page with the saved details.
      await qc.invalidateQueries({ queryKey: ["customers"] });
      await qc.invalidateQueries({ queryKey: ["customer", saved.id] });
      toast.success(customer ? "Customer updated" : "Customer added");
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? "Edit customer" : "Add customer"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        {/* Retail or wholesale -- chosen once, when the customer is created. */}
        {!customer && (
          <div className="grid grid-cols-2 rounded-lg bg-canvas p-1 text-sm font-semibold sm:col-span-2">
            {(["retail", "wholesale"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setForm({ ...form, customer_type: t })} className={`rounded-md py-2 ${form.customer_type === t ? "bg-white shadow-sm" : "text-muted"}`}>
                {titleCase(t)}
              </button>
            ))}
          </div>
        )}
        <Field label="Contact name">
          <Input required value={form.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Business name">
          <Input value={form.business_name} onChange={set("business_name")} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={form.phone} onChange={set("phone")} />
        </Field>
        {!customer && (
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set("email")} />
          </Field>
        )}
        {/* Credit terms only apply to wholesale accounts. */}
        {form.customer_type === "wholesale" && (
          <>
            <Field label="Credit limit (GH₵)" hint="0 means cash only.">
              <Input type="number" min={0} step="0.01" value={form.credit_limit} onChange={set("credit_limit")} />
            </Field>
            <Field label="Tax ID">
              <Input value={form.tax_id} onChange={set("tax_id")} />
            </Field>
          </>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={set("notes")} />
        </Field>
      </form>
    </Modal>
  );
}

// One customer: header actions (approve / reject / edit), the credit
// account for wholesale customers, their online orders, and details.
export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const customer = useQuery({ queryKey: ["customer", id], queryFn: () => api.get<Customer>(`/customers/${id}`) });
  // The credit ledger: every charge, payment and correction to what this
  // customer owes, newest first. Only wholesale customers have one.
  const ledger = useQuery({
    queryKey: ["ledger", id],
    queryFn: () => api.get<LedgerEntry[]>(`/customers/${id}/credit-ledger`, { limit: 100 }),
    enabled: customer.data?.customer_type === "wholesale",
  });
  const orders = useQuery({ queryKey: ["orders", { customer: id }], queryFn: () => api.list<Order>("/orders", { customer_id: id, limit: 20 }) });
  const [editing, setEditing] = useState(false);
  // Which ledger dialog is open, if any (see LedgerModal).
  const [ledgerAction, setLedgerAction] = useState<"payment" | "adjustment" | null>(null);

  // Approve or reject an account. Approving a wholesale customer is what
  // lets them buy on credit at the till.
  const setStatus = useMutation({
    mutationFn: (status: string) => api.post<Customer>(`/customers/${id}/status`, { status }),
    onSuccess: async (c) => {
      qc.setQueryData(["customer", id], c);
      await qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success(c.status === "approved" ? "Approved — can now buy wholesale" : `Marked ${c.status}`);
    },
    onError: (e) => toast.error(e),
  });

  if (customer.isPending) return <PageLoading />;
  if (customer.isError) return <ErrorState error={customer.error} />;
  const c = customer.data;
  // Credit left to use, and how much of the limit is used (for the bar).
  const available = Math.max(0, c.credit_limit - c.outstanding_balance);
  const usedPct = c.credit_limit > 0 ? Math.min(100, (c.outstanding_balance / c.credit_limit) * 100) : 0;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/customers" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Customers
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {c.business_name || c.full_name} <CustomerStatusBadge status={c.status} />
          </span>
        }
        description={`${titleCase(c.customer_type)} customer since ${date(c.created_at)}`}
        actions={
          can.manageOrders && (
            <>
              {c.status !== "approved" && (
                <Button icon={Check} loading={setStatus.isPending} onClick={() => setStatus.mutate("approved")}>
                  Approve
                </Button>
              )}
              {c.status === "pending" && (
                <Button variant="secondary" icon={X} onClick={() => setStatus.mutate("rejected")}>
                  Reject
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              {/* Owners only: removes a test/duplicate customer (see DeleteRecord.tsx). */}
              <OwnerDeleteButton
                compact
                label="Delete customer"
                title={`Delete ${c.business_name || c.full_name} permanently?`}
                consequences="For test or duplicate customers. Only possible once they have no orders, till sales or account history — delete those first. Their saved addresses and website login go too."
                run={(reason) => api.del(`/customers/${c.id}`, { reason })}
                done={() => navigate("/customers")}
              />
            </>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {c.customer_type === "wholesale" && (
            <Card>
              <CardHeader
                title="Credit account"
                description="Every charge from a credit sale, every payment and every correction."
                actions={
                  can.manageOrders && (
                    <>
                      <Button size="sm" variant="secondary" icon={Scale} onClick={() => setLedgerAction("adjustment")}>
                        Correction
                      </Button>
                      <Button size="sm" icon={Banknote} onClick={() => setLedgerAction("payment")}>
                        Record payment
                      </Button>
                    </>
                  )
                }
              />
              {/* Owes / Credit limit / Available, side by side. */}
              <div className="grid grid-cols-3 border-b border-line">
                {[
                  ["Owes", money(c.outstanding_balance), c.outstanding_balance > 0 ? "text-amber-700" : ""],
                  ["Credit limit", money(c.credit_limit), ""],
                  ["Available", money(available), "text-emerald-700"],
                ].map(([label, value, tone]) => (
                  <div key={label} className="px-5 py-4">
                    <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
                    <p className={`tabular mt-1 text-xl font-bold ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>
              {c.credit_limit > 0 && (
                <div className="px-5 pt-4 pb-4">
                  <div className="h-2 overflow-hidden rounded-full bg-canvas">
                    {/* Turns red past 85% -- close to the limit, so the next credit sale
                       may be refused. */}
                    <div className={`h-full rounded-full ${usedPct > 85 ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${usedPct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{usedPct.toFixed(0)}% of limit used</p>
                </div>
              )}
              {!c.is_wholesale_verified && (
                <p className="mx-5 mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Not approved yet — credit sales are blocked until it is.</p>
              )}
              {ledger.data?.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Entry</Th>
                      <Th>Details</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.map((e) => (
                      <tr key={e.id}>
                        <Td className="whitespace-nowrap text-muted">{dateTime(e.created_at)}</Td>
                        <Td>
                          <Badge tone={e.entry_type === "payment" ? "green" : e.entry_type === "charge" ? "amber" : "neutral"}>{titleCase(e.entry_type)}</Badge>
                        </Td>
                        <Td className="text-muted">
                          {e.reason ?? (e.reference_type === "pos_sale" ? "Credit sale at the counter" : "—")}
                          {e.performed_by_name && <span className="block text-xs">by {e.performed_by_name}</span>}
                        </Td>
                        <Td className={`tabular text-right font-semibold ${e.entry_type === "payment" ? "text-emerald-700" : ""}`}>
                          {/* Payments always reduce the balance; corrections can go either way;
                             charges (credit sales) add to it. */}
                          {e.entry_type === "payment" ? "−" : e.amount < 0 ? "−" : "+"}
                          {money(Math.abs(e.amount))}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="p-5 text-sm text-muted">No credit activity yet.</p>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Online orders" />
            {!orders.data?.rows.length ? (
              <p className="p-5 text-sm text-muted">No online orders.</p>
            ) : (
              <ul className="divide-y divide-line">
                {orders.data.rows.map((o) => (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-canvas">
                      <span className="font-semibold">{o.order_number}</span>
                      <span className="text-muted">{date(o.created_at)}</span>
                      <span className="ml-auto">
                        <OrderStatusBadge status={o.status} />
                      </span>
                      <span className="tabular w-24 text-right font-semibold">{money(o.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Details" />
          <dl className="space-y-3 p-5 text-sm">
            {[
              ["Contact", c.full_name],
              ["Business", c.business_name],
              ["Phone", c.phone],
              ["Email", c.email],
              ["Tax ID", c.tax_id],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium">{v || "—"}</dd>
              </div>
            ))}
            {c.notes && <p className="rounded-lg bg-canvas p-3 text-ink/80">{c.notes}</p>}
          </dl>
        </Card>
      </div>

      <CustomerFormModal open={editing} onClose={() => setEditing(false)} onSaved={() => {}} customer={c} />
      <LedgerModal customer={c} kind={ledgerAction} onClose={() => setLedgerAction(null)} />
    </>
  );
}

/** Record a payment (always reduces what's owed) or a signed correction. */
// Both are recorded in the customer's credit ledger with who did it, and
// the API keeps the running balance (outstanding_balance) in step. A
// correction needs a reason, since it changes what's owed without money
// changing hands; the owner sees it in the activity log.
function LedgerModal({ customer, kind, onClose }: { customer: Customer; kind: "payment" | "adjustment" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"decrease" | "increase">("decrease");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start fresh each time a dialog opens.
  useEffect(() => {
    setAmount("");
    setReason("");
    setError(null);
  }, [kind]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!n || n <= 0) return setError("Enter an amount above zero.");
    setBusy(true);
    setError(null);
    try {
      if (kind === "payment") await api.post(`/customers/${customer.id}/credit-payments`, { amount: n, reason: reason.trim() || null });
      else await api.post(`/customers/${customer.id}/credit-adjustments`, { amount: direction === "increase" ? n : -n, reason: reason.trim() });
      // The balance shows on this page, the list and the dashboard's
      // debtors panel -- refresh them all.
      await Promise.all(["customer", "ledger", "customers", "dashboard"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast.success(kind === "payment" ? `Payment of ${money(n)} recorded` : "Correction recorded");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!kind}
      onClose={onClose}
      size="sm"
      title={kind === "payment" ? "Record a payment" : "Correct the balance"}
      description={`${customer.business_name || customer.full_name} owes ${money(customer.outstanding_balance)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ledger-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="ledger-form" onSubmit={save} className="space-y-4">
        <FormError message={error} />
        {kind === "adjustment" && (
          <Field label="Direction">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as "decrease" | "increase")}>
              <option value="decrease">Reduce what they owe (e.g. write-off)</option>
              <option value="increase">Increase what they owe (e.g. missed charge)</option>
            </Select>
          </Field>
        )}
        <Field label="Amount (GH₵)">
          <Input type="number" min={0} step="0.01" autoFocus required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={kind === "payment" ? "Reference (optional)" : "Reason"}>
          <Input required={kind === "adjustment"} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "payment" ? "e.g. MoMo ref, cash" : "Why the balance is changing"} />
        </Field>
      </form>
    </Modal>
  );
}
