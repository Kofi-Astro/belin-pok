// The owner's activity log: everything staff did, in one timeline --
// sales, voids (with reasons), stock changes, product and price edits,
// staff changes, order updates and payments on account. For keeping an eye
// on the shop without being there.
import { useQuery } from "@tanstack/react-query";
import { Ban, Boxes, ClipboardList, HandCoins, History, Pencil, ScanBarcode, UserCog, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PeriodPicker } from "@/components/PeriodPicker";
import { Avatar, Card, EmptyState, ErrorState, PageHeader, PageLoading, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { describePeriod, type Period, type Preset, presetRange } from "@/lib/period";
import type { Activity, ActivityKind, Staff } from "@/lib/types";

const KINDS: Record<ActivityKind, { label: string; icon: LucideIcon; tone: string }> = {
  sale: { label: "Sales", icon: ScanBarcode, tone: "bg-emerald-50 text-emerald-700" },
  void: { label: "Voids", icon: Ban, tone: "bg-red-50 text-red-700" },
  stock: { label: "Stock changes", icon: Boxes, tone: "bg-sky-50 text-sky-700" },
  catalog: { label: "Product & price edits", icon: Pencil, tone: "bg-brand-50 text-brand-700" },
  order: { label: "Online orders", icon: ClipboardList, tone: "bg-amber-50 text-amber-700" },
  credit: { label: "Payments on account", icon: HandCoins, tone: "bg-teal-50 text-teal-700" },
  staff: { label: "Staff changes", icon: UserCog, tone: "bg-gray-100 text-gray-700" },
};

/** Where an entry's "View" link goes. */
function link(e: Activity): string | null {
  switch (e.reference_type) {
    case "pos_sale": {
      const day = e.at.slice(0, 10);
      return `/sales?from=${day}&to=${day}${e.kind === "void" ? "&status=voided" : ""}`;
    }
    case "products":
      return e.reference_id ? `/products/${e.reference_id}` : null;
    case "order":
      return `/orders/${e.reference_id}`;
    case "customer":
      return `/customers/${e.reference_id}`;
    case "stock_movement":
      return "/inventory?tab=movements";
    case "staff":
      return "/staff";
    case "shop_settings":
      return "/settings";
    default:
      return null;
  }
}

export function ActivityPage() {
  const [preset, setPreset] = useState<Preset>("today");
  const [period, setPeriod] = useState<Period>(presetRange("today"));
  const [staffId, setStaffId] = useState("");
  const [kind, setKind] = useState<ActivityKind | "">("");

  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api.get<Staff[]>("/staff") });
  const activity = useQuery({
    queryKey: ["activity", period, staffId],
    queryFn: () => api.get<Activity[]>("/reports/activity", { date_from: period.from, date_to: period.to, staff_id: staffId, limit: 2000 }),
  });

  if (activity.isPending) return <PageLoading />;
  if (activity.isError) return <ErrorState error={activity.error} />;

  const all = activity.data;
  const counts = all.reduce<Partial<Record<ActivityKind, number>>>((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {});
  const shown = kind ? all.filter((e) => e.kind === kind) : all;
  // Grouped by calendar day, newest first.
  const days = shown.reduce<Map<string, Activity[]>>((acc, e) => {
    const day = new Date(e.at).toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    acc.set(day, [...(acc.get(day) ?? []), e]);
    return acc;
  }, new Map());

  return (
    <>
      <PageHeader
        title="Activity log"
        description={`Everything staff did — ${describePeriod(period)}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker
              preset={preset}
              period={period}
              onChange={(p, range) => {
                setPreset(p);
                setPeriod(range);
              }}
            />
            <Select className="w-48" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Everyone</option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
            {activity.isFetching && <Spinner className="h-4 w-4" />}
          </div>
        }
      />

      {/* What kinds of things happened, at a glance -- each a filter. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {(Object.keys(KINDS) as ActivityKind[]).map((k) => {
          const { label, icon: Icon, tone } = KINDS[k];
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(active ? "" : k)}
              className={`rounded-xl border bg-white p-3 text-left shadow-xs transition ${active ? "border-brand-600 ring-2 ring-brand-100" : "border-line hover:border-ink/20"} ${
                k === "void" && counts.void ? "border-red-300" : ""
              }`}
            >
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <p className="tabular mt-2 text-xl font-bold">{counts[k] ?? 0}</p>
              <p className="text-xs text-muted">{label}</p>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={History} title="Nothing happened in this period" message={kind || staffId ? "Try clearing a filter." : undefined} />
        </Card>
      ) : (
        <div className="space-y-8">
          {[...days.entries()].map(([day, entries]) => (
            <section key={day}>
              <h2 className="mb-3 text-sm font-semibold text-muted">{day}</h2>
              <Card>
                <ol className="divide-y divide-line">
                  {entries.map((e, i) => {
                    const { icon: Icon, tone } = KINDS[e.kind];
                    const to = link(e);
                    return (
                      <li key={`${e.at}-${i}`} className={`flex gap-4 px-5 py-4 ${e.kind === "void" ? "bg-red-50/50" : ""}`}>
                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-semibold">{e.staff_name ?? "System"}</span> <span className="text-ink/80">{e.summary.charAt(0).toLowerCase() + e.summary.slice(1)}</span>
                          </p>
                          {e.detail && <p className="mt-0.5 text-sm text-muted">{e.detail}</p>}
                          <p className="mt-1 flex items-center gap-3 text-xs text-muted">
                            {new Date(e.at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}
                            {to && (
                              <Link to={to} className="font-semibold text-brand-700 hover:underline">
                                View
                              </Link>
                            )}
                          </p>
                        </div>
                        {e.amount !== null && (
                          <span className={`tabular shrink-0 text-sm font-semibold ${e.amount < 0 ? "text-red-600" : ""}`}>
                            {e.amount < 0 ? "−" : ""}
                            {money(Math.abs(e.amount))}
                          </span>
                        )}
                        {e.staff_name && <Avatar name={e.staff_name} className="hidden sm:flex" />}
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
