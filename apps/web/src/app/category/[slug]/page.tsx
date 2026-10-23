// /category/<slug> -- one category's products (e.g. /category/caps). The
// same listing as /shop (see components/ShopListing.tsx), pre-filtered to
// this category and titled with its name and description. Slugs come from
// the categories the shop sets up in the admin (Admin → Categories).
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { type ShopParams, ShopListing } from "@/components/ShopListing";
import { getCategories, getCategoryBySlug } from "@/lib/catalog";

// Both are Promises in Next.js 15+: the slug from the URL path, and the
// ?query values (filters, sort, page) that ShopListing reads.
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<ShopParams> };

/** The browser-tab title and search-result description, per category.
 * Falls back to a generic line if the shop hasn't written a description.
 * An unknown slug gets no metadata here; the page itself shows the 404. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = await getCategoryBySlug((await params).slug);
  if (!category) return {};
  return {
    title: category.name,
    description: category.description ?? `Shop ${category.name.toLowerCase()} at Belin-Pok — retail and wholesale.`,
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  // Fetched together: this category (for the heading and filter) and all
  // of them (for the chips to hop to a neighbouring category).
  const [category, categories] = await Promise.all([getCategoryBySlug(slug), getCategories()]);
  // A mistyped or retired category shows the shop's 404 page.
  if (!category) notFound();
  return (
    <ShopListing
      params={await searchParams}
      basePath={`/category/${slug}`}
      title={category.name}
      description={category.description ?? undefined}
      category={category}
      categories={categories}
    />
  );
}
