import { ArrowRight, BellRing, Boxes, Store, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ProductGrid } from "@/components/ProductCard";
import { getCategories, getProducts } from "@/lib/catalog";
import { imageUrl, primaryImage } from "@/lib/format";

export default async function HomePage() {
  // One newest-first page of products feeds both the "New arrivals" grid
  // and each category tile's photo (the newest product in it), rather
  // than a request per category.
  const [categories, { products }] = await Promise.all([getCategories(), getProducts({ sort: "newest", limit: 100 })]);

  const tileImage = new Map<string, string>();
  for (const p of products) {
    const img = primaryImage(p);
    if (img && !tileImage.has(p.category_id)) tileImage.set(p.category_id, img.storage_path);
  }
  const heroImages = products.map(primaryImage).filter(Boolean).slice(0, 3) as { storage_path: string }[];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-brand-900 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="absolute -top-40 -right-40 h-[32rem] w-[32rem] rounded-full bg-accent/25 blur-3xl" />
        <div className="container-page relative grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div className="max-w-xl">
            <p className="eyebrow text-gold">New season · Now in store</p>
            <h1 className="mt-5 text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Everyday menswear, stocked deep.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-white/75">
              Caps, tees, jackets and the rest of the wardrobe — for the walk-in shopper and the business buying by the
              dozen.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/shop?sort=newest" className="btn-primary px-8">
                Shop new arrivals <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/wholesale" className="btn border border-white/30 text-white hover:bg-white/10">
                Buying wholesale?
              </Link>
            </div>
          </div>

          {heroImages.length >= 3 ? (
            <div className="relative hidden h-[30rem] lg:block">
              {heroImages.map((img, i) => (
                <div
                  key={img.storage_path}
                  className={`absolute overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10 ${
                    ["top-0 left-8 h-80 w-60 -rotate-3", "top-12 right-4 h-96 w-72 rotate-2", "bottom-0 left-36 h-64 w-52 rotate-1"][i]
                  }`}
                >
                  <Image src={imageUrl(img.storage_path)} alt="" fill sizes="300px" className="object-cover" priority />
                </div>
              ))}
            </div>
          ) : (
            <div className="hidden h-80 items-center justify-center rounded-3xl border border-white/10 bg-white/5 lg:flex">
              <p className="text-2xl font-extrabold text-white/30">Belin-Pok</p>
            </div>
          )}
        </div>
      </section>

      {/* Why shop here */}
      <section className="border-b border-line bg-white">
        <div className="container-page grid grid-cols-2 gap-6 py-8 lg:grid-cols-4">
          {[
            { icon: Store, title: "Pick up in store", text: "Order online, collect at the shop" },
            { icon: Truck, title: "Or get it delivered", text: "We arrange delivery after you order" },
            { icon: Boxes, title: "Wholesale pricing", text: "Pack and bulk rates for businesses" },
            { icon: BellRing, title: "Back-in-stock alerts", text: "Get notified when sizes return" },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold">{title}</p>
                <p className="text-xs text-muted">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Shop by category */}
      {categories.length > 0 && (
        <section className="container-page pt-20">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Browse</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Shop by category</h2>
            </div>
            <Link href="/shop" className="hidden text-sm font-bold text-brand-700 hover:underline sm:block">
              View everything
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {categories.map((c) => {
              const photo = tileImage.get(c.id);
              return (
                <Link
                  key={c.id}
                  href={`/category/${c.slug}`}
                  className="group relative aspect-square overflow-hidden rounded-2xl bg-brand-800"
                >
                  {photo && (
                    <Image
                      src={imageUrl(photo)}
                      alt=""
                      fill
                      sizes="(min-width: 640px) 25vw, 50vw"
                      className="object-cover opacity-80 transition duration-500 group-hover:scale-105"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-brand-950/85 via-brand-950/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-4 text-white">
                    <span className="text-lg font-extrabold">{c.name}</span>
                    <ArrowRight className="h-5 w-5 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* New arrivals */}
      <section className="container-page pt-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Just landed</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">New arrivals</h2>
          </div>
          <Link href="/shop?sort=newest" className="text-sm font-bold text-brand-700 hover:underline">
            Shop all new
          </Link>
        </div>
        {products.length > 0 ? (
          <ProductGrid products={products.slice(0, 8)} />
        ) : (
          <div className="rounded-3xl border border-dashed border-line bg-white px-6 py-20 text-center">
            <p className="text-lg font-bold">New stock is on its way</p>
            <p className="mt-2 text-sm text-muted">Check back soon — we&apos;re adding products to the shop.</p>
          </div>
        )}
      </section>

      {/* Wholesale */}
      <section className="container-page pt-20">
        <div className="grid overflow-hidden rounded-3xl bg-ink text-white lg:grid-cols-5">
          <div className="p-10 lg:col-span-3 lg:p-14">
            <p className="eyebrow text-gold">For businesses</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Stocking your own shop?</h2>
            <p className="mt-4 max-w-lg leading-relaxed text-white/70">
              Approved wholesale customers get bulk and factory-pack pricing, and can buy on account. Tell us about your
              business and we&apos;ll set you up.
            </p>
            <Link href="/wholesale" className="btn-primary mt-8">
              How wholesale works <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/10 lg:col-span-2">
            {[
              ["Pack pricing", "Factory-sealed packs at a better unit price"],
              ["Bulk rates", "Wholesale prices on loose units"],
              ["Buy on account", "Credit for approved businesses"],
              ["One supplier", "Caps to joggers in one order"],
            ].map(([title, text]) => (
              <div key={title} className="bg-ink p-6">
                <p className="font-bold text-gold">{title}</p>
                <p className="mt-1 text-sm text-white/60">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
