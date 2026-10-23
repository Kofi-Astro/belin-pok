// /products/<slug> -- one product: photos, name, price, size/colour
// picker and Add to cart (the BuyBox), delivery notes, description, and
// a few more from the same category. Server-rendered from the public
// catalogue API, so prices are the online prices (in-store price plus
// the shop's online markup -- see app/pricing.py in the API) and
// wholesale or pack prices never reach this page.
import { Boxes, Store, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BuyBox } from "@/components/BuyBox";
import { Gallery } from "@/components/Gallery";
import { ProductGrid } from "@/components/ProductCard";
import { getCategories, getProductBySlug, getProducts } from "@/lib/catalog";
import { SITE_URL, imageUrl, primaryImage, priceRange, totalStock } from "@/lib/format";

// The slug from the URL; a Promise in Next.js 15+.
type Props = { params: Promise<{ slug: string }> };

// Also what WhatsApp, Facebook and X read when someone shares the link:
// title, a short description, and the product photo.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  if (!product) return {};
  const image = primaryImage(product);
  const description =
    product.description?.slice(0, 160) ?? `${product.name} — available now at Belin-Pok, retail and wholesale.`;
  return {
    title: product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      images: image ? [{ url: imageUrl(image.storage_path) }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Props) {
  // Draft, archived or unknown products come back as null -> 404 page.
  // (This fetch is shared with generateMetadata above: Next.js dedupes
  // identical requests within one render.)
  const product = await getProductBySlug((await params).slug);
  if (!product) notFound();

  // "More from <category>": fetch 5 so there are still 4 once this
  // product itself is filtered out.
  const [categories, { products: sameCategory }] = await Promise.all([
    getCategories(),
    getProducts({ categoryId: product.category_id, limit: 5 }),
  ]);
  const category = categories.find((c) => c.id === product.category_id);
  const related = sameCategory.filter((p) => p.id !== product.id).slice(0, 4);
  // Cheapest and dearest size, for the search-engine data below (sizes
  // can be priced differently).
  const { min, max } = priceRange(product);
  const image = primaryImage(product);

  // schema.org Product data: lets search engines show price and stock
  // right in the results.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    image: image ? imageUrl(image.storage_path) : undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    sku: product.variants[0]?.sku,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "GHS",
      lowPrice: min,
      highPrice: max,
      offerCount: product.variants.length,
      availability: totalStock(product) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${SITE_URL}/products/${product.slug}`,
    },
  };

  return (
    <div className="container-page py-10">
      {/* The structured data, embedded the way search engines expect it. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Home / Category / Product -- links back up the catalogue. */}
      <nav className="mb-8 text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        <span className="mx-2">/</span>
        {category && (
          <>
            <Link href={`/category/${category.slug}`} className="hover:text-ink">
              {category.name}
            </Link>
            <span className="mx-2">/</span>
          </>
        )}
        <span className="text-ink">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Left column (top on phones): photos. Right: everything else. */}
        <Gallery images={product.images} name={product.name} />

        <div className="lg:pt-4">
          {product.brand && <p className="eyebrow text-muted">{product.brand}</p>}
          <h1 className="mt-2 text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">{product.name}</h1>
          {category && (
            <Link href={`/category/${category.slug}`} className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
              {category.name}
            </Link>
          )}

          {/* Size/colour choice, price, stock and Add to cart -- client-side,
             since it reacts to what the shopper picks. */}
          <div className="mt-8">
            <BuyBox product={product} />
          </div>

          {/* How getting the item works: pickup, delivery, and wholesale. */}
          <ul className="mt-10 divide-y divide-line rounded-2xl border border-line bg-white">
            <li className="flex gap-4 p-5">
              <Store className="h-5 w-5 shrink-0 text-brand-700" />
              <div>
                <p className="text-sm font-bold">Pick up in store</p>
                <p className="text-sm text-muted">Choose pickup at checkout and collect when it&apos;s ready.</p>
              </div>
            </li>
            <li className="flex gap-4 p-5">
              <Truck className="h-5 w-5 shrink-0 text-brand-700" />
              <div>
                <p className="text-sm font-bold">Delivery</p>
                <p className="text-sm text-muted">We confirm your order and arrange delivery with you directly.</p>
              </div>
            </li>
            <li className="flex gap-4 p-5">
              <Boxes className="h-5 w-5 shrink-0 text-brand-700" />
              <div>
                <p className="text-sm font-bold">Buying in bulk?</p>
                <p className="text-sm text-muted">
                  Businesses can get wholesale and pack pricing.{" "}
                  <Link href="/wholesale" className="font-semibold text-brand-700 hover:underline">
                    See how
                  </Link>
                </p>
              </div>
            </li>
          </ul>

          {product.description && (
            <div className="mt-10">
              <h2 className="label">About this item</h2>
              {/* pre-line keeps the line breaks staff typed in the description. */}
              <p className="leading-relaxed whitespace-pre-line text-ink/85">{product.description}</p>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-24">
          <h2 className="mb-8 text-2xl font-extrabold tracking-tight">More {category ? `from ${category.name}` : "to shop"}</h2>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
