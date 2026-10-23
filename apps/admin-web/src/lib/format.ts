import { API_BASE_URL } from "./session";
import type { Product, ProductImage, Variant } from "./types";

const cedis = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" });
export const money = (n: number) => cedis.format(n);

const compact = new Intl.NumberFormat("en-GH", { notation: "compact", maximumFractionDigits: 1 });
export const compactNumber = (n: number) => compact.format(n);

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const date = (iso: string) => new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

/** "3 min ago", "yesterday", or a date -- for activity feeds. */
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return date(iso);
}

export const imageUrl = (storagePath: string) => `${API_BASE_URL}/images/${storagePath}`;

export const primaryImage = (p: { images: ProductImage[] }) => p.images.find((i) => i.is_primary) ?? p.images[0];

export const variantPrice = (p: Pick<Product, "base_price">, v: Variant) => v.price_override ?? p.base_price;

export const variantLabel = (v: Pick<Variant, "size" | "color">) => (v.color ? `${v.size} · ${v.color}` : v.size);

export const totalStock = (p: { variants: Variant[] }) => p.variants.reduce((n, v) => n + v.stock_quantity, 0);

export function stockLevel(v: Pick<Variant, "stock_quantity" | "low_stock_threshold">): "out" | "low" | "ok" {
  if (v.stock_quantity === 0) return "out";
  return v.stock_quantity <= v.low_stock_threshold ? "low" : "ok";
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
