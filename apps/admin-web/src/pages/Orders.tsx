// Online orders -- the ones placed on the website or the phone app (counter
// sales are on the Point of sale page). Two screens:
//   - OrdersPage: the list, filterable by status and searchable, with a
//     warning panel for orders the shelf may not be able to fill;
//   - OrderDetailPage: one order -- its lines (online price, and the
//     in-store price it would have been), customer, delivery, timeline,
//     and moving it along (paid -> packed -> shipped -> delivered).
// Status changes go through POST /orders/{id}/status, which records who
// made them (the owner sees these in the activity log) and notifies the
// customer's phone if they use the app.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ClipboardList, Mail, MapPin, Phone, Search, Store, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { OrderStatusBadge, Thumb } from "@/components/bits";
import { OwnerDeleteButton } from "@/components/DeleteRecord";
import { useToast } from "@/components/overlay";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, PageLoading, Pagination, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime, money, timeAgo, titleCase, optionLabel } from "@/lib/format";
import { useDebounced } from "@/lib/queries";
import type { Order, OrderStatus } from "@/lib/types";

// Orders per page in the list.
const PAGE_SIZE = 25;
// Every status, for the "set any status" dropdown (including cancelling
// or refunding, which aren't part of the usual flow).
const STATUSES: OrderStatus[] = ["pending", "paid", "packed", "shipped", "delivered", "cancelled", "refunded"];

// The usual next step from each status, offered as the one-click action.
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { pending: "paid", paid: "packed", packed: "shipped", shipped: "delivered" };

