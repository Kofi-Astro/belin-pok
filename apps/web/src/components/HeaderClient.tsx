// The interactive pieces of the site header -- cart button, account link,
// search box and the phone menu. They're split out from Header.tsx (a
// server component) because each needs browser state: the cart, the
// session, or whether a panel is open. The rest of the header stays
// server-rendered.
"use client";

import { Menu, Search, ShoppingBag, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import type { Category } from "@/lib/types";

import { Logo } from "./Logo";

// Shared look for the round icon buttons: 44px (h-11) so they're easy to
// hit with a thumb.
const iconButton =
  "relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-brand-50 hover:text-brand-700";

// Opens the cart drawer, with a badge for the number of units in the cart.
export function CartButton() {
  const { count, setDrawerOpen } = useCart();
  return (
    <button type="button" className={iconButton} onClick={() => setDrawerOpen(true)} aria-label={`Cart, ${count} items`}>
      <ShoppingBag className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

// To /account when signed in (with a small green dot), else to /login.
export function AccountLink() {
  const { status, customer } = useAuth();
  const signedIn = status === "signedIn";
  return (
    <Link
      href={signedIn ? "/account" : "/login"}
      className={iconButton}
      aria-label={signedIn ? `Your account (${customer?.full_name})` : "Sign in"}
      title={signedIn ? customer?.full_name : "Sign in"}
    >
      <User className="h-5 w-5" />
      {signedIn && <span className="absolute right-2.5 bottom-2.5 h-2 w-2 rounded-full bg-success ring-2 ring-white" />}
    </Link>
  );
}

/** Icon on small screens that expands into a field; a full field on wide ones.
 * Submits to /shop?q=..., which is a normal page -- so search results are
 * shareable links too. */
export function SearchBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/shop?q=${encodeURIComponent(q)}` : "/shop");
    setOpen(false);
  };

  return (
    <>
      {/* Tablet/desktop: an always-visible field that widens on focus. */}
      <form onSubmit={submit} className="relative hidden md:block" role="search">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search caps, tees, jackets…"
          aria-label="Search products"
          className="h-11 w-56 rounded-full border border-line bg-canvas pr-4 pl-10 text-sm focus:w-72 focus:border-brand-600 focus:bg-white focus:outline-none lg:w-64"
          style={{ transition: "width 150ms" }}
        />
      </form>
      {/* Phone: just an icon, opening a full-width bar over the header. */}
      <button type="button" className={`${iconButton} md:hidden`} onClick={() => setOpen(true)} aria-label="Search">
        <Search className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-x-0 top-0 z-50 border-b border-line bg-white p-4 shadow-lg md:hidden">
          <form onSubmit={submit} className="flex items-center gap-2" role="search">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              aria-label="Search products"
              className="field"
            />
            <button type="button" className={iconButton} onClick={() => setOpen(false)} aria-label="Close search">
              <X className="h-5 w-5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

// The slide-in menu on phones and tablets (the desktop header lists the
// categories inline instead).
export function MobileMenu({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close after navigating.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button type="button" className={`${iconButton} -ml-2 lg:hidden`} onClick={() => setOpen(true)} aria-label="Menu">
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          {/* Dimmed backdrop; tapping it closes the menu. */}
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line p-4">
              <Logo />
              <button type="button" className={iconButton} onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              <Link href="/shop" className="block rounded-xl px-4 py-3 font-bold text-ink hover:bg-brand-50">
                Shop all
              </Link>
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/category/${c.slug}`}
                  className="block rounded-xl px-4 py-3 font-semibold text-ink/80 hover:bg-brand-50"
                >
                  {c.name}
                </Link>
              ))}
            </nav>
            <div className="border-t border-line p-4 text-sm">
              <Link href="/account" className="font-semibold text-brand-700">
                My account &amp; orders
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
