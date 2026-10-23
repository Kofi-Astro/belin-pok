import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { type ShopParams, ShopListing } from "@/components/ShopListing";
import { getCategories, getCategoryBySlug } from "@/lib/catalog";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<ShopParams> };

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
  const [category, categories] = await Promise.all([getCategoryBySlug(slug), getCategories()]);
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
