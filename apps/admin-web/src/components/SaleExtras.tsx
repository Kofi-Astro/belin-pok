// What can happen to a till sale after it's rung up, shared by the till's
// Today's sales list (pages/Pos.tsx) and the Sales journal:
//   - ReceiptModal: an optional receipt -- printed, or sent by WhatsApp or
//     SMS. The shop doesn't usually give receipts, so nothing asks for one;
//     it's there when a customer wants it.
//   - ReturnModal: goods brought back -- which items, why, and what was
//     refunded and how (or nothing, for an exchange). POST
//     /pos-sales/{id}/returns; refunds are counted out of the drawer at
//     cash-up.
//   - SaleDiscountAndReturns: the discount (with its reason) and any
//     returns, for showing under a sale's lines.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MessageCircle, MessageSquare, Printer, Tag, Undo2 } from "lucide-react";
import { useState } from "react";

import { Modal, useToast } from "@/components/overlay";
import { useInvalidateStock } from "@/components/StockModals";
import { Button, Field, FormError, Input, Select, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, internationalPhone, money, optionLabel, saleItemName } from "@/lib/format";
import type { PaymentMethod, PosSale, StorefrontContentRead } from "@/lib/types";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  card: "Card",
  credit: "On account",
};

/** A sale's short receipt number: the first 8 characters of its id (the
 * same number the Sales journal shows). */
export const receiptNumber = (s: Pick<PosSale, "id">) => s.id.slice(0, 8).toUpperCase();

// --- receipts ---------------------------------------------------------------

type Shop = { name: string; phone: string; address: string };

/** The shop's name and contact details for the top of a receipt, from the
 * Website page's contact section (empty until it's filled in there). */
function useShop(): Shop {
  const content = useQuery({ queryKey: ["storefront"], queryFn: () => api.get<StorefrontContentRead>("/storefront"), staleTime: 5 * 60_000 });
  const contact = content.data?.content.contact;
  return { name: "Belin-Pok Menswear", phone: contact?.phone ?? "", address: contact?.address ?? "" };
}

/** The receipt as plain text -- for WhatsApp, SMS and copying. Lines read
 * "Joggers (Premium · L) x2  GH₵300.00". */
function receiptText(sale: PosSale, shop: Shop): string {
  const lines = [
    shop.name,
    ...(shop.address ? [shop.address] : []),
    ...(shop.phone ? [`Tel: ${shop.phone}`] : []),
    "",
    `Receipt #${receiptNumber(sale)}`,
    dateTime(sale.created_at),
    "",
    ...sale.items.map((i) => {
      const option = i.product_name ? optionLabel(i) : "";
      return `${saleItemName(i)}${option ? ` (${option})` : ""} x${i.quantity}  ${money(i.quantity * i.unit_price)}`;
    }),
    "",
    ...(sale.discount_total > 0 ? [`Subtotal  ${money(sale.subtotal)}`, `Discount  -${money(sale.discount_total)}`] : []),
    `TOTAL  ${money(sale.total)}`,
    ...sale.payments.map((p) => `Paid by ${PAYMENT_LABELS[p.method]}  ${money(p.amount)}`),
    ...(sale.refunded_total > 0 ? [`Refunded  -${money(sale.refunded_total)}`] : []),
    "",
    ...(sale.staff_name ? [`Served by ${sale.staff_name}`] : []),
    "Thank you for shopping with us!",
  ];
  return lines.join("\n");
}

/** Prints the receipt on whatever printer the device has -- sized for a
 * narrow receipt roll (80 mm) but fine on A4 too. A separate little window
 * rather than the admin page, so only the receipt prints. */
