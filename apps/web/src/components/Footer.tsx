// The site-wide footer: a short blurb, shop links (including the first few
// categories, so the footer stays in step with what the shop sells),
// account links, and contact details and social links if any are set. The
// blurb, contact details and social links are edited on the admin's Website
// page (lib/content.ts). A server
// component: the categories are fetched once on the server and cached
// with the rest of the catalogue (see lib/catalog.ts).
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";

import { getCategories } from "@/lib/catalog";
import { contactDetails, getStorefront, whatsappLink } from "@/lib/content";

import { Logo } from "./Logo";

export async function Footer() {
  const [categories, content] = await Promise.all([getCategories(), getStorefront()]);
  const contact = contactDetails(content);
  const social = [
    ["Instagram", content.social.instagram],
    ["Facebook", content.social.facebook],
    ["TikTok", content.social.tiktok],
    ["X", content.social.x],
  ].filter(([, url]) => url);
  // Only show the "Get in touch" column if there's something to put in it.
  const hasContact = Object.values(contact).some(Boolean) || social.length > 0;

  return (
    <footer className="mt-24 bg-brand-950 text-white/75">
      <div className="container-page grid gap-12 py-16 sm:grid-cols-2 lg:grid-cols-4">
        {/* Brand column: the logo (light version, for the dark background). */}
        <div className="space-y-4">
          <Logo light />
          {content.footer_blurb && <p className="max-w-xs text-sm leading-relaxed text-white/60">{content.footer_blurb}</p>}
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
            {/* At most six, to keep the column short; /shop lists them all. */}
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

        {/* Only details actually set are shown -- see contactDetails in
            lib/content.ts. */}
        {hasContact && (
          <div>
            <h3 className="mb-4 text-xs font-bold tracking-[0.18em] text-white uppercase">Get in touch</h3>
            <ul className="space-y-3 text-sm">
              {contact.whatsapp && (
                <li className="flex items-center gap-2.5">
                  <MessageCircle className="h-4 w-4 text-gold" />
                  <a href={whatsappLink(contact.whatsapp)} className="hover:text-white">
                    WhatsApp us
                  </a>
                </li>
              )}
              {contact.phone && (
                <li className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 text-gold" />
                  <a href={`tel:${contact.phone}`} className="hover:text-white">
                    {contact.phone}
                  </a>
                </li>
              )}
              {contact.email && (
                <li className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-gold" />
                  <a href={`mailto:${contact.email}`} className="hover:text-white">
                    {contact.email}
                  </a>
                </li>
              )}
              {contact.address && (
                <li className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                  <span>{contact.address}</span>
                </li>
              )}
            </ul>
            {/* Social pages, as plain labelled links. */}
            {social.length > 0 && (
              <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {social.map(([label, url]) => (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-white hover:text-gold">
                    {label}
                  </a>
                ))}
              </p>
            )}
          </div>
        )}
      </div>
      {/* Copyright line; the year updates itself. */}
      <div className="border-t border-white/10">
        <p className="container-page py-6 text-xs text-white/45">© {new Date().getFullYear()} Belin-Pok Enterprise</p>
      </div>
    </footer>
  );
}
