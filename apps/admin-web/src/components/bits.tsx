// Small domain-specific pieces shared across screens: thumbnails and the
// status badges for products, orders, customers and stock.
import clsx from "clsx";
import { ImageOff } from "lucide-react";

import { imageUrl, stockLevel, titleCase } from "@/lib/format";
import type { CustomerStatus, OrderStatus, ProductStatus, Variant } from "@/lib/types";

import { Badge, type Tone } from "./ui";

// A square product photo of `size` px, or a placeholder icon when there
// is none. Lazy-loaded: long lists only fetch the photos scrolled to.
export function Thumb({ path, size = 40, className }: { path: string | null | undefined; size?: number; className?: string }) {
  return (
    <span
      className={clsx("flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-canvas ring-1 ring-line", className)}
      style={{ width: size, height: size }}
    >
      {path ? (
        <img src={imageUrl(path)} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <ImageOff className="h-4 w-4 text-muted/60" />
      )}
    </span>
  );
}

// Product status: green Live (the API's "active"), amber Draft, grey
// Archived.
const productTone: Record<ProductStatus, Tone> = { active: "green", draft: "amber", archived: "neutral" };
export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge tone={productTone[status]} dot>
      {status === "active" ? "Live" : titleCase(status)}
    </Badge>
  );
}

// Order status colours: amber waiting on the shop, blue paid, purple
// being sent, green done, grey closed without completing.
const orderTone: Record<OrderStatus, Tone> = {
  pending: "amber",
  paid: "blue",
  packed: "brand",
  shipped: "brand",
  delivered: "green",
  cancelled: "neutral",
  refunded: "neutral",
};
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={orderTone[status]} dot>
      {titleCase(status)}
    </Badge>
  );
}

// Customer account approval.
const customerTone: Record<CustomerStatus, Tone> = { approved: "green", pending: "amber", rejected: "red" };
export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return <Badge tone={customerTone[status]}>{titleCase(status)}</Badge>;
}

// Stock for one SKU: out (red), at/below its alert level (amber), fine
// (green). The thresholds are per SKU -- see stockLevel in lib/format.ts.
export function StockBadge({ variant }: { variant: Pick<Variant, "stock_quantity" | "low_stock_threshold"> }) {
  const level = stockLevel(variant);
  if (level === "out") return <Badge tone="red">Out of stock</Badge>;
  if (level === "low") return <Badge tone="amber">Low · {variant.stock_quantity}</Badge>;
  return <Badge tone="green">{variant.stock_quantity} in stock</Badge>;
}
