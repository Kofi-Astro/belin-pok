import type { MetadataRoute } from "next";

import { getCategories, getProducts } from "@/lib/catalog";
import { SITE_URL } from "@/lib/format";

// Regenerated at most hourly -- every active product and category, so
// search engines find new stock without waiting to stumble on it.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const categories = await getCategories();
  const products = [];
  for (let offset = 0; ; offset += 200) {
    const page = await getProducts({ limit: 200, offset });
    products.push(...page.products);
    if (products.length >= page.total || page.products.length === 0) break;
  }
  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/shop`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/wholesale`, changeFrequency: "monthly", priority: 0.5 },
    ...categories.map((c) => ({ url: `${SITE_URL}/category/${c.slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...products.map((p) => ({ url: `${SITE_URL}/products/${p.slug}`, lastModified: p.created_at, priority: 0.7 })),
  ];
}
