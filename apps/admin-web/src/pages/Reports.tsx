// Sales reports: the tally of what the shop sold over any period -- today's
// end-of-day figures, last week, a month, a custom range -- broken down by
// day/week/month, payment method, product, staff member and category.
// Printable (or "Save as PDF" from the print dialog) and exportable to CSV.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Ban, Banknote, Download, Printer, Receipt, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PeriodPicker } from "@/components/PeriodPicker";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoading, Select, Spinner, StatCard, Table, Tabs, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { compactNumber, money } from "@/lib/format";
import { defaultGrouping, describePeriod, type Period, type Preset, presetRange } from "@/lib/period";
import type { SalesPeriod, SalesReport } from "@/lib/types";

// How each payment method reads; "credit" is a sale put on a wholesale
// customer's account.
const METHOD_LABELS: Record<string, string> = { cash: "Cash", mobile_money: "Mobile money", card: "Card", credit: "On account" };

/** "Mon 6 Oct" for a day; "6–12 Oct" for a week; "October 2026" for a month. */
function periodLabel(p: SalesPeriod, group: SalesReport["group_by"]): string {
  const d = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T00:00:00`).toLocaleDateString("en-GH", o);
  if (group === "day") return d(p.start, { weekday: "short", day: "numeric", month: "short" });
  if (group === "month") return d(p.start, { month: "long", year: "numeric" });
  return p.start === p.end ? d(p.start, { day: "numeric", month: "short" }) : `${d(p.start, { day: "numeric", month: "short" })} – ${d(p.end, { day: "numeric", month: "short" })}`;
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  // Everything about the report comes from the URL: the preset (today,
  // this week...), custom dates, and how rows are grouped -- by default
  // whatever suits the range (days for a week, months for a year).
  const preset = (params.get("preset") as Preset) ?? "today";
  const period: Period =
    preset === "custom" ? { from: params.get("from") ?? presetRange("today").from, to: params.get("to") ?? presetRange("today").to } : presetRange(preset);
  const group = (params.get("group") as SalesReport["group_by"]) ?? defaultGrouping(period);
  // Which breakdown is shown below the tally.
  const [tab, setTab] = useState<"products" | "staff" | "categories">("products");

  // The period lives in the URL, so a report can be bookmarked or sent.
  const setPeriod = (p: Preset, range: Period) =>
    setParams(p === "custom" ? { preset: p, from: range.from, to: range.to } : { preset: p }, { replace: true });

  const report = useQuery({
    queryKey: ["sales-report", period.from, period.to, group],
    queryFn: () => api.get<SalesReport>("/reports/sales", { date_from: period.from, date_to: period.to, group_by: group }),
    placeholderData: keepPreviousData,
  });

  if (report.isPending) return <PageLoading />;
  if (report.isError) return <ErrorState error={report.error} />;
  const r = report.data;
  const t = r.totals;
  // A single day reads as an end-of-day report: no grouping control,
  // "Day total" instead of a tally.
  const singleDay = r.date_from === r.date_to;

  // CSV downloads (open in Excel/Sheets): the tally with a total row, and
  // the products sold.
  const exportTally = () =>
    downloadCsv(`sales-${r.date_from}-to-${r.date_to}.csv`, [
      ["Period", "Receipts", "Online orders", "Items", "Cash", "Mobile money", "Card", "On account", "Online", "Total", "Voids", "Voided amount"],
      ...r.periods.map((p) => [periodLabel(p, r.group_by), p.receipts, p.online_orders, p.items_sold, p.cash, p.mobile_money, p.card, p.credit, p.online_revenue, p.revenue, p.voided_count, p.voided_amount]),
      ["Total", t.receipts, t.online_orders, t.items_sold, t.by_method.cash, t.by_method.mobile_money, t.by_method.card, t.by_method.credit, t.online_revenue, t.revenue, t.voided_count, t.voided_amount],
    ]);
  const exportProducts = () =>
    downloadCsv(`products-sold-${r.date_from}-to-${r.date_to}.csv`, [
      ["Product", "Size", "Colour", "SKU", "Category", "Qty (in store)", "Qty (online)", "Qty total", "Revenue"],
      ...r.by_product.map((p) => [p.product_name, p.size, p.color, p.sku, p.category_name, p.counter_quantity, p.online_quantity, p.quantity, p.revenue]),
    ]);

  return (
    <>
      <PageHeader
        title={singleDay ? `Sales report — ${describePeriod(period)}` : "Sales report"}
        description={singleDay ? "End-of-day figures: everything sold in store and online." : describePeriod(period)}
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <PeriodPicker preset={preset} period={period} onChange={setPeriod} />
            {!singleDay && (
              <Select className="w-32" value={group} onChange={(e) => setParams({ ...Object.fromEntries(params), group: e.target.value }, { replace: true })}>
                <option value="day">By day</option>
                <option value="week">By week</option>
                <option value="month">By month</option>
              </Select>
            )}
            {report.isFetching && <Spinner className="h-4 w-4" />}
            <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      {/* Headline numbers for the whole period. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total sales"
          value={money(t.revenue)}
          sub={`In store ${money(t.counter_revenue)} · Online ${money(t.online_revenue)}`}
          icon={Banknote}
        />
        <StatCard label="Receipts" value={t.receipts} sub={`Average ${money(t.average_receipt)} · ${t.online_orders} online order${t.online_orders === 1 ? "" : "s"}`} icon={Receipt} tone="green" />
        <StatCard label="Items sold" value={compactNumber(t.items_sold)} sub="In store and online" icon={ShoppingBag} tone="amber" />
        <StatCard
          label="Voided"
          value={t.voided_count ? money(t.voided_amount) : "None"}
          sub={t.voided_count ? `${t.voided_count} sale${t.voided_count === 1 ? "" : "s"} cancelled — see the journal for reasons` : "No sales were cancelled"}
          icon={Ban}
          tone={t.voided_count ? "red" : "green"}
        />
      </div>

      {/* How the money came in -- what the till should hold vs. what's owed. */}
      <Card className="mt-6">
        <CardHeader title="Where the money came from" description="In-store takings by how customers paid, plus online orders." />
        <div className="grid divide-y divide-line sm:grid-cols-5 sm:divide-x sm:divide-y-0">
          {(["cash", "mobile_money", "card", "credit"] as const).map((m) => (
            <div key={m} className="px-5 py-4">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">{METHOD_LABELS[m]}</p>
              <p className="tabular mt-1 text-xl font-bold">{money(t.by_method[m] ?? 0)}</p>
              {/* What to check the cash drawer against at close. */}
              {m === "cash" && <p className="text-xs text-muted">From sales — see Cash-up for the drawer</p>}
              {m === "credit" && <p className="text-xs text-muted">Owed, not yet paid</p>}
            </div>
          ))}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Online orders</p>
            <p className="tabular mt-1 text-xl font-bold">{money(t.online_revenue)}</p>
            <p className="text-xs text-muted">
              {t.online_markup_earned > 0 ? `Incl. ${money(t.online_markup_earned)} online markup` : "Paid on pickup / delivery"}
            </p>
          </div>
        </div>
        {/* Money on account moves separately from sales: "given" is new credit
           sales in the period, "collected" is customers paying off what they owe. */}
        {/* Discounts are already off the takings above; refunds for returns
           are money given back later, shown separately. */}
        {(t.discounts_given > 0 || t.refunds_given > 0) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line bg-canvas/50 px-5 py-3 text-sm text-muted">
            {t.discounts_given > 0 && (
              <Link to={`/sales?from=${r.date_from}&to=${r.date_to}&only=discounted`} className="hover:text-ink">
                Discounts: <b className="text-ink">{money(t.discounts_given)}</b> off {t.discounted_receipts} receipt{t.discounted_receipts === 1 ? "" : "s"} (already taken off
                sales) →
              </Link>
            )}
            {t.refunds_given > 0 && (
              <span>
                Returns: <b className="text-ink">{money(t.refunds_given)}</b> refunded on {t.returns_count} return{t.returns_count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
        {(t.credit_collected > 0 || t.credit_given > 0) && (
          <div className="border-t border-line bg-canvas/50 px-5 py-3 text-sm text-muted">
            On account: <b className="text-ink">{money(t.credit_given)}</b> given on credit, <b className="text-ink">{money(t.credit_collected)}</b> collected from
            customers paying off balances.
          </div>
        )}
      </Card>

      {/* Bar chart, in-store and online stacked -- only when there's more
         than one period to compare. */}
      {r.periods.length > 1 && (
        <Card className="mt-6">
          <CardHeader title={`Sales by ${r.group_by}`} />
          <div className="h-64 px-2 pt-4 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.periods.map((p) => ({ ...p, label: periodLabel(p, r.group_by) }))} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#ecebef" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b6775" }} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b6775" }} tickFormatter={(v: number) => compactNumber(v)} width={44} />
                <Tooltip formatter={(v, name) => [money(Number(v)), name]} contentStyle={{ borderRadius: 10, border: "1px solid #e6e4ea", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {/* No animation: it would also be caught half-drawn when printing. */}
                <Bar dataKey="counter_revenue" name="In store" stackId="a" fill="#5b33a0" isAnimationActive={false} />
                <Bar dataKey="online_revenue" name="Online" stackId="a" fill="#d14e0f" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader
          title={singleDay ? "Day total" : `Tally by ${r.group_by}`}
          description="Every period in the range is listed — a zero row means nothing was sold."
          actions={
            <Button size="sm" variant="secondary" icon={Download} className="no-print" onClick={exportTally}>
              CSV
            </Button>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>{r.group_by === "day" ? "Day" : r.group_by === "week" ? "Week" : "Month"}</Th>
              <Th className="text-right">Receipts</Th>
              <Th className="text-right">Items</Th>
              <Th className="text-right">Cash</Th>
              <Th className="text-right">MoMo</Th>
              <Th className="text-right">Card</Th>
              <Th className="text-right">Account</Th>
              <Th className="text-right">Online</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Voids</Th>
            </tr>
          </thead>
          <tbody>
            {r.periods.map((p) => {
              // Each period's label links to the sales journal for exactly those
              // dates, to see the receipts behind the numbers.
              const drill = `/sales?from=${p.start}&to=${p.end}`; // in-store receipts for that period
              return (
                <tr key={p.start} className={p.revenue === 0 && p.voided_count === 0 ? "text-muted" : ""}>
                  <Td className="font-medium whitespace-nowrap">
                    <Link to={drill} className="hover:text-brand-700 hover:underline">
                      {periodLabel(p, r.group_by)}
                    </Link>
                  </Td>
                  {/* Receipts here = in-store receipts plus online orders. */}
                  <Td className="tabular text-right">{p.receipts + p.online_orders || "—"}</Td>
                  <Td className="tabular text-right">{p.items_sold || "—"}</Td>
                  <Td className="tabular text-right">{p.cash ? money(p.cash) : "—"}</Td>
                  <Td className="tabular text-right">{p.mobile_money ? money(p.mobile_money) : "—"}</Td>
                  <Td className="tabular text-right">{p.card ? money(p.card) : "—"}</Td>
                  <Td className="tabular text-right">{p.credit ? money(p.credit) : "—"}</Td>
                  <Td className="tabular text-right">{p.online_revenue ? money(p.online_revenue) : "—"}</Td>
                  <Td className="tabular text-right font-semibold text-ink">{money(p.revenue)}</Td>
                  <Td className="text-right">{p.voided_count ? <Badge tone="red">{`${p.voided_count} · ${money(p.voided_amount)}`}</Badge> : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
          {r.periods.length > 1 && (
            <tfoot>
              <tr className="bg-canvas/70 font-semibold">
                <Td>Total</Td>
                <Td className="tabular text-right">{t.receipts + t.online_orders}</Td>
                <Td className="tabular text-right">{t.items_sold}</Td>
                <Td className="tabular text-right">{money(t.by_method.cash ?? 0)}</Td>
                <Td className="tabular text-right">{money(t.by_method.mobile_money ?? 0)}</Td>
                <Td className="tabular text-right">{money(t.by_method.card ?? 0)}</Td>
                <Td className="tabular text-right">{money(t.by_method.credit ?? 0)}</Td>
                <Td className="tabular text-right">{money(t.online_revenue)}</Td>
                <Td className="tabular text-right">{money(t.revenue)}</Td>
                <Td className="tabular text-right">{t.voided_count ? `${t.voided_count} · ${money(t.voided_amount)}` : "—"}</Td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      <div className="mt-8">
        <div className="no-print">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "products", label: "By product", count: r.by_product.length },
              { value: "staff", label: "By staff member", count: r.by_staff.length },
              { value: "categories", label: "By category", count: r.by_category.length },
            ]}
          />
        </div>

        {tab === "products" && (
          <Card>
            <CardHeader
              title="What sold"
              description="Every item, with how many sold in store and online."
              actions={
                <Button size="sm" variant="secondary" icon={Download} className="no-print" onClick={exportProducts}>
                  CSV
                </Button>
              }
            />
            {r.by_product.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Nothing sold in this period" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th>Category</Th>
                    <Th className="text-right">In store</Th>
                    <Th className="text-right">Online</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Revenue</Th>
                    <Th className="text-right">Share</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.by_product.map((p) => (
                    <tr key={`${p.variant_id ?? p.product_name}`}>
                      <Td>
                        {/* Lines without a product (quick-logged, or rung up as one amount and
                           not broken down yet) are listed by type, in amber, without a link. */}
                        {p.product_id ? (
                          <Link to={`/products/${p.product_id}`} className="font-medium hover:text-brand-700">
                            {p.product_name}
                          </Link>
                        ) : (
                          <span className="font-medium text-amber-800">{p.product_name}</span>
                        )}
                        {(p.size || p.color) && <span className="text-muted"> · {[p.style, p.size, p.color].filter(Boolean).join(" · ")}</span>}
                        {p.sku && <p className="font-mono text-[11px] text-muted">{p.sku}</p>}
                      </Td>
                      <Td className="text-muted">{p.category_name ?? "—"}</Td>
                      <Td className="tabular text-right">{p.counter_quantity || "—"}</Td>
                      <Td className="tabular text-right">{p.online_quantity || "—"}</Td>
                      <Td className="tabular text-right font-semibold">{p.quantity}</Td>
                      <Td className="tabular text-right font-semibold">{money(p.revenue)}</Td>
                      <Td className="tabular text-right text-muted">{t.revenue ? `${((p.revenue / t.revenue) * 100).toFixed(1)}%` : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {tab === "staff" && (
          <Card>
            <CardHeader title="Who sold what" description="In-store sales by the staff member who rang them up. Online orders have no cashier." />
            {r.by_staff.length === 0 ? (
              <EmptyState icon={Receipt} title="No in-store sales in this period" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Staff member</Th>
                    <Th className="text-right">Receipts</Th>
                    <Th className="text-right">Items</Th>
                    <Th className="text-right">Sales</Th>
                    <Th className="text-right">Cash taken</Th>
                    <Th className="text-right">Discounts given</Th>
                    <Th className="text-right">Their sales voided</Th>
                    <Th className="text-right">Voids they did</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.by_staff.map((s) => (
                    <tr key={s.staff_id}>
                      <Td>
                        {/* Opens the journal filtered to this person's receipts. */}
                        <Link to={`/sales?from=${r.date_from}&to=${r.date_to}&staff=${s.staff_id}`} className="font-medium hover:text-brand-700">
                          {s.staff_name}
                        </Link>
                      </Td>
                      <Td className="tabular text-right">{s.receipts}</Td>
                      <Td className="tabular text-right">{s.items_sold}</Td>
                      <Td className="tabular text-right font-semibold">{money(s.revenue)}</Td>
                      <Td className="tabular text-right">{money(s.cash_taken)}</Td>
                      <Td className="tabular text-right">{s.discounts_given ? money(s.discounts_given) : "—"}</Td>
                      <Td className="text-right">{s.voided_count ? <Badge tone="red">{`${s.voided_count} · ${money(s.voided_amount)}`}</Badge> : "—"}</Td>
                      <Td className="text-right">{s.voids_performed ? <Badge tone="amber">{s.voids_performed}</Badge> : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {tab === "categories" && (
          <Card>
            <CardHeader title="Sales by category" />
            {r.by_category.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Nothing sold in this period" />
            ) : (
              <div className="space-y-4 p-5">
                {r.by_category.map((c) => {
                  const pct = t.revenue ? (c.revenue / t.revenue) * 100 : 0;
                  return (
                    <div key={c.category_name}>
                      <div className="mb-1.5 flex justify-between text-sm">
                        <span className="font-semibold">{c.category_name}</span>
                        <span className="tabular">
                          <span className="text-muted">{c.quantity} items · </span>
                          <b>{money(c.revenue)}</b>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>
      {/* The counting rules, printed with the report so a printout explains
         itself. */}
      <p className="mt-6 text-xs text-muted">
        In-store sales count unless voided; online orders count unless cancelled or refunded. Days run midnight to midnight, {r.timezone.replace("_", " ")} time.
      </p>
    </>
  );
}
