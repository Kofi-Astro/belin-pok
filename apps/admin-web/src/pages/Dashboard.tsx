// The dashboard -- the first page after signing in. A quick read on how the
// shop is doing over the last 7, 30 or 90 days: revenue and items sold
// (counter and online together), money owed on account, what's running
// low, best sellers, and the latest stock changes. For a full breakdown
// of a day, week or any range, there's Sales reports (Reports.tsx); this
// page links to today's.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, Boxes, HandCoins, PackageMinus, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Thumb } from "@/components/bits";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageLoading, StatCard } from "@/components/ui";
import { api } from "@/lib/api";
import { compactNumber, money, timeAgo, titleCase } from "@/lib/format";
import type { DailySales, Dashboard, LowStockRow, StockMovement } from "@/lib/types";

// The periods on offer, in days.
const PERIODS = [7, 30, 90] as const;

// One colour per price tier, for the tier bars.
const TIER_COLORS: Record<string, string> = { retail: "#5b33a0", wholesale: "#d14e0f", pack: "#d4a017" };

export function DashboardPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);

  // Four independent requests, so one slow panel doesn't hold up the rest:
  // the headline numbers, sales per day (for the chart), the low-stock list
  // and the latest stock movements.
  const dashboard = useQuery({ queryKey: ["dashboard", days], queryFn: () => api.get<Dashboard>("/reports/dashboard", { days }) });
  const daily = useQuery({ queryKey: ["daily-sales", days], queryFn: () => api.get<DailySales[]>("/reports/daily-sales", { days }) });
  const lowStock = useQuery({ queryKey: ["low-stock"], queryFn: () => api.get<LowStockRow[]>("/variants/low-stock") });
  const activity = useQuery({
    queryKey: ["movements", "recent"],
    queryFn: () => api.get<StockMovement[]>("/stock-movements", { limit: 8 }),
  });

  if (dashboard.isPending) return <PageLoading />;
  if (dashboard.isError) return <ErrorState error={dashboard.error} />;
  const d = dashboard.data;

  // The daily report only lists days that had sales; fill the gaps with
  // zero so the chart's x-axis is an honest calendar.
  const byDay = new Map((daily.data ?? []).map((s) => [s.day, s]));
  const series = Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, revenue: byDay.get(day)?.total_amount ?? 0, items: byDay.get(day)?.items_sold ?? 0 };
  });
  // The last point is today, for the "Today:" line on the stat cards.
  const today = series[series.length - 1];
  // The report lists counter and online retail separately (both tier
  // "retail"); one bar per tier is what's useful here.
  const tiers = Object.values(
    d.revenue_by_tier.reduce<Record<string, { price_tier: string; items_sold: number; revenue: number }>>((acc, t) => {
      const cur = (acc[t.price_tier] ??= { price_tier: t.price_tier, items_sold: 0, revenue: 0 });
      cur.items_sold += t.items_sold;
      cur.revenue += t.revenue;
      return acc;
    }, {}),
  ).sort((a, b) => b.revenue - a.revenue);
  const tierTotal = tiers.reduce((n, t) => n + t.revenue, 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How the shop is doing — sales, stock and money owed."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/reports?preset=today" className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold shadow-xs hover:bg-canvas">
              Today&apos;s report
            </Link>
          <div className="flex rounded-lg border border-line bg-white p-0.5 shadow-xs">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDays(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${days === p ? "bg-brand-700 text-white" : "text-muted hover:text-ink"}`}
              >
                {p} days
              </button>
            ))}
          </div>
          </div>
        }
      />

      {/* A to-do: till lines that don't name a product yet (quick-logged, or a
         basket rung up as one amount). Sorted out from the Point of sale page. */}
      {d.unidentified_item_count > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <b>{d.unidentified_item_count}</b> sale {d.unidentified_item_count === 1 ? "line still needs" : "lines still need"} sorting out
            (quick-logged or rung up as one amount), so stock for them hasn&apos;t been deducted yet.
          </span>
          <Link to="/pos" className="ml-auto font-semibold whitespace-nowrap underline">
            Review
          </Link>
        </div>
      )}

      {/* Headline numbers. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Revenue · ${days}d`} value={money(d.gross_revenue)} sub={`Today: ${money(today?.revenue ?? 0)}`} icon={Banknote} />
        <StatCard label={`Items sold · ${days}d`} value={compactNumber(d.items_sold)} sub={`Today: ${today?.items ?? 0}`} icon={ShoppingBag} tone="green" />
        <StatCard
          label="Credit outstanding"
          value={money(d.total_outstanding_credit)}
          sub={`${d.aged_debtors.length} account${d.aged_debtors.length === 1 ? "" : "s"} owing`}
          icon={HandCoins}
          tone="amber"
        />
        <StatCard label="Low on stock" value={d.low_stock_count} sub="SKUs at or under their threshold" icon={PackageMinus} tone={d.low_stock_count ? "red" : "green"} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Revenue" description={`Daily, last ${days} days — counter and online combined`} />
          <div className="h-72 px-2 pt-4 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              {/* isAnimationActive={false} on the Area: the chart draws in full at
                 once instead of animating in (cleaner on a slow phone). */}
              <AreaChart data={series} margin={{ left: 8, right: 16, top: 8 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5b33a0" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#5b33a0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#ecebef" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#6b6775" }}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}
                  minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b6775" }} tickFormatter={(v: number) => compactNumber(v)} width={44} />
                <Tooltip
                  formatter={(v) => [money(Number(v)), "Revenue"]}
                  labelFormatter={(v) => new Date(String(v)).toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" })}
                  contentStyle={{ borderRadius: 10, border: "1px solid #e6e4ea", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#5b33a0" strokeWidth={2} fill="url(#rev)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Revenue by price tier" description="Counter and online sales" />
          <div className="space-y-5 p-5">
            {tiers.length === 0 && <p className="text-sm text-muted">No sales in this period.</p>}
            {/* One bar per tier (retail, wholesale, pack), as a share of revenue. */}
            {tiers.map((t) => {
              const pct = tierTotal ? (t.revenue / tierTotal) * 100 : 0;
              return (
                <div key={t.price_tier}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{titleCase(t.price_tier)}</span>
                    <span className="tabular font-semibold">{money(t.revenue)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TIER_COLORS[t.price_tier] }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {t.items_sold} items · {pct.toFixed(0)}%
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Best sellers" description={`Top items, last ${days} days`} />
          {d.top_variants.length === 0 ? (
            <EmptyState icon={ShoppingBag} title="No sales yet" />
          ) : (
            <ol className="divide-y divide-line">
              {d.top_variants.map((v, i) => (
                <li key={v.variant_id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="tabular w-5 text-xs font-bold text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{v.product_name}</p>
                    <p className="text-xs text-muted">{[v.size, v.color].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold">{money(v.revenue)}</p>
                    <p className="tabular text-xs text-muted">{v.units_sold} sold</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader title="Running low" actions={<Link to="/inventory?stock=low" className="text-xs font-semibold text-brand-700 hover:underline">View all</Link>} />
          {!lowStock.data?.length ? (
            <EmptyState icon={Boxes} title="Everything's well stocked" />
          ) : (
            <ul className="divide-y divide-line">
              {lowStock.data.slice(0, 6).map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Thumb path={v.image_storage_path} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/products/${v.product_id}`} className="block truncate font-medium hover:text-brand-700">
                      {v.product_name}
                    </Link>
                    <p className="text-xs text-muted">{[v.size, v.color].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Badge tone={v.stock_quantity === 0 ? "red" : "amber"}>{v.stock_quantity === 0 ? "Out" : `${v.stock_quantity} left`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          {/* Who owes, and for how long -- red past 30 days. "Days outstanding" is
             counted from the oldest charge not yet covered by payments. */}
          <CardHeader title="Credit owed" description="Wholesale accounts, longest unpaid first" />
          {d.aged_debtors.length === 0 ? (
            <EmptyState icon={HandCoins} title="Nobody owes anything" />
          ) : (
            <ul className="divide-y divide-line">
              {d.aged_debtors.slice(0, 6).map((a) => (
                <li key={a.customer_id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link to={`/customers/${a.customer_id}`} className="block truncate font-medium hover:text-brand-700">
                      {a.business_name || a.customer_name}
                    </Link>
                    <p className="text-xs text-muted">
                      {a.days_outstanding !== null ? `${a.days_outstanding} days outstanding` : "—"} · limit {money(a.credit_limit)}
                    </p>
                  </div>
                  <span className={`tabular font-semibold ${(a.days_outstanding ?? 0) > 30 ? "text-red-600" : ""}`}>{money(a.outstanding_balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent stock activity" actions={<Link to="/inventory?tab=movements" className="text-xs font-semibold text-brand-700 hover:underline">Full history</Link>} />
        {!activity.data?.length ? (
          <EmptyState icon={Boxes} title="No stock activity yet" />
        ) : (
          <ul className="divide-y divide-line">
            {activity.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                {/* Green arrow up for stock in, red arrow down for stock out. */}
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${m.quantity_change > 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                  {m.quantity_change > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.product_name} <span className="font-normal text-muted">· {[m.variant_size, m.variant_color].filter(Boolean).join(" · ")}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {titleCase(m.movement_type)}
                    {m.performed_by_name ? ` by ${m.performed_by_name}` : m.reference_type === "order" ? " · online order" : ""} · {timeAgo(m.created_at)}
                  </p>
                </div>
                <span className={`tabular font-semibold ${m.quantity_change > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {m.quantity_change > 0 ? "+" : ""}
                  {m.quantity_change}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
