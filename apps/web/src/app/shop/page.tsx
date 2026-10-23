import type { Metadata } from "next";

import { type ShopParams, ShopListing } from "@/components/ShopListing";
import { getCategories } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Shop all",
  description: "Browse every cap, tee, jacket and more in stock at Belin-Pok.",
};

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopParams> }) {
  return (
    <ShopListing
      params={await searchParams}
      basePath="/shop"
      title="Shop all"
      description="Everything in the shop, newest first."
      categories={await getCategories()}
    />
  );
}
