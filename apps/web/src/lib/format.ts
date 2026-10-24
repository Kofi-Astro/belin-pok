import type { Product, ProductImage, ProductVariant } from "./types";

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

// Ghana cedis, shown the way Ghanaian shoppers expect ("GH₵ 45.00").
const cedis = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" });

export function formatPrice(amount: number): string {
  return cedis.format(amount);
}

export function variantPrice(product: Pick<Product, "base_price">, variant: ProductVariant): number {
  return variant.price_override ?? product.base_price;
}

/** Lowest and highest price across a product's variants (or just its base
 * price when it has none) -- for "From GH₵ 40" on a card whose sizes are
 * priced differently. */
export function priceRange(product: Product): { min: number; max: number } {
  const prices = product.variants.length
    ? product.variants.map((v) => variantPrice(product, v))
    : [product.base_price];
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export function totalStock(product: Product): number {
  return product.variants.reduce((sum, v) => sum + v.stock_quantity, 0);
}

export function primaryImage(product: Pick<Product, "images">): ProductImage | undefined {
  return product.images.find((i) => i.is_primary) ?? product.images[0];
}

/** Product photos are served publicly by the API (GET /images/{path}). */
export function imageUrl(storagePath: string): string {
  return `${API_BASE_URL}/images/${storagePath}`;
}

export function variantLabel(v: Pick<ProductVariant, "size" | "color">): string {
  return v.color ? `${v.color} / ${v.size}` : v.size;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://belpok.xyz").replace(/\/$/, "");