function printReceipt(sale: PosSale, shop: Shop) {
  const w = window.open("", "_blank", "width=420,height=640");
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const row = (left: string, right: string, bold = false) =>
    `<tr${bold ? ' class="b"' : ""}><td>${esc(left)}</td><td class="r">${esc(right)}</td></tr>`;
  const items = sale.items
    .map((i) => {
      const option = i.product_name ? optionLabel(i) : "";
      return row(`${saleItemName(i)}${option ? ` (${option})` : ""} × ${i.quantity}`, money(i.quantity * i.unit_price));
    })
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${receiptNumber(sale)}</title>
<style>
  body { font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; width: 72mm; margin: 4mm auto; color: #000; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; } p { margin: 0; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; } td { padding: 2px 0; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; padding-left: 8px; } .b td { font-weight: 700; font-size: 15px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; } .s { font-size: 11px; }
</style></head><body>
<h1>${esc(shop.name)}</h1>
${shop.address ? `<p class="s">${esc(shop.address)}</p>` : ""}${shop.phone ? `<p class="s">Tel: ${esc(shop.phone)}</p>` : ""}
<hr><p>Receipt #${receiptNumber(sale)}</p><p class="s">${esc(dateTime(sale.created_at))}</p><hr>
<table>${items}</table><hr>
<table>
${sale.discount_total > 0 ? row("Subtotal", money(sale.subtotal)) + row("Discount", `−${money(sale.discount_total)}`) : ""}
${row("TOTAL", money(sale.total), true)}
${sale.payments.map((p) => row(`Paid by ${PAYMENT_LABELS[p.method]}`, money(p.amount))).join("")}
${sale.refunded_total > 0 ? row("Refunded", `−${money(sale.refunded_total)}`) : ""}
</table><hr>
${sale.staff_name ? `<p class="s">Served by ${esc(sale.staff_name)}</p>` : ""}<p>Thank you for shopping with us!</p>
<script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
</body></html>`);
  w.document.close();
  return true;
}

/** Giving the customer a receipt, if they want one: print it, or send it
 * to their phone by WhatsApp or SMS (from this device's own apps -- nothing
 * to set up, nothing extra to pay). The number is optional: without it
 * WhatsApp asks which chat to send to. */
export function ReceiptModal({ sale, onClose }: { sale: PosSale | null; onClose: () => void }) {
  const toast = useToast();
  const shop = useShop();
  const [phone, setPhone] = useState("");
  if (!sale) return null;
  const text = encodeURIComponent(receiptText(sale, shop));
  const digits = phone.replace(/[^\d+]/g, "");
  const whatsapp = digits ? `https://wa.me/${internationalPhone(digits)}?text=${text}` : `https://wa.me/?text=${text}`;
  // "?&body=" works on both iPhone and Android messages apps.
  const sms = `sms:${digits}?&body=${text}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Receipt #${receiptNumber(sale)}`}
      description={`${money(sale.total)} · ${dateTime(sale.created_at)}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <pre className="max-h-60 overflow-y-auto rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {receiptText(sale, shop)}
        </pre>
        <Field label="Customer's phone (optional)" hint="For WhatsApp or SMS. Leave blank to choose the chat in WhatsApp.">
          <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 123 4567" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={MessageCircle} onClick={() => window.open(whatsapp, "_blank", "noopener")}>
            WhatsApp
          </Button>
          <Button variant="secondary" icon={MessageSquare} disabled={!digits} onClick={() => (window.location.href = sms)}>
            SMS
          </Button>
          <Button variant="secondary" icon={Printer} onClick={() => printReceipt(sale, shop) || toast.error("Allow pop-ups for this site to print receipts.")}>
            Print
          </Button>
          <Button
            variant="secondary"
            icon={Copy}
            onClick={() =>
              void navigator.clipboard.writeText(receiptText(sale, shop)).then(
                () => toast.success("Receipt copied"),
                () => toast.error("Couldn't copy on this device"),
              )
            }
          >
            Copy
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --- returns ----------------------------------------------------------------

/** Goods brought back. Pick how many of each item came back; the refund
 * starts at what they sold for (after any discount) and can be lowered --
 * to nothing for an exchange. Lines that don't name a product yet can't be
 * returned until they're sorted out (the API refuses them too). */
export function ReturnModal({ sale, onClose }: { sale: PosSale | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [refund, setRefund] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reason, setReason] = useState("");
  const [backToStock, setBackToStock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!sale) return null;

  const returnable = sale.items.filter((i) => i.variant_id && i.quantity - i.returned_quantity > 0);
  const unsorted = sale.items.some((i) => !i.variant_id);
  // What the chosen items sold for, after the discount: the most that can
  // be refunded, and the starting refund.
  const worth = Math.round(sale.items.reduce((n, i) => n + (quantities[i.id] ?? 0) * (i.line_total / i.quantity), 0) * 100) / 100;
  const refundAmount = refund === null ? worth : Number(refund) || 0;
  const chosen = Object.values(quantities).some((q) => q > 0);
  // The money goes back the way it came, by default.
  const methods: PaymentMethod[] = sale.customer_id ? ["cash", "mobile_money", "card", "credit"] : ["cash", "mobile_money", "card"];

  const submit = async () => {
    setError(null);
    if (reason.trim().length < 3) return setError("Say why it's being returned.");
    setBusy(true);
    try {
      await api.post(`/pos-sales/${sale.id}/returns`, {
        items: Object.entries(quantities)
          .filter(([, q]) => q > 0)
          .map(([sale_item_id, quantity]) => ({ sale_item_id, quantity })),
        refund_amount: refundAmount,
        refund_method: refundAmount > 0 ? method : null,
        reason: reason.trim(),
        back_to_stock: backToStock,
      });
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["pos-sales"] }), qc.invalidateQueries({ queryKey: ["customers"] })]);
      toast.success(refundAmount > 0 ? `Return recorded — refund ${money(refundAmount)}` : "Return recorded");
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
      title="Return items"
      description={`Receipt #${receiptNumber(sale)} · ${money(sale.total)} · ${dateTime(sale.created_at)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={Undo2} disabled={!chosen || refundAmount > worth + 0.001} loading={busy} onClick={() => void submit()}>
            Record return
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError message={error} />
        {!returnable.length ? (
          <p className="text-sm text-muted">Nothing left on this sale that can be returned.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {returnable.map((i) => {
              const left = i.quantity - i.returned_quantity;
              const q = quantities[i.id] ?? 0;
              return (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{i.product_name}</p>
                    <p className="text-xs text-muted">
                      {optionLabel(i)} · sold {i.quantity} at {money(i.line_total / i.quantity)}
                      {i.returned_quantity > 0 && ` · ${i.returned_quantity} already back`}
                    </p>
                  </div>
                  <Select
                    className="w-20"
                    value={q}
                    onChange={(e) => {
                      setQuantities({ ...quantities, [i.id]: Number(e.target.value) });
                      setRefund(null);
                    }}
                    aria-label={`How many ${i.product_name} came back`}
                  >
                    {Array.from({ length: left + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
        {unsorted && <p className="text-xs text-amber-800">Lines still to sort out (quick-logged or one amount) need their product named before they can be returned.</p>}

        {chosen && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Refund (GH₵)" hint={`They sold for ${money(worth)}. Use 0 for an exchange.`}>
                <Input type="number" min={0} max={worth} step="0.01" value={refund ?? worth.toFixed(2)} onChange={(e) => setRefund(e.target.value)} />
              </Field>
              {refundAmount > 0 && (
                <Field label="Refunded by" hint={method === "cash" ? "Taken out of the drawer — counted at cash-up." : undefined}>
                  <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                    {methods.map((m) => (
                      <option key={m} value={m}>
                        {m === "credit" ? "Off their account balance" : PAYMENT_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <Field label="Why is it coming back?">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong size, swapped for an XL" />
            </Field>
            <div className="flex items-center gap-3 text-sm">
              <Toggle checked={backToStock} onChange={setBackToStock} label="Put back in stock" />
              <span>
                <span className="font-medium">{backToStock ? "Goes back in stock" : "Not going back in stock"}</span>
                <span className="block text-xs text-muted">Switch off if it&apos;s damaged and can&apos;t be sold again.</span>
              </span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** A sale's discount (and why) and its returns, as short notes under its
 * lines. Renders nothing for a sale with neither. */
export function SaleDiscountAndReturns({ sale }: { sale: PosSale }) {
  if (!sale.discount_total && !sale.returns.length) return null;
  const names = Object.fromEntries(sale.items.map((i) => [i.id, i.product_name ?? saleItemName(i)]));
  return (
    <div className="space-y-1.5 text-sm">
      {sale.discount_total > 0 && (
        <p className="flex items-start gap-1.5 text-ink/80">
          <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
          <span>
            {money(sale.discount_total)} off {money(sale.subtotal)}
            {sale.discount_reason && <span className="text-muted"> — “{sale.discount_reason}”</span>}
          </span>
        </p>
      )}
      {sale.returns.map((r) => (
        <p key={r.id} className="flex items-start gap-1.5 text-ink/80">
          <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            {r.items.map((ri) => `${names[ri.sale_item_id] ?? "Item"} ×${ri.quantity}`).join(", ")} returned{" "}
            {r.refund_method ? `· ${money(r.refund_amount)} back by ${PAYMENT_LABELS[r.refund_method].toLowerCase()}` : "· no refund"}
            {!r.back_to_stock && " · not restocked"}
            <span className="text-muted">
              {" "}
              — “{r.reason}”{r.staff_name ? `, ${r.staff_name}` : ""}, {dateTime(r.created_at)}
            </span>
          </span>
        </p>
      ))}
    </div>
  );
}
