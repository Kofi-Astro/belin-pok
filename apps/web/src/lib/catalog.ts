// Public catalog reads, used by server components (pages render real HTML
// with the products in it -- that's what search engines index and what
// WhatsApp/Facebook read for link previews).
//
// Responses are cached for a minute: long enough that a burst of visitors
// doesn't each hit the API, short enough that a restock or price change
// shows up almost immediately.
import { API_BASE_URL } from "./format";
import type { Category, Product, ProductSort } from "./types";

const REVALIDATE_SECONDS = 60;

async function getJson<T>(path: string): Promise<{ data: T; total: number | null } | null> {
  const res = await fetch(`${API_BASE_URL}${path}`, { next: { revalidate: REVALIDATE_SECONDS } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  const total = res.headers.get("x-total-count");
  return { data: (await res.json()) as T, total: total === null ? null : Number(total) };
}

export async function getCategories(): Promise<Category[]> {
  return (await getJson<Category[]>("/public/categories"))?.data ?? [];
}

export async function getCategoryBySlug(slug: string): Promise<Category | undefined> {
  return (await getCategories()).find((c) => c.slug === slug);
}

export type ProductQuery = {
  categoryId?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  sort?: ProductSort;
  limit?: number;
  offset?: number;
};

export async function getProducts(q: ProductQuery = {}): Promise<{ products: Product[]; total: number }> {
  const params = new URLSearchParams();
  if (q.categoryId) params.set("category_id", q.categoryId);
  if (q.search) params.set("search", q.search);
  if (q.minPrice !== undefined) params.set("min_price", String(q.minPrice));
  if (q.maxPrice !== undefined) params.set("max_price", String(q.maxPrice));
  if (q.inStockOnly) params.set("in_stock_only", "true");
  params.set("sort", q.sort ?? "newest");
  params.set("limit", String(q.limit ?? 24));
  params.set("offset", String(q.offset ?? 0));
  const result = await getJson<Product[]>(`/public/products?${params}`);
  return { products: result?.data ?? [], total: result?.total ?? 0 };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  return (await getJson<Product>(`/public/products/by-slug/${encodeURIComponent(slug)}`))?.data ?? null;
}
