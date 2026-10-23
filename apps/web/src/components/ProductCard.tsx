import Image from "next/image";
import Link from "next/link";

import { formatPrice, imageUrl, priceRange, totalStock } from "@/lib/format";
import type { Product } from "@/lib/types";

// Products added in the last three weeks get a "New" badge.
const NEW_FOR_DAYS = 21;

/** One product in a grid: photo (a second photo on hover, when there is
 * one), name, price -- or a "from" price when sizes are priced
 * differently -- and a badge for new or sold-out items. */
export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  // Cover photo first; the second photo (if any) is shown on hover.
  const [first, second] = [...product.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const { min, max } = priceRange(product);
  // Sold out = has sizes, all at zero (a product with no sizes yet isn't
  // "sold out", just not ready).
  const soldOut = product.variants.length > 0 && totalStock(product) === 0;
  const isNew = Date.now() - new Date(product.created_at).getTime() < NEW_FOR_DAYS * 86_400_000;
  // Distinct colour swatches to hint at the range on offer.
  const colors = [...new Set(product.variants.map((v) => v.color_hex).filter(Boolean))] as string[];

  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-brand-50">
        {first ? (
          <>
            <Image
              src={imageUrl(first.storage_path)}
              alt={first.alt_text ?? product.name}
              fill
              priority={priority}
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              className={`object-cover transition duration-500 group-hover:scale-[1.03] ${second ? "group-hover:opacity-0" : ""} ${soldOut ? "opacity-60" : ""}`}
            />
            {second && (
              <Image
                src={imageUrl(second.storage_path)}
                alt=""
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                className="object-cover opacity-0 transition duration-500 group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-brand-700/40">No photo</div>
        )}
        {/* Badge: Sold out takes precedence over New. */}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {soldOut ? (
            <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold text-white">Sold out</span>
          ) : (
            isNew && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-brand-700 shadow-sm">New</span>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1 px-0.5">
        {product.brand && <p className="text-[11px] font-bold tracking-wider text-muted uppercase">{product.brand}</p>}
        <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-ink group-hover:text-accent">{product.name}</h3>
        <p className="text-sm font-extrabold">
          {/* Sizes priced differently: show the cheapest, as "From". */}
          {min !== max && <span className="font-semibold text-muted">From </span>}
          {formatPrice(min)}
        </p>
        {colors.length > 1 && (
          <div className="flex gap-1 pt-1" aria-label={`${colors.length} colours`}>
            {colors.slice(0, 5).map((hex) => (
              <span key={hex} className="h-3 w-3 rounded-full ring-1 ring-ink/15" style={{ background: hex }} />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// The responsive grid of cards: 2 across on phones, 3 on tablets, 4 on
// desktop. priorityCount: how many of the first photos to load straight
// away (those visible without scrolling); the rest load lazily.
export function ProductGrid({ products, priorityCount = 0 }: { products: Product[]; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} />
      ))}
    </div>
  );
}
