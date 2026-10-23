// Owner-only shop settings: currently how online prices relate to
// in-store prices (see lib/pricing.ts and services/api/app/pricing.py).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, Store } from "lucide-react";
import { useEffect, useState } from "react";

import { useToast } from "@/components/overlay";
import { Button, Card, CardHeader, ErrorState, Field, FormError, Input, PageHeader, PageLoading, Select, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { applyMarkup, useShopSettings } from "@/lib/pricing";
import type { ShopSettings } from "@/lib/types";

const ROUNDING = [
  { value: 0, label: "Don't round" },
  { value: 0.5, label: "Up to the next GH₵0.50" },
  { value: 1, label: "Up to the next GH₵1" },
  { value: 5, label: "Up to the next GH₵5" },
];

const EXAMPLES = [25, 45, 85, 150, 320];

export function ShopSettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useShopSettings();
  const [percent, setPercent] = useState("");
  const [rounding, setRounding] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setPercent(String(settings.data.online_markup_percent));
    setRounding(settings.data.online_price_rounding);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.patch<ShopSettings>("/settings", { online_markup_percent: Number(percent || 0), online_price_rounding: rounding }),
    onSuccess: (s) => {
      qc.setQueryData(["shop-settings"], s);
      setError(null);
      toast.success("Online pricing saved — it applies to the shop straight away");
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (settings.isPending) return <PageLoading />;
  if (settings.isError) return <ErrorState error={settings.error} />;

  const preview = { online_markup_percent: Number(percent || 0), online_price_rounding: rounding };
  const dirty = preview.online_markup_percent !== settings.data.online_markup_percent || rounding !== settings.data.online_price_rounding;

  return (
    <>
      <PageHeader title="Shop settings" />
      <Card className="max-w-3xl">
        <CardHeader
          title="Online pricing"
          description="Prices you enter are in-store prices — what the till charges. The website and phone app charge more, to cover the cost of selling online."
        />
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <div className="space-y-4">
            <FormError message={error} />
            <Field label="Online markup (%)" hint="Added on top of every in-store price. 0 means online and in-store prices are the same.">
              <Input type="number" min={0} max={200} step="0.5" value={percent} onChange={(e) => setPercent(e.target.value)} />
            </Field>
            <Field label="Rounding" hint="Rounds online prices up to a tidy amount.">
              <Select value={rounding} onChange={(e) => setRounding(Number(e.target.value))}>
                {ROUNDING.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-muted">
              A product size can also have its own fixed online price (on its product page), which takes priority over the markup. Orders already
              placed keep the price they were placed at.
            </p>
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted">Last changed {dateTime(settings.data.updated_at)}</span>
              <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">What shoppers will pay</p>
            <Table>
              <thead>
                <tr>
                  <Th>
                    <span className="inline-flex items-center gap-1.5">
                      <Store className="h-3.5 w-3.5" /> In store
                    </span>
                  </Th>
                  <Th className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5" /> Online
                    </span>
                  </Th>
                  <Th className="text-right">Difference</Th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLES.map((p) => {
                  const online = applyMarkup(p, preview);
                  return (
                    <tr key={p}>
                      <Td className="tabular">{money(p)}</Td>
                      <Td className="tabular text-right font-semibold">{money(online)}</Td>
                      <Td className="tabular text-right text-muted">+{money(online - p)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </div>
      </Card>
    </>
  );
}
