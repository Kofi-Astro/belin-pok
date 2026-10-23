// In-store vs online prices -- a mirror of services/api/app/pricing.py, so
// the admin can show what shoppers will pay online. The prices staff enter
// are in-store prices (what the till charges); online prices add the
// shop's markup, rounded *up* to the rounding step, unless a variant has
// its own fixed online price. The server is what actually charges these.
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { Product, ShopSettings, Variant } from "./types";

export function useShopSettings() {
  return useQuery({ queryKey: ["shop-settings"], queryFn: () => api.get<ShopSettings>("/settings"), staleTime: 60_000 });
}

export function applyMarkup(inStore: number, s: Pick<ShopSettings, "online_markup_percent" | "online_price_rounding">): number {
  let raw = inStore * (1 + s.online_markup_percent / 100);
  // Rounding up in whole cents first keeps float noise (93.50000001)
  // from tipping a price over to the next step.
  raw = Math.round(raw * 100) / 100;
  if (s.online_price_rounding > 0) raw = Math.ceil(raw / s.online_price_rounding - 1e-9) * s.online_price_rounding;
  return Math.round(raw * 100) / 100;
}

export const inStorePrice = (p: Pick<Product, "base_price">, v: Variant) => v.price_override ?? p.base_price;

export function onlinePrice(p: Pick<Product, "base_price">, v: Variant, s: ShopSettings | undefined): number | null {
  if (v.online_price !== null) return v.online_price;
  return s ? applyMarkup(inStorePrice(p, v), s) : null;
}
