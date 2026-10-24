// End-of-day cash-up. At closing, whoever is on the till counts the drawer
// (and checks the mobile money and card totals); the app compares the count
// with what the till recorded and shows any shortage or surplus.
//
// What should be in the drawer = the change it started with (the float)
// + cash sales + cash repayments on account - cash refunds - cash paid out
// for shop costs. The API works this out (services/api/app/routers/
// cash_ups.py) and keeps the figures with the count.
//
// Staff count "blind": they don't see what the till expects until they've
// saved their count (the API leaves those figures out for them), so the
// count is honest rather than nudged to match. An owner sees everything,
// plus the history of past cash-ups. Counting a day again replaces the
// count, and the owner's activity log keeps both.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calculator, CheckCircle2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useState } from "react";

import { useToast } from "@/components/overlay";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, FormError, Input, PageHeader, PageLoading, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, dateTime, money } from "@/lib/format";
import { iso } from "@/lib/period";
import type { CashUp, CashUpDay, CashUpFigures, CountedMethod } from "@/lib/types";

const METHOD_LABELS: Record<CountedMethod, string> = { cash: "Cash", mobile_money: "Mobile money", card: "Card" };

// Ghana cedi notes and coins, for counting the drawer note by note.
const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];

/** "Balanced", "₵20.00 short" or "₵5.00 over", for a difference
 * (counted - expected). */
function outcome(diff: number): { label: string; tone: "green" | "red" | "amber" } {
  if (Math.abs(diff) < 0.01) return { label: "Balanced", tone: "green" };
  return diff < 0 ? { label: `${money(-diff)} short`, tone: "red" } : { label: `${money(diff)} over`, tone: "amber" };
}

const toneClass = { green: "text-emerald-700", red: "text-red-700", amber: "text-amber-700" };

export function CashUpPage() {
  const { can } = useAuth();
  const today = iso(new Date());
  const [day, setDay] = useState(today);
  // Showing the count form again over a saved cash-up ("Count again").
  const [recounting, setRecounting] = useState(false);

  const query = useQuery({
    queryKey: ["cash-up", day],
    queryFn: () => api.get<CashUpDay>("/cash-ups/day", { day }),
  });

  const pickDay = (d: string) => {
    setDay(d);
    setRecounting(false);
  };

  return (
    <>
      <PageHeader
        title="Cash-up"
        description="Close the day: count the drawer and check it against the till."
        actions={
          <Input type="date" className="w-44" value={day} max={today} onChange={(e) => e.target.value && pickDay(e.target.value)} aria-label="Day to cash up" />
        }
      />

      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data.cash_up && !recounting ? (
        <CashUpResult data={query.data} cashUp={query.data.cash_up} onRecount={() => setRecounting(true)} />
      ) : (
        <CountForm key={day} data={query.data} onSaved={() => setRecounting(false)} onCancel={query.data.cash_up ? () => setRecounting(false) : undefined} />
      )}

      {can.isOwner && <History onPick={pickDay} />}
    </>
  );
}

// --- counting ---------------------------------------------------------------

