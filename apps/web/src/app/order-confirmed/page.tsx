// /order-confirmed -- the thank-you page after checkout. The checkout page
// saves the order the API returned into sessionStorage (under
// LAST_ORDER_KEY) and then navigates here, so this page needs no API call
// and works the same for guests, who have no account to look orders up
// in. sessionStorage is per-tab and cleared when the tab closes, so the
// receipt doesn't linger on a shared phone.
"use client";

import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LAST_ORDER_KEY } from "@/lib/cart";
import { formatPrice, imageUrl } from "@/lib/format";
import type { Order } from "@/lib/types";

export default function OrderConfirmedPage() {
  // Three states: undefined = not read yet (first render, before the
  // effect runs in the browser); null = nothing saved (e.g. the page was
  // opened directly, or in a new tab); otherwise the order to show.
  const [order, setOrder] = useState<Order | null | undefined>(undefined);

  // Read in an effect, not during render: sessionStorage only exists in
  // the browser, and reading it during the server render would fail.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(LAST_ORDER_KEY);
      setOrder(saved ? (JSON.parse(saved) as Order) : null);
    } catch {
      // Storage blocked (some private-browsing modes) or the saved value
      // is corrupt: treat it as "no recent order" rather than crashing.
      setOrder(null);
    }
  }, []);

  // Hold the space while reading storage, so the footer doesn't jump up
  // and back down on the first paint.
  if (order === undefined) return <div className="min-h-[50vh]" />;

  if (order === null) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="text-2xl font-extrabold">No recent order to show</h1>
        <p className="mt-2 text-muted">Signed-in customers can see every order in their account.</p>
        <Link href="/account" className="btn-dark mt-6">
          Go to my account
        </Link>
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl py-16">
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">Thank you — order received</h1>
        <p className="mt-3 text-muted">
          Order <span className="font-bold text-ink">{order.order_number}</span>. We&apos;ll contact you shortly to confirm it
          and arrange payment{order.fulfillment_method === "delivery" ? " and delivery" : " and pickup"}.
        </p>
      </div>

      {/* What was ordered, at the prices the API actually charged (the
          online prices -- see app/pricing.py in the API). */}
      <div className="mt-12 rounded-3xl border border-line bg-white p-6 sm:p-8">
        <ul className="divide-y divide-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 py-4">
              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-brand-50">
                {item.image_storage_path && <Image src={imageUrl(item.image_storage_path)} alt="" fill sizes="64px" className="object-cover" />}
              </div>
              <div className="flex-1 text-sm">
                <p className="font-bold">{item.product_name}</p>
                <p className="text-muted">
                  {[item.variant_style, item.variant_color, item.variant_size].filter(Boolean).join(" · ")} × {item.quantity}
                </p>
              </div>
              <p className="font-bold">{formatPrice(item.line_total)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between border-t border-line pt-4 text-lg">
          <span className="font-bold">Total</span>
          <span className="font-extrabold">{formatPrice(order.total)}</span>
        </div>
      </div>

      {/* Nudge guests towards an account, where every order and its status
          can be seen later. */}
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <Link href="/shop" className="btn-dark">
          Keep shopping
        </Link>
        <Link href="/register" className="btn-outline">
          Create an account to track orders
        </Link>
      </div>
    </div>
  );
}
