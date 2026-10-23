// /shop -- every live product across all categories. The page itself is a
// thin wrapper: filtering (category, size, price range), sorting and
// paging all live in ShopListing, which reads them from the URL's query
// string so a filtered view can be bookmarked or shared, and is shared
// with the per-category pages (app/category/[slug]/page.tsx).
//
// Rendered on the server: the product list arrives as HTML, which is
// faster on a phone and lets search engines index the catalogue.
import type { Metadata } from "next";

import { type ShopParams, ShopListing } from "@/components/ShopListing";
import { getCategories } from "@/lib/catalog";

// Fixed title/description for the browser tab and search results.
export const metadata: Metadata = {
  title: "Shop all",
  description: "Browse every cap, tee, jacket and more in stock at Belin-Pok.",
};

// searchParams is a Promise in Next.js 15+ (it's resolved lazily so pages
// that don't read it can be cached); awaiting it gives the ?query values.
export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopParams> }) {
  return (
    <ShopListing
      params={await searchParams}
      // Where filter links point back to, keeping the visitor on /shop.
      basePath="/shop"
      title="Shop all"
      description="Everything in the shop, newest first."
      // For the category filter chips along the top of the listing.
      categories={await getCategories()}
    />
  );
}
