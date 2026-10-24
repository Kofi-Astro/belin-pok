// The home page: a banner, the shop's selling points, an optional row of
// hand-picked featured products, category tiles, an optional promotion,
// new arrivals, how to order, a wholesale pitch and where to find the shop. The words, buttons, banner photos and which sections show
// are edited on the admin's Website page (lib/content.ts); the products,
// categories and their photos come live from the catalogue. Server-rendered,
// so it's real HTML for search engines and link previews.
import {
  ArrowRight,
  BellRing,
  Boxes,
  Clock,
  CreditCard,
  Heart,
  type LucideIcon,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Tag,
  Truck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { GarmentArt } from "@/components/GarmentArt";
import { HowToOrder } from "@/components/home/HowToOrder";
import { PromoBanner } from "@/components/home/PromoBanner";
import { VisitShop } from "@/components/home/VisitShop";
import { ProductGrid } from "@/components/ProductCard";
import { getCategories, getProducts } from "@/lib/catalog";
import { contactDetails, getStorefront, type HighlightIcon, isExternal } from "@/lib/content";
import { imageUrl, primaryImage } from "@/lib/format";

// The icons a selling point can use (chosen on the admin's Website page).
const ICONS: Record<HighlightIcon, LucideIcon> = {
  store: Store,
  truck: Truck,
  boxes: Boxes,
  bell: BellRing,
  tag: Tag,
  shield: ShieldCheck,
  star: Star,
  clock: Clock,
  card: CreditCard,
  phone: Phone,
  heart: Heart,
  sparkles: Sparkles,
};

/** A button from the admin: a page on this site, or a full web address
 * (opened in a new tab). Renders nothing without a label. */
function CtaLink({ href, label, className, arrow }: { href: string; label: string; className: string; arrow?: boolean }) {
  if (!label.trim() || !href) return null;
  const inner = (
    <>
      {label} {arrow && <ArrowRight className="h-4 w-4" />}
    </>
  );
  return isExternal(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}

export default async function HomePage() {
  // One newest-first page of products feeds both the "New arrivals" grid
  // and each category tile's photo (the newest product in it), rather
  // than a request per category.
  const [content, categories, { products }] = await Promise.all([
    getStorefront(),
    getCategories(),
    getProducts({ sort: "newest", limit: 100 }),
  ]);
  const { hero, wholesale } = content;

  // category id -> photo of its newest product (products are newest-first,
  // so the first one seen per category wins).
  const tileImage = new Map<string, string>();
  for (const p of products) {
    const img = primaryImage(p);
    if (img && !tileImage.has(p.category_id)) tileImage.set(p.category_id, img.storage_path);
  }
  // Banner photos: the ones uploaded on the Website page, or else the
  // three newest product photos.
  const heroImages = hero.image_paths.length
    ? hero.image_paths
    : (products.map(primaryImage).filter(Boolean) as { storage_path: string }[]).slice(0, 3).map((i) => i.storage_path);
  // Fewer than three *product* photos (a brand-new shop) would look sparse,
  // so that case shows the name instead; uploaded banner photos always show.
  const showPhotos = hero.image_paths.length > 0 || heroImages.length >= 3;

  return (
    <>
      {/* Banner */}
      <section className="relative overflow-hidden bg-brand-900 text-white">
        {/* Decoration only: a faint dot pattern and a soft glow behind the text. */}
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
            {hero.eyebrow && <p className="eyebrow text-gold">{hero.eyebrow}</p>}
            <h1 className="mt-5 text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{hero.title}</h1>
            {hero.subtitle && <p className="mt-6 text-lg leading-relaxed text-white/75">{hero.subtitle}</p>}
            <div className="mt-9 flex flex-wrap gap-3">
              <CtaLink href={hero.primary_link} label={hero.primary_label} className="btn-primary px-8" arrow />
              <CtaLink href={hero.secondary_link} label={hero.secondary_label} className="btn border border-white/30 text-white hover:bg-white/10" />
            </div>
            {/* Phones and tablets: the banner's photos are desktop-only, so
                show a swipeable row of categories instead -- something to
                look at, and a quick way in. */}
            {categories.length > 0 && (
              <div className="-mx-4 mt-10 flex gap-3 overflow-x-auto px-4 pb-1 lg:hidden">
                {categories.slice(0, 8).map((c) => {
                  const photo = c.image_path || tileImage.get(c.id);
                  return (
                    <Link key={c.id} href={`/category/${c.slug}`} className="w-24 shrink-0 text-center">
                      <span className="relative block aspect-square overflow-hidden rounded-2xl bg-white/[0.07] ring-1 ring-white/10">
                        {photo ? <Image src={imageUrl(photo)} alt="" fill sizes="96px" className="object-cover" /> : <GarmentArt name={c.name} dark />}
                      </span>
                      <span className="mt-2 block truncate text-xs font-semibold text-white/80">{c.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Photos: desktop only. Three are fanned out; one or two (uploaded
              on the Website page) sit side by side. */}
          {showPhotos && heroImages.length >= 3 ? (
            <div className="relative hidden h-[30rem] lg:block">
              {heroImages.slice(0, 3).map((path, i) => (
                <div
                  key={path}
                  className={`absolute overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10 ${
                    // Position, size and tilt of each of the three photos.
                    ["top-0 left-8 h-80 w-60 -rotate-3", "top-12 right-4 h-96 w-72 rotate-2", "bottom-0 left-36 h-64 w-52 rotate-1"][i]
                  }`}
                >
                  <Image src={imageUrl(path)} alt="" fill sizes="300px" className="object-cover" priority />
                </div>
              ))}
            </div>
          ) : showPhotos ? (
            <div className={`hidden h-[28rem] gap-4 lg:grid ${heroImages.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
              {heroImages.map((path) => (
                <div key={path} className="relative overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10">
                  <Image src={imageUrl(path)} alt="" fill sizes="(min-width: 1024px) 40vw, 1px" className="object-cover" priority />
                </div>
              ))}
            </div>
          ) : (
            // No photos yet: the first four categories as drawings, so the
            // banner still shows what the shop sells.
            <div className="hidden grid-cols-2 gap-4 lg:grid">
              {(categories.length ? categories.slice(0, 4).map((c) => c.name) : ["Caps", "T-Shirts", "Jackets", "Joggers"]).map((name, i) => (
                <div
                  key={name}
                  className={`relative aspect-square overflow-hidden rounded-3xl bg-white/[0.07] ring-1 ring-white/10 ${i % 2 ? "translate-y-8" : ""}`}
                >
                  <GarmentArt name={name} dark />
                  <span className="absolute bottom-4 left-5 text-sm font-bold tracking-wide text-white/80">{name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Selling points */}
      {content.highlights.length > 0 && (
        <section className="border-b border-line bg-white">
          <div className={`container-page grid grid-cols-2 gap-6 py-8 ${content.highlights.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {content.highlights.map(({ icon, title, text }) => {
              const Icon = ICONS[icon] ?? Store;
              return (
                <div key={title} className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold">{title}</p>
                    {text && <p className="text-xs text-muted">{text}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Featured: hand-picked on the Website page (live products only). */}
      {content.featured.enabled && content.featured_products.length > 0 && (
        <section className="container-page pt-20">
          <div className="mb-8">
            <p className="eyebrow">Hand-picked</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">{content.featured.title}</h2>
            {content.featured.subtitle && <p className="mt-2 max-w-2xl text-muted">{content.featured.subtitle}</p>}
          </div>
          <ProductGrid products={content.featured_products} />
        </section>
      )}

      {/* Shop by category */}
      {content.show_categories && categories.length > 0 && (
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
              // The category's own photo (set in the admin), else its newest
              // product's, else a drawing of the garment.
              const photo = c.image_path || tileImage.get(c.id);
              return (
                <Link key={c.id} href={`/category/${c.slug}`} className="group relative aspect-square overflow-hidden rounded-2xl bg-brand-800">
                  {photo ? (
                    <>
                      <Image
                        src={imageUrl(photo)}
                        alt=""
                        fill
                        sizes="(min-width: 640px) 25vw, 50vw"
                        className="object-cover opacity-85 transition duration-500 group-hover:scale-105"
                      />
                      {/* Darkens the bottom of the photo so the white name stays readable. */}
                      <div className="absolute inset-0 bg-gradient-to-t from-brand-950/85 via-brand-950/20 to-transparent" />
                    </>
                  ) : (
                    <GarmentArt name={c.name} className="transition duration-500 group-hover:scale-105" />
                  )}
                  <div className={`absolute inset-x-0 bottom-0 flex items-center justify-between p-4 ${photo ? "text-white" : "text-ink"}`}>
                    <span className="text-lg font-extrabold">{c.name}</span>
                    <ArrowRight className="h-5 w-5 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <PromoBanner promo={content.promo} />

      {/* New arrivals */}
      {content.show_new_arrivals && (
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
          {/* Two rows on desktop; an empty shop gets a friendly placeholder. */}
          {products.length > 0 ? (
            <ProductGrid products={products.slice(0, 8)} />
          ) : (
            <div className="rounded-3xl border border-dashed border-line bg-white px-6 py-20 text-center">
              <p className="text-lg font-bold">New stock is on its way</p>
              <p className="mt-2 text-sm text-muted">Check back soon — we&apos;re adding products to the shop.</p>
            </div>
          )}
        </section>
      )}

      {content.show_how_to_order && <HowToOrder content={content} whatsapp={contactDetails(content).whatsapp} />}

      {/* Wholesale */}
      {wholesale.enabled && (
        <section className="container-page pt-20">
          <div className="grid overflow-hidden rounded-3xl bg-ink text-white lg:grid-cols-5">
            <div className={`p-10 lg:p-14 ${wholesale.points.length ? "lg:col-span-3" : "lg:col-span-5"}`}>
              {wholesale.eyebrow && <p className="eyebrow text-gold">{wholesale.eyebrow}</p>}
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{wholesale.title}</h2>
              {wholesale.text && <p className="mt-4 max-w-lg leading-relaxed text-white/70">{wholesale.text}</p>}
              <CtaLink href={wholesale.button_link} label={wholesale.button_label} className="btn-primary mt-8" arrow />
            </div>
            {wholesale.points.length > 0 && (
              <div className="grid grid-cols-2 gap-px bg-white/10 lg:col-span-2">
                {wholesale.points.map(({ title, text }) => (
                  <div key={title} className="bg-ink p-6">
                    <p className="font-bold text-gold">{title}</p>
                    {text && <p className="mt-1 text-sm text-white/60">{text}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <VisitShop content={content} />
    </>
  );
}
