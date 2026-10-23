// Inventory: stock on hand for every SKU (each size/colour of each
// product), what's running low, and the full history of stock changes.
// Stock never changes by editing a number -- every change is a recorded
// movement (received, sold, adjusted, returned...) with who made it, so
// the history always adds up to what's on hand.
//
// The tab is kept in the URL (?tab=low, ?tab=movements) so the dashboard
// and activity log can link straight to it.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Boxes, PackageCheck, PackagePlus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { StockBadge, Thumb } from "@/components/bits";
import { OwnerDeleteButton } from "@/components/DeleteRecord";
import { Modal, useToast } from "@/components/overlay";
import { AdjustStockModal, ReceiveStockModal, useInvalidateStock } from "@/components/StockModals";
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, PageHeader, Pagination, Select, Spinner, Table, Tabs, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime, money, titleCase, variantLabel } from "@/lib/format";
import { useCategories, useDebounced } from "@/lib/queries";
import type { InventoryRow, LowStockRow, StockMovement } from "@/lib/types";

// Rows per page (stock lists are scanned quickly, so more per page).
const PAGE_SIZE = 50;
type Tab = "stock" | "movements" | "low";

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "stock";
  const { can } = useAuth();
  const [receiving, setReceiving] = useState(false);
  // Fetched up here so the "Running low" tab can show its count.
  const low = useQuery({ queryKey: ["low-stock"], queryFn: () => api.get<LowStockRow[]>("/variants/low-stock") });

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock on hand for every SKU, and every change to it."
        actions={
          can.manageCatalog && (
            <Button icon={PackagePlus} onClick={() => setReceiving(true)}>
              Receive stock
            </Button>
          )
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams(t === "stock" ? {} : { tab: t })}
        tabs={[
          { value: "stock", label: "Stock levels" },
          { value: "low", label: "Running low", count: low.data?.length },
          { value: "movements", label: "Movement history" },
        ]}
      />
      {tab === "stock" && <StockLevels initialStock={params.get("stock") ?? ""} />}
      {tab === "low" && <LowStock rows={low.data} loading={low.isPending} />}
      {tab === "movements" && <Movements />}
      <ReceiveStockModal open={receiving} onClose={() => setReceiving(false)} />
    </>
  );
}

