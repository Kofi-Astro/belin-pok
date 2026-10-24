// /checkout -- turns the cart into an order. Client-side because the cart
// (lib/cart.tsx) and the session (lib/session.ts) both live in the
// browser. The API re-prices every line itself (online prices) and checks
// stock as it creates the order, so nothing here is trusted for money or
// availability -- the totals shown are a preview.
"use client";

import { Lock, Store, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { LAST_ORDER_KEY, useCart } from "@/lib/cart";
import { formatPrice, imageUrl } from "@/lib/format";
import { ApiError, session } from "@/lib/session";
import type { Address, CheckoutRequest, Order } from "@/lib/types";

// A blank delivery address; Ghana as the default country.
const emptyAddress = { label: "Home", line1: "", line2: "", city: "", state: "", postal_code: "", country: "Ghana" };

/** Checkout: who's ordering (signed in, or name + phone as a guest), pickup
 * or delivery, and a delivery address. There's no online payment yet --
 * POST /orders/checkout creates the order as "pending", and the shop
 * contacts the customer to arrange payment, which the page says plainly. */
export default function CheckoutPage() {
  const router = useRouter();
  const { lines, subtotal, clear } = useCart();
  const { status, customer } = useAuth();

  // Form state. addressId is a saved address's id, or "new" to type one in.
  const [method, setMethod] = useState<"pickup" | "delivery">("pickup");
  const [guest, setGuest] = useState({ name: "", phone: "", email: "" });
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<string>("new");
  const [address, setAddress] = useState(emptyAddress);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A signed-in customer can reuse a saved address.
  useEffect(() => {
    if (status !== "signedIn") return;
    session
      .request<Address[]>("/customers/me/addresses")
      .then((list) => {
        setSavedAddresses(list);
        const preferred = list.find((a) => a.is_default) ?? list[0];
        if (preferred) setAddressId(preferred.id);
      })
      .catch(() => {});
  }, [status]);

  // Nothing to check out -- e.g. the page was reloaded after ordering
  // (the cart is cleared once an order goes through).
  if (lines.length === 0) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="text-2xl font-extrabold">Your cart is empty</h1>
        <Link href="/shop" className="btn-dark mt-6">
          Browse the shop
        </Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Only variant ids and quantities are sent; prices are the API's job.
    const body: CheckoutRequest = {
      items: lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })),
      fulfillment_method: method,
      notes: notes.trim() || undefined,
    };
    // Guests identify themselves with a name and phone (the shop calls to
    // confirm); a signed-in customer's details come from their account.
    if (status !== "signedIn") {
      body.guest_full_name = guest.name.trim();
      body.guest_phone = guest.phone.trim();
      body.guest_email = guest.email.trim() || undefined;
    }
    // Delivery needs an address: a saved one by id, or the new one typed in
    // (blank optional fields go up as null).
    if (method === "delivery") {
      if (addressId !== "new") body.address_id = addressId;
      else
        body.address = {
          ...address,
          line2: address.line2 || null,
          state: address.state || null,
          postal_code: address.postal_code || null,
        };
    }

    setSubmitting(true);
    try {
      const order = await session.request<Order>("/orders/checkout", { method: "POST", body: JSON.stringify(body) });
      // Hand the order to the thank-you page, which reads it from here, then
      // empty the cart -- the order now holds the items.
      sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order));
      clear();
      router.push("/order-confirmed");
    } catch (err) {
      // A 409 about stock means someone else bought the last ones while this
      // cart was open -- say how to fix it. Other API errors are shown as
      // the API words them; no answer at all means a connection problem.
      setError(
        err instanceof ApiError
          ? err.status === 409 && err.message.includes("stock")
            ? `${err.message}. Please adjust your cart and try again.`
            : err.message
          : "We couldn't reach the shop. Check your connection and try again.",
      );
      setSubmitting(false);
    }
  };

  // One change handler per address field: setAddr("city") updates city.
  const setAddr = (k: keyof typeof emptyAddress) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress({ ...address, [k]: e.target.value });

  return (
    <div className="container-page py-12">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Checkout</h1>

      <form onSubmit={submit} className="mt-10 grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          {/* 1. Contact */}
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
            <h2 className="text-lg font-extrabold">1. Your details</h2>
            {status === "signedIn" && customer ? (
              <p className="mt-4 text-sm">
                Ordering as <span className="font-bold">{customer.full_name}</span>
                {customer.email && <span className="text-muted"> ({customer.email})</span>}
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">
                  No account needed.{" "}
                  <Link href="/login?next=/checkout" className="font-semibold text-brand-700 hover:underline">
                    Sign in
                  </Link>{" "}
                  to use your saved details.
                </p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="name">
                      Full name
                    </label>
                    <input id="name" required className="field" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} autoComplete="name" />
                  </div>
                  <div>
                    <label className="label" htmlFor="phone">
                      Phone
                    </label>
                    <input
                      id="phone"
                      required
                      type="tel"
                      className="field"
                      value={guest.phone}
                      onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                      autoComplete="tel"
                      placeholder="We'll call to confirm"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="email">
                      Email <span className="font-semibold text-muted normal-case">(optional)</span>
                    </label>
                    <input id="email" type="email" className="field" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} autoComplete="email" />
                  </div>
                </div>
              </>
            )}
          </section>

          {/* 2. Fulfilment */}
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
            <h2 className="text-lg font-extrabold">2. Pickup or delivery</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["pickup", Store, "Pick up in store", "Collect it from the shop"],
                  ["delivery", Truck, "Delivery", "We'll arrange it with you"],
                ] as const
              ).map(([value, Icon, title, text]) => (
                // Each option is a big tappable card; the real radio input inside is
                // visually hidden (sr-only) but still works with a keyboard and
                // screen readers.
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition ${method === value ? "border-brand-700 bg-brand-50" : "border-line hover:border-ink/30"}`}
                >
                  <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only" />
                  <Icon className="mt-0.5 h-5 w-5 text-brand-700" />
                  <span>
                    <span className="block font-bold">{title}</span>
                    <span className="text-sm text-muted">{text}</span>
                  </span>
                </label>
              ))}
            </div>

            {method === "delivery" && (
              <div className="mt-6 space-y-4">
                {/* Signed-in customers with saved addresses pick one (the default is
                   pre-selected), or choose "A new address…" to type one. */}
                {savedAddresses.length > 0 && (
                  <div>
                    <label className="label" htmlFor="saved">
                      Deliver to
                    </label>
                    <select id="saved" className="field" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                      {savedAddresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}: {a.line1}, {a.city}
                        </option>
                      ))}
                      <option value="new">A new address…</option>
                    </select>
                  </div>
                )}
                {addressId === "new" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="label" htmlFor="line1">
                        Street address
                      </label>
                      <input id="line1" required className="field" value={address.line1} onChange={setAddr("line1")} autoComplete="address-line1" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label" htmlFor="line2">
                        Landmark / directions <span className="font-semibold text-muted normal-case">(optional)</span>
                      </label>
                      <input id="line2" className="field" value={address.line2} onChange={setAddr("line2")} autoComplete="address-line2" />
                    </div>
                    <div>
                      <label className="label" htmlFor="city">
                        Town / city
                      </label>
                      <input id="city" required className="field" value={address.city} onChange={setAddr("city")} autoComplete="address-level2" />
                    </div>
                    <div>
                      <label className="label" htmlFor="state">
                        Region
                      </label>
                      <input id="state" className="field" value={address.state} onChange={setAddr("state")} autoComplete="address-level1" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 3. Notes */}
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
            <h2 className="text-lg font-extrabold">
              3. Anything we should know? <span className="text-sm font-semibold text-muted">(optional)</span>
            </h2>
            <textarea className="field mt-4 min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Best time to call, delivery instructions…" />
          </section>
        </div>

        {/* Order summary; stays in view while scrolling the form on desktop. */}
        <aside className="h-fit space-y-5 rounded-3xl border border-line bg-white p-6 lg:sticky lg:top-28">
          <h2 className="text-lg font-extrabold">Your order</h2>
          <ul className="space-y-4">
            {lines.map((l) => (
              <li key={l.variantId} className="flex gap-3">
                <div className="relative h-16 w-13 shrink-0 overflow-hidden rounded-lg bg-brand-50">
                  {l.imagePath && <Image src={imageUrl(l.imagePath)} alt="" fill sizes="52px" className="object-cover" />}
                  <span className="absolute -top-0 -right-0 rounded-bl-lg bg-ink px-1.5 text-[10px] font-bold text-white">{l.quantity}</span>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="line-clamp-1 font-semibold">{l.productName}</p>
                  <p className="text-muted">{[l.style, l.color, l.size].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="text-sm font-bold">{formatPrice(l.unitPrice * l.quantity)}</p>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t border-line pt-4 text-base">
            <span className="font-bold">Total</span>
            <span className="font-extrabold">{formatPrice(subtotal)}</span>
          </div>
          {/* Said plainly before the button, so nobody expects a payment step. */}
          <p className="rounded-xl bg-brand-50 p-4 text-xs leading-relaxed text-brand-900">
            No payment is taken online. Once you place your order we&apos;ll contact you to confirm it and arrange payment
            {method === "delivery" ? " and delivery" : ""}.
          </p>
          {error && <p className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-danger">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full py-4">
            <Lock className="h-4 w-4" /> {submitting ? "Placing your order…" : "Place order"}
          </button>
        </aside>
      </form>
    </div>
  );
}
