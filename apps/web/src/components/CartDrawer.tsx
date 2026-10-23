"use client";

import { ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useCart } from "@/lib/cart";
import { formatPrice } from "@/lib/format";

import { CartLineRow } from "./CartLineRow";

/** The cart sliding in from the right -- opened by the header's bag icon
 * and after "Add to cart", so shoppers see the item land without leaving
 * the product page. */
export function CartDrawer() {
  const { lines, subtotal, count, drawerOpen, setDrawerOpen } = useCart();
  const pathname = usePathname();

  // Close it whenever the page changes (e.g. after tapping Checkout).
  useEffect(() => setDrawerOpen(false), [pathname, setDrawerOpen]);

  // Esc closes it, like any dialog.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  // Rendered in the layout on every page, but only drawn when open.
  if (!drawerOpen) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your cart">
      {/* Dimmed backdrop; tapping it closes the drawer. */}
      <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawerOpen(false)} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <h2 className="text-lg font-extrabold">
            Your cart <span className="font-semibold text-muted">({count})</span>
          </h2>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="rounded-full p-2 hover:bg-brand-50"
            aria-label="Close cart"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <ShoppingBag className="h-12 w-12 text-brand-100" />
            <p className="font-semibold">Your cart is empty</p>
            <Link href="/shop" className="btn-dark">
              Start shopping
            </Link>
          </div>
        ) : (
          <>
            {/* The lines scroll; the subtotal and Checkout stay pinned below. */}
            <ul className="flex-1 divide-y divide-line overflow-y-auto px-6">
              {lines.map((line) => (
                <CartLineRow key={line.variantId} line={line} compact />
              ))}
            </ul>
            <div className="space-y-4 border-t border-line bg-canvas p-6">
              <div className="flex items-center justify-between text-base">
                <span className="font-semibold">Subtotal</span>
                <span className="font-extrabold">{formatPrice(subtotal)}</span>
              </div>
              <p className="text-xs text-muted">Delivery is arranged after you order. Pickup in store is free.</p>
              <Link href="/checkout" className="btn-primary w-full">
                Checkout
              </Link>
              <Link href="/cart" className="block text-center text-sm font-semibold text-brand-700 hover:underline">
                View full cart
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