function CountForm({ data, onSaved, onCancel }: { data: CashUpDay; onSaved: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const previous = data.cash_up;
  const figures = data.figures;
  // Start from the earlier count when counting again, otherwise from the
  // float yesterday's cash-up left in the drawer.
  const [float, setFloat] = useState(String(previous?.opening_float ?? data.suggested_opening_float ?? 0));
  const [paidOut, setPaidOut] = useState(previous?.paid_out ? String(previous.paid_out) : "");
  const [paidOutNote, setPaidOutNote] = useState(previous?.paid_out_note ?? "");
  const [cash, setCash] = useState("");
  const [momo, setMomo] = useState("");
  const [card, setCard] = useState("");
  const [left, setLeft] = useState(previous?.left_in_drawer != null ? String(previous.left_in_drawer) : "");
  const [note, setNote] = useState(previous?.note ?? "");
  const [byNotes, setByNotes] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Card only matters to a shop that takes cards: offer it when there were
  // card sales (owners can see that) or it was counted before.
  const [showCard, setShowCard] = useState(!!previous?.counted_card || (figures?.money_in.card ?? 0) > 0);

  const notesTotal = DENOMINATIONS.reduce((n, d) => n + d * (Number(notes[d]) || 0), 0);
  const countedCash = byNotes ? Math.round(notesTotal * 100) / 100 : Number(cash);

  const save = useMutation({
    mutationFn: () =>
      api.post<CashUp>("/cash-ups", {
        business_date: data.business_date,
        opening_float: Number(float) || 0,
        paid_out: Number(paidOut) || 0,
        paid_out_note: paidOutNote.trim() || null,
        counted_cash: countedCash,
        counted_mobile_money: momo === "" ? null : Number(momo),
        counted_card: !showCard || card === "" ? null : Number(card),
        left_in_drawer: left === "" ? null : Number(left),
        note: note.trim() || null,
      }),
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ["cash-up"] });
      await qc.invalidateQueries({ queryKey: ["cash-ups"] });
      const o = outcome(saved.total_difference);
      toast.success(`Cash-up saved: ${o.tone === "green" ? "balanced" : o.label}`);
      onSaved();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!byNotes && cash === "") return setError("Enter the cash you counted.");
    if (Number(paidOut) > 0 && paidOutNote.trim().length < 3) return setError("Say what the cash paid out was for.");
    if (left !== "" && Number(left) > countedCash) return setError("You can't leave more in the drawer than you counted.");
    save.mutate();
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader
          title={previous ? "Count again" : `Count for ${date(data.business_date)}`}
          description={figures ? undefined : "Count first — you'll see what the till expected once you save."}
        />
        <form onSubmit={submit} className="space-y-6 p-5">
          <FormError message={error} />

          {/* 1. What the drawer started with, and what came out of it. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Change in the drawer at opening (GH₵)" hint="The float. Filled in from yesterday's cash-up.">
              <Input type="number" min={0} step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} />
            </Field>
            <Field label="Cash paid out today (GH₵)" hint="Taken from the drawer for shop costs, if any.">
              <Input type="number" min={0} step="0.01" value={paidOut} placeholder="0" onChange={(e) => setPaidOut(e.target.value)} />
            </Field>
            {Number(paidOut) > 0 && (
              <Field label="What was it for?" className="sm:col-span-2">
                <Input value={paidOutNote} onChange={(e) => setPaidOutNote(e.target.value)} placeholder="e.g. Transport for stock, water" />
              </Field>
            )}
          </div>

          {/* 2. The count itself: a total, or note by note. */}
          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Cash in the drawer now</p>
              <Button type="button" size="sm" variant="ghost" icon={byNotes ? ChevronUp : ChevronDown} onClick={() => setByNotes(!byNotes)}>
                {byNotes ? "Enter a total instead" : "Count note by note"}
              </Button>
            </div>
            {byNotes ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {DENOMINATIONS.map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm">
                      <span className="tabular w-16 shrink-0 text-right font-semibold">{d >= 1 ? `₵${d}` : `${Math.round(d * 100)}p`}</span>
                      <span className="text-muted">×</span>
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="h-9"
                        value={notes[d] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [d]: e.target.value })}
                        aria-label={`Number of ${d >= 1 ? `₵${d}` : `${Math.round(d * 100)} pesewa`} ${d >= 1 && d !== 2 && d !== 1 ? "notes" : "coins"}`}
                      />
                    </label>
                  ))}
                </div>
                <p className="flex justify-between border-t border-line pt-3 font-semibold">
                  <span>Total counted</span>
                  <span className="tabular text-lg">{money(notesTotal)}</span>
                </p>
              </div>
            ) : (
              <Input type="number" min={0} step="0.01" className="h-12 text-lg font-semibold" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" autoFocus />
            )}
          </div>

          {/* 3. Mobile money and card: optional checks against statements. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile money received today (GH₵)" hint="From the MoMo phone or statement. Leave blank to skip.">
              <Input type="number" min={0} step="0.01" value={momo} onChange={(e) => setMomo(e.target.value)} />
            </Field>
            {showCard ? (
              <Field label="Card payments today (GH₵)" hint="From the card machine's end-of-day slip.">
                <Input type="number" min={0} step="0.01" value={card} onChange={(e) => setCard(e.target.value)} />
              </Field>
            ) : (
              <div className="flex items-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCard(true)}>
                  + We take cards too
                </Button>
              </div>
            )}
          </div>

          {/* 4. Closing up. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Leaving in the drawer for tomorrow (GH₵)" hint="Tomorrow's float. The rest is taken away or banked.">
              <Input type="number" min={0} step="0.01" value={left} onChange={(e) => setLeft(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the owner should know" />
            </Field>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button type="submit" icon={Calculator} loading={save.isPending}>
              Save cash-up
            </Button>
          </div>
        </form>
      </Card>

      {/* Owners see what the till expects while counting; staff don't. */}
      {figures ? (
        <TillFigures figures={figures} float={Number(float) || 0} paidOut={Number(paidOut) || 0} />
      ) : (
        <Card className="self-start p-5 text-sm text-muted">
          <p className="font-semibold text-ink">Why can&apos;t I see the till total?</p>
          <p className="mt-1">Counting before you see the expected amount keeps the count honest. Everything shows as soon as you save.</p>
        </Card>
      )}
    </div>
  );
}

