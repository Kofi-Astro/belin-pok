import Link from "next/link";

import { getCategories } from "@/lib/catalog";
import { getStorefront } from "@/lib/content";

import { AccountLink, CartButton, MobileMenu, SearchBox } from "./HeaderClient";
import { Logo } from "./Logo";

/** Site header: announcement strip (its wording, and whether it shows,
 * set on the admin's Website page), then logo / category nav / search /
 * account / cart. A server component, so the category links are in the
 * HTML from the first byte (and crawlable); only the interactive bits are
 * client components (HeaderClient.tsx). */
export async function Header() {
  const [categories, { announcement }] = await Promise.all([getCategories(), getStorefront()]);

  return (
    <header className="sticky top-0 z-40">
      {/* Announcement strip; the extra part only fits on wider screens. */}
      {announcement.enabled && announcement.text && (
        <div className="bg-brand-950 text-white">
          <p className="container-page py-2 text-center text-xs font-semibold tracking-wide">
            {announcement.text}
            {announcement.extra && (
              <span className="hidden sm:inline">
                <span className="mx-2 text-white/40">·</span>
                {announcement.extra}
              </span>
            )}
          </p>
        </div>
      )}

      <div className="border-b border-line bg-white/95 backdrop-blur">
        <div className="container-page flex h-18 items-center gap-4 lg:gap-8">
          {/* Menu button: phones and tablets only (hidden on desktop). */}
          <MobileMenu categories={categories} />
          <Logo />

          {/* Desktop: the first six categories inline; the rest via Shop all. */}
          <nav className="hidden items-center gap-6 lg:flex" aria-label="Categories">
            <Link href="/shop" className="text-sm font-bold text-ink hover:text-accent">
              Shop all
            </Link>
            {categories.slice(0, 6).map((c) => (
              <Link key={c.id} href={`/category/${c.slug}`} className="text-sm font-semibold text-ink/75 hover:text-accent">
                {c.name}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <SearchBox />
            <AccountLink />
            <CartButton />
          </div>
        </div>
      </div>
    </header>
  );
}
