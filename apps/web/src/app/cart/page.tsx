"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";

import { CartLineRow } from "@/components/CartLineRow";
import { useCart } from "@/lib/cart";
import { formatPrice } from "@/lib/format";

export default function CartPage() {
  const { lines, subtotal, count } = useCart();

  return (
    <div className="container-page py-12">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Your cart</h1>

      {lines.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-dashed border-line bg-white px-6 py-20 text-center">
          <ShoppingBag className="mx-auto h-12 w-12 text-brand-100" />
          <p className="mt-4 text-lg font-bold">Your cart is empty</p>
          <Link href="/shop" className="btn-dark mt-6">
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]">
          <ul className="divide-y divide-line rounded-3xl border border-line bg-white px-6">
            {lines.map((line) => (
              <CartLineRow key={line.variantId} line={line} />
            ))}
          </ul>
          <aside className="h-fit space-y-5 rounded-3xl border border-line bg-white p-6 lg:sticky lg:top-28">
            <h2 className="text-lg font-extrabold">Order summary</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Items ({count})</dt>
                <dd className="font-semibold">{formatPrice(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Delivery</dt>
                <dd className="text-right font-semibold">Arranged after ordering</dd>
              </div>
            </dl>
            <div className="flex justify-between border-t border-line pt-4 text-base">
              <span className="font-bold">Total</span>
              <span className="font-extrabold">{formatPrice(subtotal)}</span>
            </div>
            <Link href="/checkout" className="btn-primary w-full">
              Checkout
            </Link>
            <Link href="/shop" className="block text-center text-sm font-semibold text-brand-700 hover:underline">
              Continue shopping
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