/** What the till recorded for the day, and from it what each drawer or
 * account should hold. */
function TillFigures({ figures, float, paidOut }: { figures: CashUpFigures; float: number; paidOut: number }) {
  const rows: [string, number][] = [
    ["Change at opening", float],
    ["Cash sales", figures.sales_by_method.cash],
    ["Cash paid back on account", figures.repayments_by_method.cash],
    ["Cash refunds", -figures.refunds_by_method.cash],
    ["Paid out", -paidOut],
  ];
  return (
    <Card className="self-start">
      <CardHeader title="What the till recorded" description={`${figures.receipts} receipt${figures.receipts === 1 ? "" : "s"} · ${money(figures.takings)} taken`} />
      <dl className="space-y-1.5 px-5 py-4 text-sm">
        {rows
          .filter(([, n], i) => i < 2 || n !== 0)
          .map(([label, n]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular">{n < 0 ? `− ${money(-n)}` : money(n)}</dd>
            </div>
          ))}
        <div className="flex justify-between border-t border-line pt-2 font-semibold">
          <dt>Cash expected in the drawer</dt>
          <dd className="tabular">{money(float + figures.money_in.cash - paidOut)}</dd>
        </div>
        <div className="flex justify-between pt-2">
          <dt className="text-muted">Mobile money expected</dt>
          <dd className="tabular">{money(figures.money_in.mobile_money)}</dd>
        </div>
        {figures.money_in.card > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">Card expected</dt>
            <dd className="tabular">{money(figures.money_in.card)}</dd>
          </div>
        )}
        {figures.sales_by_method.credit > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">Sold on account (not collected)</dt>
            <dd className="tabular">{money(figures.sales_by_method.credit)}</dd>
          </div>
        )}
        {figures.discounts > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">Discounts given</dt>
            <dd className="tabular">{money(figures.discounts)}</dd>
          </div>
        )}
        {figures.voided_count > 0 && <p className="pt-1 text-xs text-muted">{figures.voided_count} sale(s) voided today — already left out.</p>}
      </dl>
    </Card>
  );
}

// --- the result -------------------------------------------------------------

