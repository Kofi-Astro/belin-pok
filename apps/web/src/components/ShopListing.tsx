import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { getProducts } from "@/lib/catalog";
import type { Category, ProductSort } from "@/lib/types";

import { ProductGrid } from "./ProductCard";

const PAGE_SIZE = 24;

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name", label: "Name A–Z" },
];

export type ShopParams = { q?: string; sort?: string; min?: string; max?: string; in_stock?: string; page?: string };

function parse(params: ShopParams) {
  const num = (v?: string) => (v && !Number.isNaN(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
  return {
    q: params.q?.trim() || undefined,
    sort: (SORTS.some((s) => s.value === params.sort) ? params.sort : "newest") as ProductSort,
    min: num(params.min),
    max: num(params.max),
    inStock: params.in_stock === "1",
    page: Math.max(1, Math.floor(num(params.page) ?? 1)),
  };
}

/** The product listing behind /shop and /category/[slug]. Everything is
 * driven by the URL's query string -- filters are a plain GET form -- so
 * any filtered view is a link that can be shared or bookmarked, and the
 * page works before any JavaScript loads. */
export async function ShopListing({
  params,
  basePath,
  title,
  description,
  category,
  categories,
}: {
  params: ShopParams;
  basePath: string;
  title: string;
  description?: string;
  category?: Category;
  categories: Category[];
}) {
  const f = parse(params);
  const { products, total } = await getProducts({
    categoryId: category?.id,
    search: f.q,
    minPrice: f.min,
    maxPrice: f.max,
    inStockOnly: f.inStock,
    sort: f.sort,
    limit: PAGE_SIZE,
    offset: (f.page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (overrides: Partial<Record<keyof ShopParams, string | undefined>>) => {
    const qs = new URLSearchParams();
    const merged = {
      q: f.q,
      sort: f.sort === "newest" ? undefined : f.sort,
      min: f.min?.toString(),
      max: f.max?.toString(),
      in_stock: f.inStock ? "1" : undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const filters = (
    <form action={basePath} className="space-y-8">
      {f.q && <input type="hidden" name="q" value={f.q} />}
      <div>
        <h3 className="label">Sort by</h3>
        <select name="sort" defaultValue={f.sort} className="field">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <h3 className="label">Price (GH₵)</h3>
        <div className="flex items-center gap-2">
          <input name="min" type="number" min={0} inputMode="numeric" placeholder="Min" defaultValue={f.min} className="field" />
          <span className="text-muted">–</span>
          <input name="max" type="number" min={0} inputMode="numeric" placeholder="Max" defaultValue={f.max} className="field" />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
        <input type="checkbox" name="in_stock" value="1" defaultChecked={f.inStock} className="h-4 w-4 accent-brand-700" />
        In stock only
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn-dark flex-1">
          Apply
        </button>
        <Link href={f.q ? `${basePath}?q=${encodeURIComponent(f.q)}` : basePath} className="btn-outline">
          Reset
        </Link>
      </div>
    </form>
  );

  return (
    <div className="container-page py-10">
      <nav className="mb-6 text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        <span className="mx-2">/</span>
        {category ? (
          <>
            <Link href="/shop" className="hover:text-ink">
              Shop
            </Link>
            <span className="mx-2">/</span>
            <span className="text-ink">{category.name}</span>
          </>
        ) : (
          <span className="text-ink">Shop</span>
        )}
      </nav>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{f.q ? `Results for “${f.q}”` : title}</h1>
          {description && !f.q && <p className="mt-2 max-w-2xl text-muted">{description}</p>}
        </div>
        <p className="text-sm font-semibold text-muted">
          {total} {total === 1 ? "product" : "products"}
        </p>
      </div>

      {/* Category chips: quick hops between categories on any screen size. */}
      <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1">
        <Link
          href={f.q ? `/shop?q=${encodeURIComponent(f.q)}` : "/shop"}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${!category ? "border-brand-900 bg-brand-900 text-white" : "border-line bg-white hover:border-ink/40"}`}
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${category?.id === c.id ? "border-brand-900 bg-brand-900 text-white" : "border-line bg-white hover:border-ink/40"}`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
        <aside className="hidden lg:block">{filters}</aside>
        {/* Small screens: the same form, folded away behind a toggle --
            <details> needs no JavaScript. */}
        <details className="rounded-2xl border border-line bg-white lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-bold">
            <SlidersHorizontal className="h-4 w-4" /> Filter &amp; sort
          </summary>
          <div className="border-t border-line p-5">{filters}</div>
        </details>

        <div>
          {products.length > 0 ? (
            <ProductGrid products={products} priorityCount={4} />
          ) : (
            <div className="rounded-3xl border border-dashed border-line bg-white px-6 py-20 text-center">
              <p className="text-lg font-bold">Nothing matches that yet</p>
              <p className="mt-2 text-sm text-muted">Try fewer filters, or browse everything.</p>
              <Link href="/shop" className="btn-dark mt-6">
                Browse all products
              </Link>
            </div>
          )}

          {pages > 1 && (
            <nav className="mt-14 flex items-center justify-center gap-2" aria-label="Pages">
              {f.page > 1 && (
                <Link href={href({ page: String(f.page - 1) })} className="btn-outline px-4" aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              )}
              <span className="px-4 text-sm font-semibold text-muted">
                Page {f.page} of {pages}
              </span>
              {f.page < pages && (
                <Link href={href({ page: String(f.page + 1) })} className="btn-outline px-4" aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
