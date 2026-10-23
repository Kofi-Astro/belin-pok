import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";

import { getCategories } from "@/lib/catalog";
import { CONTACT } from "@/lib/format";

import { Logo } from "./Logo";

export async function Footer() {
  const categories = await getCategories();
  const hasContact = Object.values(CONTACT).some(Boolean);

  return (
    <footer className="mt-24 bg-brand-950 text-white/75">
      <div className="container-page grid gap-12 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Logo light />
          <p className="max-w-xs text-sm leading-relaxed text-white/60">
            Caps, tees, jackets and everyday menswear — for walk-in customers and for businesses buying wholesale.
          </p>
        </div>

        <div>
          <h3 className="mb-4 text-xs font-bold tracking-[0.18em] text-white uppercase">Shop</h3>
          <ul className="space-y-2.5 text-sm">
            <li>
              <Link href="/shop" className="hover:text-white">
                All products
              </Link>
            </li>
            <li>
              <Link href="/shop?sort=newest" className="hover:text-white">
                New arrivals
              </Link>
            </li>
            {categories.slice(0, 6).map((c) => (
              <li key={c.id}>
                <Link href={`/category/${c.slug}`} className="hover:text-white">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-xs font-bold tracking-[0.18em] text-white uppercase">Your account</h3>
          <ul className="space-y-2.5 text-sm">
            <li>
              <Link href="/account" className="hover:text-white">
                Orders &amp; details
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-white">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/register" className="hover:text-white">
                Create an account
              </Link>
            </li>
            <li>
              <Link href="/cart" className="hover:text-white">
                Your cart
              </Link>
            </li>
          </ul>
        </div>

        {/* Only details actually configured for this deployment are shown --
            see CONTACT in lib/format.ts. */}
        {hasContact && (
          <div>
            <h3 className="mb-4 text-xs font-bold tracking-[0.18em] text-white uppercase">Get in touch</h3>
            <ul className="space-y-3 text-sm">
              {CONTACT.whatsapp && (
                <li className="flex items-center gap-2.5">
                  <MessageCircle className="h-4 w-4 text-gold" />
                  <a href={`https://wa.me/${CONTACT.whatsapp.replace(/\D/g, "")}`} className="hover:text-white">
                    WhatsApp us
                  </a>
                </li>
              )}
              {CONTACT.phone && (
                <li className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 text-gold" />
                  <a href={`tel:${CONTACT.phone}`} className="hover:text-white">
                    {CONTACT.phone}
                  </a>
                </li>
              )}
              {CONTACT.email && (
                <li className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-gold" />
                  <a href={`mailto:${CONTACT.email}`} className="hover:text-white">
                    {CONTACT.email}
                  </a>
                </li>
              )}
              {CONTACT.address && (
                <li className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                  <span>{CONTACT.address}</span>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-white/10">
        <p className="container-page py-6 text-xs text-white/45">© {new Date().getFullYear()} Belin-Pok Enterprise</p>
      </div>
    </footer>
  );
}
