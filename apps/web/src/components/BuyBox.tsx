// The buying panel on a product page. Client-side because it reacts to
// the shopper's choices (type, colour, size, quantity) and talks to the cart and
// the session; the product data itself arrives from the server-rendered
// page, at online prices.
"use client";

import { BellRing, Check, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { formatPrice, primaryImage, priceRange, variantPrice } from "@/lib/format";
import { session } from "@/lib/session";
import type { Product, ProductVariant } from "@/lib/types";

import { QuantityStepper } from "./CartLineRow";

// Clothing sizes in the order people expect to read them; anything else
// (numeric shoe/waist sizes, "One Size") sorts after, numbers numerically.
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL", "4XL", "5XL"];
// Sort key: [group, position, text] -- known clothing sizes first in
// their usual order, then numeric sizes by value, then anything else
// alphabetically.
function sizeRank(size: string): [number, number, string] {
  const i = SIZE_ORDER.indexOf(size.toUpperCase());
  if (i >= 0) return [0, i, size];
  const n = parseFloat(size);
  return Number.isNaN(n) ? [2, 0, size] : [1, n, size];
}
function compareSizes(a: string, b: string) {
  const [ra, rb] = [sizeRank(a), sizeRank(b)];
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
}

/** Type, colour and size pickers, price, stock, quantity and Add to cart. A
 * sold-out size offers "Notify me" instead (POST
 * /variants/{id}/notify-when-in-stock -- needs a signed-in customer). */
export function BuyBox({ product }: { product: Product }) {
  const { add, setDrawerOpen } = useCart();
  const { status } = useAuth();
  const allVariants = product.variants;

  // Types / qualities (Standard, Premium, a brand...), each priced on its
  // own. With more than one, the shopper picks a type first and the
  // colours and sizes below narrow to it; with one (or none), it's chosen
  // up front and the type picker is hidden. undefined = not chosen yet;
  // null is a real value (variants without a type, shown as "Standard").
  const styles = useMemo(() => [...new Set(allVariants.map((v) => v.style))], [allVariants]);
  const [style, setStyle] = useState<string | null | undefined>(styles.length === 1 ? styles[0] : undefined);
  const variants = useMemo(() => allVariants.filter((v) => style !== undefined && v.style === style), [allVariants, style]);
  // Cheapest price of each type, for "from ₵…" on its button.
  const typeFrom = (t: string | null) => Math.min(...allVariants.filter((v) => v.style === t).map((v) => variantPrice(product, v)));

  // The distinct colours on offer for the chosen type (null for "no
  // colour"). With one colour, it's chosen up front and the colour picker
  // is hidden.
  const colors = useMemo(() => [...new Set(variants.map((v) => v.color))], [variants]);
  const [color, setColor] = useState<string | null>(colors.length === 1 ? colors[0] : null);
  // The sizes to offer: all of them if there's one colour or none,
  // otherwise just those of the chosen colour, in size order.
  const sizesForColor = useMemo(
    () =>
      variants
        .filter((v) => colors.length <= 1 || v.color === color)
        .sort((a, b) => compareSizes(a.size, b.size)),
    [variants, colors, color],
  );
  // Pre-chosen when there's only one size ("One Size" caps, say).
  const [size, setSize] = useState<string | null>(allVariants.length === 1 ? allVariants[0].size : null);
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // The exact variant (colour + size) chosen, once both are.
  const selected: ProductVariant | undefined = sizesForColor.find((v) => v.size === size);
  const { min, max } = priceRange(product);
  // A size can have its own price; until one is chosen, the price line
  // shows the range across all sizes instead.
  const price = selected ? variantPrice(product, selected) : null;
  const image = primaryImage(product);

  const pickStyle = (t: string | null) => {
    setStyle(t);
    const ofType = allVariants.filter((v) => v.style === t);
    const typeColors = [...new Set(ofType.map((v) => v.color))];
    // Keep the colour and size if this type has them; a single colour is
    // chosen for the shopper.
    const nextColor = typeColors.length === 1 ? typeColors[0] : typeColors.includes(color) ? color : null;
    setColor(nextColor);
    if (!ofType.some((v) => v.color === nextColor && v.size === size)) setSize(null);
    setQuantity(1);
    setNotice(null);
  };

  const pickColor = (c: string | null) => {
    setColor(c);
    // Keep the chosen size if this colour has it too.
    if (!variants.some((v) => v.color === c && v.size === size)) setSize(null);
    setQuantity(1);
    setNotice(null);
  };

  // Adds the chosen variant to the cart with what the cart needs to show
  // it without another API call, including the stock (maxQuantity) that
  // caps the quantity there -- then opens the drawer as confirmation.
  const addToCart = () => {
    if (!selected) return;
    add(
      {
        variantId: selected.id,
        productSlug: product.slug,
        productName: product.name,
        size: selected.size,
        color: selected.color,
        style: selected.style,
        unitPrice: variantPrice(product, selected),
        imagePath: image?.storage_path ?? null,
        maxQuantity: selected.stock_quantity,
      },
      quantity,
    );
    setDrawerOpen(true);
  };

  // Restock alert for a sold-out size: the API notifies the customer (by
  // push on the phone app) when stock comes back in.
  const notifyMe = async () => {
    if (!selected) return;
    try {
      await session.request(`/variants/${selected.id}/notify-when-in-stock`, { method: "POST" });
      setNotice({ kind: "ok", text: "Done — we'll let you know as soon as it's back." });
    } catch {
      setNotice({ kind: "error", text: "Couldn't set that up just now. Please try again." });
    }
  };

  // A product published before any sizes were added: nothing to buy yet.
  if (allVariants.length === 0) {
    return <p className="rounded-2xl bg-brand-50 p-5 text-sm font-semibold text-brand-700">Coming soon to the shop.</p>;
  }

  return (
    <div className="space-y-7">
      <p className="text-3xl font-extrabold">
        {price !== null ? formatPrice(price) : min === max ? formatPrice(min) : `${formatPrice(min)} – ${formatPrice(max)}`}
      </p>

      {styles.length > 1 && (
        <fieldset>
          <legend className="label">
            Type{style !== undefined && <span className="ml-1 font-semibold text-muted normal-case">— {style ?? "Standard"}</span>}
          </legend>
          <div className="flex flex-wrap gap-2">
            {styles.map((t) => (
              <button
                key={t ?? "standard"}
                type="button"
                onClick={() => pickStyle(t)}
                className={`rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                  style === t ? "border-brand-900 bg-brand-900 text-white" : "border-line bg-white hover:border-ink/40"
                }`}
              >
                <span className="block font-bold">{t ?? "Standard"}</span>
                <span className={`text-xs ${style === t ? "text-white/75" : "text-muted"}`}>from {formatPrice(typeFrom(t))}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {style !== undefined && colors.length > 1 && (
        <fieldset>
          <legend className="label">
            Colour{color && <span className="ml-1 font-semibold text-muted normal-case">— {color}</span>}
          </legend>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const hex = variants.find((v) => v.color === c)?.color_hex;
              return (
                <button
                  key={c ?? "none"}
                  type="button"
                  onClick={() => pickColor(c)}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    color === c ? "border-brand-900 bg-brand-900 text-white" : "border-line bg-white hover:border-ink/40"
                  }`}
                >
                  {hex && <span className="h-4 w-4 rounded-full ring-1 ring-ink/20" style={{ background: hex }} />}
                  {c ?? "Standard"}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Sizes appear once a colour is chosen (or straight away if there's
         only one). Sold-out sizes stay visible but struck through, so the
         shopper can still pick one and ask to be notified. */}
      {style !== undefined && (colors.length <= 1 || color !== null) && (
        <fieldset>
          <legend className="label">Size</legend>
          <div className="flex flex-wrap gap-2">
            {sizesForColor.map((v) => {
              const out = v.stock_quantity === 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setSize(v.size);
                    setQuantity(1);
                    setNotice(null);
                  }}
                  className={`min-w-14 rounded-xl border px-4 py-3 text-sm font-bold transition ${
                    size === v.size
                      ? "border-brand-900 bg-brand-900 text-white"
                      : out
                        ? "border-line bg-white text-muted line-through decoration-1 hover:border-ink/30"
                        : "border-line bg-white hover:border-ink/40"
                  }`}
                  aria-label={`${v.size}${out ? " (sold out)" : ""}`}
                >
                  {v.size}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {selected && (
        <p className="flex items-center gap-2 text-sm font-semibold">
          {selected.stock_quantity === 0 ? (
            <span className="text-danger">Sold out in this size</span>
          ) : selected.stock_quantity <= selected.low_stock_threshold ? (
            <span className="text-accent">Only {selected.stock_quantity} left — order soon</span>
          ) : (
            <span className="flex items-center gap-1.5 text-success">
              <Check className="h-4 w-4" /> In stock
            </span>
          )}
        </p>
      )}

      {/* Sold out: offer a restock alert (which needs an account) instead of
         Add to cart. */}
      {selected?.stock_quantity === 0 ? (
        status === "signedIn" ? (
          <button type="button" onClick={notifyMe} className="btn-dark w-full py-4">
            <BellRing className="h-4 w-4" /> Notify me when it&apos;s back
          </button>
        ) : (
          <Link href={`/login?next=/products/${product.slug}`} className="btn-dark w-full py-4">
            <BellRing className="h-4 w-4" /> Sign in to get a restock alert
          </Link>
        )
      ) : (
        <div className="flex items-center gap-3">
          <QuantityStepper value={quantity} max={selected?.stock_quantity ?? 1} onChange={setQuantity} />
          <button type="button" onClick={addToCart} disabled={!selected} className="btn-primary flex-1 py-4">
            <ShoppingBag className="h-4 w-4" />
            {selected ? "Add to cart" : style === undefined ? "Choose a type" : colors.length > 1 && !color ? "Choose a colour" : "Choose a size"}
          </button>
        </div>
      )}

      {notice && (
        <p className={`text-sm font-semibold ${notice.kind === "ok" ? "text-success" : "text-danger"}`}>{notice.text}</p>
      )}
    </div>
  );
}
