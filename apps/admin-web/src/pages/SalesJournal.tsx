// The sales journal: every counter sale as a receipt -- when, who rang it
// up, who bought, each item with quantity and price, how it was paid, and
// for voided sales who voided it, when and why. Filterable, exportable.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Ban, ChevronDown, ChevronRight, Download, Receipt } from "lucide-react";
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { PeriodPicker } from "@/components/PeriodPicker";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { downloadCsv } from "@/lib/csv";
import { dateTime, money, titleCase } from "@/lib/format";
import { describePeriod, type Period, type Preset, presetRange } from "@/lib/period";
import type { PosSale, Staff } from "@/lib/types";

const PAGE_SIZE = 50;
const METHOD_LABELS: Record<string, string> = { cash: "Cash", mobile_money: "MoMo", card: "Card", credit: "On account" };

export function SalesJournalPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  // A link from the report carries explicit dates (?from&to); otherwise a preset.
  const preset: Preset = params.get("from") ? "custom" : ((params.get("preset") as Preset) ?? "today");
  const period: Period = preset === "custom" ? { from: params.get("from")!, to: params.get("to") ?? params.get("from")! } : presetRange(preset);
  const staffId = params.get("staff") ?? "";
  const status = params.get("status") ?? "";
  const method = params.get("method") ?? "";
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const update = (changes: Record<string, string>) => {
    const next = Object.fromEntries(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    setParams(next, { replace: true });
    setPage(0);
  };
  const setPeriod = (p: Preset, range: Period) =>
    update(p === "custom" ? { preset: "", from: range.from, to: range.to } : { preset: p, from: "", to: "" });

  // The staff list is owner-only on the API; others filter via report links.
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api.get<Staff[]>("/staff"), enabled: can.isOwner });

  const query = { date_from: period.from, date_to: period.to, staff_id: staffId, status, payment_method: method };
  const sales = useQuery({
    queryKey: ["pos-sales", "journal", query, page],
    queryFn: () => api.list<PosSale>("/pos-sales", { ...query, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    const rows: PosSale[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await api.list<PosSale>("/pos-sales", { ...query, limit: 500, offset });
      rows.push(...page.rows);
      if (rows.length >= page.total || page.rows.length === 0) break;
    }
    // One line per item sold, with the receipt's details repeated, so it
    // can be filtered and summed in a spreadsheet.
    downloadCsv(`sales-journal-${period.from}-to-${period.to}.csv`, [
      ["Date & time", "Receipt", "Rung up by", "Customer", "Item", "Size", "Colour", "Price tier", "Qty", "Unit price", "Line total", "Paid by", "Status", "Voided by", "Void reason"],
      ...rows.flatMap((s) =>
        s.items.map((i) => [
          new Date(s.created_at).toLocaleString("en-GH"),
          s.id.slice(0, 8).toUpperCase(),
          s.staff_name,
          s.customer_name ?? "Walk-in",
          i.product_name ?? `${i.category_name} (quick log)`,
          i.variant_size,
          i.variant_color,
          i.price_tier,
          i.quantity,
          i.unit_price,
          i.line_total,
          s.payments.map((p) => `${METHOD_LABELS[p.method]} ${p.amount}`).join(" + "),
          s.status,
          s.voided_by_name,
          s.void_reason,
        ]),
      ),
    ]);
  };

  const data = sales.data;
  const pageTotal = (data?.rows ?? []).filter((s) => s.status !== "voided").reduce((n, s) => n + s.total, 0);

  return (
    <>
      <PageHeader
        title="Sales journal"
        description={`Every counter sale, receipt by receipt — ${describePeriod(period)}.`}
        actions={
          <Button variant="secondary" icon={Download} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <PeriodPicker preset={preset} period={period} onChange={setPeriod} />
          {can.isOwner && (
            <Select className="w-48" value={staffId} onChange={(e) => update({ staff: e.target.value })}>
              <option value="">Everyone</option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          )}
          {!can.isOwner && staffId && (
            <Button size="sm" variant="secondary" onClick={() => update({ staff: "" })}>
              Clear staff filter
            </Button>
          )}
          <Select className="w-40" value={method} onChange={(e) => update({ method: e.target.value })}>
            <option value="">Any payment</option>
            <option value="cash">Cash</option>
            <option value="mobile_money">Mobile money</option>
            <option value="card">Card</option>
            <option value="credit">On account</option>
          </Select>
          <Select className="w-36" value={status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All sales</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided only</option>
          </Select>
          {sales.isFetching && <Spinner className="h-4 w-4" />}
          {data && (
            <span className="ml-auto text-sm text-muted">
              {data.total} receipt{data.total === 1 ? "" : "s"}
              {data.total <= PAGE_SIZE && ` · ${money(pageTotal)} excluding voids`}
            </span>
          )}
        </div>

        {sales.isError ? (
          <div className="p-4">
            <ErrorState error={sales.error} />
          </div>
        ) : !data?.rows.length ? (
          <EmptyState icon={Receipt} title="No sales match" message="Try a different period or filter." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-8" />
                  <Th>When</Th>
                  <Th>Rung up by</Th>
                  <Th>Customer</Th>
                  <Th>Items</Th>
                  <Th>Paid by</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => {
                  const isOpen = open === s.id;
                  const voided = s.status === "voided";
                  const count = s.items.reduce((n, i) => n + i.quantity, 0);
                  return (
                    <Fragment key={s.id}>
                      <tr onClick={() => setOpen(isOpen ? null : s.id)} className={`cursor-pointer hover:bg-canvas/70 ${voided ? "bg-red-50/40" : ""}`}>
                        <Td className="text-muted">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Td>
                        <Td className="whitespace-nowrap">
                          <p className="font-medium">{dateTime(s.created_at)}</p>
                          <p className="font-mono text-[11px] text-muted">#{s.id.slice(0, 8).toUpperCase()}</p>
                        </Td>
                        <Td className="font-medium">{s.staff_name ?? "—"}</Td>
                        <Td className="text-muted">{s.customer_name ?? "Walk-in"}</Td>
                        <Td>
                          <p className="max-w-80 truncate">
                            {s.items.map((i) => `${i.product_name ?? i.category_name} ×${i.quantity}`).join(", ")}
                          </p>
                          <p className="text-xs text-muted">
                            {count} item{count === 1 ? "" : "s"}
                            {s.items.some((i) => !i.variant_id) && " · includes quick-logged lines"}
                          </p>
                        </Td>
                        <Td className="text-muted">{s.payments.map((p) => METHOD_LABELS[p.method]).join(" + ")}</Td>
                        <Td className="text-right">
                          {voided ? (
                            <span className="inline-flex flex-col items-end">
                              <Badge tone="red">Voided</Badge>
                              <span className="tabular text-xs text-muted line-through">{money(s.total)}</span>
                            </span>
                          ) : (
                            <span className="tabular font-semibold">{money(s.total)}</span>
                          )}
                        </Td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} className="border-b border-line bg-canvas/50 px-6 py-5">
                            <div className="grid gap-6 lg:grid-cols-3">
                              <div className="lg:col-span-2">
                                <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Items</p>
                                <table className="w-full text-sm">
                                  <thead className="text-xs text-muted">
                                    <tr>
                                      <th className="py-1 text-left font-medium">Item</th>
                                      <th className="py-1 text-left font-medium">Price</th>
                                      <th className="py-1 text-right font-medium">Qty</th>
                                      <th className="py-1 text-right font-medium">Each</th>
                                      <th className="py-1 text-right font-medium">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.items.map((i) => (
                                      <tr key={i.id} className="border-t border-line">
                                        <td className="py-2">
                                          {i.product_name ? (
                                            <>
                                              <span className="font-medium">{i.product_name}</span>
                                              <span className="text-muted"> · {[i.variant_size, i.variant_color].filter(Boolean).join(" · ")}</span>
                                            </>
                                          ) : (
                                            <>
                                              <span className="font-medium text-amber-800">{i.category_name} (quick log)</span>
                                              {i.note && <span className="text-muted"> — “{i.note}”</span>}
                                            </>
                                          )}
                                        </td>
                                        <td className="py-2 text-muted">{i.price_tier === "pack" && i.pack_size ? `Packs of ${i.pack_size}` : titleCase(i.price_tier)}</td>
                                        <td className="tabular py-2 text-right">{i.quantity}</td>
                                        <td className="tabular py-2 text-right">{money(i.unit_price)}</td>
                                        <td className="tabular py-2 text-right font-medium">{money(i.line_total)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="space-y-4 text-sm">
                                <div>
                                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Payment</p>
                                  {s.payments.map((p, idx) => (
                                    <div key={idx} className="flex justify-between">
                                      <span>{METHOD_LABELS[p.method]}</span>
                                      <span className="tabular font-medium">{money(p.amount)}</span>
                                    </div>
                                  ))}
                                  {s.customer_id && (
                                    <Link to={`/customers/${s.customer_id}`} className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline">
                                      View {s.customer_name}'s account
                                    </Link>
                                  )}
                                </div>
                                {voided && (
                                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
                                    <p className="flex items-center gap-1.5 font-semibold">
                                      <Ban className="h-4 w-4" /> Voided
                                      {s.voided_by_name && ` by ${s.voided_by_name}`}
                                    </p>
                                    {s.voided_at && <p className="text-xs">{dateTime(s.voided_at)}</p>}
                                    <p className="mt-1">{s.void_reason ? `“${s.void_reason}”` : "No reason recorded (voided before reasons were required)."}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
