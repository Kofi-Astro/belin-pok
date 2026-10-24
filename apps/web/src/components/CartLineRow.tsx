// One line of the cart -- photo, name, size/colour, line total, a quantity
// stepper and Remove. Used by both the full /cart page and the slide-out
// cart drawer (compact). Client-side because it edits the cart, which lives
// in the shopper's browser (lib/cart.tsx).
"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { type CartLine, useCart } from "@/lib/cart";
import { formatPrice, imageUrl } from "@/lib/format";

// A "− 2 +" control. Exported because the product page's buy box uses it
// too. The buttons disable at min/max rather than clamping silently, so
// it's obvious why a tap did nothing; max is the stock available.
export function QuantityStepper({
  value,
  max,
  onChange,
  min = 1,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-white">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        className="p-2 text-ink/70 hover:text-ink disabled:opacity-30"
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      {/* aria-live: screen readers announce the new number after each tap. */}
      <span className="w-8 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="p-2 text-ink/70 hover:text-ink disabled:opacity-30"
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// compact: smaller photo for the drawer, where space is tight.
export function CartLineRow({ line, compact = false }: { line: CartLine; compact?: boolean }) {
  const { setQuantity, remove } = useCart();
  // Photo width in px; the height is 1.25x (the catalogue's 4:5 photos).
  const size = compact ? 80 : 112;

  return (
    <li className="flex gap-4 py-5">
      {/* Photo and name both link back to the product page. */}
      <Link
        href={`/products/${line.productSlug}`}
        className="shrink-0 overflow-hidden rounded-xl bg-brand-50"
        style={{ width: size, height: size * 1.25 }}
      >
        {line.imagePath && (
          <Image
            src={imageUrl(line.imagePath)}
            alt={line.productName}
            width={size}
            height={size * 1.25}
            className="h-full w-full object-cover"
          />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/products/${line.productSlug}`} className="line-clamp-2 font-bold hover:text-accent">
              {line.productName}
            </Link>
            <p className="mt-0.5 text-sm text-muted">
              {[line.style, line.color, line.size].filter(Boolean).join(" · ")}
            </p>
          </div>
          {/* Line total. unitPrice is the price seen when it was added; checkout
             re-prices from the API, so this is a preview, not a promise. */}
          <p className="shrink-0 font-bold">{formatPrice(line.unitPrice * line.quantity)}</p>
        </div>
        <div className="mt-auto flex items-center justify-between pt-3">
          <QuantityStepper value={line.quantity} max={line.maxQuantity} onChange={(n) => setQuantity(line.variantId, n)} />
          <button
            type="button"
            onClick={() => remove(line.variantId)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        </div>
        {/* Explains why + stopped working: the cart can't hold more than the
           stock that was there when the item was added. */}
        {line.quantity >= line.maxQuantity && (
          <p className="mt-2 text-xs font-semibold text-accent">Only {line.maxQuantity} in stock</p>
        )}
      </div>
    </li>
  );
}