function CashUpResult({ data, cashUp, onRecount }: { data: CashUpDay; cashUp: CashUp; onRecount: () => void }) {
  const overall = outcome(cashUp.total_difference);
  const lines: { method: CountedMethod; expected: number; counted: number | null; diff: number | null }[] = [
    { method: "cash", expected: cashUp.expected_cash, counted: cashUp.counted_cash, diff: cashUp.cash_difference },
    { method: "mobile_money", expected: cashUp.expected_mobile_money, counted: cashUp.counted_mobile_money, diff: cashUp.mobile_money_difference },
    { method: "card", expected: cashUp.expected_card, counted: cashUp.counted_card, diff: cashUp.card_difference },
  ];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-5">
          {overall.tone === "green" ? <CheckCircle2 className="h-10 w-10 text-emerald-600" /> : <AlertTriangle className={`h-10 w-10 ${toneClass[overall.tone]}`} />}
          <div className="min-w-0 flex-1">
            <p className={`text-xl font-bold sm:text-2xl ${toneClass[overall.tone]}`}>{overall.label}</p>
            <p className="text-sm text-muted">
              {date(cashUp.business_date)} · counted by {cashUp.counted_by_name ?? "someone"} at {dateTime(cashUp.updated_at)}
            </p>
          </div>
          <Button variant="secondary" icon={RotateCcw} onClick={onRecount}>
            Count again
          </Button>
        </div>
        {data.changed_since && (
          <p className="flex items-start gap-2 border-b border-line bg-amber-50 px-5 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Sales for this day have changed since it was counted (a sale added, voided or deleted). Count again to check against the till as it is now.
          </p>
        )}
        <Table>
          <thead>
            <tr>
              <Th />
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Counted</Th>
              <Th className="text-right">Difference</Th>
            </tr>
          </thead>
          <tbody>
            {lines
              .filter((l) => l.counted !== null || l.expected > 0)
              .map((l) => (
                <tr key={l.method}>
                  <Td className="font-semibold">{METHOD_LABELS[l.method]}</Td>
                  <Td className="tabular text-right">{money(l.expected)}</Td>
                  <Td className="tabular text-right">{l.counted === null ? <span className="text-muted">not checked</span> : money(l.counted)}</Td>
                  <Td className={`tabular text-right font-semibold whitespace-nowrap ${l.diff === null ? "" : toneClass[outcome(l.diff).tone]}`}>
                    {l.diff === null ? "—" : outcome(l.diff).label}
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
        <dl className="grid gap-x-6 gap-y-1.5 border-t border-line px-5 py-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between">
            <dt className="text-muted">Change at opening</dt>
            <dd className="tabular">{money(cashUp.opening_float)}</dd>
          </div>
          {cashUp.paid_out > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Paid out</dt>
              <dd className="tabular text-right">
                {money(cashUp.paid_out)} <span className="text-muted">({cashUp.paid_out_note})</span>
              </dd>
            </div>
          )}
          {cashUp.left_in_drawer !== null && (
            <div className="flex justify-between">
              <dt className="text-muted">Left for tomorrow</dt>
              <dd className="tabular">{money(cashUp.left_in_drawer)}</dd>
            </div>
          )}
          {cashUp.left_in_drawer !== null && (
            <div className="flex justify-between">
              <dt className="text-muted">To take away / bank</dt>
              <dd className="tabular font-semibold">{money(cashUp.counted_cash - cashUp.left_in_drawer)}</dd>
            </div>
          )}
          {cashUp.note && <p className="pt-1 text-muted sm:col-span-2">Note: {cashUp.note}</p>}
        </dl>
      </Card>
      {data.figures && <TillFigures figures={data.figures} float={cashUp.opening_float} paidOut={cashUp.paid_out} />}
    </div>
  );
}

// --- history (owner) --------------------------------------------------------

function History({ onPick }: { onPick: (day: string) => void }) {
  const history = useQuery({ queryKey: ["cash-ups"], queryFn: () => api.get<CashUp[]>("/cash-ups") });
  const rows = history.data ?? [];
  const short = rows.filter((c) => c.total_difference <= -0.01).reduce((n, c) => n + c.total_difference, 0);
  return (
    <Card className="mt-8">
      <CardHeader
        title="Past cash-ups"
        description={rows.length ? `${rows.length} day${rows.length === 1 ? "" : "s"} counted${short ? ` · ${money(-short)} short in total` : ""}` : undefined}
      />
      {!rows.length ? (
        <EmptyState icon={Calculator} title="No cash-ups yet" message="Each day's count will be listed here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>Counted by</Th>
              <Th className="text-right">Cash</Th>
              <Th className="text-right">Mobile money</Th>
              <Th className="text-right">Overall</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const o = outcome(c.total_difference);
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-canvas" onClick={() => onPick(c.business_date)}>
                  <Td className="font-medium">{date(c.business_date)}</Td>
                  <Td className="text-muted">{c.counted_by_name}</Td>
                  <Td className={`tabular text-right ${toneClass[outcome(c.cash_difference).tone]}`}>{outcome(c.cash_difference).label}</Td>
                  <Td className={`tabular text-right ${c.mobile_money_difference === null ? "text-muted" : toneClass[outcome(c.mobile_money_difference).tone]}`}>
                    {c.mobile_money_difference === null ? "—" : outcome(c.mobile_money_difference).label}
                  </Td>
                  <Td className="text-right">
                    <Badge tone={o.tone}>{o.label}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