export function OrdersPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  // 0-based page; reset to 0 whenever the filter or search changes.
  const [page, setPage] = useState(0);

  const orders = useQuery({
    queryKey: ["orders", { status, debounced, page }],
    queryFn: () => api.list<Order>("/orders", { status, search: debounced, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    // Keep showing the current page while the next one loads, instead of
    // flashing an empty table.
    placeholderData: keepPreviousData,
  });
  // Unfulfilled orders needing more of something than the system thinks
  // is on hand -- a sign that stock went out without being recorded.
  const attention = useQuery({ queryKey: ["orders", "attention"], queryFn: () => api.get<Order[]>("/orders/needs-attention") });

  return (
    <>
      <PageHeader title="Online orders" description="Orders placed on the website. Counter sales are under Point of sale." />

      {!!attention.data?.length && (
        <Card className="mb-6 border-amber-200">
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <b>{attention.data.length}</b> unfulfilled {attention.data.length === 1 ? "order needs" : "orders need"} more stock than the
              system shows on hand — usually a counter sale that wasn&apos;t rung up. Check the shelf before packing.
            </span>
          </div>
          <ul className="divide-y divide-line">
            {attention.data.map((o) => (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-canvas">
                  <span className="font-semibold">{o.order_number}</span>
                  <span className="text-muted">{o.customer_name}</span>
                  <span className="ml-auto">
                    <OrderStatusBadge status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          {/* Status filter tabs ("" = all). Cancelled/refunded are left off to keep
             the bar short; they still show under All. */}
          <div className="flex flex-wrap rounded-lg bg-canvas p-0.5">
            {(["", "pending", "paid", "packed", "shipped", "delivered"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => (setStatus(s), setPage(0))}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${status === s ? "bg-white shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {s ? titleCase(s) : "All"}
              </button>
            ))}
          </div>
          <div className="relative min-w-48 flex-[1_1_16rem]">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input className="pl-9" placeholder="Order number, name, phone or email…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(0))} />
          </div>
          {orders.isFetching && <Spinner className="h-4 w-4" />}
        </div>
        {orders.isError ? (
          <div className="p-4">
            <ErrorState error={orders.error} />
          </div>
        ) : orders.data?.rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No orders here" message={status || debounced ? "Try another status or search." : "Online orders will show up here."} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th>Items</Th>
                  <Th>Fulfilment</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {(orders.data?.rows ?? []).map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="cursor-pointer hover:bg-canvas/70">
                    <Td>
                      <p className="font-semibold">{o.order_number}</p>
                      <p className="text-xs text-muted">{timeAgo(o.created_at)}</p>
                    </Td>
                    <Td>
                      <p className="font-medium">{o.customer_name}</p>
                      <p className="text-xs text-muted">{o.customer_phone ?? o.customer_email ?? ""}</p>
                    </Td>
                    <Td>
                      <div className="flex -space-x-2">
                        {/* Up to four overlapping thumbnails, then "+N". */}
                        {o.items.slice(0, 4).map((i) => (
                          <Thumb key={i.id} path={i.image_storage_path} size={32} className="ring-2 ring-white" />
                        ))}
                        {o.items.length > 4 && <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-canvas text-xs font-semibold ring-2 ring-white">+{o.items.length - 4}</span>}
                      </div>
                    </Td>
                    <Td className="text-muted">{o.fulfillment_method === "pickup" ? "Pickup" : "Delivery"}</Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td className="tabular text-right font-semibold">{money(o.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={orders.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

// One order. Anyone signed in can view it; moving it along needs the
// manageOrders permission (owner or order fulfilment).
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const order = useQuery({ queryKey: ["order", id], queryFn: () => api.get<Order>(`/orders/${id}`) });
  // The status picked in the "Update status" card, and its optional note
  // (e.g. a mobile money reference), recorded in the order's timeline.
  const [next, setNext] = useState<OrderStatus | "">("");
  const [note, setNote] = useState("");

  const update = useMutation({
    mutationFn: (status: OrderStatus) => api.post<Order>(`/orders/${id}/status`, { status, note: note.trim() || null }),
    // The API returns the updated order: show it straight away, then refresh
    // the lists (counts and filters may have changed).
    onSuccess: async (o) => {
      qc.setQueryData(["order", id], o);
      await qc.invalidateQueries({ queryKey: ["orders"] });
      setNote("");
      setNext("");
      toast.success(`Order marked ${o.status}`);
    },
    onError: (e) => toast.error(e),
  });

  if (order.isPending) return <PageLoading />;
  if (order.isError) return <ErrorState error={order.error} />;
  const o = order.data;
  // The one-click "Mark as ..." in the header: the usual next step, if any.
  const suggested = NEXT[o.status];
  const addr = o.shipping_address;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/orders" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Online orders
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {o.order_number} <OrderStatusBadge status={o.status} />
            <Badge tone="blue">Online order</Badge>
          </span>
        }
        description={`Placed ${dateTime(o.created_at)}`}
        actions={
          <>
            {can.manageOrders && suggested && (
              <Button loading={update.isPending} onClick={() => update.mutate(suggested)}>
                Mark as {suggested}
              </Button>
            )}
            {/* Owners only: removes a test order entirely (see DeleteRecord.tsx). */}
            <OwnerDeleteButton
              compact
              label="Delete order"
              title={`Delete ${o.order_number} permanently?`}
              description={`${money(o.total)} from ${o.customer_name}, ${dateTime(o.created_at)}`}
              consequences="For test orders. It disappears from the orders list and every report, and its items go back into stock. The customer record stays — delete it from their page if it was a test too."
              run={(reason) => api.del(`/orders/${o.id}`, { reason })}
              done={() => navigate("/orders")}
            />
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title={`Items (${o.items.reduce((n, i) => n + i.quantity, 0)})`} />
            <ul className="divide-y divide-line">
              {o.items.map((i) => (
                <li key={i.id} className="flex items-center gap-4 px-5 py-4 text-sm">
                  <Thumb path={i.image_storage_path} size={48} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/products/${i.product_id}`} className="font-semibold hover:text-brand-700">
                      {i.product_name}
                    </Link>
                    <p className="text-xs text-muted">
                      {optionLabel(i)} · SKU {i.variant_sku}
                    </p>
                  </div>
                  <span className="tabular text-right text-muted">
                    {i.quantity} × {money(i.unit_price)}
                    {/* Online orders are charged the online price (in-store price plus the
                       shop's markup -- Admin → Shop settings). The in-store price is
                       recorded on each line at checkout, shown here when it differs.
                       Null for orders placed before online pricing existed. */}
                    {i.in_store_unit_price !== null && i.in_store_unit_price !== i.unit_price && (
                      <span className="block text-xs">in store {money(i.in_store_unit_price)}</span>
                    )}
                  </span>
                  <span className="tabular w-24 text-right font-semibold">{money(i.line_total)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 border-t border-line px-5 py-4 text-sm">
              <div className="flex justify-between text-muted">
                <span>Subtotal</span>
                <span className="tabular">{money(o.subtotal)}</span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span className="tabular">{money(o.total)}</span>
              </div>
              {/* What the online markup added to this order, in total. */}
              {(() => {
                const markup = o.items.reduce((n, i) => n + (i.in_store_unit_price !== null ? (i.unit_price - i.in_store_unit_price) * i.quantity : 0), 0);
                return markup > 0 ? (
                  <p className="pt-1 text-xs text-muted">
                    Includes {money(markup)} online markup — the same items would cost {money(o.total - markup)} in store.
                  </p>
                ) : null;
              })()}
            </div>
          </Card>

          {can.manageOrders && (
            <Card>
              <CardHeader title="Update status" description="The customer gets a notification on their phone if they use the app." />
              <div className="grid gap-4 p-5 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <Field label="New status">
                  <Select value={next} onChange={(e) => setNext(e.target.value as OrderStatus)}>
                    <option value="">Choose…</option>
                    {STATUSES.filter((s) => s !== o.status).map((s) => (
                      <option key={s} value={s}>
                        {titleCase(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note (optional)">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid by MoMo, ref 1234" />
                </Field>
                <Button disabled={!next} loading={update.isPending} onClick={() => next && update.mutate(next)}>
                  Update
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <div className="space-y-3 p-5 text-sm">
              <Link to={`/customers/${o.customer_id}`} className="font-semibold hover:text-brand-700">
                {o.customer_name}
              </Link>
              {o.customer_phone && (
                <a href={`tel:${o.customer_phone}`} className="flex items-center gap-2 text-muted hover:text-ink">
                  <Phone className="h-4 w-4" /> {o.customer_phone}
                </a>
              )}
              {o.customer_email && (
                <a href={`mailto:${o.customer_email}`} className="flex items-center gap-2 text-muted hover:text-ink">
                  <Mail className="h-4 w-4" /> {o.customer_email}
                </a>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Fulfilment" />
            <div className="space-y-3 p-5 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {o.fulfillment_method === "pickup" ? <Store className="h-4 w-4 text-brand-600" /> : <Truck className="h-4 w-4 text-brand-600" />}
                {o.fulfillment_method === "pickup" ? "Pickup in store" : "Delivery"}
              </p>
              {addr && (
                <p className="flex items-start gap-2 text-muted">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{[addr.line1, addr.line2, addr.city, addr.state, addr.country].filter(Boolean).join(", ")}</span>
                </p>
              )}
              {o.notes && <p className="rounded-lg bg-canvas p-3 text-ink/80">“{o.notes}”</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            {/* Every status change, oldest first, each with its note. */}
            <ol className="space-y-4 p-5 text-sm">
              <li className="relative border-l-2 border-line pl-4">
                <span className="absolute top-1.5 -left-[5px] h-2 w-2 rounded-full bg-gray-400" />
                <p className="font-medium">Order placed</p>
                <p className="text-xs text-muted">{dateTime(o.created_at)}</p>
              </li>
              {o.status_history.map((h, i) => (
                <li key={i} className="relative border-l-2 border-line pl-4">
                  <span className="absolute top-1.5 -left-[5px] h-2 w-2 rounded-full bg-brand-500" />
                  <p className="font-medium">Marked {h.status}</p>
                  {h.note && <p className="text-muted">{h.note}</p>}
                  <p className="text-xs text-muted">{dateTime(h.created_at)}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