// Every SKU with its stock, filterable by search, category and level.
// initialStock lets a link pre-filter it (e.g. ?stock=out).
function StockLevels({ initialStock }: { initialStock: string }) {
  const { can } = useAuth();
  const categories = useCategories();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [categoryId, setCategoryId] = useState("");
  const [stock, setStock] = useState(initialStock);
  const [page, setPage] = useState(0);
  // The row whose Adjust or Repack dialog is open, if any.
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [repacking, setRepacking] = useState<InventoryRow | null>(null);

  const rows = useQuery({
    queryKey: ["inventory", { debounced, categoryId, stock, page }],
    queryFn: () =>
      api.list<InventoryRow>("/variants", { search: debounced, category_id: categoryId, stock, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div className="relative min-w-48 flex-[1_1_16rem]">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            placeholder="Search product name or SKU…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Select className="w-44" value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPage(0))}>
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={stock} onChange={(e) => (setStock(e.target.value), setPage(0))}>
          <option value="">Any stock level</option>
          <option value="in_stock">In stock</option>
          <option value="low">Running low</option>
          <option value="out">Out of stock</option>
        </Select>
        {rows.isFetching && <Spinner className="h-4 w-4" />}
      </div>
      {rows.isError ? (
        <div className="p-4">
          <ErrorState error={rows.error} />
        </div>
      ) : rows.data?.rows.length === 0 ? (
        <EmptyState icon={Boxes} title="Nothing matches" message="Try a different search or filter." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>SKU</Th>
                <Th>Category</Th>
                <Th className="text-right">On hand</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(rows.data?.rows ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-canvas/70">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Thumb path={r.image_storage_path} />
                      <div className="min-w-0">
                        <Link to={`/products/${r.product_id}`} className="block truncate font-semibold hover:text-brand-700">
                          {r.product_name}
                        </Link>
                        <p className="text-xs text-muted">
                          {variantLabel(r)}
                          {/* Drafts hold stock too (fast-received items), but aren't on sale yet. */}
                          {r.product_status === "draft" && " · draft"}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-xs text-muted">{r.sku}</Td>
                  <Td className="text-muted">{r.category_name}</Td>
                  <Td className="tabular text-right text-base font-semibold">{r.stock_quantity}</Td>
                  <Td>
                    <StockBadge variant={r} />
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {/* Repack is offered only for sizes sold in packs, with at least one
                       pack's worth of loose units on hand. */}
                    {can.manageCatalog && r.pack_size && r.stock_quantity >= r.pack_size && (
                      <Button size="sm" variant="ghost" onClick={() => setRepacking(r)}>
                        Repack
                      </Button>
                    )}
                    {can.adjustStock && (
                      <Button size="sm" variant="secondary" onClick={() => setAdjusting(r)}>
                        Adjust
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={rows.data?.total ?? 0} onPage={setPage} />
        </>
      )}
      <AdjustStockModal open={!!adjusting} onClose={() => setAdjusting(null)} variant={adjusting} productName={adjusting?.product_name ?? ""} />
      <RepackModal row={repacking} onClose={() => setRepacking(null)} />
    </Card>
  );
}

/** POST /inventory/rebalance: records loose units being organised into
 * factory-style packs. A bookkeeping note (audit log), not a stock
 * movement -- the units on hand don't change. */
function RepackModal({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateStock();
  const [packs, setPacks] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!row) return null;
  // The most whole packs the units on hand can make.
  const max = Math.floor(row.stock_quantity / (row.pack_size ?? 1));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/inventory/rebalance", { lines: [{ variant_id: row.id, pack_count: Number(packs) }], note: note.trim() || null });
      await invalidate();
      toast.success(`Recorded ${packs} pack(s) of ${row.pack_size}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Repack into packs"
      description={`${row.product_name} · ${variantLabel(row)} — packs of ${row.pack_size}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="repack" loading={busy} icon={PackageCheck}>
            Record
          </Button>
        </>
      }
    >
      <form id="repack" onSubmit={save} className="space-y-4">
        <FormError message={error} />
        <p className="text-sm text-muted">Records that loose units were packed for sale. The stock count stays the same.</p>
        <Field label={`Packs made (up to ${max})`}>
          <Input type="number" min={1} max={max} required value={packs} onChange={(e) => setPacks(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

// SKUs at or below their low-stock alert level (set per size on the
// product page), lowest first -- the reorder list.
function LowStock({ rows, loading }: { rows: LowStockRow[] | undefined; loading: boolean }) {
  const { can } = useAuth();
  const [adjusting, setAdjusting] = useState<LowStockRow | null>(null);
  if (loading) return <Spinner />;
  return (
    <Card>
      {!rows?.length ? (
        <EmptyState icon={Boxes} title="Nothing is running low" message="Every SKU is above its low-stock alert level." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Alert at</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Thumb path={r.image_storage_path} />
                    <div>
                      <Link to={`/products/${r.product_id}`} className="font-semibold hover:text-brand-700">
                        {r.product_name}
                      </Link>
                      <p className="text-xs text-muted">
                        {variantLabel(r)} · {r.sku}
                      </p>
                    </div>
                  </div>
                </Td>
                <Td className="text-right">
                  <Badge tone={r.stock_quantity === 0 ? "red" : "amber"}>{r.stock_quantity}</Badge>
                </Td>
                <Td className="tabular text-right text-muted">{r.low_stock_threshold}</Td>
                <Td className="text-right">
                  {can.adjustStock && (
                    <Button size="sm" variant="secondary" onClick={() => setAdjusting(r)}>
                      Restock
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <AdjustStockModal open={!!adjusting} onClose={() => setAdjusting(null)} variant={adjusting} productName={adjusting?.product_name ?? ""} />
    </Card>
  );
}

// Every stock movement, newest first: what changed, by how much, who did
// it and why. Sales show the price they went at.
function Movements() {
  const [page, setPage] = useState(0);
  // The movement log has no total count, so "next" is offered whenever a
  // full page came back.
  const rows = useQuery({
    queryKey: ["movements", page],
    queryFn: () => api.get<StockMovement[]>("/stock-movements", { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = rows.data ?? [];
  return (
    <Card>
      {rows.isPending ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon={Boxes} title="No stock movements yet" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Item</Th>
                <Th>Type</Th>
                <Th className="text-right">Change</Th>
                <Th>By</Th>
                <Th>Reason</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-muted">{dateTime(m.created_at)}</Td>
                  <Td>
                    <p className="font-medium">{m.product_name}</p>
                    <p className="text-xs text-muted">
                      {[m.variant_size, m.variant_color].filter(Boolean).join(" · ")} · {m.variant_sku}
                    </p>
                  </Td>
                  <Td>
                    {/* Blue: sales; amber: adjustments; green: stock coming in. */}
                    <Badge tone={m.movement_type === "sale" ? "blue" : m.movement_type === "adjustment" ? "amber" : "green"}>
                      {titleCase(m.movement_type)}
                    </Badge>
                  </Td>
                  <Td className={`tabular text-right font-semibold ${m.quantity_change > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    <span className="inline-flex items-center gap-1">
                      {m.quantity_change > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {m.quantity_change > 0 ? "+" : ""}
                      {m.quantity_change}
                    </span>
                  </Td>
                  {/* Online orders take stock without a staff member doing it. */}
                  <Td className="text-muted">{m.performed_by_name ?? (m.reference_type === "order" ? "Online order" : "—")}</Td>
                  <Td className="max-w-56 truncate text-muted">
                    {m.reason ?? (m.unit_price !== null && m.movement_type === "sale" ? `@ ${money(m.unit_price)}` : "")}
                  </Td>
                  <Td className="text-right">
                    {/* Owners only, and only entries made by hand: a sale's or
                        order's stock goes with that sale/order. */}
                    {!["pos_sale", "pos_sale_void", "order", "order_cancel"].includes(m.reference_type ?? "") && (
                      <OwnerDeleteButton
                        compact
                        label="Delete entry"
                        title="Delete this stock entry permanently?"
                        description={`${m.product_name} · ${[m.variant_size, m.variant_color].filter(Boolean).join(" · ")}: ${m.quantity_change > 0 ? "+" : ""}${m.quantity_change}`}
                        consequences="For test entries and mistakes. Its effect on stock is undone. Not possible for a delivery whose units have since been sold."
                        run={(reason) => api.del(`/stock-movements/${m.id}`, { reason })}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Newer
            </Button>
            <span className="text-muted">Page {page + 1}</span>
            <Button size="sm" variant="secondary" disabled={data.length < PAGE_SIZE} onClick={() => setPage(page + 1)}>
              Older
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
